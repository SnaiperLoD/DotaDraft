import * as fs from 'fs';
import * as path from 'path';
import type { Hero, HeroEvaluationValues } from 'shared';

// Utility-axis stacking diminishing-returns (Blueprint/12-next-session-
// priorities.md, item 2; Blueprint/10-tech-debt-backlog.md, "Поворотный
// момент"). Root cause: control/initiating/mobility/saving/skirmish_rate/
// map_control are themselves mutually correlated (r=0.27-0.56 pairwise,
// see backlog) — a hero maxing several of them simultaneously (Treant
// Protector, Batrider, Keeper of the Light, Nyx Assassin, Chen, Io) gets
// counted as if each axis were an independent source of strength, but
// real winRate does not keep climbing past ~2-3 simultaneously-high axes.
// Lives in common/, not battle/ or evaluation/ — same reasoning as
// common/hard-carry.ts and common/role-fit.ts (Core Rules Separation:
// both engines depend on this neutral module instead of one depending on
// the other).
interface UtilityStackConfig {
  // Raw 0-10 evaluation_values score at/above which an axis counts as
  // "high" for this hero.
  utilityStackThreshold: number;
  // Number of simultaneously-high utility axes that's still normal breadth
  // (no penalty) — e.g. a control-heavy initiator is unremarkable on its
  // own.
  utilityStackFreeCount: number;
  // Discount (fraction subtracted, e.g. 0.08 = -8%) applied to EACH of the
  // hero's utility-axis values, keyed by how many axes are simultaneously
  // high. Escalating, same shape as hard-carry's hardCarryStackPenalty.
  utilityStackPenalty: Record<string, number>;
}

const AXIS_WEIGHTS_PATH = path.join(__dirname, '..', '..', 'data', 'axis-weights.json');
const config: UtilityStackConfig = JSON.parse(fs.readFileSync(AXIS_WEIGHTS_PATH, 'utf-8'));

export const UTILITY_AXES: (keyof HeroEvaluationValues)[] = [
  'control',
  'initiating',
  'mobility',
  'saving',
  'skirmish_rate',
  'map_control',
];

// Computed on the fly from evaluation_values (already-calibrated, static
// per hero) rather than a persisted tag — same reasoning as isHardCarry()
// deriving from presumed_positions instead of a manual flag.
export function utilityStackBreadth(hero: Hero): number {
  const ev = hero.evaluation_values;
  if (!ev) return 0;
  return UTILITY_AXES.filter((axis) => (ev[axis] ?? 0) >= config.utilityStackThreshold).length;
}

export function utilityStackPenalty(hero: Hero): number {
  const breadth = utilityStackBreadth(hero);
  if (breadth <= config.utilityStackFreeCount) return 0;
  return config.utilityStackPenalty[String(breadth)] ?? 0;
}

// Per-axis multipliers, one hero at a time (unlike hard-carry's team-wide
// axisMultiplier — utility stacking is a property of the individual hero's
// own kit, not a team-composition effect) — feeds into
// CustomTagEffects.heroAxisMultiplier. Only touches the 6 utility axes;
// durability/objectives/burst/teamfight/scaling/tempo/camp_stacking are
// untouched, since those aren't part of the collinear cluster this
// discounts.
export function utilityStackAxisMultipliers(hero: Hero): Partial<Record<keyof HeroEvaluationValues, number>> {
  const penalty = utilityStackPenalty(hero);
  if (penalty === 0) return {};
  const multipliers: Partial<Record<keyof HeroEvaluationValues, number>> = {};
  for (const axis of UTILITY_AXES) multipliers[axis] = 1 - penalty;
  return multipliers;
}
