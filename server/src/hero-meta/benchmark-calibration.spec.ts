import {
  percentileRankScale,
  percentileRankScaleByGroup,
  anchoredGroupScale,
  medianBenchmarkValue,
  zScoreExtremityScale,
  weightedBlend,
} from './benchmark-calibration';

describe('percentileRankScale', () => {
  it('maps the lowest value to 0 and the highest to 10', () => {
    const result = percentileRankScale([10, 30, 20]);
    expect(result[0]).toBe(0); // 10 is lowest
    expect(result[1]).toBe(10); // 30 is highest
    expect(result[2]).toBe(5); // 20 is the middle of 3 evenly spaced values
  });

  it("passes through null for heroes with no benchmark data, without affecting others' ranks", () => {
    const result = percentileRankScale([10, null, 30, 20]);
    expect(result[1]).toBeNull();
    expect(result[0]).toBe(0);
    expect(result[2]).toBe(10);
    expect(result[3]).toBe(5);
  });

  it('is robust to an extreme outlier — it does not compress the rest toward 0', () => {
    const values = [10, 12, 14, 16, 18, 20, 100000];
    const result = percentileRankScale(values);
    // Rank-based: the 6 non-outlier values still spread across most of 0-10.
    expect(result[0]).toBe(0);
    expect(result[5]).toBeCloseTo(50 / 6, 0);
    expect(result[6]).toBe(10);
  });

  it('returns all nulls when no values are present', () => {
    expect(percentileRankScale([null, null])).toEqual([null, null]);
  });
});

describe('percentileRankScaleByGroup', () => {
  it('ranks each value only against others sharing its group, not the whole population', () => {
    // Two groups: [10, 20, 30] and [1, 2, 3] — the second group's values
    // would all score near 0 under a population-wide rank, but within their
    // own group they span the full 0-10 range same as the first group.
    const values = [10, 20, 30, 1, 2, 3];
    const groups = ['A', 'A', 'A', 'B', 'B', 'B'];
    const result = percentileRankScaleByGroup(values, groups);
    expect(result).toEqual([0, 5, 10, 0, 5, 10]);
  });

  it('buckets null-group entries together rather than against the whole population', () => {
    const values = [10, 20, 30, 100, 200];
    const groups = ['A', 'A', 'A', null, null];
    const result = percentileRankScaleByGroup(values, groups);
    expect(result[3]).toBe(0); // 100 is the lower of the two null-group entries
    expect(result[4]).toBe(10); // 200 is the higher
  });

  it('passes through null values without affecting other ranks in the same group', () => {
    const values = [10, null, 30];
    const groups = ['A', 'A', 'A'];
    const result = percentileRankScaleByGroup(values, groups);
    expect(result[1]).toBeNull();
    expect(result[0]).toBe(0);
    expect(result[2]).toBe(10);
  });
});

// Composes percentileRankScale + percentileRankScaleByGroup (both tested
// above) with a rescale step — previously untested entirely, unlike its two
// building blocks. Expected values below were cross-checked against an
// independent reference implementation of the same formula, not hand-typed.
describe('anchoredGroupScale', () => {
  it("rescales each group's within-group rank onto the GLOBAL score range that group actually occupies, instead of resetting every group to its own fresh 0-10", () => {
    const values = [10, 20, 30, 40, 90, 91, 92];
    const groups = ['Support', 'Support', 'Support', 'Support', 'Core', 'Core', 'Core'];
    const result = anchoredGroupScale(values, groups);

    // Plain within-group ranking (percentileRankScaleByGroup) would give the
    // best Support a fresh 10 and the worst Core a fresh 0 — anchoring caps
    // them at the global scores their own group actually occupies instead.
    expect(result[3]).toBeCloseTo(5, 1); // best Support: capped at its real global score, not 10
    expect(result[3]).not.toBeCloseTo(10, 1);
    expect(result[4]).toBeCloseTo(6.7, 1); // worst Core: its real global score, not 0
    expect(result[4]).not.toBeCloseTo(0, 1);

    // The population-wide extremes still anchor to the population extremes.
    expect(result[0]).toBeCloseTo(0, 1); // worst Support overall
    expect(result[6]).toBeCloseTo(10, 1); // best Core overall
    // A mid-ranked member of each group lands off both the group-only and
    // the raw-global value, confirming the rescale actually ran (not just
    // passing one of its two inputs through unchanged).
    expect(result[2]).toBeCloseTo(3.4, 1);
  });

  it("anchors a single-member group directly to its own global score (span=0), not a group-relative midpoint", () => {
    const values = [10, 20, 30];
    const groups = ['A', 'A', 'B']; // B has exactly one member
    const result = anchoredGroupScale(values, groups);
    // B's plain within-group score would be 5 (the single-value fallback in
    // percentileRankScale) — anchoring instead uses its real global score.
    expect(result[2]).toBe(10);
  });

  it('buckets null-group entries together and anchors them the same way as a named group', () => {
    const values = [10, 20, 100, 200];
    const groups = ['A', 'A', null, null];
    const result = anchoredGroupScale(values, groups);
    expect(result).toEqual([0, 3.3, 6.7, 10]);
  });
});

