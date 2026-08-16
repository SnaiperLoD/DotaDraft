import { buildEvaluationScoreWeights } from './axis-weights-config';

describe('buildEvaluationScoreWeights', () => {
  it('gives synergy 0.25 of the eval-only budget (5pp cut from 0.30)', () => {
    expect(buildEvaluationScoreWeights().synergy).toBe(0.25);
  });
});
