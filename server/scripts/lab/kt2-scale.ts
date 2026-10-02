// Н5.2 — scale layer. SCALE-ONLY by construction: every map here is monotone in
// favoredRate / diff, so r and Spearman cannot improve; only MAE-type metrics move.
//  (a) KPI side: OOF affine and OOF isotonic maps favoredRate → expected WR.
//  (b) Game side: what the tier roll implies per hero, and what tier weights would
//      be needed to (i) match the real spread, (ii) be calibrated (slope real~sys = 1).
//      Measured on the random-5v5 pool, not on real player-vs-pool battles.
//   cd server && npx ts-node scripts/lab/kt2-scale.ts
import * as fs from 'fs';
import * as path from 'path';
import { DATA_DIR, appendRun, ensureLabDir, mulberry32 } from './lab-common';
import { cacheDir, favoredRates, loadCache, productionParams, replayCounts, replayDiff, replayHeroProb, type FeatureCache } from './feature-cache';
import { bootstrapRuler, isotonicFit, ols, ruler, sd } from './lab-metrics';
import { DEFAULT_DIFF_INPUTS, WIN_WEIGHT_BY_TIER } from '../../src/battle/battle-resolution';
import { HIGH_SKILL_UPSET_SHIFT } from '../../src/battle/custom-tags';

const OUT = ensureLabDir('kt2');
const P0 = productionParams(0);
const meta = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'hero-meta.json'), 'utf-8')).heroes as { heroId: number; winRate: number }[];
const wr = new Map(meta.map((e) => [e.heroId, e.winRate]));

function oofMap(x: number[], y: number[], kind: 'affine' | 'iso', repeats = 10): number[] {
  const rng = mulberry32(31);
  const n = x.length;
  const avg = new Array(n).fill(0);
  for (let rep = 0; rep < repeats; rep++) {
    const idx = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    for (let f = 0; f < 5; f++) {
      const te = idx.filter((_, i) => i % 5 === f);
      const tes = new Set(te);
      const tr = idx.filter((i) => !tes.has(i));
      const xt = tr.map((i) => x[i]);
      const yt = tr.map((i) => y[i]);
      if (kind === 'affine') {
        const { a, b } = ols(xt, yt);
        te.forEach((i) => (avg[i] += (a + b * x[i]) / repeats));
      } else {
        const fit = isotonicFit(xt, yt);
        const pts = xt.map((v, k) => [v, fit[k]]).sort((p, q) => p[0] - q[0]);
        te.forEach((i) => {
          // step interpolation at x[i]
          let v = pts[0][1];
          for (const [px, py] of pts) if (px <= x[i]) v = py;
          avg[i] += v / repeats;
        });
      }
    }
  }
  return avg;
}

