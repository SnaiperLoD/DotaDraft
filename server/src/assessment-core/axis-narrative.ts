export type AxisBracket = 'veryLow' | 'low' | 'mid' | 'high' | 'veryHigh';

export interface Contributor {
  name: string;
  value: number;
}

export interface NarrativeContext {
  percentile: number;
  bracket: AxisBracket;
  top: Contributor[];
}

/**
 * 5-value axis description bands. Inner 30/70 matches `percentileBracket`
 * in evaluation/score-narrative so summary copy and axis copy stay aligned.
 * Extreme <10 / >90 are display-only — Evaluation win-condition summary
 * still uses the 3-value bracket.
 */
export function axisNarrativeBracket(percentile: number): AxisBracket {
  if (percentile < 10) return 'veryLow';
  if (percentile < 30) return 'low';
  if (percentile < 70) return 'mid';
  if (percentile < 90) return 'high';
  return 'veryHigh';
}
