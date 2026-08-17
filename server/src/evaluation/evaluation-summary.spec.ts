import { i18nLine, isI18nLine, type AnalyzerResult } from 'shared';
import { buildSummary } from './evaluation.service';

function axis(key: string, percentile: number): AnalyzerResult {
  return {
    key,
    label: key,
    score: percentile / 10,
    percentile,
    explanation: [i18nLine('eval.axis.narrative', { axis: key, band: 'x' })],
  };
}

function summaryAxes(lines: AnalyzerResult['explanation']): string[] {
  return lines.map((line) => {
    if (!isI18nLine(line)) throw new Error(`expected I18nLine, got ${JSON.stringify(line)}`);
    return line.params?.axis ?? '';
  });
}

describe('buildSummary ordering', () => {
  const breakdown = [
    axis('tempo', 40),
    axis('scaling', 95),
    axis('control', 12),
    axis('burst', 80),
    axis('durability', 4),
    axis('mobility', 71),
    axis('saving', 22),
    // Not a summary key — must not leak into strengths/weaknesses.
    axis('map_control', 99),
  ];

  it('assigns the highest percentiles to strengths and the lowest to weaknesses', () => {
    const summary = buildSummary(breakdown);
    expect(summaryAxes(summary.strengths)).toEqual(['scaling', 'burst', 'mobility']);
    expect(summaryAxes(summary.weaknesses)).toEqual(['durability', 'control', 'saving']);
  });

  it('leans on the top-ranked axis and covers for the bottom-ranked axis', () => {
    const summary = buildSummary(breakdown);
    if (typeof summary.gameplan === 'string') {
      throw new Error('expected structured gameplan beats');
    }
    const leanOn = summary.gameplan[1];
    const coverFor = summary.gameplan[2];
    if (!isI18nLine(leanOn) || !isI18nLine(coverFor)) {
      throw new Error('expected I18nLine gameplan beats');
    }
    expect(leanOn.key).toBe('eval.gameplan.leanOn');
    expect(leanOn.params?.axis).toBe('scaling');
    expect(coverFor.key).toBe('eval.gameplan.coverFor');
    expect(coverFor.params?.axis).toBe('durability');
  });

  it('ranks percentile-less analyzers by score*10 on the same scale', () => {
    const summary = buildSummary([
      axis('tempo', 50),
      {
        key: 'synergy',
        label: 'Synergy',
        score: 9.5,
        percentile: null,
        explanation: [i18nLine('eval.axis.empty')],
      },
      {
        key: 'counter',
        label: 'Counter',
        score: 1.0,
        percentile: null,
        explanation: [i18nLine('eval.axis.empty')],
      },
      axis('scaling', 50),
    ]);
    expect(summaryAxes(summary.strengths)[0]).toBe('synergy');
    expect(summaryAxes(summary.weaknesses)[0]).toBe('counter');
  });
});