function tierModel(c: FeatureCache, w: { Low: number; Moderate: number; High: number }) {
  return Array.from(replayHeroProb(c, P0, { kind: 'tier', moderate: DEFAULT_DIFF_INPUTS.moderateAbsDiff, high: DEFAULT_DIFF_INPUTS.highAbsDiff, w, hsShift: HIGH_SKILL_UPSET_SHIFT }));
}
const scaled = (s: number, keepHigh: boolean) => ({
  Low: 0.5 + s * (WIN_WEIGHT_BY_TIER.Low - 0.5),
  Moderate: 0.5 + s * (WIN_WEIGHT_BY_TIER.Moderate - 0.5),
  High: keepHigh ? 1 : Math.min(1, 0.5 + s * (WIN_WEIGHT_BY_TIER.High - 0.5)),
});
function bisect(f: (s: number) => number, target: number, lo: number, hi: number): number {
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (f(m) < target) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

const result: Record<string, unknown> = {};
for (const label of ['full', 'naked-open']) {
  const c = loadCache(cacheDir(1, 100000, label));
  const Y = c.meta.heroIds.map((id) => wr.get(id)!);
  const fav = favoredRates(replayCounts(c, P0));
  const fmt = (x: number[]) => {
    const r = ruler(x, Y);
    return { r: r.r, spearman: r.spearman, sdRatio: r.sdRatio, slope: r.slopeRealOnSys, maePp: r.maePp, coverage7Pct: r.coverage7Pct, flagged10: r.flagged10, maeAffPp: r.maeAffPp };
  };
  const aff = oofMap(fav, Y, 'affine');
  const iso = oofMap(fav, Y, 'iso');
  const ciAff = bootstrapRuler(aff, Y, 2000);
  // pool-level tier stats under production
  let even = 0;
  const tierN = { Low: 0, Moderate: 0, High: 0 };
  let favWinP = 0;
  for (let m = 0; m < c.n; m++) {
    const d = replayDiff(c, m, P0);
    const ad = Math.abs(d);
    if (ad <= P0.threshold) {
      even++;
      continue;
    }
    const t = ad > DEFAULT_DIFF_INPUTS.highAbsDiff ? 'High' : ad > DEFAULT_DIFF_INPUTS.moderateAbsDiff ? 'Moderate' : 'Low';
    tierN[t]++;
    let p = WIN_WEIGHT_BY_TIER[t];
    if (c.flags && !c.flags[m * 3 + 2]) {
      if (c.flags[m * 3]) p = Math.max(0.5, p - HIGH_SKILL_UPSET_SHIFT);
      if (c.flags[m * 3 + 1]) p = Math.max(0.5, p - HIGH_SKILL_UPSET_SHIFT);
    }
    favWinP += p;
  }
  const nonEven = c.n - even;
  const prodTier = tierModel(c, WIN_WEIGHT_BY_TIER);
  const sdReal = sd(Y);
  const sMatchKeep = bisect((s) => sd(tierModel(c, scaled(s, true))), sdReal, 0, 4.16); // Moderate stays ≤ 1
  const sCalibKeep = bisect((s) => -ols(tierModel(c, scaled(s, true)), Y).b, -1, 0.05, 5);
  const sCalibAll = bisect((s) => -ols(tierModel(c, scaled(s, false)), Y).b, -1, 0.05, 5);
  const favRate = (w: { Low: number; Moderate: number; High: number }) => {
    let s = 0;
    for (let m = 0; m < c.n; m++) {
      const ad = Math.abs(replayDiff(c, m, P0));
      if (ad <= P0.threshold) continue;
      let p = ad > DEFAULT_DIFF_INPUTS.highAbsDiff ? w.High : ad > DEFAULT_DIFF_INPUTS.moderateAbsDiff ? w.Moderate : w.Low;
      if (c.flags && !c.flags[m * 3 + 2]) {
        if (c.flags[m * 3]) p = Math.max(0.5, p - HIGH_SKILL_UPSET_SHIFT);
        if (c.flags[m * 3 + 1]) p = Math.max(0.5, p - HIGH_SKILL_UPSET_SHIFT);
      }
      s += p;
    }
    return s / nonEven;
  };
  const variant = (s: number, keep: boolean) => {
    const w = scaled(s, keep);
    return { s, weights: w, favoriteWinRateInPool: favRate(w), hero: fmt(tierModel(c, w)) };
  };
  result[label] = {
    kpiScaleLayer: {
      raw: fmt(fav),
      oofAffine: fmt(aff),
      oofAffineCI: { maePp: ciAff.maePp, coverage7Pct: ciAff.coverage7Pct, r: ciAff.r },
      oofIsotonic: fmt(iso),
    },
    pool: {
      evenPct: (even / c.n) * 100,
      tierPctOfNonEven: { Low: (tierN.Low / nonEven) * 100, Moderate: (tierN.Moderate / nonEven) * 100, High: (tierN.High / nonEven) * 100 },
      favoriteWinRate: favWinP / nonEven,
    },
    gameTierRoll: {
      production: { weights: WIN_WEIGHT_BY_TIER, hero: fmt(prodTier) },
      matchRealSpread_keepHigh1: variant(sMatchKeep, true),
      calibratedSlope1_keepHigh1: variant(sCalibKeep, true),
      calibratedSlope1_scaleHighToo: variant(sCalibAll, false),
    },
  };
}
fs.writeFileSync(path.join(OUT, 'scale.json'), JSON.stringify(result, null, 2));
appendRun({ kind: 'kt2-scale', label: 'scale-layer', config: { maps: ['oof-affine', 'oof-isotonic', 'tier-scaling'] }, seed: 1, nMatches: 100000, metrics: result, wallMs: 0 });
console.log(JSON.stringify(result, (k, v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v), 0));
