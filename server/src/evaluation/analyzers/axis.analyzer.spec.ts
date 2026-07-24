import { createAxisAnalyzer } from './axis.analyzer';
import { makeHero, DEFAULT_EVALUATION_VALUES, picks } from '../../test-utils/hero-factory';

function heroWithAxis(id: number, name: string, axis: string, value: number) {
  return makeHero({ id, name, evaluation_values: { ...DEFAULT_EVALUATION_VALUES, [axis]: value } });
}

function hardCarryHero(id: number, name: string, axis: string, value: number) {
  return makeHero({
    id,
    name,
    evaluation_values: { ...DEFAULT_EVALUATION_VALUES, [axis]: value },
    presumed_positions: [{ position: 'Carry', share: 0.8 }],
  });
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
    const result = analyzer.analyze(picks(heroes));
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
    const result = analyzer.analyze(picks(heroes));
    expect(result.explanation[1]).toContain('High (9)');
    expect(result.explanation[1]).toContain('Mid (6)');
    expect(result.explanation[1]).not.toContain('Low (2)');
  });

  it('picks the narrative bracket matching the rounded score', () => {
    const strong = [heroWithAxis(1, 'A', 'tempo', 9)];
    const weak = [heroWithAxis(1, 'A', 'tempo', 1)];
    const analyzer = createAxisAnalyzer('tempo', 'Tempo');

    expect(analyzer.analyze(picks(strong)).explanation[2]).toMatch(/early, fast-paced/i);
    expect(analyzer.analyze(picks(weak)).explanation[2]).toMatch(/slow to get going/i);
  });

  it('applies a role-fit boost and mentions it when a hero is assigned a role its strong axis matches', () => {
    const carry = heroWithAxis(1, 'Anti-Mage', 'scaling', 8);
    const analyzer = createAxisAnalyzer('scaling', 'Scaling');

    const unassigned = analyzer.analyze(picks([carry]));
    const assigned = analyzer.analyze(picks([carry], 'Carry'));

    expect(assigned.score as number).toBeGreaterThan(unassigned.score as number);
    expect(assigned.explanation.some((line) => line.includes('Anti-Mage (Carry)') && line.includes('role-fit'))).toBe(
      true,
    );
    expect(unassigned.explanation.some((line) => line.includes('role-fit'))).toBe(false);
  });

  it('does not boost when the assigned role has no relevant axis here', () => {
    const support = heroWithAxis(1, 'Crystal Maiden', 'scaling', 8);
    const analyzer = createAxisAnalyzer('scaling', 'Scaling');

    const result = analyzer.analyze(picks([support], 'Hard Support'));
    expect(result.explanation.some((line) => line.includes('role-fit'))).toBe(false);
  });

  it('applies the hard-carry stacking penalty and mentions it, matching Battle Engine', () => {
    const analyzer = createAxisAnalyzer('teamfight', 'Teamfight');
    const noStack = [
      hardCarryHero(1, 'HC1', 'teamfight', 6),
      heroWithAxis(2, 'Sup1', 'teamfight', 6),
      heroWithAxis(3, 'Sup2', 'teamfight', 6),
      heroWithAxis(4, 'Sup3', 'teamfight', 6),
      heroWithAxis(5, 'Sup4', 'teamfight', 6),
    ];
    const twoStacked = [
      hardCarryHero(1, 'HC1', 'teamfight', 6),
      hardCarryHero(2, 'HC2', 'teamfight', 6),
      heroWithAxis(3, 'Sup2', 'teamfight', 6),
      heroWithAxis(4, 'Sup3', 'teamfight', 6),
      heroWithAxis(5, 'Sup4', 'teamfight', 6),
    ];

    const withoutPenalty = analyzer.analyze(picks(noStack));
    const withPenalty = analyzer.analyze(picks(twoStacked));

    expect(withoutPenalty.score).toBe(6);
    // 2 hard-carries = -5% (server/data/axis-weights.json hardCarryStackPenalty)
    expect(withPenalty.score).toBeCloseTo(6 * 0.95, 5);
    expect(withPenalty.explanation.some((line) => line.includes('hard-carry'))).toBe(true);
    expect(withoutPenalty.explanation.some((line) => line.includes('hard-carry'))).toBe(false);
  });
});
