import { createSynergyAnalyzer, type SynergyLookup } from './synergy.analyzer';
import { makeHero, DEFAULT_EVALUATION_VALUES } from '../../test-utils/hero-factory';

const noRealData: SynergyLookup = {
  getSynergyWinRate: () => null,
  getWinRate: () => null,
};

describe('createSynergyAnalyzer (tag rules, no real data)', () => {
  const synergyAnalyzer = createSynergyAnalyzer(noRealData);

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

describe('createSynergyAnalyzer (real win-rate data blending)', () => {
  it('halves a tag rule\'s weight when real data shows the pair underperforming by 4.5pp+', () => {
    const setup = makeHero({ id: 1, name: 'Lion', synergy_tags: ['needs_setup'] });
    const enabler = makeHero({ id: 2, name: 'Mirana', synergy_tags: ['enables_engage'] });

    const underperforming: SynergyLookup = {
      getWinRate: (id) => (id === 1 || id === 2 ? 0.5 : null),
      // Expected (avg of solo win rates) is 0.5; actual is 0.45 -> -5pp, past the -4.5pp threshold.
      getSynergyWinRate: (a, b) => ([a, b].sort().join() === '1,2' ? 0.45 : null),
    };

    const result = createSynergyAnalyzer(underperforming).analyze([setup, enabler]);
    expect(result.score).toBe(1.3); // 2.5 * 0.5 = 1.25, rounded to 1 decimal
    expect(result.explanation[0]).toMatch(/underperforms expectations/i);
  });

  it('does not dampen a tag rule when the underperformance is within the threshold', () => {
    const setup = makeHero({ id: 1, name: 'Lion', synergy_tags: ['needs_setup'] });
    const enabler = makeHero({ id: 2, name: 'Mirana', synergy_tags: ['enables_engage'] });

    const mildUnderperformance: SynergyLookup = {
      getWinRate: (id) => (id === 1 || id === 2 ? 0.5 : null),
      // -2pp, short of the -4.5pp dampening threshold.
      getSynergyWinRate: (a, b) => ([a, b].sort().join() === '1,2' ? 0.48 : null),
    };

    const result = createSynergyAnalyzer(mildUnderperformance).analyze([setup, enabler]);
    expect(result.score).toBe(2.5);
    expect(result.explanation[0]).not.toMatch(/underperforms expectations/i);
  });

  it('rewards a real-data-only synergy pair with no matching tags at all', () => {
    const heroA = makeHero({ id: 1, name: 'Axe' });
    const heroB = makeHero({ id: 2, name: 'Sven' });

    const strongRealSynergy: SynergyLookup = {
      getWinRate: (id) => (id === 1 || id === 2 ? 0.5 : null),
      // Expected 0.5, actual 0.6 -> +10pp, well past the +3pp significance bar.
      getSynergyWinRate: (a, b) => ([a, b].sort().join() === '1,2' ? 0.6 : null),
    };

    const result = createSynergyAnalyzer(strongRealSynergy).analyze([heroA, heroB]);
    expect(result.score).toBeGreaterThan(0);
    expect(result.explanation[0]).toContain('Axe');
    expect(result.explanation[0]).toContain('Sven');
    expect(result.explanation[0]).toMatch(/strong real win rate/i);
  });

  it('ignores small real-data deltas as noise (below the significance threshold)', () => {
    const heroA = makeHero({ id: 1, name: 'Axe' });
    const heroB = makeHero({ id: 2, name: 'Sven' });

    const weakSignal: SynergyLookup = {
      getWinRate: (id) => (id === 1 || id === 2 ? 0.5 : null),
      // +1pp — below the +3pp significance bar.
      getSynergyWinRate: (a, b) => ([a, b].sort().join() === '1,2' ? 0.51 : null),
    };

    const result = createSynergyAnalyzer(weakSignal).analyze([heroA, heroB]);
    expect(result.score).toBe(0);
  });
});
