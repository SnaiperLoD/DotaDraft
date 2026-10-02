// Accuracy gate for the feature cache:
//  (1) replay on production weights reproduces production assessBattle()
//      favored/even/appearances per hero (rwr 0 and 2) within 1e-9;
//  (2) the lab pool is runSimulation()'s pool: favoredRate per hero equals
//      the r0-worker heroTable (rwr 0) within 1e-9;
//  (3) replay wall time.
//   cd server && npx ts-node scripts/lab/verify-cache.ts
import * as fs from 'fs';
import * as path from 'path';
import { LAB_DIR, appendRun, kpi } from './lab-common';
import { cacheDir, favoredRates, loadCache, productionParams, replayCounts } from './feature-cache';

const SEED = Number(process.env.LAB_SEED ?? 1);
const N = Number(process.env.LAB_MATCHES ?? 100000);
const TOL = 1e-9;
let allPass = true;

for (const label of ['naked-open', 'full']) {
  const c = loadCache(cacheDir(SEED, N, label));
  const prod = JSON.parse(fs.readFileSync(path.join(c.dir, 'prod-counts.json'), 'utf-8')) as Record<
    string,
    { appearances: number[]; favored: number[]; even: number[] }
  >;
  const r0Path = path.join(LAB_DIR, 'r0', `seed${SEED}-n${N}`, `${label}-heroTable.json`);
  const r0 = fs.existsSync(r0Path)
    ? new Map(
        (JSON.parse(fs.readFileSync(r0Path, 'utf-8')) as { heroTable: { heroId: number; favoredRate: number; appearances: number }[] }).heroTable.map(
          (h) => [h.heroId, h],
        ),
      )
    : null;
  const winRate = new Map<number, number | null>(
    (JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'hero-meta.json'), 'utf-8')) as { heroes: { heroId: number; winRate: number | null }[] }).heroes.map(
      (e) => [e.heroId, e.winRate],
    ),
  );

  for (const rwr of [0, 2]) {
    const t0 = process.hrtime.bigint();
    const cnt = replayCounts(c, productionParams(rwr));
    const replayMs = Number(process.hrtime.bigint() - t0) / 1e6;
    const p = prod[`rwr${rwr}`];
    let maxCountDiff = 0;
    for (let h = 0; h < c.meta.nHeroes; h++) {
      maxCountDiff = Math.max(
        maxCountDiff,
        Math.abs(cnt.favored[h] - p.favored[h]),
        Math.abs(cnt.even[h] - p.even[h]),
        Math.abs(cnt.appearances[h] - p.appearances[h]),
      );
    }
    const fr = favoredRates(cnt);
    let maxVsRunSim: number | null = null;
    if (rwr === 0 && r0) {
      maxVsRunSim = 0;
      c.meta.heroIds.forEach((id, h) => {
        const row = r0.get(id)!;
        maxVsRunSim = Math.max(maxVsRunSim!, Math.abs(row.favoredRate - fr[h]), Math.abs(row.appearances - cnt.appearances[h]));
      });
    }
    const k = kpi(c.meta.heroIds.map((id, h) => ({ heroId: id, name: c.meta.heroNames[h], favoredRate: fr[h], realWinRate: winRate.get(id) ?? null })));
    const pass = maxCountDiff <= TOL && (maxVsRunSim === null || maxVsRunSim <= TOL);
    if (!pass) allPass = false;
    console.log(
      `[${label}] rwr=${rwr} maxCountDiff=${maxCountDiff} maxVsRunSimulation=${maxVsRunSim} replay=${replayMs.toFixed(0)}ms r=${k.r.toFixed(4)} MAE=${k.maePp.toFixed(2)} ±7=${k.coverage7Pct.toFixed(1)} ≥10=${k.flagged10} ${pass ? 'PASS' : 'FAIL'}`,
    );
    appendRun({
      kind: 'cache-verify',
      label: `${label}-rwr${rwr}`,
      config: { seed: SEED, nMatches: N, cache: label, params: 'production', rwr },
      seed: SEED,
      nMatches: N,
      metrics: { ...k, maxCountDiff, maxVsRunSimulation: maxVsRunSim, pass, buildChecks: (c.meta as unknown as { buildChecks: unknown }).buildChecks },
      wallMs: replayMs,
    });
  }
}
console.log(allPass ? 'CACHE GATE: PASS' : 'CACHE GATE: FAIL');
process.exitCode = allPass ? 0 : 1;
