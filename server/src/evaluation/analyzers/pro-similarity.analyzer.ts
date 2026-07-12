import type { Analyzer } from '../analyzer.interface';

// No professional match data exists until the Import Module ships (Milestone 3,
// Blueprint/07-development-plan.md). Returning null keeps this honest instead of
// fabricating a score; EvaluationService redistributes its weight until then.
export const proSimilarityAnalyzer: Analyzer = {
  key: 'proSimilarity',
  label: 'Pro Similarity',
  analyze() {
    return {
      score: null,
      explanation: [
        'No professional match data has been imported yet (planned for Milestone 3).',
      ],
    };
  },
};
