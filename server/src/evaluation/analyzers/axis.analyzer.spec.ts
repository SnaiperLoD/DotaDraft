import { createAxisAnalyzer } from './axis.analyzer';
import { makeHero, DEFAULT_EVALUATION_VALUES } from '../../test-utils/hero-factory';

function heroWithAxis(id: number, name: string, axis: string, value: number) {
  return makeHero({ id, name, evaluation_values: { ...DEFAULT_EVALUATION_VALUES, [axis]: value } });
}

describe('createAxisAnalyzer', () => {
  it('returns null with no heroes', () => {
    const analyzer = createAxisAnalyzer('teamfight', 'Teamfight');
    const result = analyzer.analyze([]);
    expect(result.score).toBeNull();
  });

  it('averages the given axis across the team and rounds to 1 decimal', () => {
    const heroes = [
      heroWithAxis(1, 'A', 'teamfight', 5),
      heroWithAxis(2, 'B', 'teamfight', 8),
      heroWithAxis(3, 'C', 'teamfight', 4),
    ];
    const analyzer = createAxisAnalyzer('teamfight', 'Teamfight');
    const result = analyzer.analyze(heroes);
    // (5 + 8 + 4) / 3 = 5.666... -> 5.7
    expect(result.score).toBe(5.7);
  });

  it('names the top 2 contributors on that axis', () => {
    const heroes = [
      heroWithAxis(1, 'Low', 'scaling', 2),
      heroWithAxis(2, 'High', 'scaling', 9),
      heroWithAxis(3, 'Mid', 'scaling', 6),
    ];
    const analyzer = createAxisAnalyzer('scaling', 'Scaling');
    const result = analyzer.analyze(heroes);
    expect(result.explanation[1]).toContain('High (9)');
    expect(result.explanation[1]).toContain('Mid (6)');
    expect(result.explanation[1]).not.toContain('Low (2)');
  });

  it('picks the narrative bracket matching the rounded score', () => {
    const strong = [heroWithAxis(1, 'A', 'tempo', 9)];
    const weak = [heroWithAxis(1, 'A', 'tempo', 1)];
    const analyzer = createAxisAnalyzer('tempo', 'Tempo');

    expect(analyzer.analyze(strong).explanation[2]).toMatch(/early, fast-paced/i);
    expect(analyzer.analyze(weak).explanation[2]).toMatch(/slow to get going/i);
  });
});
