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
    analyze(heroes) {
      if (compositions.length === 0) {
        return {
          score: null,
          explanation: [
            'No professional match data has been imported yet (planned for Milestone 3).',
          ],
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
          explanation: [
            `No imported professional draft shares ${MIN_OVERLAP_FOR_SIMILARITY} or more heroes with this composition (closest match: ${overlapCount} of 5) — not enough overlap to call it pro-similar.`,
          ],
        };
      }

      const score = Math.round((overlapCount / 5) * 10 * 10) / 10;
      const explanation = [
        `Shares ${overlapCount} of 5 heroes (${best!.overlap.join(', ')}) with a winning professional draft` +
          (best!.comp.teamName ? ` by ${best!.comp.teamName}` : '') +
          (best!.comp.leagueName ? ` (${best!.comp.leagueName})` : '') +
          '.',
      ];

      return { score, explanation };
    },
  };
}
