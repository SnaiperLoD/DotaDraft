import {
  axisNarrativeBracket,
  percentileBracket,
  AXIS_NARRATIVE,
  type NarrativeContext,
} from './score-narrative';

describe('axisNarrativeBracket', () => {
  it('adds veryLow (<10) and veryHigh (>=90) bands around the 30/70 core', () => {
    expect(axisNarrativeBracket(0)).toBe('veryLow');
    expect(axisNarrativeBracket(9)).toBe('veryLow');
    expect(axisNarrativeBracket(10)).toBe('low');
    expect(axisNarrativeBracket(29)).toBe('low');
    expect(axisNarrativeBracket(30)).toBe('mid');
    expect(axisNarrativeBracket(69)).toBe('mid');
    expect(axisNarrativeBracket(70)).toBe('high');
    expect(axisNarrativeBracket(89)).toBe('high');
    expect(axisNarrativeBracket(90)).toBe('veryHigh');
    expect(axisNarrativeBracket(100)).toBe('veryHigh');
  });

  it('keeps percentileBracket at the 3-value 30/70 split (evaluation.service win-condition logic relies on it)', () => {
    // The extreme bands must NOT leak into percentileBracket — a >90th tempo
    // still has to read as 'high' for buildSummary's `tempoBracket === 'high'`.
    expect(percentileBracket(5)).toBe('low');
    expect(percentileBracket(95)).toBe('high');
    expect(percentileBracket(50)).toBe('mid');
  });
});

describe('AXIS_NARRATIVE extreme bands', () => {
  const ctx = (percentile: number, bracket: NarrativeContext['bracket']): NarrativeContext => ({
    percentile,
    bracket,
    top: [{ name: 'Hero', value: 9 }],
  });

  it('frames a veryHigh axis as a defining strength', () => {
    const text = AXIS_NARRATIVE.tempo.veryHigh(ctx(95, 'veryHigh'));
    expect(text).toMatch(/defining strength/i);
    // Reuses the high tactical body.
    expect(text).toMatch(/fast-start draft/i);
  });

  it('frames a veryLow axis as a serious weakness', () => {
    const text = AXIS_NARRATIVE.tempo.veryLow(ctx(3, 'veryLow'));
    expect(text).toMatch(/most serious weakness/i);
    expect(text).toMatch(/avoid forcing early confrontations/i);
  });

  it('leaves the plain high/low bands without the extreme framing', () => {
    expect(AXIS_NARRATIVE.tempo.high(ctx(80, 'high'))).not.toMatch(/defining strength/i);
    expect(AXIS_NARRATIVE.tempo.low(ctx(20, 'low'))).not.toMatch(/most serious weakness/i);
  });

  it('exposes all five bands for every axis', () => {
    for (const set of Object.values(AXIS_NARRATIVE)) {
      expect(Object.keys(set).sort()).toEqual(['high', 'low', 'mid', 'veryHigh', 'veryLow']);
    }
  });
});
