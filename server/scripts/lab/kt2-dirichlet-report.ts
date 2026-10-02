// Summarises the Н4.1 Dirichlet null: quantiles, where production and "all = 1"
// sit, and which axes' weight share moves r (Spearman of share vs r across draws).
//   cd server && npx ts-node scripts/lab/kt2-dirichlet-report.ts
import * as fs from 'fs';
import * as path from 'path';
import { DATA_DIR, LAB_DIR, appendRun } from './lab-common';
import { NA, NP, cacheDir, favoredRates, loadCache, productionParams, replayCounts } from './feature-cache';
import { ruler, spearman } from './lab-metrics';
import { AXES } from '../../src/assessment-core/axes';

const DIR = path.join(LAB_DIR, 'kt2', 'dirichlet');
const K = 7;
const NAMES = ['r', 'spearman', 'maeAffPp', 'sdRatio', 'maePp', 'coverage7Pct', 'flagged10'];
const meta = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'hero-meta.json'), 'utf-8')).heroes as { heroId: number; winRate: number }[];
const wr = new Map(meta.map((e) => [e.heroId, e.winRate]));
const out: Record<string, unknown> = {};

for (const cacheLabel of ['naked-open', 'full']) {
  const c = loadCache(cacheDir(1, 100000, cacheLabel));
  const Y = c.meta.heroIds.map((id) => wr.get(id)!);
  const P0 = productionParams(0);
  const prod = ruler(favoredRates(replayCounts(c, P0)), Y, { iso: false });
  const ones = ruler(favoredRates(replayCounts(c, { ...P0, w: new Float64Array(NP * NA).fill(1) })), Y, { iso: false });
  for (const mode of ['free14', 'free11', 'shared14']) {
    const files = fs.readdirSync(DIR).filter((f) => f.startsWith(`${cacheLabel}-${mode}-`) && f.endsWith('.metrics.f32'));
    const m: number[][] = NAMES.map(() => []);
    const shares: number[][] = AXES.map(() => []);
    for (const f of files) {
      const buf = fs.readFileSync(path.join(DIR, f));
      const arr = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
      const wb = fs.readFileSync(path.join(DIR, f.replace('.metrics.', '.weights.')));
      const W = new Float32Array(wb.buffer, wb.byteOffset, wb.byteLength / 4);
      const n = arr.length / K;
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < K; k++) m[k].push(arr[i * K + k]);
        // blended share of each axis = Σ_p pd[p] · w[p,a]/Σ_a w[p,a]
        for (let a = 0; a < NA; a++) {
          let s = 0;
          for (let p = 0; p < NP; p++) {
            let tot = 0;
            for (let b = 0; b < NA; b++) tot += W[(i * NP + p) * NA + b];
            s += P0.pd[p] * (tot ? W[(i * NP + p) * NA + a] / tot : 0);
          }
          shares[a].push(s);
        }
      }
    }
    const q = (arr: number[], p: number) => {
      const s = [...arr].sort((x, y) => x - y);
      return s[Math.floor(p * (s.length - 1))];
    };
    const pctile = (arr: number[], v: number) => arr.filter((x) => x < v).length / arr.length;
    const dist = Object.fromEntries(
      NAMES.map((nm, k) => [nm, { mean: m[k].reduce((a, b) => a + b, 0) / m[k].length, p05: q(m[k], 0.05), p50: q(m[k], 0.5), p95: q(m[k], 0.95), p99: q(m[k], 0.99), max: q(m[k], 1) }]),
    );
    const key = `${cacheLabel}:${mode}`;
    out[key] = {
      n: m[0].length,
      dist,
      production: { r: prod.r, spearman: prod.spearman, maeAffPp: prod.maeAffPp, pctileR: pctile(m[0], prod.r), pctileSpearman: pctile(m[1], prod.spearman), pctileMaeAffLowerIsBetter: 1 - pctile(m[2], prod.maeAffPp) },
      allOnes: { r: ones.r, spearman: ones.spearman, pctileR: pctile(m[0], ones.r) },
      axisShareVsR: Object.fromEntries(AXES.map((a, i) => [a, spearman(shares[i], m[0])])),
    };
    appendRun({ kind: 'kt2-dirichlet-summary', label: key, config: { cache: cacheLabel, mode, alpha: 1 }, seed: 1, nMatches: 100000, metrics: out[key], wallMs: 0 });
  }
}
fs.writeFileSync(path.join(LAB_DIR, 'kt2', 'dirichlet-summary.json'), JSON.stringify(out, null, 2));
for (const [k, v] of Object.entries(out) as [string, any][]) {
  const d = v.dist;
  console.log(
    `${k.padEnd(20)} n=${v.n} r p05/p50/p95/p99/max=${[d.r.p05, d.r.p50, d.r.p95, d.r.p99, d.r.max].map((x: number) => x.toFixed(3)).join('/')}  prod r=${v.production.r.toFixed(3)} pct=${(v.production.pctileR * 100).toFixed(1)}  rho pct=${(v.production.pctileSpearman * 100).toFixed(1)}  ones r=${v.allOnes.r.toFixed(3)} pct=${(v.allOnes.pctileR * 100).toFixed(1)}  maeAff p50=${d.maeAffPp.p50.toFixed(2)} sdRatio p50=${d.sdRatio.p50.toFixed(2)}`,
  );
  console.log('   axis share ~ r:', Object.entries(v.axisShareVsR).map(([a, x]) => `${a}:${(x as number).toFixed(2)}`).join(' '));
}
