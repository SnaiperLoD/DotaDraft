// Н4.3 (gated by Н3.1: axes-only OOF r 0.27–0.32 ≥ 0.3 threshold) — can the
// BATTLE FORMULA itself realise the axis signal if its weights are optimised?
// Class A: same inputs, only axis weights change. Out of fold by hero:
// weights are fitted on train heroes' r(favoredRate, realWR), test heroes'
// favoredRate under those weights is collected OOF, r is taken on all 127.
// Search: separable ES on log-weights, 11 free axes (prod zeros kept), ONE weight
// set shared by all phases (pd 0.15/0.35/0.5 kept), start = all ones (not prod:
// prod was tuned on all heroes, starting there would leak).
// Fast path: with shared weights the phase blend is linear, so
// power = Σ_a w_a·U_a / Σ_a w_a with U = Σ_p pd_p·T_p (exact in real arithmetic).
// Optimisation uses the first LAB_OPT_SUB matches (default 30k); final OOF
// favoredRates are re-evaluated on the full 100k with the exact replay.
//   cd server && npx ts-node scripts/lab/kt2-optimize.ts
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { DATA_DIR, REPO_ROOT, appendRun, ensureLabDir, mulberry32 } from './lab-common';
import { NA, NP, cacheDir, favoredRates, loadCache, productionParams, replayCounts, type FeatureCache } from './feature-cache';
import { pearson, pairedDelta, bootstrapRuler } from './lab-metrics';
import { AXES } from '../../src/assessment-core/axes';

const OUT = ensureLabDir('kt2', 'optimize');
const SUB = Number(process.env.LAB_OPT_SUB ?? 30000);
const GENS = Number(process.env.LAB_OPT_GENS ?? 80);
const PERMS = Number(process.env.LAB_PERMS ?? 200);
const CONFIGS = (process.env.LAB_OPT_CONFIGS ?? 'naked-open,full').split(',');
const ZERO = new Set(['map_control', 'camp_stacking', 'resource_efficiency']);
const FREE = AXES.map((a, i) => (ZERO.has(a) ? -1 : i)).filter((i) => i >= 0);

const meta = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'hero-meta.json'), 'utf-8')).heroes as { heroId: number; winRate: number }[];
const wrById = new Map(meta.map((e) => [e.heroId, e.winRate]));

interface Fast {
  c: FeatureCache;
  U: Float64Array; // SUB*2*NA
  mult: Float64Array; // SUB*2 multiplier product (syn, matchup, rwr=0)
  H: number;
}
function prepFast(c: FeatureCache): Fast {
  const P0 = productionParams(0);
  const n = Math.min(SUB, c.n);
  const U = new Float64Array(n * 2 * NA);
  const mult = new Float64Array(n * 2);
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  for (let m = 0; m < n; m++) {
    for (let s = 0; s < 2; s++)
      for (let a = 0; a < NA; a++) {
        let u = 0;
        for (let p = 0; p < NP; p++) u += P0.pd[p] * c.T[((m * 2 + s) * NP + p) * NA + a];
        U[(m * 2 + s) * NA + a] = u;
      }
    const sd = m * 5;
    mult[m * 2] = clamp(1 + c.side[sd] * P0.synergyCoeff, 0.3, 1.7) * clamp(1 + c.side[sd + 2] * P0.matchupCoeff, 0.3, 1.7);
    mult[m * 2 + 1] = clamp(1 + c.side[sd + 1] * P0.synergyCoeff, 0.3, 1.7) * clamp(1 - c.side[sd + 2] * P0.matchupCoeff, 0.3, 1.7);
  }
  return { c, U, mult, H: c.meta.nHeroes };
}
function fastFav(f: Fast, w: number[]): number[] {
  const n = f.mult.length / 2;
  const fav = new Float64Array(f.H);
  const app = new Float64Array(f.H);
  const even = new Float64Array(f.H);
  let tot = 0;
  for (const a of FREE) tot += w[a];
  for (let m = 0; m < n; m++) {
    let pa = 0;
    let pb = 0;
    const ba = m * 2 * NA;
    const bb = ba + NA;
    for (const a of FREE) {
      pa += f.U[ba + a] * w[a];
      pb += f.U[bb + a] * w[a];
    }
    const d = (pa / tot) * f.mult[m * 2] - (pb / tot) * f.mult[m * 2 + 1];
    const dir = d > 0.15 ? 0 : d < -0.15 ? 1 : -1;
    for (let k = 0; k < 10; k++) {
      const h = f.c.heroIdx[m * 10 + k];
      app[h]++;
      if (dir === -1) even[h]++;
      else if ((k < 5 ? 0 : 1) === dir) fav[h]++;
    }
  }
  return Array.from(fav, (v, h) => (app[h] - even[h] ? v / (app[h] - even[h]) : 0.5));
}
const rOn = (x: number[], y: number[], idx: number[]) => pearson(idx.map((i) => x[i]), idx.map((i) => y[i]));

