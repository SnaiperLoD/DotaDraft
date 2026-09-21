import type { BattleLaneResult, Hero, HeroEvaluationValues } from 'shared';
import { makeHero, DEFAULT_EVALUATION_VALUES } from '../test-utils/hero-factory';
import { buildExplanation } from './battle-explanation';
import type { BattlePick, MatchupLookup } from './battle-resolution';
import { flattenLocalized } from '../test-utils/localized-text';

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

  it('names one lane and prefers a save over who starts fights', () => {
    const lookup: MatchupLookup = {
      getMatchupWinRate: (heroId, vsId) => {
        if (heroId === 1 && vsId === 11) return 0.58;
        if (heroId === 1 && vsId === 14) return 0.7;
        if (heroId === 11 && vsId === 3) return 0.71;
        return null;
      },
      getSynergyWinRate: (a, b) => ((a === 2 && b === 5) || (b === 2 && a === 5) ? 0.62 : null),
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

    const text = flattenLocalized(
      buildExplanation({
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
      }),
    );

    expect(text).toMatch(/battle.explain.lane.oppHunt/);
    expect(text).not.toMatch(/battle.explain.lane.mineLean/);
    expect(text).toMatch(/Phantom Assassin/);
    expect(text).toMatch(/Tidehunter/);
    expect(text).toMatch(/71/);
    expect(text).not.toMatch(/battle.explain.shape.duel/);
    expect(text).toMatch(/battle.explain.shape.saveMine/);
    expect(text).toMatch(/Dazzle/);
    expect(text).not.toMatch(/battle.explain.carry/);
    expect(text).not.toMatch(/battle.explain.combo/);
    expect(text).not.toMatch(/battle.explain.clock/);
    expect(text).not.toMatch(/battle.explain.sheet/);
    expect(text).toMatch(/battle.explain.close.favoredHeld/);
    expect(text.toLowerCase()).not.toMatch(/took roshan|aegis|buyback|catapult/);
  });

  it('names a visible tag and stays silent on hidden calibration tags', () => {
    const withCm = [...mine.slice(0, 4), pick(5, 'Crystal Maiden', 'Hard Support', { saving: 8 })];
    const withBm = [...opponent.slice(0, 4), pick(16, 'Beastmaster', 'Hard Support')];
    const text = flattenLocalized(
      buildExplanation({
        advantageDirection: 'A',
        confidenceTier: 'Moderate',
        resolvedOutcome: 'Win',
        teamA: withCm,
        teamB: withBm,
        lookup: noData,
        topAxisDelta: emptyDeltas[3],
        axisDeltas: emptyDeltas,
        highSkillSwingHero: null,
      }),
    );

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
    const text = flattenLocalized(
      buildExplanation({
        advantageDirection: 'A',
        confidenceTier: 'Moderate',
        resolvedOutcome: 'Win',
        teamA: mine,
        teamB: opponent,
        lookup,
        topAxisDelta: emptyDeltas[3],
        axisDeltas: emptyDeltas,
        highSkillSwingHero: null,
      }),
    );

    expect(text).not.toMatch(/battle.explain.catch/);
    expect(text).not.toMatch(/battle.explain.combo.win/);
  });

  it('frames an Even matchup and closes as a coin flip', () => {
    const text = flattenLocalized(
      buildExplanation({
        advantageDirection: 'Even',
        confidenceTier: 'Low',
        resolvedOutcome: 'Lose',
        teamA: mine,
        teamB: opponent,
        lookup: noData,
        topAxisDelta: { axis: 'control', delta: 0.1 },
        axisDeltas: [{ axis: 'control', delta: 0.1 }],
        highSkillSwingHero: null,
      }),
    );

    expect(text).toMatch(/battle.explain.frame.even/);
    expect(text).toMatch(/Low/);
    expect(text).toMatch(/battle.explain.close.evenLose/);
  });

  it('frames opponent favorite, High Skill swing, and upset reasons', () => {
    const lookup: MatchupLookup = {
      getMatchupWinRate: (a, b) => (a === 2 && b === 13 ? 0.66 : null),
      getSynergyWinRate: (a, b) => ((a === 2 && b === 5) || (b === 2 && a === 5) ? 0.61 : null),
      getWinRate: () => 0.5,
    };
    const text = flattenLocalized(
      buildExplanation({
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
      }),
    );

    expect(text).toMatch(/battle.explain.frame.ahead/);
    expect(text).toMatch(/opponent/);
    expect(text).toMatch(/High/);
    expect(text).toMatch(/battle.explain.highSkill/);
    expect(text).toMatch(/Storm Spirit/);
    expect(text).toMatch(/battle.explain.upset.reasons/);
    expect(text).toMatch(/top/);
    expect(text).toMatch(/Shadow Fiend/);
    expect(text).toMatch(/Dazzle/);
    expect(text).toMatch(/initiating/);
  });

  it('keeps the Roshan window off the card', () => {
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
    const text = flattenLocalized(
      buildExplanation({
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
      }),
    );

    expect(text).not.toMatch(/battle.explain.clock/);
    expect(text).toMatch(/battle.explain.frame.ahead/);
    expect(text).toMatch(/battle.explain.close.favoredHeld/);
    expect(text).not.toMatch(/15–20/);
  });

  it('does not paste the axis sheet onto the card', () => {
    const scaleMine = mine.map((p) =>
      pick(p.hero.id, p.hero.name, p.assignedRole, { tempo: 4, scaling: 9, initiating: 3, saving: 3 }),
    );
    const flatOpp = opponent.map((p) =>
      pick(p.hero.id, p.hero.name, p.assignedRole, { tempo: 4, scaling: 4, initiating: 3, saving: 3 }),
    );
    const text = flattenLocalized(
      buildExplanation({
        advantageDirection: 'A',
        confidenceTier: 'Moderate',
        resolvedOutcome: 'Win',
        teamA: scaleMine,
        teamB: flatOpp,
        lookup: noData,
        topAxisDelta: { axis: 'scaling', delta: 1 },
        axisDeltas: [{ axis: 'scaling', delta: 1.2 }],
        highSkillSwingHero: null,
      }),
    );

    expect(text).not.toMatch(/battle.explain.clock/);
    expect(text).not.toMatch(/battle.explain.sheet/);
    expect(text).toMatch(/battle.explain.frame.ahead/);
    expect(text).toMatch(/scaling/);
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
    const text = flattenLocalized(
      buildExplanation({
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
      }),
    );

    expect(text).not.toMatch(/battle.explain.shape.duel/);
    expect(text).toMatch(/battle.explain.shape.saveOpp/);
    expect(text).toMatch(/Dazzle/);
    expect(text).not.toMatch(/battle.explain.sheet/);
    expect(text).toMatch(/battle.explain.close.underdogHeld/);
  });

  it('covers carry coin-flip matchup, opponent tag-only board, shutdown and hard-carry tax', () => {
    const lookup: MatchupLookup = {
      getMatchupWinRate: (a, b) => (a === 1 && b === 11 ? 0.5 : null),
      getSynergyWinRate: () => null,
      getWinRate: () => 0.5,
    };
    const withBm = [...opponent.slice(0, 4), pick(16, 'Beastmaster', 'Hard Support')];
    const text = flattenLocalized(
      buildExplanation({
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
      }),
    );

    expect(text).not.toMatch(/battle.explain.carry/);
    expect(text).toMatch(/battle.explain.tags/);
    expect(text).toMatch(/battle.explain.shutdown.mine/);
    expect(text).toMatch(/Anti-Mage/);
    expect(text).toMatch(/battle.explain.shutdown.opp/);
    expect(text).toMatch(/Phantom Assassin/);
    expect(text).toMatch(/Axe/);
    expect(text).toMatch(/battle.explain.hardCarry.mine/);
    expect(text).toMatch(/3/);
    expect(text).toMatch(/battle.explain.hardCarry.opp/);
    expect(text).toMatch(/4/);
  });

  it('does not retell catches and combos on the card', () => {
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
    const text = flattenLocalized(
      buildExplanation({
        advantageDirection: 'A',
        confidenceTier: 'Moderate',
        resolvedOutcome: 'Win',
        teamA: mine,
        teamB: opponent,
        lookup,
        topAxisDelta: emptyDeltas[3],
        axisDeltas: emptyDeltas,
        highSkillSwingHero: null,
      }),
    );

    expect(text).not.toMatch(/battle.explain.catch/);
    expect(text).not.toMatch(/battle.explain.combo/);
    expect(text).not.toMatch(/battle.explain.carry/);
    expect(text).toMatch(/battle.explain.shape.saveMine/);
    expect(text).toMatch(/Dazzle/);
    expect(text).toMatch(/battle.explain.close.favoredHeld/);
  });

  it('joins three shutdown names with an oxford comma', () => {
    const text = flattenLocalized(
      buildExplanation({
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
      }),
    );

    expect(text).toMatch(/battle.explain.shutdown.mine/);
    expect(text).toMatch(/Anti-Mage/);
    expect(text).toMatch(/Storm Spirit/);
    expect(text).toMatch(/Tidehunter/);
    expect(text).toMatch(/3/);
    expect(text).toMatch(/battle.explain.upset.reasons/);
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
    const text = flattenLocalized(
      buildExplanation({
        advantageDirection: 'Even',
        confidenceTier: 'Moderate',
        resolvedOutcome: 'Win',
        teamA: mine,
        teamB: opponent,
        lookup,
        topAxisDelta: { axis: 'control', delta: 0 },
        axisDeltas: [{ axis: 'control', delta: 0.05 }],
        highSkillSwingHero: null,
      }),
    );

    expect(text).not.toMatch(/battle.explain.catch/);
    expect(text).not.toMatch(/battle.explain.carry/);
    expect(text).toMatch(/battle.explain.close.evenWin/);
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
    const text = flattenLocalized(
      buildExplanation({
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
      }),
    );

    expect(text).not.toMatch(/battle.explain.lanes.wash/);
    expect(text).toMatch(/battle.explain.lane.mineHunt/);
    expect(text).toMatch(/Storm Spirit/);
    expect(text).toMatch(/Shadow Fiend/);
  });

  it('prefers the save over who starts the fights', () => {
    const soloInitMine = [
      pick(1, 'Anti-Mage', 'Carry', { scaling: 9, initiating: 2 }),
      pick(2, 'Storm Spirit', 'Mid', { initiating: 9, tempo: 8 }),
      pick(3, 'Tidehunter', 'Offlane', { initiating: 2, control: 8 }),
      pick(4, 'Earth Spirit', 'Soft Support', { initiating: 2 }),
      pick(5, 'Dazzle', 'Hard Support', { saving: 9, tempo: 7 }),
    ];
    const softOpp = [
      pick(11, 'Phantom Assassin', 'Carry', { scaling: 7, initiating: 2 }),
      pick(13, 'Shadow Fiend', 'Mid', { initiating: 2 }),
      pick(14, 'Axe', 'Offlane', { initiating: 2 }),
      pick(12, 'Earthshaker', 'Soft Support', { initiating: 2 }),
      pick(15, 'Lion', 'Hard Support', { saving: 2 }),
    ];
    const lookup: MatchupLookup = {
      getMatchupWinRate: (a, b) => (a === 1 && b === 11 ? 0.7 : null),
      getSynergyWinRate: () => null,
      getWinRate: () => 0.5,
    };
    const text = flattenLocalized(
      buildExplanation({
        advantageDirection: 'A',
        confidenceTier: 'Moderate',
        resolvedOutcome: 'Win',
        teamA: soloInitMine,
        teamB: softOpp,
        lookup,
        topAxisDelta: { axis: 'initiating', delta: 1 },
        axisDeltas: [{ axis: 'initiating', delta: 1.2 }],
        highSkillSwingHero: null,
      }),
    );

    expect(text).not.toMatch(/battle.explain.shape.duel/);
    expect(text).toMatch(/battle.explain.shape.saveMine/);
    expect(text).toMatch(/Dazzle/);
    expect(text).not.toMatch(/battle.explain.carry/);
  });

  it('covers carry matchup owner differing from the scaler', () => {
    const lookup: MatchupLookup = {
      getMatchupWinRate: (a, b) => (a === 1 && b === 11 ? 0.35 : null),
      getSynergyWinRate: () => null,
      getWinRate: () => 0.5,
    };
    const text = flattenLocalized(
      buildExplanation({
        advantageDirection: 'A',
        confidenceTier: 'Moderate',
        resolvedOutcome: 'Win',
        teamA: mine,
        teamB: opponent,
        lookup,
        topAxisDelta: emptyDeltas[3],
        axisDeltas: emptyDeltas,
        highSkillSwingHero: null,
      }),
    );

    expect(text).not.toMatch(/battle.explain.carry/);
    expect(text).toMatch(/battle.explain.close.favoredHeld/);
  });

  function explainLanes(lanes: BattleLaneResult[]): string {
    return flattenLocalized(
      buildExplanation({
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
      }),
    );
  }

  function laneAt(
    lane: BattleLaneResult['lane'],
    winRate: number,
    pairHero: string,
    pairVs: string,
  ): BattleLaneResult {
    const winner: BattleLaneResult['winner'] = winRate > 0.5 ? 'mine' : winRate < 0.5 ? 'opponent' : 'even';
    return {
      lane,
      mine: [pairHero],
      opponent: [pairVs],
      winner,
      winRate,
      mineIds: [1],
      opponentIds: [11],
      topPair:
        winner === 'even'
          ? null
          : {
              hero: pairHero,
              heroId: 1,
              vs: pairVs,
              vsId: 11,
              winRate: winner === 'mine' ? winRate : 1 - winRate,
            },
    };
  }

  it('calls even lanes even when every lane % is within 3.5pp of 50%', () => {
    const text = explainLanes([
      laneAt('safe', 0.535, 'Anti-Mage', 'Axe'),
      laneAt('mid', 0.512, 'Storm Spirit', 'Shadow Fiend'),
      laneAt('off', 0.465, 'Tidehunter', 'Phantom Assassin'),
    ]);

    expect(text).toMatch(/battle.explain.lanes.even/);
    expect(text).not.toMatch(/battle.explain.lanes.uneven/);
    expect(text).not.toMatch(/battle.explain.lanes.wash/);
    expect(text).not.toMatch(/battle.explain.lane.mineLean/);
    expect(text).not.toMatch(/battle.explain.lane.oppHole/);
    expect(text).not.toMatch(/battle.explain.lane.mineEdge/);
    expect(text).not.toMatch(/battle.explain.lane.oppEdge/);
  });

  it('keeps won/lost lane wording when a lean sits just outside 3.5pp', () => {
    const text = explainLanes([
      laneAt('safe', 0.536, 'Anti-Mage', 'Axe'),
      laneAt('mid', 0.536, 'Storm Spirit', 'Shadow Fiend'),
      laneAt('off', 0.536, 'Tidehunter', 'Phantom Assassin'),
    ]);

    expect(text).not.toMatch(/battle.explain.lanes.uneven/);
    expect(text).toMatch(/battle.explain.lane.mineLean/);
    expect(text).not.toMatch(/battle.explain.lanes.even/);
  });

  it('does not use the all-even phrase when only some lanes are within 3.5pp', () => {
    const text = explainLanes([
      laneAt('safe', 0.512, 'Anti-Mage', 'Axe'),
      laneAt('mid', 0.62, 'Storm Spirit', 'Shadow Fiend'),
      laneAt('off', 0.41, 'Tidehunter', 'Phantom Assassin'),
    ]);

    expect(text).not.toMatch(/battle.explain.lanes.even/);
    expect(text).not.toMatch(/battle.explain.lanes.uneven/);
    expect(text).toMatch(/battle.explain.lane.mineHunt/);
    expect(text).not.toMatch(/battle.explain.lane.oppHole/);
    expect(text).toMatch(/Storm Spirit/);
    expect(text).not.toMatch(/Tidehunter/);
  });
});
