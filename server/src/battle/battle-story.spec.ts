import type { BattleLaneResult } from 'shared';
import { makeHero, DEFAULT_EVALUATION_VALUES } from '../test-utils/hero-factory';
import { buildBattleStory } from './battle-story';
import type { BattlePick, MatchupLookup } from './battle-resolution';
import type { HeroEvaluationValues } from 'shared';

function pick(id: number, name: string, role: string, axes: Partial<HeroEvaluationValues> = {}): BattlePick {
  return {
    hero: makeHero({
      id,
      name,
      evaluation_values: { ...DEFAULT_EVALUATION_VALUES, ...axes },
    }),
    assignedRole: role,
  };
}

function roster(startId: number, prefix: string, axes: Partial<HeroEvaluationValues> = {}): BattlePick[] {
  return [
    pick(startId, `${prefix} Carry`, 'Carry', axes),
    pick(startId + 1, `${prefix} Mid`, 'Mid', axes),
    pick(startId + 2, `${prefix} Offlane`, 'Offlane', axes),
    pick(startId + 3, `${prefix} Soft`, 'Soft Support', axes),
    pick(startId + 4, `${prefix} Hard`, 'Hard Support', axes),
  ];
}

const mine = roster(1, 'Radiant');
const opponent = roster(11, 'Dire');

const noData: MatchupLookup = {
  getMatchupWinRate: () => null,
  getSynergyWinRate: () => null,
  getWinRate: () => null,
};

function lanes(winners: Array<BattleLaneResult['winner']>): BattleLaneResult[] {
  const ids: BattleLaneResult['lane'][] = ['safe', 'mid', 'off'];
  return ids.map((lane, i) => ({
    lane,
    mine: [`Radiant ${lane}`],
    opponent: [`Dire ${lane}`],
    winner: winners[i] ?? 'even',
    winRate: winners[i] === 'mine' ? 0.58 : winners[i] === 'opponent' ? 0.42 : 0.5,
    mineIds: [],
    opponentIds: [],
    topPair: null,
  }));
}

const aheadLanes = lanes(['mine', 'mine', 'even']);
const behindLanes = lanes(['opponent', 'opponent', 'even']);
const evenLanes = lanes(['even', 'even', 'even']);

