import { createAxisAnalyzer } from './axis.analyzer';
import { makeHero, DEFAULT_EVALUATION_VALUES, picks } from '../../test-utils/hero-factory';
import { flattenLocalized } from '../../test-utils/localized-text';
import { isI18nLine } from 'shared';

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
    expect(flattenLocalized([result.explanation[1]])).toContain('High (9)');
    expect(flattenLocalized([result.explanation[1]])).toContain('Mid (6)');
    expect(flattenLocalized([result.explanation[1]])).not.toContain('Low (2)');
  });

  it('picks the narrative bracket matching the rounded score', () => {
    const strong = [heroWithAxis(1, 'A', 'tempo', 9)];
    const weak = [heroWithAxis(1, 'A', 'tempo', 1)];
    const analyzer = createAxisAnalyzer('tempo', 'Tempo');

    const strongLine = analyzer.analyze(picks(strong)).explanation[2];
    const weakLine = analyzer.analyze(picks(weak)).explanation[2];
    expect(isI18nLine(strongLine) && strongLine.key).toBe('eval.axis.narrative');
    expect(isI18nLine(strongLine) && strongLine.params?.bodyBracket).toBe('high');
    expect(isI18nLine(weakLine) && weakLine.params?.bodyBracket).toBe('low');
  });

  it('applies a role-fit boost and mentions it when a hero is assigned a role its strong axis matches', () => {
    // `initiating` is a Carry role-fit axis; `control` was removed from Carry.
    // A real Carry presumed_position keeps the core-miscast penalty (common/
    // role-fit.ts) from firing — this hero genuinely plays Carry, so the test
    // isolates the role-fit boost rather than netting it against a miscast.
    const carry = makeHero({
      id: 1,
      name: 'Anti-Mage',
      evaluation_values: { ...DEFAULT_EVALUATION_VALUES, initiating: 8 },
      presumed_positions: [{ position: 'Carry', share: 0.9 }],
    });
    const analyzer = createAxisAnalyzer('initiating', 'Initiating');

    const unassigned = analyzer.analyze(picks([carry]));
    const assigned = analyzer.analyze(picks([carry], 'Carry'));

    expect(assigned.score as number).toBeGreaterThan(unassigned.score as number);
    expect(flattenLocalized(assigned.explanation)).toMatch(/eval.axis.roleFit/);
    expect(flattenLocalized(assigned.explanation)).toContain('Anti-Mage:Carry');
    expect(flattenLocalized(unassigned.explanation)).not.toMatch(/eval.axis.roleFit/);
  });

  it('does not boost when the assigned role has no relevant axis here', () => {
    const support = heroWithAxis(1, 'Crystal Maiden', 'scaling', 8);
    const analyzer = createAxisAnalyzer('scaling', 'Scaling');

    const result = analyzer.analyze(picks([support], 'Hard Support'));
    expect(flattenLocalized(result.explanation)).not.toMatch(/eval.axis.roleFit/);
  });

  it('applies the hard-carry stacking penalty (3+ threshold) without explaining it on non-scaling axes', () => {
    const analyzer = createAxisAnalyzer('teamfight', 'Teamfight');
    const twoStacked = [
      hardCarryHero(1, 'HC1', 'teamfight', 6),
      hardCarryHero(2, 'HC2', 'teamfight', 6),
      heroWithAxis(3, 'Sup2', 'teamfight', 6),
      heroWithAxis(4, 'Sup3', 'teamfight', 6),
      heroWithAxis(5, 'Sup4', 'teamfight', 6),
    ];
    const threeStacked = [
      hardCarryHero(1, 'HC1', 'teamfight', 6),
      hardCarryHero(2, 'HC2', 'teamfight', 6),
      hardCarryHero(3, 'HC3', 'teamfight', 6),
      heroWithAxis(4, 'Sup3', 'teamfight', 6),
      heroWithAxis(5, 'Sup4', 'teamfight', 6),
    ];

    // 2 hard-carries: below the (now 3+) threshold, no penalty yet.
    const belowThreshold = analyzer.analyze(picks(twoStacked));
    const withPenalty = analyzer.analyze(picks(threeStacked));

    expect(belowThreshold.score).toBe(6);
    expect(flattenLocalized(belowThreshold.explanation)).not.toMatch(/eval.axis.hardCarryScaling/);
    // 3 hard-carries = -5% (server/data/axis-weights.json hardCarryStackPenalty)
    // — still applies to the score, just no longer explained on a
    // non-scaling axis (Blueprint/10-tech-debt-backlog.md, "Дублирующаяся
    // строка про hard-carry stacking" — used to repeat verbatim across
    // ~11 of the 13 axes at once).
    expect(withPenalty.score).toBeCloseTo(6 * 0.95, 5);
    expect(flattenLocalized(withPenalty.explanation)).not.toMatch(/eval.axis.hardCarryScaling/);
  });

  it('exempts scaling from the penalty and boosts it instead, once 3+ hard-carries are drafted', () => {
    const analyzer = createAxisAnalyzer('scaling', 'Scaling');
    const threeStacked = [
      hardCarryHero(1, 'HC1', 'scaling', 6),
      hardCarryHero(2, 'HC2', 'scaling', 6),
      hardCarryHero(3, 'HC3', 'scaling', 6),
      heroWithAxis(4, 'Sup3', 'scaling', 6),
      heroWithAxis(5, 'Sup4', 'scaling', 6),
    ];

    const result = analyzer.analyze(picks(threeStacked));

    expect(result.score).toBeCloseTo(6 * 1.1, 5);
    expect(flattenLocalized(result.explanation)).toMatch(/eval.axis.hardCarryScaling/);
  });

  it('applies hidden Raid Boss +18% on Evaluation axes', () => {
    const medusa = heroWithAxis(1, 'Medusa', 'teamfight', 5);
    const analyzer = createAxisAnalyzer('teamfight', 'Teamfight');
    const result = analyzer.analyze(picks([medusa]));
    expect(result.score).toBeCloseTo(5 * 1.18, 5);
  });

  it('omits topContributorHeroId when that hero is bottom 35% of the pool on the axis', () => {
    const weak = heroWithAxis(1, 'Weak', 'saving', 1);
    const alsoWeak = heroWithAxis(2, 'AlsoWeak', 'saving', 0.5);
    const pool = [0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9]; // 1 sits at 20th percentile
    const analyzer = createAxisAnalyzer('saving', 'Saving', pool);
    const result = analyzer.analyze(picks([weak, alsoWeak]));
    expect(result.topContributorHeroId).toBeNull();
  });

  it('keeps topContributorHeroId when the hero is above the pool floor', () => {
    const strong = heroWithAxis(1, 'Strong', 'saving', 8);
    const filler = heroWithAxis(2, 'Filler', 'saving', 4);
    const pool = [0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const analyzer = createAxisAnalyzer('saving', 'Saving', pool);
    const result = analyzer.analyze(picks([strong, filler]));
    expect(result.topContributorHeroId).toBe(1);
  });
});
