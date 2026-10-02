// Pre-registered STRATZ-pairs acceptance test on window B (Blueprint/16
// "Pre-registration: STRATZ pair stats"; rule = the PUB rule with PUB → STZ).
// Needs caches on B (seed0, n=100078):
//   full                      (production hero-meta → OFF / PRO rows)
//   full-stz      LAB_HERO_META=artifacts/lab/stratz/hero-meta.stratz-both.json
//   full-stzdiv   LAB_HERO_META=artifacts/lab/stratz/hero-meta.stratz-divine.json (diagnostic)
// OFF = production cache with synergyCoeff = matchupCoeff = 0 (same OFF as the pair test).
//   cd server && npx ts-node scripts/lab/kt5-stratz.ts
import * as fs from 'fs';
import * as path from 'path';
import { LAB_DIR, appendRun, ensureLabDir, mulberry32 } from './lab-common';
import { cacheDir, loadCache, productionParams, replayDiff, type FeatureCache, type ReplayParams } from './feature-cache';

const OUT = ensureLabDir('kt5');
const outcome = JSON.parse(fs.readFileSync(path.join(LAB_DIR, 'opendota-wide', 'wide-outcome.json'), 'utf-8')) as { radiantWin: boolean; avgRankTier: number; day: string }[];
const M = outcome.length;
const y = outcome.map((o) => (o.radiantWin ? 1 : 0));
const P0 = productionParams(0);
const pro = loadCache(cacheDir(0, M, 'full'));
const STZ_LABEL = process.env.LAB_STZ_CACHE ?? 'full-stz';
const OUT_NAME = process.env.LAB_KT5_OUT ?? 'kt5-stratz.json';
const stz = loadCache(cacheDir(0, M, STZ_LABEL));
const div = STZ_LABEL !== 'full-stz' ? null : fs.existsSync(cacheDir(0, M, 'full-stzdiv')) ? loadCache(cacheDir(0, M, 'full-stzdiv')) : null;
const score = (c: FeatureCache, p: ReplayParams) => Float64Array.from({ length: M }, (_, m) => replayDiff(c, m, p));
const S: Record<string, Float64Array> = {
  OFF: score(pro, { ...P0, synergyCoeff: 0, matchupCoeff: 0 }),
  PRO: score(pro, P0),
  STZ: score(stz, P0),
  'STZ-SYN': score(stz, { ...P0, matchupCoeff: 0 }),
  'STZ-MAT': score(stz, { ...P0, synergyCoeff: 0 }),
};
if (div) S['DIV (diagnostic)'] = score(div, P0);
// plain hero-WR-mean baseline (STRATZ stats time=0, same week): team mean WR difference
{
  const heroesJ = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'heroes.json'), 'utf-8')) as { id: number }[];
  const g = new Map<number, number>();
  const w = new Map<number, number>();
  for (const b of ['LEGEND_ANCIENT', 'DIVINE_IMMORTAL'])
    for (const r of JSON.parse(fs.readFileSync(path.join(LAB_DIR, 'stratz', 'stats', 'w1789344000', 'stats', `${b}-all-allpos.json`), 'utf-8')).data as { time: number; heroId: number; matchCount: number; winCount: number }[])
      if (r.time === 0) { g.set(r.heroId, (g.get(r.heroId) ?? 0) + r.matchCount); w.set(r.heroId, (w.get(r.heroId) ?? 0) + r.winCount); }
  const WR = heroesJ.map((h) => w.get(h.id)! / g.get(h.id)!);
  const poolB = JSON.parse(fs.readFileSync(path.join(LAB_DIR, 'opendota-wide', 'wide-pool.json'), 'utf-8')) as { heroIdx: number[] }[];
  S.HEROWR = Float64Array.from(poolB, (m) => m.heroIdx.slice(0, 5).reduce((s2, h) => s2 + WR[h], 0) - m.heroIdx.slice(5).reduce((s2, h) => s2 + WR[h], 0));
}

