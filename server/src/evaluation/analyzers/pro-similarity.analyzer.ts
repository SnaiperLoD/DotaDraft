import { i18nLine } from 'shared';
import type { Analyzer } from '../analyzer.interface';
import type { ProComposition } from '../../pro-match/pro-match.service';

// Below this many shared heroes, an overlap is noise rather than a
// meaningful signal (any two 5-hero drafts can share 1-2 heroes by chance
// out of 120+ heroes) — the analyzer stays honest and returns null instead
// of a low score claiming similarity that isn't really there.
const MIN_OVERLAP_FOR_SIMILARITY = 3;

// Compares the drafted heroes against imported winning professional
// compositions (Milestone 3). Built per-evaluation with the current set of
// compositions, same factory shape as createAxisAnalyzer — data is passed in
// at construction, analyze() itself stays synchronous.
export function createProSimilarityAnalyzer(compositions: ProComposition[]): Analyzer {
  return {
    key: 'proSimilarity',
    label: 'Pro Similarity',
    analyze(picks) {
      const heroes = picks.map((p) => p.hero);
      if (compositions.length === 0) {
        return {
          score: null,
          percentile: null,
          explanation: [i18nLine('eval.pro.none')],
        };
      }

      let best: { comp: ProComposition; overlap: string[] } | null = null;
      for (const comp of compositions) {
        const heroIdSet = new Set(comp.heroIds);
        const overlap = heroes.filter((h) => heroIdSet.has(h.id)).map((h) => h.name);
        if (!best || overlap.length > best.overlap.length) {
          best = { comp, overlap };
        }
      }

      const overlapCount = best!.overlap.length;

      if (overlapCount < MIN_OVERLAP_FOR_SIMILARITY) {
        return {
          score: null,
          percentile: null,
          explanation: [
            i18nLine('eval.pro.tooFew', {
              min: String(MIN_OVERLAP_FOR_SIMILARITY),
              overlap: String(overlapCount),
            }),
          ],
        };
      }

      const score = Math.round((overlapCount / 5) * 10 * 10) / 10;
      const params: Record<string, string> = {
        overlap: String(overlapCount),
        heroes: best!.overlap.join(', '),
      };
      if (best!.comp.teamName) params.teamName = best!.comp.teamName;
      if (best!.comp.leagueName) params.leagueName = best!.comp.leagueName;

      // Not axis-based (no evaluation_values score) — no percentile
      // distribution to rank against, see analyzer.interface.ts.
      return {
        score,
        percentile: null,
        explanation: [i18nLine('eval.pro.match', params)],
        matchUrl: `https://www.opendota.com/matches/${best!.comp.matchId}`,
      };
    },
  };
}
