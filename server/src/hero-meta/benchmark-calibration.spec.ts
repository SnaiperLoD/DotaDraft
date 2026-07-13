import {
  percentileRankScale,
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
