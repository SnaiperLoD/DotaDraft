import { mulberry32, seededShuffle, shuffleWith } from './random';

describe('shuffleWith', () => {
  it('returns a permutation and does not mutate the input', () => {
    const input = [1, 2, 3, 4, 5, 6];
    const out = shuffleWith(input, mulberry32(42));
    expect([...out].sort()).toEqual(input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('is deterministic for a deterministic rng', () => {
    expect(shuffleWith([1, 2, 3, 4], mulberry32(7))).toEqual(shuffleWith([1, 2, 3, 4], mulberry32(7)));
    expect(seededShuffle([1, 2, 3, 4], 7)).toEqual(shuffleWith([1, 2, 3, 4], mulberry32(7)));
  });

  it('produces every permutation of 3 items roughly uniformly', () => {
    const rand = mulberry32(12345);
    const runs = 6000;
    const counts = new Map<string, number>();
    for (let i = 0; i < runs; i++) {
      const key = shuffleWith(['a', 'b', 'c'], rand).join('');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(counts.size).toBe(6);
    const expected = runs / 6;
    for (const c of counts.values()) {
      expect(c).toBeGreaterThan(expected * 0.85);
      expect(c).toBeLessThan(expected * 1.15);
    }
  });
});
