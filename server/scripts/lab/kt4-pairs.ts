// Pre-registered pair-channel test — analysis (written before the wide pages were
// read; rule frozen in Blueprint/16 "Pre-registration: pair channels").
// Rows on ONE cache (all tags, prod weights, rwr 0): OFF (syn=mat=0), ON (prod),
// SYN only, MAT only, SHIPPED (pairs on, rwr 2). Primary ΔAUC = AUC(ON) − AUC(OFF),
// paired bootstrap by match (2000). Δlog-loss/ΔBrier with leave-one-day-out
// logistic calibration. Splits: Ancient (<70) / Divine (≥70), per UTC day.
//   cd server && npx ts-node scripts/lab/kt4-pairs.ts
import * as fs from 'fs';
import * as path from 'path';
import { LAB_DIR, appendRun, ensureLabDir, mulberry32 } from './lab-common';
import { cacheDir, loadCache, productionParams, replayDiff, type ReplayParams } from './feature-cache';

const OUT = ensureLabDir('kt4');
const outcome = JSON.parse(fs.readFileSync(path.join(LAB_DIR, 'opendota-wide', 'wide-outcome.json'), 'utf-8')) as { radiantWin: boolean; avgRankTier: number; day: string }[];
const M = outcome.length;
const y = outcome.map((o) => (o.radiantWin ? 1 : 0));
const c = loadCache(cacheDir(0, M, 'full'));
const P0 = productionParams(0);
const rowsP: Record<string, ReplayParams> = {
  OFF: { ...P0, synergyCoeff: 0, matchupCoeff: 0 },
  ON: P0,
  SYN: { ...P0, matchupCoeff: 0 },
  MAT: { ...P0, synergyCoeff: 0 },
  SHIPPED: productionParams(2),
};
const S: Record<string, Float64Array> = {};
for (const [k, p] of Object.entries(rowsP)) S[k] = Float64Array.from({ length: M }, (_, m) => replayDiff(c, m, p));

function auc(s: Float64Array, I: Int32Array | number[]): number {
  const n = I.length;
  const ord = Array.from(I).sort((a, b) => s[a] - s[b]);
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
function lodoProb(s: Float64Array): Float64Array {
  const p = new Float64Array(M);
  for (const d of days) {
    const tr = all.filter((i) => outcome[i].day !== d);
    const te = all.filter((i) => outcome[i].day === d);
    const [a, b] = logit2(s, tr);
    for (const i of te) p[i] = 1 / (1 + Math.exp(-(a + b * s[i])));
  }
  return p;
}
const P: Record<string, Float64Array> = {};
for (const k of Object.keys(S)) P[k] = lodoProb(S[k]);
const ll = (p: Float64Array, I: ArrayLike<number>) => {
  let s = 0;
  for (let j = 0; j < I.length; j++) {
    const i = I[j];
    s -= y[i] ? Math.log(p[i]) : Math.log(1 - p[i]);
  }
  return s / I.length;
};
const brier = (p: Float64Array, I: ArrayLike<number>) => {
  let s = 0;
  for (let j = 0; j < I.length; j++) s += (p[I[j]] - y[I[j]]) ** 2;
  return s / I.length;
};

const B = 2000;
const rng = mulberry32(4040);
const bs: Record<string, { dAuc: number[]; dLl: number[]; dBr: number[] }> = Object.fromEntries(['ON', 'SYN', 'MAT', 'SHIPPED'].map((k) => [k, { dAuc: [], dLl: [], dBr: [] }]));
const I = new Int32Array(M);
for (let b = 0; b < B; b++) {
  for (let i = 0; i < M; i++) I[i] = Math.floor(rng() * M);
  const aOff = auc(S.OFF, I);
  const lOff = ll(P.OFF, I);
  const brOff = brier(P.OFF, I);
  for (const k of Object.keys(bs)) {
    bs[k].dAuc.push(auc(S[k], I) - aOff);
    bs[k].dLl.push(ll(P[k], I) - lOff);
    bs[k].dBr.push(brier(P[k], I) - brOff);
  }
  if ((b + 1) % 250 === 0) console.log(`bootstrap ${b + 1}/${B}`);
}
const ci = (a: number[]) => {
  const s = [...a].sort((x, z) => x - z);
  return [s[Math.floor(0.025 * (B - 1))], s[Math.floor(0.975 * (B - 1))]];
};
const rows = Object.fromEntries(
  Object.keys(S).map((k) => [
    k,
    {
      auc: auc(S[k], all),
      logLoss: ll(P[k], all),
      brier: brier(P[k], all),
      ...(k === 'OFF' ? {} : { dAuc: auc(S[k], all) - auc(S.OFF, all), dAucCI: ci(bs[k].dAuc), dLogLoss: ll(P[k], all) - ll(P.OFF, all), dLogLossCI: ci(bs[k].dLl), dBrier: brier(P[k], all) - brier(P.OFF, all), dBrierCI: ci(bs[k].dBr) }),
    },
  ]),
);
const split = (pred: (i: number) => boolean) => {
  const J = all.filter(pred);
  return { n: J.length, aucOff: auc(S.OFF, J), aucOn: auc(S.ON, J), dAuc: auc(S.ON, J) - auc(S.OFF, J), dLogLoss: ll(P.ON, J) - ll(P.OFF, J) };
};
const brackets = { Ancient: split((i) => outcome[i].avgRankTier < 70), Divine: split((i) => outcome[i].avgRankTier >= 70) };
const perDay = Object.fromEntries(days.map((d) => [d, split((i) => outcome[i].day === d)]));
// decision rule exactly as pre-registered
const prim = rows.ON as { dAuc: number; dAucCI: number[]; dLogLossCI: number[] };
// Declared deviation: the pull spans 8 UTC dates (2026-10-02 has only 475 matches); "5 of 7 days" is applied to the 7 dates with ≥1000 matches.
const daysNeg = Object.values(perDay).filter((v) => v.n >= 1000 && v.dAuc < 0).length;
const fullDays = Object.values(perDay).filter((v) => v.n >= 1000).length;
const hurts = prim.dAucCI[1] < 0 && prim.dLogLossCI[0] > 0 && brackets.Ancient.dAuc < 0 && brackets.Divine.dAuc < 0 && daysNeg >= 5;
const neutral = prim.dAucCI[0] >= -0.005 && prim.dAucCI[1] <= 0.005;
const helps = prim.dAucCI[0] > 0;
const verdict = hurts ? 'HURTS (confirmed)' : helps ? 'HELPS' : neutral ? 'NEUTRAL' : 'INCONCLUSIVE';
const out = { generatedAt: new Date().toISOString(), nMatches: M, days, boot: B, rows, brackets, perDay, daysNeg, fullDays, verdict };
fs.writeFileSync(path.join(OUT, 'kt4-pairs.json'), JSON.stringify(out, null, 2));
appendRun({ kind: 'kt4-pairs', label: 'pre-registered pair-channel test', config: { rows: Object.keys(S), boot: B, calib: 'leave-one-day-out logistic' }, seed: 0, nMatches: M, metrics: out, wallMs: 0 });
console.log(JSON.stringify({ verdict, rows, brackets, daysNeg }, (k, v) => (typeof v === 'number' ? +v.toFixed(5) : v), 1));
