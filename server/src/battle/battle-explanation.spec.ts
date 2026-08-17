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

  it('frames an Even matchup and closes as a coin flip', () => {
    const text = buildExplanation({
      advantageDirection: 'Even',
      confidenceTier: 'Low',
      resolvedOutcome: 'Lose',
      teamA: mine,
      teamB: opponent,
      lookup: noData,
      topAxisDelta: { axis: 'control', delta: 0.1 },
      axisDeltas: [{ axis: 'control', delta: 0.1 }],
      highSkillSwingHero: null,
    }).join(' ');

    expect(text).toMatch(/close matchup with no clear favorite \(Low confidence\)/);
    expect(text).toMatch(/came up just short in what was essentially a coin flip/);
  });

  it('frames opponent favorite, High Skill swing, and upset reasons', () => {
    const lookup: MatchupLookup = {
      getMatchupWinRate: (a, b) => (a === 2 && b === 13 ? 0.66 : null),
      getSynergyWinRate: (a, b) =>
        (a === 2 && b === 5) || (b === 2 && a === 5) ? 0.61 : null,
      getWinRate: () => 0.5,
    };
    const text = buildExplanation({
      advantageDirection: 'B',
      confidenceTier: 'High',
      resolvedOutcome: 'Win',
      teamA: mine,
      teamB: opponent,
      lookup,
      topAxisDelta: { axis: 'control', delta: -0.8 },
      axisDeltas: [
        { axis: 'control', delta: -0.8 },
        { axis: 'initiating', delta: 0.9 },
      ],
      highSkillSwingHero: hero(2, 'Storm Spirit', { initiating: 8 }),
    }).join(' ');

    expect(text).toMatch(/Opponent's draft leaned ahead overall \(High confidence\)/);
    expect(text).toMatch(/Storm Spirit's own play was the deciding swing/);
    expect(text).toMatch(/On top of that, your draft had real advantages/);
    expect(text).toMatch(/Storm Spirit's individual matchup into Shadow Fiend/);
    expect(text).toMatch(/Storm Spirit \+ Dazzle/);
    expect(text).toMatch(/led in initiation potential/);
  });

  it('describes tempo-vs-scaling clock split and early tempo winners', () => {
    const tempoMine = mine.map((p, i) =>
      pick(p.hero.id, p.hero.name, p.assignedRole, {
        tempo: 8,
        scaling: 3,
        initiating: i === 1 ? 8 : 3,
        saving: i === 4 ? 8 : 3,
      }),
    );
    const scaleOpp = opponent.map((p, i) =>
      pick(p.hero.id, p.hero.name, p.assignedRole, {
        tempo: 3,
        scaling: 8,
        initiating: i === 2 ? 8 : 3,
        saving: 3,
      }),
    );
    const text = buildExplanation({
      advantageDirection: 'A',
      confidenceTier: 'Moderate',
      resolvedOutcome: 'Win',
      teamA: tempoMine,
      teamB: scaleOpp,
      lookup: noData,
      topAxisDelta: { axis: 'tempo', delta: 1 },
      axisDeltas: [
        { axis: 'tempo', delta: 1 },
        { axis: 'scaling', delta: -1 },
      ],
      highSkillSwingHero: null,
    }).join(' ');

    expect(text).toMatch(/Your draft wants this over now/);
    expect(text).toMatch(/the opponent's draft is the one that gets paid/);
    expect(text).toMatch(/15–20 minute window/);
  });

  it('describes a late-scaling winning side when tempos are tied', () => {
    const scaleMine = mine.map((p) =>
      pick(p.hero.id, p.hero.name, p.assignedRole, { tempo: 4, scaling: 9, initiating: 3, saving: 3 }),
    );
    const flatOpp = opponent.map((p) =>
      pick(p.hero.id, p.hero.name, p.assignedRole, { tempo: 4, scaling: 4, initiating: 3, saving: 3 }),
    );
    const text = buildExplanation({
      advantageDirection: 'A',
      confidenceTier: 'Moderate',
      resolvedOutcome: 'Win',
      teamA: scaleMine,
      teamB: flatOpp,
      lookup: noData,
      topAxisDelta: { axis: 'scaling', delta: 1 },
      axisDeltas: [{ axis: 'scaling', delta: 1.2 }],
      highSkillSwingHero: null,
    }).join(' ');

    expect(text).toMatch(/scales harder than it plays early/);
    expect(text).toMatch(/30\+ minute window/);
    expect(text).toMatch(/your draft's real pull is late-game scaling/);
  });

  it('covers opponent-only fight shape, save, and axis lead', () => {
    const passiveMine = [
      pick(1, 'Anti-Mage', 'Carry', { initiating: 2, saving: 2, scaling: 8 }),
      pick(2, 'Sniper', 'Mid', { initiating: 2, saving: 2 }),
      pick(3, 'Medusa', 'Offlane', { initiating: 2, saving: 2 }),
      pick(4, 'Warlock', 'Soft Support', { initiating: 2, saving: 2 }),
      pick(5, 'Witch Doctor', 'Hard Support', { initiating: 2, saving: 2 }),
    ];
    const aggressiveOpp = [
      pick(11, 'Phantom Assassin', 'Carry', { initiating: 3, saving: 2 }),
      pick(13, 'Shadow Fiend', 'Mid', { initiating: 3, saving: 2 }),
      pick(14, 'Axe', 'Offlane', { initiating: 9, saving: 2 }),
      pick(12, 'Earthshaker', 'Soft Support', { initiating: 3, saving: 2 }),
      pick(15, 'Dazzle', 'Hard Support', { initiating: 2, saving: 9 }),
    ];
    const text = buildExplanation({
      advantageDirection: 'B',
      confidenceTier: 'Moderate',
      resolvedOutcome: 'Lose',
      teamA: passiveMine,
      teamB: aggressiveOpp,
      lookup: noData,
      topAxisDelta: { axis: 'initiating', delta: -1 },
      axisDeltas: [
        { axis: 'initiating', delta: -1.2 },
        { axis: 'saving', delta: -1.0 },
      ],
      highSkillSwingHero: null,
    }).join(' ');

    expect(text).toMatch(/Anti-Mage is the one who starts fights on your side; Axe is the one who has to answer/);
    expect(text).toMatch(/Dazzle is the save the opponent brought/);
    expect(text).toMatch(/opponent's draft is the one leading in/);
    expect(text).toMatch(/That edge held up here/);
  });

  it('covers carry coin-flip matchup, opponent tag-only board, shutdown and hard-carry tax', () => {
    const lookup: MatchupLookup = {
      getMatchupWinRate: (a, b) => (a === 1 && b === 11 ? 0.5 : null),
      getSynergyWinRate: () => null,
      getWinRate: () => 0.5,
    };
    const withBm = [...opponent.slice(0, 4), pick(16, 'Beastmaster', 'Hard Support')];
    const text = buildExplanation({
      advantageDirection: 'A',
      confidenceTier: 'Moderate',
      resolvedOutcome: 'Win',
      teamA: mine,
      teamB: withBm,
      lookup,
      topAxisDelta: emptyDeltas[3],
      axisDeltas: emptyDeltas,
      highSkillSwingHero: null,
      shutdownHeroesA: [hero(1, 'Anti-Mage')],
      shutdownHeroesB: [hero(11, 'Phantom Assassin'), hero(14, 'Axe')],
      hardCarryCountA: 3,
      hardCarryCountB: 4,
    }).join(' ');

    expect(text).toMatch(/individual matchup is a coin flip \(50%\)/);
    expect(text).toMatch(/theirs has/);
    expect(text).toMatch(/Anti-Mage is in shutdown/);
    expect(text).toMatch(/Phantom Assassin and Axe on the other side are similarly boxed in/);
    expect(text).toMatch(/Three hard-carries on your side/);
    expect(text).toMatch(/opponent stacked 4 hard-carries/);
  });

  it('covers opponent-owned carry matchup and a second catch plus leftover combo', () => {
    const lookup: MatchupLookup = {
      getMatchupWinRate: (a, b) => {
        if (a === 1 && b === 11) return 0.35;
        if (a === 2 && b === 14) return 0.72;
        if (a === 3 && b === 15) return 0.68;
        return null;
      },
      getSynergyWinRate: (a, b) => {
        if ((a === 2 && b === 5) || (b === 2 && a === 5)) return 0.63;
        if ((a === 14 && b === 15) || (b === 14 && a === 15)) return 0.6;
        return null;
      },
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

    expect(text).toMatch(/Phantom Assassin owns that matchup at 65%/);
    expect(text).toMatch(/catch that actually matters for your draft is Storm Spirit into Axe \(72%\)/);
    expect(text).toMatch(/Tidehunter into Lion \(68%\) is a second real hole/);
    expect(text).toMatch(/Storm Spirit \+ Dazzle is a real pairing on the winning side/);
    expect(text).toMatch(/the opponent still had/);
  });

  it('joins three shutdown names with an oxford comma', () => {
    const text = buildExplanation({
      advantageDirection: 'A',
      confidenceTier: 'Moderate',
      resolvedOutcome: 'Lose',
      teamA: mine,
      teamB: opponent,
      lookup: noData,
      topAxisDelta: emptyDeltas[3],
      axisDeltas: emptyDeltas,
      highSkillSwingHero: null,
      shutdownHeroesA: [hero(1, 'Anti-Mage'), hero(2, 'Storm Spirit'), hero(3, 'Tidehunter')],
    }).join(' ');

    expect(text).toMatch(/Anti-Mage, Storm Spirit, and Tidehunter are in shutdown/);
    expect(text).toMatch(/opponent's draft had real advantages of its own/);
  });

  it('skips catches at the exact 50% floor and still narrates null carry matchup', () => {
    const lookup: MatchupLookup = {
      getMatchupWinRate: (a, b) => {
        if (a === 1 && b === 11) return null;
        return 0.5;
      },
      getSynergyWinRate: () => 0.5,
      getWinRate: () => 0.5,
    };
    const text = buildExplanation({
      advantageDirection: 'Even',
      confidenceTier: 'Moderate',
      resolvedOutcome: 'Win',
      teamA: mine,
      teamB: opponent,
      lookup,
      topAxisDelta: { axis: 'control', delta: 0 },
      axisDeltas: [{ axis: 'control', delta: 0.05 }],
      highSkillSwingHero: null,
    }).join(' ');

    expect(text).not.toMatch(/catch that actually matters/);
    expect(text).toMatch(/There isn't a real individual matchup row for Anti-Mage into Phantom Assassin/);
    expect(text).toMatch(/came out on top in what was essentially a coin flip/);
  });

  it('narrates a lane without a numeric lean when winRate is null', () => {
    const lanes: BattleLaneResult[] = [
      {
        lane: 'mid',
        mine: ['Storm Spirit'],
        opponent: ['Shadow Fiend'],
        winner: 'mine',
        winRate: null,
        mineIds: [2],
        opponentIds: [13],
        topPair: { hero: 'Storm Spirit', heroId: 2, vs: 'Shadow Fiend', vsId: 13, winRate: 0.66 },
      },
    ];
    const text = buildExplanation({
      advantageDirection: 'A',
      confidenceTier: 'Moderate',
      resolvedOutcome: 'Win',
      teamA: mine,
      teamB: opponent,
      lookup: noData,
      topAxisDelta: emptyDeltas[3],
      axisDeltas: emptyDeltas,
      highSkillSwingHero: null,
      lanes,
    }).join(' ');

    expect(text).toMatch(/Lanes weren't a wash/);
    expect(text).toMatch(/leans this way because Storm Spirit into Shadow Fiend is a real matchup edge/);
  });
});