describe('buildBattleStory', () => {
  it('returns four beats with a short lane tally, not a lane-summary dump', () => {
    const story = buildBattleStory({
      resolvedOutcome: 'Win',
      advantageDirection: 'A',
      lanes: aheadLanes,
      mine,
      opponent,
      lookup: noData,
      topAxis: 'tempo',
    });

    expect(story.isUpset).toBe(false);
    expect(story.cameFromBehind).toBe(false);
    expect(story.beats.map((beat) => beat.phase)).toEqual(['opening', 'turn', 'conversion', 'finish']);
    expect(story.beats.map((beat) => beat.key)).toEqual([
      'openingAhead',
      'turningAxis',
      'conversionRoshanMid',
      'finishHeld',
    ]);
    expect(story.beats[0].params).toMatchObject({
      winnerSide: 'yours',
      winnerLanes: '2',
      loserLanes: '0',
      matchupWinner: '',
      topAxis: 'tempo',
      driver: 'Radiant Carry',
      turner: '',
      comboA: '',
      comboB: '',
    });
    expect(story.beats[0].params).not.toHaveProperty('lanes');
    expect(story.beats[0].evidence.lanes).toEqual([
      { lane: 'safe', winner: 'mine' },
      { lane: 'mid', winner: 'mine' },
      { lane: 'off', winner: 'even' },
    ]);
  });

  it('names the winning side’s real >50% matchup on a Lose, not the player’s best row', () => {
    const lookup: MatchupLookup = {
      getMatchupWinRate: (heroId, vsId) => {
        if (heroId === 12 && vsId === 1) return 0.72;
        if (heroId === 1 && vsId === 15) return 0.68;
        return 0.48;
      },
      getSynergyWinRate: () => null,
      getWinRate: () => 0.5,
    };

    const story = buildBattleStory({
      resolvedOutcome: 'Lose',
      advantageDirection: 'B',
      lanes: aheadLanes,
      mine,
      opponent,
      lookup,
    });

    expect(story.beats[1].key).toBe('turningCatch');
    expect(story.beats[0].params).toMatchObject({
      winnerSide: 'opponent',
      matchupWinner: 'Dire Mid',
      matchupLoser: 'Radiant Carry',
      matchupWinRate: '72',
    });
    expect(story.beats[1].evidence.matchup).toEqual({ winnerId: 12, loserId: 1 });
  });

  it('calls a 54% pair an edge, not a hunt', () => {
    const lookup: MatchupLookup = {
      getMatchupWinRate: (heroId, vsId) => (heroId === 12 && vsId === 1 ? 0.54 : 0.48),
      getSynergyWinRate: () => null,
      getWinRate: () => 0.5,
    };
    const story = buildBattleStory({
      resolvedOutcome: 'Lose',
      advantageDirection: 'B',
      lanes: aheadLanes,
      mine,
      opponent,
      lookup,
    });
    expect(story.beats[1].key).toBe('turningEdge');
    expect(story.beats[1].params.matchupWinRate).toBe('54');
  });

  it('does not narrate a catch when the best matchup is still ≤50%', () => {
    const lookup: MatchupLookup = {
      getMatchupWinRate: () => 0.47,
      getSynergyWinRate: () => null,
      getWinRate: () => 0.5,
    };
    const story = buildBattleStory({
      resolvedOutcome: 'Win',
      advantageDirection: 'A',
      lanes: aheadLanes,
      mine,
      opponent,
      lookup,
      topAxis: 'control',
    });
    expect(story.beats[1].key).toBe('turningAxis');
    expect(story.beats[1].params.matchupWinner).toBe('');
    expect(story.beats[1].evidence.matchup).toBeUndefined();
  });

  it('uses comeback keys when the winner lost the lanes', () => {
    const story = buildBattleStory({
      resolvedOutcome: 'Win',
      advantageDirection: 'A',
      lanes: behindLanes,
      mine,
      opponent,
      lookup: noData,
      topAxis: 'scaling',
    });

    expect(story.cameFromBehind).toBe(true);
    expect(story.isUpset).toBe(false);
    expect(story.beats.map((beat) => beat.key)).toEqual([
      'openingComeback',
      'turningAxis',
      'conversionRoshanMid',
      'finishComeback',
    ]);
    expect(story.beats[0].params.posture).toBe('behind');
  });

  it('treats even lanes as even, not as an “ahead” opening', () => {
    const story = buildBattleStory({
      resolvedOutcome: 'Win',
      advantageDirection: 'A',
      lanes: evenLanes,
      mine,
      opponent,
      lookup: noData,
    });

    expect(story.cameFromBehind).toBe(false);
    expect(story.beats[0].key).toBe('openingEven');
    expect(story.beats[0].params.winnerLanes).toBe('0');
    expect(story.beats[0].evidence.lanes?.every((lane) => lane.winner === 'even')).toBe(true);
  });

  it('uses upset opening/finish when the underdog wins, High Skill on the turn when nothing else lands', () => {
    const withoutSkill = buildBattleStory({
      resolvedOutcome: 'Win',
      advantageDirection: 'B',
      lanes: behindLanes,
      mine,
      opponent,
      lookup: noData,
      topAxis: 'burst',
    });
    expect(withoutSkill.isUpset).toBe(true);
    expect(withoutSkill.cameFromBehind).toBe(true);
    expect(withoutSkill.beats[0].key).toBe('openingUpset');
    expect(withoutSkill.beats[1].key).toBe('turningAxis');
    expect(withoutSkill.beats[3].key).toBe('finishUpset');

    const withSkill = buildBattleStory({
      resolvedOutcome: 'Lose',
      advantageDirection: 'A',
      lanes: aheadLanes,
      mine,
      opponent,
      lookup: noData,
      highSkillSwingHeroName: 'Dire Mid',
    });
    expect(withSkill.isUpset).toBe(true);
    expect(withSkill.beats[1].key).toBe('turningUpsetHighSkill');
    expect(withSkill.beats[1].params.swingHero).toBe('Dire Mid');
  });

  it('names the highest initiating winner as fight driver, not skirmish', () => {
    const drivenMine = [
      pick(1, 'Radiant Carry', 'Carry', { initiating: 8, skirmish_rate: 2 }),
      pick(2, 'Radiant Mid', 'Mid', { initiating: 4, skirmish_rate: 9 }),
      pick(3, 'Radiant Offlane', 'Offlane'),
      pick(4, 'Radiant Soft', 'Soft Support'),
      pick(5, 'Radiant Hard', 'Hard Support'),
    ];
    const story = buildBattleStory({
      resolvedOutcome: 'Win',
      advantageDirection: 'A',
      lanes: aheadLanes,
      mine: drivenMine,
      opponent,
      lookup: noData,
    });
    expect(story.beats[0].params.driver).toBe('Radiant Carry');
  });

  it('names a high-saving winner as turner and ignores a default saving 3', () => {
    const withSaver = [
      pick(1, 'Radiant Carry', 'Carry', { initiating: 9 }),
      pick(2, 'Radiant Mid', 'Mid'),
      pick(3, 'Radiant Offlane', 'Offlane'),
      pick(4, 'Radiant Soft', 'Soft Support'),
      pick(5, 'Radiant Hard', 'Hard Support', { saving: 8 }),
    ];
    const withSaverStory = buildBattleStory({
      resolvedOutcome: 'Win',
      advantageDirection: 'A',
      lanes: aheadLanes,
      mine: withSaver,
      opponent,
      lookup: noData,
    });
    expect(withSaverStory.beats[0].params.turner).toBe('Radiant Hard');
    expect(withSaverStory.beats[0].params.driver).toBe('Radiant Carry');

    const defaultStory = buildBattleStory({
      resolvedOutcome: 'Win',
      advantageDirection: 'A',
      lanes: aheadLanes,
      mine,
      opponent,
      lookup: noData,
    });
    expect(defaultStory.beats[0].params.turner).toBe('');
  });

  it('narrates a combo only when synergy is actually above 50%', () => {
    const lookup: MatchupLookup = {
      getMatchupWinRate: () => null,
      getSynergyWinRate: (a, b) => (a === 1 && b === 2 ? 0.62 : 0.44),
      getWinRate: () => 0.5,
    };
    const story = buildBattleStory({
      resolvedOutcome: 'Win',
      advantageDirection: 'A',
      lanes: aheadLanes,
      mine,
      opponent,
      lookup,
    });
    expect(story.beats[1].key).toBe('turningCombo');
    expect(story.beats[1].params).toMatchObject({
      comboA: 'Radiant Carry',
      comboB: 'Radiant Mid',
      comboWinRate: '62',
    });

    const weak: MatchupLookup = {
      getMatchupWinRate: () => null,
      getSynergyWinRate: () => 0.49,
      getWinRate: () => 0.5,
    };
    const weakStory = buildBattleStory({
      resolvedOutcome: 'Win',
      advantageDirection: 'A',
      lanes: aheadLanes,
      mine,
      opponent,
      lookup: weak,
    });
    expect(weakStory.beats[1].key).toBe('turningAxis');
    expect(weakStory.beats[1].params.comboA).toBe('');
  });

  it('uses catch+combo together when both pairs clear 50%', () => {
    const lookup: MatchupLookup = {
      getMatchupWinRate: (heroId, vsId) => (heroId === 2 && vsId === 11 ? 0.66 : 0.48),
      getSynergyWinRate: (a, b) => (a === 1 && b === 2 ? 0.61 : null),
      getWinRate: () => 0.5,
    };
    const story = buildBattleStory({
      resolvedOutcome: 'Win',
      advantageDirection: 'A',
      lanes: aheadLanes,
      mine,
      opponent,
      lookup,
    });
    expect(story.beats[1].key).toBe('turningCatchCombo');
    expect(story.beats[1].params).toMatchObject({
      matchupWinner: 'Radiant Mid',
      matchupLoser: 'Dire Carry',
      comboA: 'Radiant Carry',
      comboB: 'Radiant Mid',
    });
  });

  it('picks a Roshan window from winning-side tempo vs scaling, not a recorded take', () => {
    const earlyMine = roster(1, 'Radiant', { tempo: 7, scaling: 3 });
    const lateMine = roster(1, 'Radiant', { tempo: 3, scaling: 7 });
    const early = buildBattleStory({
      resolvedOutcome: 'Win',
      advantageDirection: 'A',
      lanes: aheadLanes,
      mine: earlyMine,
      opponent,
      lookup: noData,
    });
    const late = buildBattleStory({
      resolvedOutcome: 'Win',
      advantageDirection: 'A',
      lanes: aheadLanes,
      mine: lateMine,
      opponent,
      lookup: noData,
    });
    expect(early.beats[2].key).toBe('conversionRoshanEarly');
    expect(early.beats[2].params.roshanBand).toBe('15–20');
    expect(late.beats[2].key).toBe('conversionRoshanLate');
    expect(late.beats[2].params.roshanBand).toBe('30+');
  });

  it('names both carries late with the real matchup and who scales', () => {
    const scaledMine = [
      pick(1, 'Radiant Carry', 'Carry', { scaling: 8 }),
      pick(2, 'Radiant Mid', 'Mid'),
      pick(3, 'Radiant Offlane', 'Offlane'),
      pick(4, 'Radiant Soft', 'Soft Support'),
      pick(5, 'Radiant Hard', 'Hard Support'),
    ];
    const lookup: MatchupLookup = {
      getMatchupWinRate: (heroId, vsId) => (heroId === 1 && vsId === 11 ? 0.61 : null),
      getSynergyWinRate: () => null,
      getWinRate: () => 0.5,
    };
    const story = buildBattleStory({
      resolvedOutcome: 'Win',
      advantageDirection: 'A',
      lanes: aheadLanes,
      mine: scaledMine,
      opponent,
      lookup,
    });
    expect(story.beats[3].key).toBe('finishHeld');
    expect(story.beats[3].params).toMatchObject({
      myCarry: 'Radiant Carry',
      theirCarry: 'Dire Carry',
      lateMatchupWinner: 'Radiant Carry',
      carryWinRate: '61',
      scaleLeader: 'Radiant Carry',
    });
  });

  it('hooks the opening to the winning side’s strongest real lane pair', () => {
    const withPair: BattleLaneResult[] = aheadLanes.map((lane) =>
      lane.lane === 'safe'
        ? {
            ...lane,
            topPair: { hero: 'Radiant Carry', heroId: 1, vs: 'Dire Offlane', vsId: 13, winRate: 0.67 },
          }
        : lane,
    );
    const story = buildBattleStory({
      resolvedOutcome: 'Win',
      advantageDirection: 'A',
      lanes: withPair,
      mine,
      opponent,
      lookup: noData,
    });
    expect(story.beats[0].params).toMatchObject({
      openingLane: 'safe',
      openingPairHero: 'Radiant Carry',
      openingPairVs: 'Dire Offlane',
      openingPairWinRate: '67',
    });
  });

  it('names lead after each beat from lanes + outcome, without resolving the pit', () => {
    const held = buildBattleStory({
      resolvedOutcome: 'Win',
      advantageDirection: 'A',
      confidenceTier: 'High',
      lanes: aheadLanes,
      mine,
      opponent,
      lookup: noData,
    });
    expect(held.hingePhase).toBe('turn');
    expect(held.thinPhase).toBe('');
    expect(held.beats[0].params).toMatchObject({
      openingLead: 'yours',
      turnLead: 'yours',
      conversionLead: 'yours',
      finishLead: 'yours',
    });

    const invert = buildBattleStory({
      resolvedOutcome: 'Win',
      advantageDirection: 'A',
      lanes: behindLanes,
      mine,
      opponent,
      lookup: noData,
    });
    expect(invert.thinPhase).toBe('turn');
    expect(invert.beats[0].params).toMatchObject({
      openingLead: 'theirs',
      turnLead: 'yours',
      conversionLead: 'yours',
      finishLead: 'yours',
    });

    const even = buildBattleStory({
      resolvedOutcome: 'Win',
      advantageDirection: 'A',
      lanes: evenLanes,
      mine,
      opponent,
      lookup: noData,
    });
    expect(even.thinPhase).toBe('opening');
    expect(even.beats[0].params.openingLead).toBe('even');
    expect(even.beats[0].params.turnLead).toBe('yours');
  });

  it('marks opening as thin when the favorite is Even or Low even if lanes held', () => {
    const evenFav = buildBattleStory({
      resolvedOutcome: 'Win',
      advantageDirection: 'Even',
      confidenceTier: 'High',
      lanes: aheadLanes,
      mine,
      opponent,
      lookup: noData,
    });
    expect(evenFav.thinPhase).toBe('opening');

    const low = buildBattleStory({
      resolvedOutcome: 'Win',
      advantageDirection: 'A',
      confidenceTier: 'Low',
      lanes: aheadLanes,
      mine,
      opponent,
      lookup: noData,
    });
    expect(low.thinPhase).toBe('opening');
  });
});
