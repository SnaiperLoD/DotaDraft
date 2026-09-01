import {
  buildOpponentPickRanges,
  opponentPickWeight,
  pickWeightedIndex,
  pickWeightedOpponent,
  type PoolPickRow,
} from './opponent-pool-pick';

describe('opponent-pool-pick', () => {
  it('pickWeightedIndex returns the only index when weights are equal and rand is mid', () => {
    expect(pickWeightedIndex([1, 1], 0)).toBe(0);
    expect(pickWeightedIndex([1, 1], 0.49)).toBe(0);
    expect(pickWeightedIndex([1, 1], 0.5)).toBe(1);
  });

  it('weights recent pro matchIds higher than old ones in the same candidate set', () => {
    const rows: PoolPickRow[] = [
      { id: 'pro-100', source: 'pro', heroIds: [1, 2, 3, 4, 5], leagueName: 'Old Cup' },
      { id: 'pro-900', source: 'pro', heroIds: [6, 7, 8, 9, 10], leagueName: 'The International 2026' },
    ];
    const ranges = buildOpponentPickRanges(rows);
    const oldW = opponentPickWeight(rows[0]!, ranges);
    const newW = opponentPickWeight(rows[1]!, ranges);
    expect(newW).toBeGreaterThan(oldW * 2);
  });

  it('treats TI loser pool ids as the same match recency as the winner row', () => {
    const rows: PoolPickRow[] = [
      { id: 'pro-100', source: 'pro', heroIds: [1, 2, 3, 4, 5] },
      { id: 'pro-900-lose', source: 'pro', heroIds: [6, 7, 8, 9, 10], leagueName: 'The International 2022' },
    ];
    const ranges = buildOpponentPickRanges(rows);
    expect(ranges.maxMatchId).toBe(900);
    expect(opponentPickWeight(rows[1]!, ranges)).toBeGreaterThan(opponentPickWeight(rows[0]!, ranges));
  });

  it('boosts player-sourced rows over comparable pro rows', () => {
    const now = new Date().toISOString();
    const rows: PoolPickRow[] = [
      { id: 'pro-500', source: 'pro', heroIds: [1, 2, 3, 4, 5], leagueName: null },
      {
        id: 'player-1',
        source: 'player',
        heroIds: [6, 7, 8, 9, 10],
        createdAt: now,
      },
    ];
    const ranges = buildOpponentPickRanges(rows);
    expect(opponentPickWeight(rows[1]!, ranges)).toBeGreaterThan(opponentPickWeight(rows[0]!, ranges));
  });

  it('pickWeightedOpponent always returns the sole candidate', () => {
    const only = { id: 'only', source: 'pro', heroIds: [1, 2, 3, 4, 5] };
    expect(pickWeightedOpponent([only], () => 0.99).id).toBe('only');
  });

  it('pickWeightedOpponent prefers the heavier row when rand is high enough', () => {
    const rows: PoolPickRow[] = [
      { id: 'pro-100', source: 'pro', heroIds: [1, 2, 3, 4, 5] },
      { id: 'pro-900', source: 'pro', heroIds: [6, 7, 8, 9, 10], leagueName: 'The International 2026' },
    ];
    // With a heavy skew toward the second row, rand near 1 should land there.
    expect(pickWeightedOpponent(rows, () => 0.99).id).toBe('pro-900');
  });
});
