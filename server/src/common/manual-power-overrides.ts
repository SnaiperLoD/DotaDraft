import * as fs from 'fs';
import * as path from 'path';
import type { Hero } from 'shared';

// MVP-level manual correction (Blueprint/10-tech-debt-backlog.md, dispersion/
// anomaly fixing) — by explicit user request, a hand-tuned final multiplier
// per hero to pull the worst favoredRate/realWinRate outliers back under the
// ±10pp threshold, instead of waiting on the next structural finding.
//
// Deliberately Battle Engine ONLY, not Evaluation Engine: `evaluation_values`
// stays untouched (single source of truth for Evaluation Engine's per-axis
// breakdown text, axis-percentiles.ts's population percentiles, and Synergy/
// Counter analyzers) — patching a raw axis value to fix Battle Engine's
// favoredRate would also silently distort what the player sees described as
// that hero's real strengths/weaknesses, and skew the percentile reference
// population for every OTHER hero too. A power multiplier only touches the
// one thing actually being calibrated against real data (Battle Engine's
// win-probability model), leaving the descriptive layer honest.
//
// Reuses the existing heroPowerMultiplier mechanism (custom-tags.ts) rather
// than inventing a new one — same effect as debuffing every axis uniformly
// (mathematically identical for overallPower, since it's a normalized
// weighted average: multiplying every axis by k multiplies the average by
// k), just without touching evaluation_values itself.
//
// Values below 1 debuff an overperformer, above 1 buff an underperformer.
// Silently defaults to 1 (no-op) for any hero not listed.
const OVERRIDES_PATH = path.join(__dirname, '..', '..', 'data', 'manual-power-overrides.json');
const overrides: Record<string, number> = JSON.parse(fs.readFileSync(OVERRIDES_PATH, 'utf-8'));

export function manualPowerMultiplier(hero: Hero): number {
  return overrides[String(hero.id)] ?? 1;
}