describe('medianBenchmarkValue', () => {
  it('returns the value at the 0.5 percentile', () => {
    const percentiles = [
      { percentile: 0.1, value: 100 },
      { percentile: 0.5, value: 500 },
      { percentile: 0.9, value: 900 },
    ];
    expect(medianBenchmarkValue(percentiles)).toBe(500);
  });

  it('returns null when the benchmark data is missing entirely', () => {
    expect(medianBenchmarkValue(null)).toBeNull();
    expect(medianBenchmarkValue(undefined)).toBeNull();
  });

  it('returns null when the 0.5 percentile bucket is absent', () => {
    expect(medianBenchmarkValue([{ percentile: 0.1, value: 100 }])).toBeNull();
  });
});

describe('zScoreExtremityScale', () => {
  it('keeps near-average values close to the 5 midpoint', () => {
    // 300..320 is a tight cluster; 310 sits almost exactly at the mean.
    const values = [300, 305, 310, 315, 320];
    const result = zScoreExtremityScale(values, 1.6);
    expect(result[2]).toBeCloseTo(5, 0);
  });

  it('pushes a strong outlier hard toward 0, far more than a mild deviation', () => {
    // Crystal-Maiden-style case: one hero far below a tight cluster of others.
    const values = [300, 305, 310, 315, 320, 180];
    const result = zScoreExtremityScale(values, 1.6);
    expect(result[5]).toBe(0); // the extreme low outlier hits the floor
    expect(result[0]).toBeGreaterThan(2); // 300 is only mildly below the cluster, stays fairly central
  });

  it('a higher exponent amplifies tails more than a lower one, for the same data', () => {
    const values = [300, 305, 310, 315, 320, 180];
    const mild = zScoreExtremityScale(values, 1.0)[0] as number;
    const amplified = zScoreExtremityScale(values, 3.0)[0] as number;
    // At higher exponents, mid-range points get pulled closer to 5 relative
    // to the amplified extreme — i.e. score[0] should move toward the
    // midpoint as the tail dominates the scale more.
    expect(Math.abs(amplified - 5)).toBeLessThan(Math.abs(mild - 5));
  });

  it('passes through null for missing data', () => {
    const result = zScoreExtremityScale([300, null, 320], 1.6);
    expect(result[1]).toBeNull();
  });

  it('returns 5 for every value when there is no variance', () => {
    expect(zScoreExtremityScale([300, 300, 300], 1.6)).toEqual([5, 5, 5]);
  });

  it('returns 5 (not NaN/a crash) when fewer than 2 real values are present to compute a spread from', () => {
    expect(zScoreExtremityScale([300], 1.6)).toEqual([5]);
    expect(zScoreExtremityScale([null, null], 1.6)).toEqual([null, null]);
    expect(zScoreExtremityScale([300, null], 1.6)).toEqual([5, null]);
  });

  it('normalizes each tail by its OWN max, not the other tail\'s — an asymmetric spread must not borrow the wrong denominator', () => {
    // exponent=1 keeps adjusted values equal to plain z-scores. Below-mean:
    // 1,4,6,7 (max |z|≈1.14); above-mean: 9,20 (max z≈2.03) — deliberately
    // asymmetric, so picking the wrong tail's max (or the wrong arithmetic
    // operator) changes the result. Values cross-checked against an
    // independent reference implementation of the same formula.
    const result = zScoreExtremityScale([1, 4, 6, 7, 9, 20], 1);
    // value=1 is the extreme of its own (negative) tail -> ratio -1 -> floor.
    expect(result[0]).toBeCloseTo(0, 1);
    // value=9 is mildly above average. Normalizing by the (larger) positive
    // tail's own max keeps it modest; borrowing the negative tail's smaller
    // max, or multiplying instead of dividing by the denominator, would both
    // push this well past 5.5.
    expect(result[4]).toBeCloseTo(5.5, 1);
  });
});

describe('weightedBlend', () => {
  it('computes a weighted average when all parts are present', () => {
    const result = weightedBlend([
      { value: 10, weight: 0.7 },
      { value: 0, weight: 0.3 },
    ]);
    expect(result).toBe(7);
  });

  it('redistributes weight across present parts when one is missing', () => {
    const result = weightedBlend([
      { value: 8, weight: 0.7 },
      { value: null, weight: 0.3 },
    ]);
    expect(result).toBe(8); // only part present, gets full weight
  });

  it('returns null when every part is missing', () => {
    expect(weightedBlend([{ value: null, weight: 1 }])).toBeNull();
  });
});
