import { synergyAnalyzer } from './synergy.analyzer';
import { makeHero, DEFAULT_EVALUATION_VALUES } from '../../test-utils/hero-factory';

describe('synergyAnalyzer', () => {
  it('reports no synergy when nothing matches', () => {
    const heroes = [makeHero({ id: 1, name: 'A' }), makeHero({ id: 2, name: 'B' })];
    const result = synergyAnalyzer.analyze(heroes);
    expect(result.score).toBe(0);
    expect(result.explanation[0]).toMatch(/no strong hero-to-hero synergies/i);
  });

  it('scores a needs_setup + enables_engage pair and names both heroes', () => {
    const setup = makeHero({ id: 1, name: 'Lion', synergy_tags: ['needs_setup'] });
    const enabler = makeHero({ id: 2, name: 'Mirana', synergy_tags: ['enables_engage'] });
    const result = synergyAnalyzer.analyze([setup, enabler]);
    expect(result.score).toBe(2.5);
    expect(result.explanation[0]).toContain('Lion');
    expect(result.explanation[0]).toContain('Mirana');
  });

  it('stacks multiple independent tag-pair rules', () => {
    const heroes = [
      makeHero({ id: 1, name: 'A', synergy_tags: ['needs_setup'] }),
      makeHero({ id: 2, name: 'B', synergy_tags: ['enables_engage'] }),
      makeHero({ id: 3, name: 'C', synergy_tags: ['needs_space'] }),
      makeHero({ id: 4, name: 'D', synergy_tags: ['creates_space'] }),
    ];
    const result = synergyAnalyzer.analyze(heroes);
    // needs_setup+enables_engage (2.5) + needs_space+creates_space (2) = 4.5
    expect(result.score).toBe(4.5);
  });

  it('does not pair a hero with itself', () => {
    const soloHero = makeHero({ id: 1, name: 'Solo', synergy_tags: ['needs_setup', 'enables_engage'] });
    const result = synergyAnalyzer.analyze([soloHero]);
    expect(result.score).toBe(0);
  });

  it('adds a bonus for 2+ high-mobility heroes', () => {
    const mobile = (id: number, name: string) =>
      makeHero({ id, name, evaluation_values: { ...DEFAULT_EVALUATION_VALUES, mobility: 6 } });
    const result = synergyAnalyzer.analyze([mobile(1, 'A'), mobile(2, 'B')]);
    expect(result.score).toBe(1);
    expect(result.explanation.some((line) => line.includes('high-mobility'))).toBe(true);
  });

  it('adds a bonus for 3+ teamfight-tagged heroes', () => {
    const teamfighter = (id: number, name: string) => makeHero({ id, name, tags: ['teamfight'] });
    const result = synergyAnalyzer.analyze([teamfighter(1, 'A'), teamfighter(2, 'B'), teamfighter(3, 'C')]);
    expect(result.score).toBe(1);
    expect(result.explanation.some((line) => line.includes('teamfight-oriented core'))).toBe(true);
  });

  it('caps the final score at 10', () => {
    // Stack every rule plus both bonuses to try to exceed 10.
    const heroes = [
      makeHero({
        id: 1,
        name: 'A',
        synergy_tags: ['needs_setup', 'needs_space'],
        tags: ['teamfight'],
        evaluation_values: { ...DEFAULT_EVALUATION_VALUES, mobility: 6 },
      }),
      makeHero({
        id: 2,
        name: 'B',
        synergy_tags: ['enables_engage', 'creates_space', 'protects_allies', 'wave_clear_support'],
        tags: ['teamfight'],
        evaluation_values: { ...DEFAULT_EVALUATION_VALUES, mobility: 6 },
      }),
      makeHero({
        id: 3,
        name: 'C',
        synergy_tags: ['amplifies_magic_damage', 'amplifies_physical_damage'],
        tags: ['teamfight'],
      }),
    ];
    const result = synergyAnalyzer.analyze(heroes);
    expect(result.score).toBeLessThanOrEqual(10);
  });
});
