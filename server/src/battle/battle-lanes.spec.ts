import type { BattlePick } from './battle-resolution';
import { makeHero } from '../test-utils/hero-factory';
import { flattenLocalized } from '../test-utils/localized-text';
import { laneTally } from './battle-cast';
import { buildExplanation } from './battle-explanation';
import { buildLaneResults, laneWinnerFor } from './battle-lanes';
import type { MatchupLookup } from './battle-resolution';
import { buildBattleStory } from './battle-story';

const noData: MatchupLookup = {
  getMatchupWinRate: () => null,
  getSynergyWinRate: () => null,
  getWinRate: () => null,
};

function hero(id: number, name: string) {
  return makeHero({ id, name });
}

describe('buildLaneResults', () => {
  it('stores mine’s implied chance from average edge, plus ids and the winning side’s top pair', () => {
    const lookup: MatchupLookup = {
      getMatchupWinRate: (heroId, vsId) => {
        if (heroId === 1 && vsId === 14) return 0.7;
        if (heroId === 5 && vsId === 12) return 0.6;
        if (heroId === 14 && vsId === 1) return 0.3;
        if (heroId === 12 && vsId === 5) return 0.4;
        if (heroId === 2 && vsId === 13) return 0.55;
        if (heroId === 13 && vsId === 2) return 0.45;
        return null;
      },
      getSynergyWinRate: () => null,
      getWinRate: () => 0.5,
    };
    const mineByRole = new Map([
      ['Carry', hero(1, 'Anti-Mage')],
      ['Mid', hero(2, 'Storm Spirit')],
      ['Offlane', hero(3, 'Tidehunter')],
      ['Soft Support', hero(4, 'Earth Spirit')],
      ['Hard Support', hero(5, 'Crystal Maiden')],
    ]);
    const opponentByRole = new Map([
      ['Carry', hero(11, 'Phantom Assassin')],
      ['Mid', hero(13, 'Shadow Fiend')],
      ['Offlane', hero(14, 'Axe')],
      ['Soft Support', hero(12, 'Earthshaker')],
      ['Hard Support', hero(15, 'Lion')],
    ]);

    const lanes = buildLaneResults(mineByRole, opponentByRole, lookup);
    const safe = lanes.find((lane) => lane.lane === 'safe')!;
    expect(safe.winner).toBe('mine');
    expect(safe.winRate).toBeCloseTo(0.65, 5);
    expect(safe.mineIds).toEqual([1, 5]);
    expect(safe.opponentIds).toEqual([14, 12]);
    expect(safe.topPair).toEqual({
      hero: 'Anti-Mage',
      heroId: 1,
      vs: 'Axe',
      vsId: 14,
      winRate: 0.7,
    });
  });

  it('returns even + null winRate when the lane has no pair data', () => {
    const mineByRole = new Map([['Mid', hero(2, 'Storm Spirit')]]);
    const opponentByRole = new Map([['Mid', hero(13, 'Shadow Fiend')]]);
    const lanes = buildLaneResults(mineByRole, opponentByRole, noData);
    const mid = lanes.find((lane) => lane.lane === 'mid')!;
    expect(mid.winner).toBe('even');
    expect(mid.winRate).toBeNull();
    expect(mid.topPair).toBeNull();
  });

  it('reads a lane within 3.5pp of 50% as even, and a lean past it as won (T1.2)', () => {
    expect(laneWinnerFor(0.5)).toBe('even');
    expect(laneWinnerFor(0.51)).toBe('even');
    expect(laneWinnerFor(0.49)).toBe('even');
    expect(laneWinnerFor(0.535)).toBe('even');
    expect(laneWinnerFor(0.465)).toBe('even');
    expect(laneWinnerFor(0.536)).toBe('mine');
    expect(laneWinnerFor(0.464)).toBe('opponent');
    expect(laneWinnerFor(null)).toBe('even');
  });
});

describe('one even-lane boundary across lanes, Explanation and story (T1.2)', () => {
  const roles = ['Carry', 'Mid', 'Offlane', 'Soft Support', 'Hard Support'];
  const minePicks: BattlePick[] = roles.map((role, i) => ({
    hero: hero(i + 1, `Radiant ${role}`),
    assignedRole: role,
  }));
  const opponentPicks: BattlePick[] = roles.map((role, i) => ({
    hero: hero(i + 11, `Dire ${role}`),
    assignedRole: role,
  }));
  const byRole = (picks: BattlePick[]) => new Map(picks.map((p) => [p.assignedRole!, p.hero]));
  // Every pair 51/49 for Radiant: a lean on paper, nobody's lane in the copy.
  const lookup: MatchupLookup = {
    getMatchupWinRate: (heroId) => (heroId <= 5 ? 0.51 : 0.49),
    getSynergyWinRate: () => null,
    getWinRate: () => 0.5,
  };

  it('51/49 lanes are even on the card, in Explanation and in the story tally', () => {
    const lanes = buildLaneResults(byRole(minePicks), byRole(opponentPicks), lookup);
    expect(lanes.map((lane) => lane.winner)).toEqual(['even', 'even', 'even']);
    expect(lanes.every((lane) => lane.topPair === null)).toBe(true);

    expect(laneTally(lanes, 'Win')).toEqual({ winnerWins: 0, loserWins: 0 });

    const explanation = flattenLocalized(
      buildExplanation({
        advantageDirection: 'A',
        confidenceTier: 'Moderate',
        resolvedOutcome: 'Win',
        teamA: minePicks,
        teamB: opponentPicks,
        lookup,
        topAxisDelta: { axis: 'tempo', delta: 0.1 },
        axisDeltas: [{ axis: 'tempo', delta: 0.1 }],
        highSkillSwingHero: null,
        lanes,
      }),
    );
    expect(explanation).toMatch(/battle.explain.lanes.even/);

    const story = buildBattleStory({
      resolvedOutcome: 'Win',
      advantageDirection: 'A',
      lanes,
      mine: minePicks,
      opponent: opponentPicks,
      lookup,
    });
    expect(story.beats[0].key).toBe('openingEven');
    expect(story.beats[0].params).toMatchObject({ winnerLanes: '0', loserLanes: '0', openingLead: 'even' });
    expect(story.cameFromBehind).toBe(false);
  });
});
