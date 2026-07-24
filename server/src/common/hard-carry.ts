import * as fs from 'fs';
import * as path from 'path';
import type { Hero } from 'shared';

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

// A normal draft has exactly one real Carry and one real Mid, so 0-1
// hard-carry heroes is the healthy baseline (no penalty); 2 is that
// baseline itself (small penalty acknowledging even the standard pair
// competes for priority/farm) and 3+ escalates sharply, modeling a draft
// that can't actually function with that many heroes needing the same
// resources.
export function hardCarryPenalty(team: Hero[]): number {
  const count = team.filter(isHardCarry).length;
  return config.hardCarryStackPenalty[String(count)] ?? 0;
}
