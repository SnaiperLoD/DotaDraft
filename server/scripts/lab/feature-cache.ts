// Feature cache: load + exact replay of Battle's advantageDirection for
// arbitrary axis/phase weights, phase mix, realWinRateWeight and diff coeffs.
//
// Why this is exact: in battle-resolution.ts assessBattle(), the only places
// axis weights enter are overallPowerForPhase() (weighted mean of tagged
// axisAverage per phase) and axisPowerDeltas() (reporting only). Tag effects
// (custom-tags.ts, hard-carry, utility-stacking, manual overrides, shutdown)
// are built from RAW unweighted axisAverage and hero sets — no axis weight
// enters them (hard-carry.ts / utility-stacking.ts read axis-weights.json only
// for their own penalty keys). So per (match, side, phase, axis) the tagged
// axisAverage is weight-independent and the decision is a closed-form function
// of the cache. Gate: verify-cache.ts.
import * as fs from 'fs';
import * as path from 'path';
import { AXES } from '../../src/assessment-core/axes';
import { axisWeightsConfig } from '../../src/common/axis-weights-config';
import { DEFAULT_DIFF_INPUTS, ADVANTAGE_THRESHOLD } from '../../src/battle/battle-resolution';

export const PHASES = ['early', 'mid', 'late'] as const;
export const NA = AXES.length; // 14
export const NP = PHASES.length; // 3
export function cacheDir(seed: number, n: number, label: string): string {
  return path.join(__dirname, '..', '..', '..', 'artifacts', 'lab', 'cache', `seed${seed}-n${n}-${label}`);
}

export const SIDE_FIELDS = ['synergyBonusA', 'synergyBonusB', 'edgeA', 'winRateEdgeA', 'winRateEdgeB'] as const;

export interface FeatureCache {
  dir: string;
  meta: { label: string; seed: number; nMatches: number; nHeroes: number; axes: string[]; phases: string[]; heroIds: number[]; heroNames: string[]; roles: string[]; disabledTags: string };
  n: number;
  heroIdx: Int16Array; // n*10
  roleIdx: Int8Array; // n*10
  T: Float64Array; // ((m*2+s)*NP+p)*NA+a — tagged axisAverage (tags+role-fit+penalties), per phase
  R: Float64Array; // (m*2+s)*NA+a — raw axisAverage (role-fit, no tags)
  side: Float64Array; // m*5 + SIDE_FIELDS index
  flags: Int8Array | null; // m*3: highSkill A, highSkill B, mechanical present
}

function readBin<T>(p: string, ctor: new (b: ArrayBuffer) => T): T {
  const buf = fs.readFileSync(p);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  return new ctor(ab);
}

export function loadCache(dir: string): FeatureCache {
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf-8'));
  return {
    dir,
    meta,
    n: meta.nMatches,
    heroIdx: readBin(path.join(dir, 'heroIdx.bin'), Int16Array),
    roleIdx: readBin(path.join(dir, 'roleIdx.bin'), Int8Array),
    T: readBin(path.join(dir, 'T.bin'), Float64Array),
    R: readBin(path.join(dir, 'R.bin'), Float64Array),
    side: readBin(path.join(dir, 'side.bin'), Float64Array),
    flags: fs.existsSync(path.join(dir, 'flags.bin')) ? readBin(path.join(dir, 'flags.bin'), Int8Array) : null,
  };
}

export interface ReplayParams {
  w: Float64Array; // NP*NA, phase-major, AXES order
  pd: Float64Array; // NP
  rwr: number;
  synergyCoeff: number;
  matchupCoeff: number;
  threshold: number;
  /** Lab ablation: replace taggedPower by this constant on both sides (axes OFF, multipliers only). Use the pool's mean taggedPower to keep the diff scale. */
  constPower?: number;
  /** Lab ablation: use raw untagged axisAverage (R) instead of T — no tags, no penalties, roles kept. */
  useRaw?: boolean;
}

