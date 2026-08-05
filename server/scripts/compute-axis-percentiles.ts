import * as fs from 'fs';
import * as path from 'path';
import { AXES } from '../src/battle/battle-resolution';
import { roleFitValue } from '../src/common/role-fit';
import { hardCarryAxisMultipliers } from '../src/common/hard-carry';
import { ROLES } from 'shared';
import type { Hero, HeroEvaluationValues } from 'shared';

// Percentile calibration for Evaluation's "where does this draft rank"
// display (self-play outlier investigation follow-up, Blueprint/
// 10-tech-debt-backlog.md). Draws N random 5-hero teams, scores each axis
// EXACTLY the way axis.analyzer.ts does (role-fit + hard-carry
// axisMultiplier, same rounding) so the resulting distribution is an
// apples-to-apples population to rank a real evaluation against — not just
// an informal "what's average" probe like check-axis-distribution.ts.
const HEROES_PATH = path.join(__dirname, '..', 'data', 'heroes.json');
const HERO_META_PATH = path.join(__dirname, '..', 'data', 'hero-meta.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'axis-percentile-distributions.json');

const N_SAMPLES = 10000;
const TEAM_SIZE = 5;

// resource_efficiency isn't in Battle Engine's AXES (server/src/battle/
// battle-resolution.ts) — it's Evaluation-Engine-only, not wired into the
// real power/win-probability calc (see calibrate-evaluation-values.ts's
// header comment). Sampled here anyway, alongside AXES, purely so it gets
// a percentile distribution for axis.analyzer.ts's percentileFor() to rank
// against — this loop is agnostic to what each axis feeds into.
const AXES_TO_SAMPLE: (keyof HeroEvaluationValues)[] = [...AXES, 'resource_efficiency'];

function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Duplicated from simulate-self-play.ts rather than factored into a shared
// module — same trade-off as custom-tags.ts's registry duplication, this
// is calibration tooling, not production code.
function roleWeights(positions: { position: string; share: number }[]): Record<string, number> {
  const w: Record<string, number> = { Carry: 0, Mid: 0, Offlane: 0, 'Soft Support': 0, 'Hard Support': 0 };
  let allocated = 0;
  for (const p of positions) {
    if (p.position === 'Carry') { w.Carry += p.share; allocated += p.share; }
    else if (p.position === 'Mid') { w.Mid += p.share; allocated += p.share; }
    else if (p.position === 'Offlane') { w.Offlane += p.share; allocated += p.share; }
    else if (p.position === 'Support') { w['Soft Support'] += p.share / 2; w['Hard Support'] += p.share / 2; allocated += p.share; }
  }
  const leftover = Math.max(0, 1 - allocated);
  for (const role of ROLES) w[role] += leftover / ROLES.length;
  return w;
}

function assignWeightedRoles(heroes: Hero[], weightsById: Map<number, Record<string, number>>): string[] {
  const order = shuffle(heroes.map((_, i) => i));
  const rolesLeft = [...ROLES] as string[];
  const assigned: string[] = new Array(heroes.length);
  for (const idx of order) {
    const w = weightsById.get(heroes[idx].id) ?? Object.fromEntries(ROLES.map((r) => [r, 1]));
    const weights = rolesLeft.map((r) => Math.max(0.001, w[r] ?? 0.001));
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = Math.random() * total;
    let pick = rolesLeft.length - 1;
    for (let i = 0; i < weights.length; i++) {
      roll -= weights[i];
      if (roll <= 0) { pick = i; break; }
    }
    assigned[idx] = rolesLeft[pick];
    rolesLeft.splice(pick, 1);
  }
  return assigned;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function percentileOf(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function main() {
  const heroes: Hero[] = JSON.parse(fs.readFileSync(HEROES_PATH, 'utf-8'));
  const { heroes: rawMetaEntries }: { heroes: any[] } = JSON.parse(fs.readFileSync(HERO_META_PATH, 'utf-8'));
  const positionsById = new Map(rawMetaEntries.map((e) => [e.heroId, e.positions]));
  for (const h of heroes) h.presumed_positions = (positionsById.get(h.id) ?? []) as Hero['presumed_positions'];
  const weightsById = new Map(heroes.map((h) => [h.id, roleWeights(positionsById.get(h.id) ?? [])]));

  const scoresByAxis: Record<string, number[]> = Object.fromEntries(AXES_TO_SAMPLE.map((a) => [a, []]));

  for (let i = 0; i < N_SAMPLES; i++) {
    const team = shuffle(heroes).slice(0, TEAM_SIZE);
    const roles = assignWeightedRoles(team, weightsById);
    const multipliers = hardCarryAxisMultipliers(team);

    for (const axis of AXES_TO_SAMPLE) {
      const rawAvg = mean(team.map((h, idx) => roleFitValue(axis, roles[idx], h.evaluation_values[axis])));
      const score = Math.round(rawAvg * (multipliers[axis] ?? 1) * 10) / 10;
      scoresByAxis[axis].push(score);
    }
  }

  console.log(`Sampled ${N_SAMPLES} random 5-hero teams (weighted-role assignment).\n`);
  console.log('axis            mean   p10   p25   p50   p75   p90');
  const distributions: Record<string, number[]> = {};
  for (const axis of AXES_TO_SAMPLE) {
    const sorted = [...scoresByAxis[axis]].sort((a, b) => a - b);
    distributions[axis] = sorted;
    console.log(
      `  ${axis.padEnd(14)}${mean(sorted).toFixed(2).padStart(5)} ${percentileOf(sorted, 10).toFixed(1).padStart(5)} ${percentileOf(sorted, 25).toFixed(1).padStart(5)} ${percentileOf(sorted, 50).toFixed(1).padStart(5)} ${percentileOf(sorted, 75).toFixed(1).padStart(5)} ${percentileOf(sorted, 90).toFixed(1).padStart(5)}`,
    );
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), nSamples: N_SAMPLES, distributions }, null, 2));
  console.log(`\nWritten to ${OUTPUT_PATH}`);
}

main();
