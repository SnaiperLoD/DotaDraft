import { counterAnalyzer } from './counter.analyzer';
import { makeHero, picks } from '../../test-utils/hero-factory';

describe('counterAnalyzer', () => {
  it('scores 0 and explains the gap when no counter_tags are present', () => {
    const heroes = [makeHero({ id: 1, name: 'A' }), makeHero({ id: 2, name: 'B' })];
    const result = counterAnalyzer.analyze(picks(heroes));
    expect(result.score).toBe(0);
    expect(result.explanation[0]).toMatch(/no specialized counters/i);
  });

  it('counts each covered threat category once, regardless of how many heroes cover it', () => {
    const heroes = [
      makeHero({ id: 1, name: 'A', counter_tags: ['counters_illusions'] }),
      makeHero({ id: 2, name: 'B', counter_tags: ['counters_illusions'] }),
    ];
    const result = counterAnalyzer.analyze(picks(heroes));
    // 1 of 6 categories covered -> (1/6)*10 = 1.7 (rounded)
    expect(result.score).toBe(1.7);
    expect(result.explanation[0]).toContain('A');
    expect(result.explanation[0]).toContain('B');
  });

  it('reaches full-coverage score (10) at the 6-category threshold without exceeding it beyond that', () => {
    const heroes = [
      makeHero({
        id: 1,
        name: 'A',
        counter_tags: [
          'counters_illusions',
          'counters_summons',
          'counters_invisibility',
          'counters_channeled_ultimates',
          'counters_low_mobility',
          'counters_high_mobility',
        ],
      }),
    ];
    const result = counterAnalyzer.analyze(picks(heroes));
    expect(result.score).toBe(10);
  });

  it('caps the score at 10 even when all 9 categories are covered', () => {
    const allTags = [
      'counters_illusions',
      'counters_summons',
      'counters_invisibility',
      'counters_channeled_ultimates',
      'counters_low_mobility',
      'counters_high_mobility',
      'counters_squishy_backline',
      'counters_mana_reliant',
      'counters_tanky_durable',
    ];
    const heroes = [makeHero({ id: 1, name: 'A', counter_tags: allTags })];
    const result = counterAnalyzer.analyze(picks(heroes));
    expect(result.score).toBe(10);
  });

  it('humanizes the tag name in the explanation (underscores to spaces, prefix stripped)', () => {
    const heroes = [makeHero({ id: 1, name: 'A', counter_tags: ['counters_squishy_backline'] })];
    const result = counterAnalyzer.analyze(picks(heroes));
    expect(result.explanation[0]).toContain('Counters squishy backline: A.');
  });
});