/** Production parameters resolved exactly like axisWeightForPhase(). */
export function productionParams(rwr = axisWeightsConfig.realWinRateWeight): ReplayParams {
  const w = new Float64Array(NP * NA);
  PHASES.forEach((ph, p) =>
    AXES.forEach((ax, a) => {
      w[p * NA + a] = axisWeightsConfig.phaseWeights?.[ph]?.[ax] ?? axisWeightsConfig.axisWeights[ax] ?? 1;
    }),
  );
  const dist = axisWeightsConfig.phaseDistribution ?? { early: 1 / 3, mid: 1 / 3, late: 1 / 3 };
  return {
    w,
    pd: Float64Array.from(PHASES.map((ph) => dist[ph])),
    rwr,
    synergyCoeff: DEFAULT_DIFF_INPUTS.synergyCoeff,
    matchupCoeff: DEFAULT_DIFF_INPUTS.matchupCoeff,
    // Final-diff Even cut-off (battle-diff-inputs.json evenAbsDiff since 2026-10-03).
    threshold: DEFAULT_DIFF_INPUTS.evenAbsDiff ?? ADVANTAGE_THRESHOLD,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Same operation order as blendedOverallPower(team, tagEffects). */
export function taggedPower(c: FeatureCache, m: number, s: number, prm: ReplayParams): number {
  let blended = 0;
  for (let p = 0; p < NP; p++) {
    const src = prm.useRaw ? c.R : c.T;
    const base = prm.useRaw ? (m * 2 + s) * NA : ((m * 2 + s) * NP + p) * NA;
    let sum = 0;
    let tot = 0;
    for (let a = 0; a < NA; a++) sum = sum + src[base + a] * prm.w[p * NA + a];
    for (let a = 0; a < NA; a++) tot = tot + prm.w[p * NA + a];
    const op = tot === 0 ? 0 : sum / tot;
    blended = blended + op * prm.pd[p];
  }
  return blended;
}

/** Same expression as assessBattle()'s powerA − powerB. */
export function replayDiff(c: FeatureCache, m: number, prm: ReplayParams): number {
  const sd = m * 5;
  const synA = c.side[sd];
  const synB = c.side[sd + 1];
  const edgeA = c.side[sd + 2];
  const wrA = c.side[sd + 3];
  const wrB = c.side[sd + 4];
  const powerA =
    (prm.constPower !== undefined ? prm.constPower : taggedPower(c, m, 0, prm)) *
    clamp(1 + synA * prm.synergyCoeff, 0.3, 1.7) *
    clamp(1 + edgeA * prm.matchupCoeff, 0.3, 1.7) *
    clamp(1 + wrA * prm.rwr, 1 - 0.3, 1 + 0.3);
  const powerB =
    (prm.constPower !== undefined ? prm.constPower : taggedPower(c, m, 1, prm)) *
    clamp(1 + synB * prm.synergyCoeff, 0.3, 1.7) *
    clamp(1 - edgeA * prm.matchupCoeff, 0.3, 1.7) *
    clamp(1 + wrB * prm.rwr, 1 - 0.3, 1 + 0.3);
  return powerA - powerB;
}

export interface HeroCounts {
  appearances: Float64Array;
  favored: Float64Array;
  even: Float64Array;
}

export function replayCounts(c: FeatureCache, prm: ReplayParams): HeroCounts {
  const H = c.meta.nHeroes;
  const out: HeroCounts = { appearances: new Float64Array(H), favored: new Float64Array(H), even: new Float64Array(H) };
  for (let m = 0; m < c.n; m++) {
    const d = replayDiff(c, m, prm);
    const dir = d > prm.threshold ? 0 : d < -prm.threshold ? 1 : -1;
    for (let k = 0; k < 10; k++) {
      const h = c.heroIdx[m * 10 + k];
      out.appearances[h]++;
      if (dir === -1) out.even[h]++;
      else if ((k < 5 ? 0 : 1) === dir) out.favored[h]++;
    }
  }
  return out;
}

export function favoredRates(cnt: HeroCounts): number[] {
  return Array.from(cnt.appearances, (app, h) =>
    app - cnt.even[h] === 0 ? 0.5 : cnt.favored[h] / (app - cnt.even[h]),
  );
}

/**
 * Per-hero mean P(hero's side wins) under a per-match probability model.
 * mode 'tier': resolveBattle()'s WIN_WEIGHT_BY_TIER + High Skill pull (Mechanical gate).
 * mode 'logistic': σ(k·diff).
 */
export function replayHeroProb(
  c: FeatureCache,
  prm: ReplayParams,
  mode: { kind: 'tier'; moderate: number; high: number; w: { Low: number; Moderate: number; High: number }; hsShift: number } | { kind: 'logistic'; k: number },
): Float64Array {
  const H = c.meta.nHeroes;
  const sum = new Float64Array(H);
  const app = new Float64Array(H);
  for (let m = 0; m < c.n; m++) {
    const d = replayDiff(c, m, prm);
    let pA: number;
    if (mode.kind === 'logistic') pA = 1 / (1 + Math.exp(-mode.k * d));
    else {
      const ad = Math.abs(d);
      const fw = ad > mode.high ? mode.w.High : ad > mode.moderate ? mode.w.Moderate : mode.w.Low;
      pA = d > prm.threshold ? fw : d < -prm.threshold ? 1 - fw : 0.5;
      if (c.flags && !c.flags[m * 3 + 2]) {
        const pull = (p: number) => (p > 0.5 ? Math.max(0.5, p - mode.hsShift) : p < 0.5 ? Math.min(0.5, p + mode.hsShift) : p);
        if (c.flags[m * 3]) pA = pull(pA);
        if (c.flags[m * 3 + 1]) pA = pull(pA);
      }
    }
    for (let k = 0; k < 10; k++) {
      const h = c.heroIdx[m * 10 + k];
      app[h]++;
      sum[h] += k < 5 ? pA : 1 - pA;
    }
  }
  return sum.map((s, h) => s / app[h]);
}
