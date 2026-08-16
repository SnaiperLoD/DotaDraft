// Shared axis-weight config loader (Eval + Battle mid skeleton).
// Battle keeps phaseWeights / realWinRateWeight / stacking penalties in the
// same JSON; Evaluation only consumes mid `axisWeights` proportions for
// axes that appear in Total Score (Core Rules Separation: neither engine
// imports the other — both depend on this common module).
import * as fs from 'fs';
import * as path from 'path';
import type { HeroEvaluationValues } from 'shared';

export type GamePhase = 'early' | 'mid' | 'late';

export interface AxisWeightsConfig {
  axisWeights: Partial<Record<keyof HeroEvaluationValues, number>>;
  phaseWeights?: Partial<Record<GamePhase, Partial<Record<keyof HeroEvaluationValues, number>>>>;
  phaseDistribution?: Record<GamePhase, number>;
  realWinRateWeight: number;
  hardCarryShareThreshold?: number;
  hardCarryStackPenalty?: Record<string, number>;
  utilityStackThreshold?: number;
  utilityStackFreeCount?: number;
  utilityStackPenalty?: Record<string, number>;
}

const AXIS_WEIGHTS_PATH = path.join(__dirname, '..', '..', 'data', 'axis-weights.json');

export const axisWeightsConfig: AxisWeightsConfig = JSON.parse(
  fs.readFileSync(AXIS_WEIGHTS_PATH, 'utf-8'),
);

/** Mid-phase (baseline) Battle weight; missing keys default to 1, same as battle-resolution. */
export function midAxisWeight(axis: keyof HeroEvaluationValues): number {
  return axisWeightsConfig.axisWeights[axis] ?? 1;
}

// Axes that contribute to Evaluation Total Score and share the mid skeleton
// with Battle. map_control / camp_stacking muted; counter informational-only.
export const EVALUATION_MID_AXES: (keyof HeroEvaluationValues)[] = [
  'teamfight',
  'tempo',
  'scaling',
  'objectives',
  'burst',
  'control',
  'durability',
  'mobility',
  'saving',
  'initiating',
  'skirmish_rate',
  'resource_efficiency',
];

// Historical Eval-only cards — not derived from Battle mid.
const EVAL_ONLY_WEIGHTS: Record<string, number> = {
  synergy: 0.3,
  proSimilarity: 0.05,
};

// Keep the same overall axis share of Total Score that Eval had before the
// shared-skeleton wiring (~0.55), so synergy/proSimilarity stay dominant
// flavour/UI cards without suddenly owning the whole score.
const EVAL_AXIS_BUDGET = 0.55;

/**
 * Evaluation Total Score weights: Eval-only keys + mid-axis proportions
 * from axis-weights.json, renormalized to EVAL_AXIS_BUDGET.
 */
export function buildEvaluationScoreWeights(): Record<string, number> {
  const mids = EVALUATION_MID_AXES.map((a) => Math.max(0, midAxisWeight(a)));
  const sum = mids.reduce((s, w) => s + w, 0);
  const axisPart: Record<string, number> = {};
  if (sum > 0) {
    for (let i = 0; i < EVALUATION_MID_AXES.length; i++) {
      axisPart[EVALUATION_MID_AXES[i]] = (EVAL_AXIS_BUDGET * mids[i]) / sum;
    }
  }
  return { ...EVAL_ONLY_WEIGHTS, ...axisPart };
}