/** Separable (μ/μ,λ)-ES on θ = log w, maximising r on train heroes. */
function es(f: Fast, y: number[], train: number[], seed: number, gens: number): number[] {
  const rng = mulberry32(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
  const D = FREE.length;
  let mean = new Array(D).fill(0);
  let sigma = new Array(D).fill(0.8);
  const lambda = 16;
  const mu = 8;
  const toW = (th: number[]) => {
    const w = new Array(NA).fill(0);
    FREE.forEach((a, k) => (w[a] = Math.exp(Math.max(-6, Math.min(6, th[k])))));
    return w;
  };
  let best = { score: -Infinity, th: mean };
  for (let g = 0; g < gens; g++) {
    const pop = Array.from({ length: lambda }, () => {
      const z = sigma.map(() => gauss());
      const th = mean.map((m, k) => m + sigma[k] * z[k]);
      return { th, z, score: rOn(fastFav(f, toW(th)), y, train) };
    }).sort((a, b) => b.score - a.score);
    if (pop[0].score > best.score) best = { score: pop[0].score, th: pop[0].th };
    const elite = pop.slice(0, mu);
    mean = mean.map((_, k) => elite.reduce((s, e) => s + e.th[k], 0) / mu);
    // per-coordinate step adaptation from elite spread, with floor/ceiling
    sigma = sigma.map((s, k) => {
      const v = elite.reduce((acc, e) => acc + (e.z[k] * s) ** 2, 0) / mu;
      return Math.min(1.5, Math.max(0.05, 0.7 * s + 0.3 * Math.sqrt(v) * 1.2));
    });
  }
  return toW(best.th);
}

function folds(n: number, rng: () => number): number[][] {
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return Array.from({ length: 5 }, (_, k) => idx.filter((_, i) => i % 5 === k));
}

/** OOF procedure; returns mean OOF r over repeats (fast path) and per-fold weights. */
function procedure(f: Fast, y: number[], repeats: number, seed: number, gens: number) {
  const rng = mulberry32(seed);
  const rs: number[] = [];
  const fits: { test: number[]; w: number[] }[] = [];
  for (let rep = 0; rep < repeats; rep++) {
    const oofX = new Array(y.length).fill(0);
    for (const te of folds(y.length, rng)) {
      const tes = new Set(te);
      const tr = y.map((_, i) => i).filter((i) => !tes.has(i));
      const w = es(f, y, tr, Math.floor(rng() * 1e9), gens);
      const x = fastFav(f, w);
      te.forEach((i) => (oofX[i] = x[i]));
      fits.push({ test: te, w });
    }
    rs.push(pearson(oofX, y));
  }
  return { r: rs.reduce((a, b) => a + b, 0) / repeats, rs, fits };
}

const job = process.env.LAB_OPT_JOB; // "config:permStart:permEnd"
if (job) {
  const [cfg, a, b] = job.split(':');
  const c = loadCache(cacheDir(1, 100000, cfg));
  const f = prepFast(c);
  const Y = c.meta.heroIds.map((id) => wrById.get(id)!);
  const res: number[] = [];
  for (let k = Number(a); k < Number(b); k++) {
    const rng = mulberry32(70000 + k);
    const yp = [...Y];
    for (let i = yp.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [yp[i], yp[j]] = [yp[j], yp[i]];
    }
    res.push(procedure(f, yp, 1, 800 + k, Math.round(GENS / 2)).r);
  }
  fs.writeFileSync(path.join(OUT, `null-${cfg}-${a}-${b}.json`), JSON.stringify(res));
} else {
  void main();
}

async function main() {
  const t0 = Date.now();
  const par = Number(process.env.LAB_PAR ?? 12);
  const out: Record<string, unknown> = {};
  for (const cfg of CONFIGS) {
    const chunk = Math.ceil(PERMS / par);
    const jobs: string[] = [];
    for (let a = 0; a < PERMS; a += chunk) jobs.push(`${cfg}:${a}:${Math.min(PERMS, a + chunk)}`);
    const nullDone = Promise.all(
      jobs.map(
        (j) =>
          new Promise<void>((resolve, reject) => {
            const ch = spawn(process.execPath, ['-r', 'ts-node/register', __filename], { cwd: path.join(REPO_ROOT, 'server'), stdio: 'inherit', env: { ...process.env, LAB_OPT_JOB: j } });
            ch.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${j} failed ${code}`))));
          }),
      ),
    );
    const c = loadCache(cacheDir(1, 100000, cfg));
    const f = prepFast(c);
    const Y = c.meta.heroIds.map((id) => wrById.get(id)!);
    const all = Y.map((_, i) => i);
    // in-sample optimum (upper bound, NOT evidence)
    const wIn = es(f, Y, all, 4242, GENS);
    const P0 = productionParams(0);
    const exact = (w: number[]) => {
      const W = new Float64Array(NP * NA);
      for (let p = 0; p < NP; p++) for (let a = 0; a < NA; a++) W[p * NA + a] = w[a];
      return favoredRates(replayCounts(c, { ...P0, w: W }));
    };
    const inSampleR = pearson(exact(wIn), Y);
    // main OOF: 4 repeats × 5 folds, full GENS; null-comparable: 1 repeat, GENS/2
    const main4 = procedure(f, Y, 4, 1, GENS);
    const main1 = procedure(f, Y, 1, 2, Math.round(GENS / 2));
    // exact 100k OOF favoredRates for the 4×5 fits (repeat-averaged per hero)
    const oofExact = new Array(Y.length).fill(0);
    const cnt = new Array(Y.length).fill(0);
    for (const fit of main4.fits) {
      const x = exact(fit.w);
      fit.test.forEach((i) => {
        oofExact[i] += x[i];
        cnt[i]++;
      });
    }
    const oofX = oofExact.map((v, i) => v / cnt[i]);
    await nullDone;
    const nul: number[] = [];
    for (const j of jobs) nul.push(...(JSON.parse(fs.readFileSync(path.join(OUT, `null-${j.replace(/:/g, '-')}.json`), 'utf-8')) as number[]));
    const sorted = [...nul].sort((a, b) => a - b);
    const per = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'artifacts', 'lab', 'kt1', 'per-hero.json'), 'utf-8')) as Record<string, number>[];
    const perById = new Map(per.map((p) => [p.heroId, p]));
    const baseX = c.meta.heroIds.map((id) => perById.get(id)![cfg === 'full' ? 'B-full' : 'B-naked']);
    const meanW = AXES.map((_, a) => main4.fits.reduce((s, fit) => s + fit.w[a] / FREE.reduce((t, b) => t + fit.w[b], 0), 0) / main4.fits.length);
    out[cfg] = {
      inSampleR,
      inSampleWeightsShare: Object.fromEntries(AXES.map((a, i) => [a, wIn[i] / FREE.reduce((t, b) => t + wIn[b], 0)])),
      oofR4x5_fast30k: main4.r,
      oofR4x5_repeats: main4.rs,
      oofR_exact100k_avg: bootstrapRuler(oofX, Y, 2000).r,
      oofR1x5_nullComparable: main1.r,
      null: { n: nul.length, mean: nul.reduce((a, b) => a + b, 0) / nul.length, p95: sorted[Math.floor(0.95 * (sorted.length - 1))], p99: sorted[Math.floor(0.99 * (sorted.length - 1))] },
      pPerm: (nul.filter((v) => v >= main1.r).length + 1) / (nul.length + 1),
      pairedVsBase: pairedDelta(baseX, oofX, Y, ['r', 'spearman', 'maeAffPp']),
      meanOofWeightShare: Object.fromEntries(AXES.map((a, i) => [a, meanW[i]])),
    };
    appendRun({ kind: 'kt2-optimize', label: `es-shared11-${cfg}`, config: { cfg, sub: SUB, gens: GENS, perms: PERMS, start: 'ones', free: FREE.map((i) => AXES[i]) }, seed: 1, nMatches: SUB, metrics: out[cfg], wallMs: Date.now() - t0 });
  }
  fs.writeFileSync(path.join(OUT, 'optimize.json'), JSON.stringify(out, null, 2));
  console.log(`optimize done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