function auc(s: Float64Array, I: ArrayLike<number>): number {
  const ord = Array.from(I).sort((a, b) => s[a] - s[b]);
  const n = ord.length;
  let rankSum = 0;
  let nPos = 0;
  for (let i = 0; i < n; ) {
    let j = i;
    while (j + 1 < n && s[ord[j + 1]] === s[ord[i]]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) if (y[ord[k]]) {
      rankSum += r;
      nPos++;
    }
    i = j + 1;
  }
  return (rankSum - (nPos * (nPos + 1)) / 2) / (nPos * (n - nPos));
}
function logit2(s: Float64Array, I: number[]): [number, number] {
  let sm = 0;
  for (const i of I) sm += s[i] * s[i];
  const sc = Math.sqrt(sm / I.length) || 1;
  let a = 0;
  let b = 0;
  for (let it = 0; it < 50; it++) {
    let g0 = 0, g1 = 0, h00 = 0, h01 = 0, h11 = 0;
    for (const i of I) {
      const x = s[i] / sc;
      const p = 1 / (1 + Math.exp(-(a + b * x)));
      const w = p * (1 - p);
      g0 += y[i] - p;
      g1 += (y[i] - p) * x;
      h00 += w;
      h01 += w * x;
      h11 += w * x * x;
    }
    const det = h00 * h11 - h01 * h01;
    const da = (h11 * g0 - h01 * g1) / det;
    const db = (h00 * g1 - h01 * g0) / det;
    a += da;
    b += db;
    if (Math.abs(da) + Math.abs(db) < 1e-10) break;
  }
  return [a, b / sc];
}
const days = [...new Set(outcome.map((o) => o.day))].sort();
const all = outcome.map((_, i) => i);
const P: Record<string, Float64Array> = {};
for (const [k, s] of Object.entries(S)) {
  const p = new Float64Array(M);
  for (const d of days) {
    const [a, b] = logit2(s, all.filter((i) => outcome[i].day !== d));
    for (const i of all) if (outcome[i].day === d) p[i] = 1 / (1 + Math.exp(-(a + b * s[i])));
  }
  P[k] = p;
}
const ll = (p: Float64Array, I: ArrayLike<number>) => {
  let s = 0;
  for (let j = 0; j < I.length; j++) s -= y[I[j]] ? Math.log(p[I[j]]) : Math.log(1 - p[I[j]]);
  return s / I.length;
};
const B = 2000;
const rng = mulberry32(5050);
const comps: [string, string][] = [['STZ', 'PRO'], ['STZ', 'OFF'], ['STZ', 'HEROWR'], ['PRO', 'OFF'], ['STZ-SYN', 'OFF'], ['STZ-MAT', 'OFF'], ...(div ? ([['DIV (diagnostic)', 'PRO']] as [string, string][]) : [])];
const bs = comps.map(() => ({ dAuc: [] as number[], dLl: [] as number[] }));
const I = new Int32Array(M);
for (let b = 0; b < B; b++) {
  for (let i = 0; i < M; i++) I[i] = Math.floor(rng() * M);
  const cacheA: Record<string, number> = {};
  const cacheL: Record<string, number> = {};
  const A = (k: string) => (cacheA[k] ??= auc(S[k], I));
  const L = (k: string) => (cacheL[k] ??= ll(P[k], I));
  comps.forEach(([x, z], i) => {
    bs[i].dAuc.push(A(x) - A(z));
    bs[i].dLl.push(L(x) - L(z));
  });
  if ((b + 1) % 250 === 0) console.log(`bootstrap ${b + 1}/${B}`);
}
const ci = (a: number[]) => {
  const s = [...a].sort((p, q) => p - q);
  return [s[Math.floor(0.025 * (B - 1))], s[Math.floor(0.975 * (B - 1))]];
};
const rows = Object.fromEntries(Object.keys(S).map((k) => [k, { auc: auc(S[k], all), logLoss: ll(P[k], all) }]));
const deltas = Object.fromEntries(comps.map(([x, z], i) => [`${x} − ${z}`, { dAuc: auc(S[x], all) - auc(S[z], all), dAucCI: ci(bs[i].dAuc), dLogLoss: ll(P[x], all) - ll(P[z], all), dLogLossCI: ci(bs[i].dLl) }]));
const split = (pred: (i: number) => boolean) => {
  const J = all.filter(pred);
  return { n: J.length, PRO: auc(S.PRO, J), STZ: auc(S.STZ, J), OFF: auc(S.OFF, J), stzMinusPro: auc(S.STZ, J) - auc(S.PRO, J), stzMinusOff: auc(S.STZ, J) - auc(S.OFF, J) };
};
const brackets = { Ancient: split((i) => outcome[i].avgRankTier < 70), Divine: split((i) => outcome[i].avgRankTier >= 70) };
const perDay = Object.fromEntries(days.map((d) => [d, split((i) => outcome[i].day === d)]));
const sp = deltas['STZ − PRO'];
const so = deltas['STZ − OFF'];
const daysPos = Object.values(perDay).filter((v) => v.n >= 1000 && v.stzMinusPro > 0).length;
const ready = sp.dAucCI[0] > 0 && sp.dLogLossCI[1] < 0 && so.dAucCI[0] >= -0.002 && brackets.Ancient.stzMinusPro > 0 && brackets.Divine.stzMinusPro > 0 && daysPos >= 5;
const betterThanProWorseThanOff = sp.dAucCI[0] > 0 && sp.dLogLossCI[1] < 0 && so.dAucCI[0] < -0.002;
const verdict = ready ? 'READY for hero-meta proposal' : betterThanProWorseThanOff ? 'BETTER THAN PRO, WORSE THAN OFF' : sp.dAucCI[0] <= 0 ? 'NO IMPROVEMENT over pro' : 'INCONCLUSIVE (partial criteria)';
const out = { generatedAt: new Date().toISOString(), nMatches: M, rows, deltas, brackets, perDay, daysPos, verdict };
fs.writeFileSync(path.join(OUT, OUT_NAME), JSON.stringify(out, null, 2));
appendRun({ kind: 'kt5-stratz', label: `STRATZ pairs on window B (${STZ_LABEL})`, config: { rows: Object.keys(S), boot: B }, seed: 0, nMatches: M, metrics: out, wallMs: 0 });
console.log(JSON.stringify({ verdict, rows, deltas, brackets, daysPos }, (k, v) => (typeof v === 'number' ? +v.toFixed(5) : v), 1));
