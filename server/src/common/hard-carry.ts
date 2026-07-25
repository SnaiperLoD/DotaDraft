import * as fs from 'fs';
import * as path from 'path';
import type { Hero, HeroEvaluationValues } from 'shared';

// Hard-carry stacking penalty (Blueprint/10-tech-debt-backlog.md). Lives in
// common/, not battle/ or evaluation/, because both Battle Engine
// (battle-resolution.ts) and Evaluation Engine (axis.analyzer.ts) apply it
// to their own "sum of axes" — same reasoning as common/role-fit.ts (Core
// Rules Separation: both depend on this neutral module instead of one
// depending on the other).
interface HardCarryConfig {
  // Share of a hero's real games (presumed_positions) at Carry or Mid
  // above which they count as "hard-carry".
  hardCarryShareThreshold: number;
  // Power penalty (fraction subtracted, e.g. 0.05 = -5%) keyed by how many
  // hard-carry heroes are on the same team.
  hardCarryStackPenalty: Record<string, number>;
}

const AXIS_WEIGHTS_PATH = path.join(__dirname, '..', '..', 'data', 'axis-weights.json');
const config: HardCarryConfig = JSON.parse(fs.readFileSync(AXIS_WEIGHTS_PATH, 'utf-8'));

// A hero counts as "hard-carry" if they play Carry OR Mid in more than
// hardCarryShareThreshold of their real games (presumed_positions,
// hero-meta.json) — not summed, either position individually dominating.
// Computed on the fly rather than a persisted tag: presumed_positions is
// already real, per-hero data that updates when positions get refetched, so
// deriving from it stays in sync automatically instead of needing its own
// manual upkeep like tags/synergy_tags/counter_tags do.
export function isHardCarry(hero: Hero): boolean {
  // Optional chaining: heroes.json itself doesn't carry presumed_positions
  // (only merged in at seed time, see seed.ts) — scripts that build Hero
  // objects straight from that file, not through HeroService/SQLite, would
  // otherwise crash here.
  const carryShare = hero.presumed_positions?.find((p) => p.position === 'Carry')?.share ?? 0;
  const midShare = hero.presumed_positions?.find((p) => p.position === 'Mid')?.share ?? 0;
  return carryShare > config.hardCarryShareThreshold || midShare > config.hardCarryShareThreshold;
}

// A normal draft has exactly one real Carry and one real Mid, so 0-2
// hard-carry heroes is the healthy baseline (no penalty — a standard pair
// plus one flex/Universal pick is still fine); 3 is where it starts
// costing real priority/farm competition, escalating sharply from there,
// modeling a draft that can't actually function with that many heroes
// needing the same resources.
export function hardCarryPenalty(team: Hero[]): number {
  const count = team.filter(isHardCarry).length;
  return config.hardCarryStackPenalty[String(count)] ?? 0;
}

// scaling is deliberately exempt from the stacking penalty above — and
// gets a flat boost instead — because a team that stacks hard-carries is,
// if anything, MORE built around winning a long game than a normal draft,
// not less. Every other axis still takes the fractional penalty.
const SCALING_BOOST = 0.1;

// Every axis except scaling; keeps this file the single owner of "what the
// stacking penalty actually multiplies," rather than exporting the raw
// fraction and making every caller remember to special-case scaling
// itself. Duplicates battle-resolution.ts's AXES list (13 names) rather
// than importing it, to avoid a circular import — same trade-off already
// made in custom-tags.ts.
const NON_SCALING_AXES: (keyof HeroEvaluationValues)[] = [
  'teamfight',
  'tempo',
  'mobility',
  'objectives',
  'control',
  'durability',
  'burst',
  'map_control',
  'saving',
  'initiating',
  'skirmish_rate',
  'camp_stacking',
];

// Per-axis multipliers for the stacking penalty/scaling-boost — feeds
// directly into axisAverage()'s tagEffects.axisMultiplier (battle-
// resolution.ts) and the equivalent per-axis calc in axis.analyzer.ts.
// Empty when there's no penalty (0-2 hard-carries), so callers can treat
// "no entries" as "nothing to apply" without a separate branch.
export function hardCarryAxisMultipliers(team: Hero[]): Partial<Record<keyof HeroEvaluationValues, number>> {
  const penalty = hardCarryPenalty(team);
  if (penalty === 0) return {};
  const multipliers: Partial<Record<keyof HeroEvaluationValues, number>> = { scaling: 1 + SCALING_BOOST };
  for (const axis of NON_SCALING_AXES) multipliers[axis] = 1 - penalty;
  return multipliers;
}
