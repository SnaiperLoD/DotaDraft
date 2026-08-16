import type { BattleLaneResult, Hero, HeroEvaluationValues } from 'shared';
import { makeHero, DEFAULT_EVALUATION_VALUES } from '../test-utils/hero-factory';
import { buildExplanation } from './battle-explanation';
import type { BattlePick, MatchupLookup } from './battle-resolution';

function hero(id: number, name: string, axisOverrides: Partial<HeroEvaluationValues> = {}): Hero {
  return makeHero({ id, name, evaluation_values: { ...DEFAULT_EVALUATION_VALUES, ...axisOverrides } });
}

function pick(
  id: number,
  name: string,
  role: string | null,
  axes: Partial<HeroEvaluationValues> = {},
): BattlePick {
  return { hero: hero(id, name, axes), assignedRole: role };
}

const noData: MatchupLookup = {
  getMatchupWinRate: () => null,
  getSynergyWinRate: () => null,
  getWinRate: () => null,
};

const emptyDeltas: { axis: keyof HeroEvaluationValues; delta: number }[] = [
  { axis: 'teamfight', delta: 0 },
  { axis: 'tempo', delta: 0 },
  { axis: 'scaling', delta: 0 },
  { axis: 'control', delta: 0.8 },
  { axis: 'initiating', delta: 0.6 },
  { axis: 'saving', delta: -0.5 },
];

describe('buildExplanation', () => {
  const mine = [
    pick(1, 'Anti-Mage', 'Carry', { scaling: 9, initiating: 3 }),
    pick(2, 'Storm Spirit', 'Mid', { initiating: 8, tempo: 8 }),
    pick(3, 'Tidehunter', 'Offlane', { initiating: 7, control: 8 }),
    pick(4, 'Earth Spirit', 'Soft Support', { initiating: 6 }),
    pick(5, 'Dazzle', 'Hard Support', { saving: 8, tempo: 7 }),
  ];
  const opponent = [
    pick(11, 'Phantom Assassin', 'Carry', { scaling: 7 }),
    pick(13, 'Shadow Fiend', 'Mid', { initiating: 5 }),
    pick(14, 'Axe', 'Offlane', { initiating: 8 }),
    pick(12, 'Earthshaker', 'Soft Support', { initiating: 6 }),
    pick(15, 'Lion', 'Hard Support', { saving: 4 }),
  ];

  it('pulls lanes, carry late, fight shape, and real pair % into one write-up', () => {
    const lookup: MatchupLookup = {
      getMatchupWinRate: (heroId, vsId) => {
        if (heroId === 1 && vsId === 11) return 0.58;
        if (heroId === 1 && vsId === 14) return 0.7;
        if (heroId === 11 && vsId === 3) return 0.71;
        return null;
      },
      getSynergyWinRate: (a, b) =>
        (a === 2 && b === 5) || (b === 2 && a === 5) ? 0.62 : null,
      getWinRate: () => 0.5,
    };
    const lanes: BattleLaneResult[] = [
      {
        lane: 'safe',
        mine: ['Anti-Mage', 'Dazzle'],
        opponent: ['Axe', 'Earthshaker'],
        winner: 'mine',
        winRate: 0.62,
        mineIds: [1, 5],
        opponentIds: [14, 12],
        topPair: { hero: 'Anti-Mage', heroId: 1, vs: 'Axe', vsId: 14, winRate: 0.7 },
      },
      {
        lane: 'mid',
        mine: ['Storm Spirit'],
        opponent: ['Shadow Fiend'],
        winner: 'even',
        winRate: 0.5,
        mineIds: [2],
        opponentIds: [13],
        topPair: null,
      },
      {
        lane: 'off',
        mine: ['Tidehunter', 'Earth Spirit'],
        opponent: ['Phantom Assassin', 'Lion'],
        winner: 'opponent',
        winRate: 0.41,
        mineIds: [3, 4],
        opponentIds: [11, 15],
        topPair: { hero: 'Phantom Assassin', heroId: 11, vs: 'Tidehunter', vsId: 3, winRate: 0.71 },
      },
    ];

    const text = buildExplanation({
      advantageDirection: 'A',
      confidenceTier: 'Moderate',
      resolvedOutcome: 'Win',
      teamA: mine,
      teamB: opponent,
      lookup,
      topAxisDelta: emptyDeltas[3],
      axisDeltas: emptyDeltas,
      highSkillSwingHero: null,
      lanes,
    }).join(' ');

    expect(text).toMatch(/Anti-Mage into Axe \(70%\)/);
    expect(text).toMatch(/Phantom Assassin into Tidehunter is a 71% hole/);
    expect(text).not.toMatch(/mid was/);
    expect(text).toMatch(/Storm Spirit is the one who starts fights/);
    expect(text).toMatch(/Axe is the one who has to answer/);
    expect(text).toMatch(/Dazzle is the only one on the board who actually saves/);
    expect(text).toMatch(/Anti-Mage against Phantom Assassin/);
    expect(text).toMatch(/Anti-Mage owns that matchup at 58%/);
    expect(text).toMatch(/Storm Spirit \+ Dazzle/);
    expect(text).toMatch(/That advantage held up/);
    expect(text.toLowerCase()).not.toMatch(/took roshan|aegis|buyback|catapult/);
  });

  it('names a visible tag and stays silent on hidden calibration tags', () => {
    const withCm = [...mine.slice(0, 4), pick(5, 'Crystal Maiden', 'Hard Support', { saving: 8 })];
    const withBm = [...opponent.slice(0, 4), pick(16, 'Beastmaster', 'Hard Support')];
    const text = buildExplanation({
      advantageDirection: 'A',
      confidenceTier: 'Moderate',
      resolvedOutcome: 'Win',
      teamA: withCm,
      teamB: withBm,
      lookup: noData,
      topAxisDelta: emptyDeltas[3],
      axisDeltas: emptyDeltas,
      highSkillSwingHero: null,
    }).join(' ');

    expect(text).toMatch(/Mana Booster/);
    expect(text).not.toMatch(/Summoning Sickness/);
    expect(text).not.toMatch(/Raid Boss/);
  });

  it('does not invent a catch below 50%', () => {
    const lookup: MatchupLookup = {
      getMatchupWinRate: () => 0.42,
      getSynergyWinRate: () => 0.44,
      getWinRate: () => 0.5,
    };
    const text = buildExplanation({
      advantageDirection: 'A',
      confidenceTier: 'Moderate',
      resolvedOutcome: 'Win',
      teamA: mine,
      teamB: opponent,
      lookup,
      topAxisDelta: emptyDeltas[3],
      axisDeltas: emptyDeltas,
      highSkillSwingHero: null,
    }).join(' ');

    expect(text).not.toMatch(/catch that actually matters/);
    expect(text).not.toMatch(/real pairing on the winning side/);
  });
});
