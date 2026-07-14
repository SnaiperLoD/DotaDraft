import { createProSimilarityAnalyzer } from './pro-similarity.analyzer';
import type { Hero } from 'shared';
import type { ProComposition } from '../../pro-match/pro-match.service';
import { makeHero, picks } from '../../test-utils/hero-factory';

function hero(id: number, name: string): Hero {
  return makeHero({ id, name });
}

describe('createProSimilarityAnalyzer', () => {
  it('returns null score with no imported data', () => {
    const analyzer = createProSimilarityAnalyzer([]);
    const result = analyzer.analyze(picks([hero(1, 'A'), hero(2, 'B')]));
    expect(result.score).toBeNull();
    expect(result.explanation[0]).toMatch(/no professional match data/i);
  });

  it('returns null (not a low score) when the best overlap is below the 3-hero threshold', () => {
    const compositions: ProComposition[] = [
      { matchId: '1', heroIds: [1, 2, 97, 96, 95], teamName: 'Team A', leagueName: null },
    ];
    const analyzer = createProSimilarityAnalyzer(compositions);
    // Only 2 of 5 heroes overlap — below MIN_OVERLAP_FOR_SIMILARITY.
    const result = analyzer.analyze(picks([hero(1, 'A'), hero(2, 'B'), hero(3, 'C')]));
    expect(result.score).toBeNull();
    expect(result.explanation[0]).toMatch(/does not share|no imported professional draft/i);
    expect(result.explanation[0]).toContain('closest match: 2 of 5');
  });

  it('returns null for zero overlap the same way as below-threshold overlap', () => {
    const compositions: ProComposition[] = [
      { matchId: '1', heroIds: [10, 11, 12, 13, 14], teamName: 'Team A', leagueName: null },
    ];
    const analyzer = createProSimilarityAnalyzer(compositions);
    const result = analyzer.analyze(picks([hero(1, 'A'), hero(2, 'B')]));
    expect(result.score).toBeNull();
    expect(result.explanation[0]).toContain('closest match: 0 of 5');
  });

  it('picks the composition with the highest overlap and names the shared heroes once 3+ heroes match', () => {
    const compositions: ProComposition[] = [
      { matchId: '1', heroIds: [1, 99, 98, 97, 96], teamName: 'Low Overlap', leagueName: null },
      { matchId: '2', heroIds: [1, 2, 3, 50, 51], teamName: 'Team Secret', leagueName: 'TI' },
    ];
    const analyzer = createProSimilarityAnalyzer(compositions);
    const result = analyzer.analyze(picks([hero(1, 'Axe'), hero(2, 'Zeus'), hero(3, 'Lion')]));
    expect(result.score).toBe(6); // 3 of 5 heroes overlap
    expect(result.explanation[0]).toContain('Axe, Zeus, Lion');
    expect(result.explanation[0]).toContain('Team Secret');
    expect(result.explanation[0]).toContain('TI');
  });
});
