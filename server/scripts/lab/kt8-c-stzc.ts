// Blind window C (Blueprint/16 "Pre-registration: blind window C"), step 3: the one-pass
// acceptance test of cleaned STRATZ pairs (week 1790208000) on window C.
// Needs artifacts/lab/opendota-c/c-{pool,outcome}.json and two caches on C (seed 0):
//   winC-full        production hero-meta  → OFF / PRO rows
//   winC-full-stzc   LAB_HERO_META=artifacts/stratz-refresh/1790208000/hero-meta.proposed.json
// Normally run through kt8-c-run.ts. Rule = the STZC rule on B, with the day criterion
// adapted to C's length (declared in the pre-registration).
//   cd server && npx ts-node scripts/lab/kt8-c-stzc.ts
import * as fs from 'fs';
import * as path from 'path';
import { LAB_DIR, REPO_ROOT, appendRun, ensureLabDir, loadHeroes, mulberry32 } from './lab-common';
import { cacheDir, loadCache, productionParams, replayDiff, type FeatureCache, type ReplayParams } from './feature-cache';

export const PROPOSED_META = path.join(REPO_ROOT, 'artifacts', 'stratz-refresh', '1790208000', 'hero-meta.proposed.json');
const OUT = ensureLabDir('kt8');
const C = path.join(LAB_DIR, 'opendota-c');
const outcome = JSON.parse(fs.readFileSync(path.join(C, 'c-outcome.json'), 'utf-8')) as { radiantWin: boolean; avgRankTier: number; day: string; block6h: string }[];
const poolC = JSON.parse(fs.readFileSync(path.join(C, 'c-pool.json'), 'utf-8')) as { heroIdx: number[] }[];
const M = outcome.length;
const y = outcome.map((o) => (o.radiantWin ? 1 : 0));
const P0 = productionParams(0);
const open = (label: string): FeatureCache => {
  const dir = cacheDir(0, M, label);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf-8')) as { buildChecks?: { taggedMismatch: number; diffMismatch: number } };
  if (meta.buildChecks && (meta.buildChecks.taggedMismatch !== 0 || meta.buildChecks.diffMismatch !== 0)) throw new Error(`cache ${label}: replay mismatch ${JSON.stringify(meta.buildChecks)}`);
  return loadCache(dir);
};
const pro = open('winC-full');
const stzc = open('winC-full-stzc');
const score = (c: FeatureCache, p: ReplayParams) => Float64Array.from({ length: M }, (_, m) => replayDiff(c, m, p));
const S: Record<string, Float64Array> = {
  OFF: score(pro, { ...P0, synergyCoeff: 0, matchupCoeff: 0 }),
  PRO: score(pro, P0),
  STZC: score(stzc, P0),
  'STZC-SYN': score(stzc, { ...P0, matchupCoeff: 0 }),
  'STZC-MAT': score(stzc, { ...P0, synergyCoeff: 0 }),
};
// lookup-swap sanity: the STZC cache must actually differ from production on the side channels
let sideDiff = 0;
for (let i = 0; i < M * 5; i++) if (pro.side[i] !== stzc.side[i]) sideDiff++;
if (sideDiff === 0) throw new Error('STZC cache side channels identical to production — LAB_HERO_META swap did not take effect');
// HEROWR: team mean of the REFRESHED winRate (proposed hero-meta), no pairs — descriptive, not a Battle row
{
  const { heroes } = loadHeroes();
  const wr = new Map((JSON.parse(fs.readFileSync(PROPOSED_META, 'utf-8')).heroes as { heroId: number; winRate: number | null }[]).map((h) => [h.heroId, h.winRate ?? 0.5]));
  const WR = heroes.map((h) => wr.get(h.id) ?? 0.5);
  S.HEROWR = Float64Array.from(poolC, (m) => m.heroIdx.slice(0, 5).reduce((s, h) => s + WR[h], 0) - m.heroIdx.slice(5).reduce((s, h) => s + WR[h], 0));
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
    for (let k = i; k <= j; k++)
      if (y[ord[k]]) {
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
// leave-one-day-out logistic calibration (as on B)
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
const brier = (p: Float64Array, I: ArrayLike<number>) => {
  let s = 0;
  for (let j = 0; j < I.length; j++) s += (p[I[j]] - y[I[j]]) ** 2;
  return s / I.length;
};
const B = 2000;
const rng = mulberry32(8080);
const comps: [string, string][] = [['STZC', 'PRO'], ['STZC', 'OFF'], ['PRO', 'OFF'], ['STZC', 'HEROWR'], ['STZC-SYN', 'OFF'], ['STZC-MAT', 'OFF']];
const bs = comps.map(() => ({ dAuc: [] as number[], dLl: [] as number[], dBr: [] as number[] }));
const I = new Int32Array(M);
for (let b = 0; b < B; b++) {
  for (let i = 0; i < M; i++) I[i] = Math.floor(rng() * M);
  const cA: Record<string, number> = {};
  const cL: Record<string, number> = {};
  const cB: Record<string, number> = {};
  const A = (k: string) => (cA[k] ??= auc(S[k], I));
  const L = (k: string) => (cL[k] ??= ll(P[k], I));
  const Br = (k: string) => (cB[k] ??= brier(P[k], I));
  comps.forEach(([x, z], i) => {
    bs[i].dAuc.push(A(x) - A(z));
    bs[i].dLl.push(L(x) - L(z));
    bs[i].dBr.push(Br(x) - Br(z));
  });
  if ((b + 1) % 250 === 0) console.log(`bootstrap ${b + 1}/${B}`);
}
const ci = (a: number[]) => {
  const s = [...a].sort((p, q) => p - q);
  return [s[Math.floor(0.025 * (B - 1))], s[Math.floor(0.975 * (B - 1))]];
};
const rows = Object.fromEntries(Object.keys(S).map((k) => [k, { auc: auc(S[k], all), logLoss: ll(P[k], all), brier: brier(P[k], all) }]));
const deltas = Object.fromEntries(
  comps.map(([x, z], i) => [
    `${x} − ${z}`,
    { dAuc: auc(S[x], all) - auc(S[z], all), dAucCI: ci(bs[i].dAuc), dLogLoss: ll(P[x], all) - ll(P[z], all), dLogLossCI: ci(bs[i].dLl), dBrier: brier(P[x], all) - brier(P[z], all), dBrierCI: ci(bs[i].dBr) },
  ]),
);
const split = (pred: (i: number) => boolean) => {
  const J = all.filter(pred);
  if (J.length < 50) return { n: J.length };
  return { n: J.length, OFF: auc(S.OFF, J), PRO: auc(S.PRO, J), STZC: auc(S.STZC, J), HEROWR: auc(S.HEROWR, J), stzcMinusPro: auc(S.STZC, J) - auc(S.PRO, J), stzcMinusOff: auc(S.STZC, J) - auc(S.OFF, J), proMinusOff: auc(S.PRO, J) - auc(S.OFF, J) };
};
const brackets = { Ancient: split((i) => outcome[i].avgRankTier < 70), Divine: split((i) => outcome[i].avgRankTier >= 70) };
const perDay = Object.fromEntries(days.map((d) => [d, split((i) => outcome[i].day === d)]));
const blocks = [...new Set(outcome.map((o) => o.block6h))].sort();
const per6h = Object.fromEntries(blocks.map((b) => [b, split((i) => outcome[i].block6h === b)])); // descriptive only

// ---- frozen decision ----
const sp = deltas['STZC − PRO'];
const so = deltas['STZC − OFF'];
const po = deltas['PRO − OFF'];
const fullDays = Object.values(perDay).filter((v) => v.n >= 1000) as { n: number; stzcMinusPro: number }[];
const daysNeeded = Math.ceil((5 / 7) * fullDays.length);
const daysPos = fullDays.filter((v) => v.stzcMinusPro > 0).length;
const bothBrackets = (brackets.Ancient.stzcMinusPro ?? -1) > 0 && (brackets.Divine.stzcMinusPro ?? -1) > 0;
const criteria = {
  'STZC−PRO ΔAUC CI low > 0': sp.dAucCI[0] > 0,
  'STZC−PRO Δlog-loss CI high < 0': sp.dLogLossCI[1] < 0,
  'STZC−OFF ΔAUC CI low ≥ −0.002': so.dAucCI[0] >= -0.002,
  'STZC−PRO > 0 in both brackets': bothBrackets,
  [`STZC−PRO > 0 on ≥ ${daysNeeded} of ${fullDays.length} dates with ≥1000`]: fullDays.length >= 2 && daysPos >= daysNeeded,
};
const ready = Object.values(criteria).every(Boolean);
const proHurts = po.dAucCI[1] < 0;
const verdict = ready
  ? 'READY — recommend applying STZC pairs (--parts pairs) together with the rankedMatchupsByDelta baseline-0.5 code change'
  : proHurts
    ? 'STZC NOT READY; PRO − OFF CI < 0 — recommend pairs OFF (synergyCoeff = matchupCoeff = 0)'
    : 'STZC NOT READY; PRO not shown harmful — keep pro pairs (no change)';
const out = { generatedAt: new Date().toISOString(), nMatches: M, proposedMeta: path.relative(REPO_ROOT, PROPOSED_META), sideValuesDiffering: sideDiff, rows, deltas, brackets, perDay, per6h, criteria, daysPos, daysNeeded, proHurts, verdict };
fs.writeFileSync(path.join(OUT, 'kt8-c-stzc.json'), JSON.stringify(out, null, 2));
appendRun({ kind: 'kt8-c-stzc', label: 'cleaned STRATZ pairs (w1790208000) on blind window C', config: { rows: Object.keys(S), boot: B, rngSeed: 8080 }, seed: 0, nMatches: M, metrics: out, wallMs: 0 });
console.log(JSON.stringify({ verdict, criteria, rows, deltas, brackets, perDay }, (k, v) => (typeof v === 'number' ? +v.toFixed(5) : v), 1));
