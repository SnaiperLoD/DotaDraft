// Н4.1 — null distribution of the KPI under random axis weights (Dirichlet α=1),
// replayed exactly on the feature cache. Where do production weights and
// "all weights = 1" sit? Only weight proportions matter (each phase divides by
// its own weight sum), so Dirichlet covers the whole space.
//   cd server && npx ts-node scripts/lab/kt2-dirichlet.ts           (driver: all configs, parallel)
// Modes: free14 — independent Dirichlet over 14 axes per phase (42 params);
//        free11 — same, map_control/camp_stacking/resource_efficiency held at 0 (as prod);
//        shared14 — one Dirichlet over 14 axes reused for all three phases.
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { DATA_DIR, REPO_ROOT, appendRun, ensureLabDir, mulberry32 } from './lab-common';
import { NA, NP, cacheDir, favoredRates, loadCache, productionParams, replayCounts } from './feature-cache';
import { ruler } from './lab-metrics';
import { AXES } from '../../src/assessment-core/axes';

const OUT = ensureLabDir('kt2', 'dirichlet');
const N_PER_WORKER = Number(process.env.LAB_DIR_N ?? 5000);
const job = process.env.LAB_DIR_JOB; // `${cache}:${mode}:${seed}`

const CONFIGS = ['naked-open', 'full'].flatMap((c) => ['free14', 'free11', 'shared14'].map((m) => `${c}:${m}`));
const WORKERS_PER_CONFIG = Number(process.env.LAB_DIR_WPC ?? 4);

async function driver(): Promise<void> {
  const jobs = CONFIGS.flatMap((cfg) => Array.from({ length: WORKERS_PER_CONFIG }, (_, i) => `${cfg}:${1000 + i}`));
  const par = Number(process.env.LAB_PAR ?? 12);
  let next = 0;
  const t0 = Date.now();
  const run = (j: string) =>
    new Promise<void>((resolve, reject) => {
      const ch = spawn(process.execPath, ['-r', 'ts-node/register', __filename], {
        cwd: path.join(REPO_ROOT, 'server'),
        stdio: 'inherit',
        env: { ...process.env, LAB_DIR_JOB: j },
      });
      ch.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${j} failed ${code}`))));
    });
  await Promise.all(Array.from({ length: Math.min(par, jobs.length) }, async () => {
    while (next < jobs.length) await run(jobs[next++]);
  }));
  console.log(`dirichlet null done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

function worker(j: string): void {
  const [cacheLabel, mode, seedStr] = j.split(':');
  const seed = Number(seedStr);
  const c = loadCache(cacheDir(1, 100000, cacheLabel));
  const meta = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'hero-meta.json'), 'utf-8')).heroes as { heroId: number; winRate: number }[];
  const wr = new Map(meta.map((e) => [e.heroId, e.winRate]));
  const Y = c.meta.heroIds.map((id) => wr.get(id)!);
  const rng = mulberry32(seed);
  const zero = new Set(['map_control', 'camp_stacking', 'resource_efficiency'].map((a) => AXES.indexOf(a as (typeof AXES)[number])));
  const base = productionParams(0);
  const dirichlet = (k: number[]): number[] => {
    const g = k.map(() => -Math.log(1 - rng()));
    const s = g.reduce((a, b) => a + b, 0);
    return g.map((v) => v / s);
  };
  const K = 7; // r, spearman, maeAff, sdRatio, maePp, cov7, flagged10
  const metrics = new Float32Array(N_PER_WORKER * K);
  const weights = new Float32Array(N_PER_WORKER * NP * NA);
  const t0 = Date.now();
  for (let i = 0; i < N_PER_WORKER; i++) {
    const w = new Float64Array(NP * NA);
    const free = AXES.map((_, a) => a).filter((a) => mode !== 'free11' || !zero.has(a));
    if (mode === 'shared14') {
      const d = dirichlet(free);
      for (let p = 0; p < NP; p++) free.forEach((a, k) => (w[p * NA + a] = d[k]));
    } else {
      for (let p = 0; p < NP; p++) {
        const d = dirichlet(free);
        free.forEach((a, k) => (w[p * NA + a] = d[k]));
      }
    }
    const x = favoredRates(replayCounts(c, { ...base, w }));
    const r = ruler(x, Y, { iso: false });
    metrics.set([r.r, r.spearman, r.maeAffPp, r.sdRatio, r.maePp, r.coverage7Pct, r.flagged10], i * K);
    weights.set(w, i * NP * NA);
  }
  const tag = `${cacheLabel}-${mode}-${seed}`;
  fs.writeFileSync(path.join(OUT, `${tag}.metrics.f32`), Buffer.from(metrics.buffer));
  fs.writeFileSync(path.join(OUT, `${tag}.weights.f32`), Buffer.from(weights.buffer));
  const wallMs = Date.now() - t0;
  appendRun({
    kind: 'kt2-dirichlet-chunk',
    label: tag,
    config: { cache: cacheLabel, mode, rngSeed: seed, n: N_PER_WORKER, alpha: 1, pd: Array.from(base.pd), rwr: 0 },
    seed: 1,
    nMatches: 100000,
    metrics: { n: N_PER_WORKER },
    wallMs,
  });
  console.log(`[${tag}] ${N_PER_WORKER} sets in ${(wallMs / 1000).toFixed(0)}s`);
}

if (job) worker(job);
else void driver();
