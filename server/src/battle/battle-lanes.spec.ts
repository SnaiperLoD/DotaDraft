import { makeHero } from '../test-utils/hero-factory';
import { buildLaneExplanation, buildLaneResults } from './battle-lanes';
import type { MatchupLookup } from './battle-resolution';

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
});

describe('buildLaneExplanation', () => {
  it('explains won lanes from real pairs and skips even lanes', () => {
    const lines = buildLaneExplanation([
      {
        lane: 'safe',
        mine: ['Anti-Mage', 'Crystal Maiden'],
        opponent: ['Axe', 'Earthshaker'],
        winner: 'mine',
        winRate: 0.62,
        mineIds: [1, 5],
        opponentIds: [14, 7],
        topPair: { hero: 'Anti-Mage', heroId: 1, vs: 'Axe', vsId: 14, winRate: 0.64 },
      },
      {
        lane: 'mid',
        mine: ['Storm Spirit'],
        opponent: ['Shadow Fiend'],
        winner: 'even',
        winRate: 0.5,
        mineIds: [17],
        opponentIds: [11],
        topPair: null,
      },
      {
        lane: 'off',
        mine: ['Tidehunter', 'Earth Spirit'],
        opponent: ['Phantom Assassin', 'Lion'],
        winner: 'opponent',
        winRate: 0.41,
        mineIds: [29, 107],
        opponentIds: [44, 26],
        topPair: { hero: 'Phantom Assassin', heroId: 44, vs: 'Tidehunter', vsId: 29, winRate: 0.71 },
      },
    ]);
    expect(lines).toEqual([
      "The opponent's offlane leans this way because Phantom Assassin into Tidehunter is a real matchup edge.",
      'Your safe lane leans this way because Anti-Mage into Axe is a real matchup edge.',
    ]);
  });
});
