// KT3: (1) honest ceiling from /heroStats public picks, (2) hidden tags out of
// sample on NEW targets (Oct heroStats Ancient+Divine WR; 8h Divine window WR),
// (3) the match-level SAFE on 25 074 public matches — evaluated ONCE for the
// frozen shortlist (Blueprint/16 "Frozen shortlist"), pair channels OFF primary,
// (4) Н6.1 cheap match-level logistic models (team axis diffs; hero one-hot BT).
//   cd server && npx ts-node scripts/lab/kt3-safe.ts
import * as fs from 'fs';
import * as path from 'path';
import { CUSTOM_TAG_DEFINITIONS } from 'shared';
import { DATA_DIR, LAB_DIR, REPO_ROOT, appendRun, ensureLabDir, mulberry32 } from './lab-common';
import { NA, NP, cacheDir, favoredRates, loadCache, productionParams, replayCounts, replayDiff, type FeatureCache, type ReplayParams } from './feature-cache';
import { mean, pairedDelta, pearson, ruler, sd, spearman } from './lab-metrics';
import { AXES } from '../../src/assessment-core/axes';

const OUT = ensureLabDir('kt3');
const t0 = Date.now();
const heroesJ = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'heroes.json'), 'utf-8')) as { id: number; name: string; evaluation_values: Record<string, number> }[];
const H = heroesJ.length;
const meta = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'hero-meta.json'), 'utf-8')).heroes as { heroId: number; winRate: number }[];
const augWR = new Map(meta.map((e) => [e.heroId, e.winRate]));
const hs = JSON.parse(fs.readFileSync(path.join(LAB_DIR, 'opendota', 'heroStats.json'), 'utf-8')) as Record<string, number>[];
const hsById = new Map(hs.map((x) => [x.id, x]));
const outcome = JSON.parse(fs.readFileSync(path.join(LAB_DIR, 'opendota', 'pub-outcome.json'), 'utf-8')) as { startTime: number; radiantWin: boolean }[];
const yM = outcome.map((o) => (o.radiantWin ? 1 : 0));
const M = yM.length;

// ---------------- (1) ceiling ----------------
const ids = heroesJ.map((h) => h.id);
const Yaug = ids.map((id) => augWR.get(id)!);
const pick = (id: number, br: number[]) => br.reduce((s, b) => s + (hsById.get(id)?.[`${b}_pick`] ?? 0), 0);
const win = (id: number, br: number[]) => br.reduce((s, b) => s + (hsById.get(id)?.[`${b}_win`] ?? 0), 0);
const oct67 = ids.map((id) => win(id, [6, 7]) / pick(id, [6, 7]));
const oct6 = ids.map((id) => win(id, [6]) / pick(id, [6]));
const oct7 = ids.map((id) => win(id, [7]) / pick(id, [7]));
const n67 = ids.map((id) => pick(id, [6, 7]));
const relBinom = (p: number[], n: number[]) => 1 - mean(p.map((v, i) => (v * (1 - v)) / n[i])) / sd(p) ** 2;
// window WR (25k Divine matches)
const pc = new Float64Array(H);
const wc = new Float64Array(H);
const pool = JSON.parse(fs.readFileSync(path.join(LAB_DIR, 'opendota', 'pub-pool.json'), 'utf-8')) as { heroIdx: number[] }[];
pool.forEach((m, i) =>
  m.heroIdx.forEach((h, k) => {
    pc[h]++;
    if ((k < 5) === outcome[i].radiantWin) wc[h]++;
  }),
);
const winWR = Array.from(wc, (w, h) => w / pc[h]);
const ceiling = {
  oct67Picks: { min: Math.min(...n67), median: [...n67].sort((a, b) => a - b)[Math.floor(H / 2)], max: Math.max(...n67) },
  sdPp: { aug: sd(Yaug) * 100, oct67: sd(oct67) * 100, window: sd(winWR) * 100 },
  binomialReliability: { oct67: relBinom(oct67, n67), window: relBinom(winWR, Array.from(pc)) },
  rAugVsOct67: pearson(Yaug, oct67), // test–retest over ~7 weeks (incl. patch drift)
  rOct6VsOct7: pearson(oct6, oct7), // bracket consistency (Ancient vs Divine)
  rAugVsWindow: pearson(Yaug, winWR),
  rOct67VsWindow: pearson(oct67, winWR),
  windowGamesPerHero: { min: Math.min(...pc), median: [...pc].sort((a, b) => a - b)[Math.floor(H / 2)] },
};

// ---------------- (2) hidden tags out of sample ----------------
const per = JSON.parse(fs.readFileSync(path.join(LAB_DIR, 'kt1', 'per-hero.json'), 'utf-8')) as Record<string, number>[];
const perById = new Map(per.map((p) => [p.heroId, p]));
const xN = ids.map((id) => perById.get(id)!['B-naked']);
const xF = ids.map((id) => perById.get(id)!['B-full']);
const z = (v: number[]) => {
  const m = mean(v);
  const s = sd(v);
  return v.map((x) => (x - m) / s);
};
const hidden = CUSTOM_TAG_DEFINITIONS.filter((d) => !d.visible && !d.revealable);
const idxByName = new Map(heroesJ.map((h, i) => [h.name, i]));
const memberships: { h: number; dir: number; tag: string }[] = [];
for (const d of hidden) {
  const mem = d.heroNames.map((n) => idxByName.get(n)).filter((h): h is number => h !== undefined);
  const dir = Math.sign(mean(mem.map((h) => xF[h] - xN[h])));
  mem.forEach((h) => memberships.push({ h, dir, tag: d.name }));
}
const signHits = (T: number[]) => {
  const zt = z(T);
  const zn = z(xN);
  return memberships.filter(({ h, dir }) => Math.sign(zt[h] - zn[h]) === dir).length / memberships.length;
};
function hiddenOn(T: number[], label: string) {
  const rng = mulberry32(5150);
  const hit = signHits(T);
  const nullHits: number[] = [];
  for (let k = 0; k < 2000; k++) {
    const p = [...T];
    for (let i = p.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    nullHits.push(signHits(p));
  }
  const d = pairedDelta(xN, xF, T, ['r', 'spearman', 'maeAffPp']);
  // per-tag: mean z(T) of members vs mean z(Aug) — does the tagged group's real standing persist?
  const zt = z(T);
  const za = z(Yaug);
  const perTag = hidden.map((tg) => {
    const ms = memberships.filter((m) => m.tag === tg.name);
    return { tag: tg.name, n: ms.length, dir: ms[0]?.dir ?? 0, meanZaug: mean(ms.map((m) => za[m.h])), meanZtarget: mean(ms.map((m) => zt[m.h])) };
  });
  return {
    label,
    rNaked: pearson(xN, T),
    rFull: pearson(xF, T),
    spearmanNaked: spearman(xN, T),
    spearmanFull: spearman(xF, T),
    pairedFullMinusNaked: d,
    signHit: hit,
    signHitNull: { mean: mean(nullHits), p95: [...nullHits].sort((a, b) => a - b)[1899], p: nullHits.filter((v) => v >= hit).length / nullHits.length },
    perTag,
  };
}
const hiddenOos = {
  augReference: { rNaked: pearson(xN, Yaug), rFull: pearson(xF, Yaug) },
  oct67: hiddenOn(oct67, 'heroStats Oct, Ancient+Divine'),
  window: hiddenOn(winWR, '8h Divine window'),
};

// ---------------- (3) the safe ----------------
const caches: Record<string, FeatureCache> = {
  full: loadCache(cacheDir(0, M, 'full')),
  naked: loadCache(cacheDir(0, M, 'naked-open')),
  noShutdown: loadCache(cacheDir(0, M, 'full-noShutdown')),
};
const P0 = productionParams(0);
const opt = JSON.parse(fs.readFileSync(path.join(LAB_DIR, 'kt2', 'optimize', 'optimize.json'), 'utf-8'));
const esShare = opt.full.inSampleWeightsShare as Record<string, number>;
const wES = new Float64Array(NP * NA);
for (let p = 0; p < NP; p++) AXES.forEach((a, i) => (wES[p * NA + i] = esShare[a] ?? 0));
const pairOff = (p: ReplayParams): ReplayParams => ({ ...p, synergyCoeff: 0, matchupCoeff: 0 });
const scoreBattle = (c: FeatureCache, p: ReplayParams) => Array.from({ length: M }, (_, m) => replayDiff(c, m, p));
const oofB = JSON.parse(fs.readFileSync(path.join(LAB_DIR, 'kt2', 'regress', 'oof-preds.json'), 'utf-8')) as Record<string, number>[];
const priorB = new Map(oofB.map((r) => [r.heroId, r['lasso|B:design+pop']]));
const teamDiff = (val: (h: number) => number) =>
  pool.map((m) => mean(m.heroIdx.slice(0, 5).map(val)) - mean(m.heroIdx.slice(5).map(val)));
const rows: Record<string, { cls: string; s: number[] }> = {
  BASE: { cls: 'base', s: scoreBattle(caches.full, pairOff(P0)) },
  'S1 es-full': { cls: 'A', s: scoreBattle(caches.full, pairOff({ ...P0, w: wES })) },
  'S2 no-shutdown': { cls: 'A', s: scoreBattle(caches.noShutdown, pairOff(P0)) },
  'S3 hero-prior-B': { cls: 'B-meta', s: teamDiff((h) => priorB.get(ids[h])!) },
  'ref B-naked': { cls: 'ref', s: scoreBattle(caches.naked, pairOff(P0)) },
  'ref BASE pair ON': { cls: 'ref', s: scoreBattle(caches.full, P0) },
  'ref S1 pair ON': { cls: 'ref', s: scoreBattle(caches.full, { ...P0, w: wES }) },
  'ref shipped (pair ON, rwr=2)': { cls: 'C', s: scoreBattle(caches.full, productionParams(2)) },
  'ref hero-meta winRate prior': { cls: 'C', s: teamDiff((h) => Yaug[h]) },
};

function auc(s: number[], y: number[], idx?: number[]): number {
  const I = idx ?? s.map((_, i) => i);
  const arr = I.map((i) => [s[i], y[i]]).sort((a, b) => a[0] - b[0]);
  let rankSum = 0;
  let nPos = 0;
  for (let i = 0; i < arr.length; ) {
    let j = i;
    while (j + 1 < arr.length && arr[j + 1][0] === arr[i][0]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) if (arr[k][1] === 1) {
      rankSum += r;
      nPos++;
    }
    i = j + 1;
  }
  const nNeg = arr.length - nPos;
  return (rankSum - (nPos * (nPos + 1)) / 2) / (nPos * nNeg);
}
// logistic a + b·s via Newton
function logit2(s: number[], y: number[], I: number[]): [number, number] {
  let a = 0;
  let b = 0;
  const sc = sd(I.map((i) => s[i])) || 1;
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
const order = outcome.map((_, i) => i).sort((i, j) => outcome[i].startTime - outcome[j].startTime);
const half1 = order.slice(0, Math.floor(M / 2));
const half2 = order.slice(Math.floor(M / 2));
function crossFitProb(s: number[]): number[] {
  const p = new Array(M).fill(0.5);
  for (const [tr, te] of [[half1, half2], [half2, half1]]) {
    const [a, b] = logit2(s, yM, tr);
    for (const i of te) p[i] = 1 / (1 + Math.exp(-(a + b * s[i])));
  }
  return p;
}
const ll = (p: number[], I: number[]) => -mean(I.map((i) => (yM[i] ? Math.log(p[i]) : Math.log(1 - p[i]))));
const brier = (p: number[], I: number[]) => mean(I.map((i) => (p[i] - yM[i]) ** 2));
const all = yM.map((_, i) => i);
const probs: Record<string, number[]> = {};
const constP = crossFitProb(new Array(M).fill(0));
for (const [k, v] of Object.entries(rows)) probs[k] = crossFitProb(v.s);
const rngB = mulberry32(2024);
const B = 1000;
const boots: Record<string, { auc: number[]; ll: number[] }> = Object.fromEntries(Object.keys(rows).map((k) => [k, { auc: [], ll: [] }]));
for (let b = 0; b < B; b++) {
  const I = Array.from({ length: M }, () => Math.floor(rngB() * M));
  const baseAuc = auc(rows.BASE.s, yM, I);
  const baseLl = ll(probs.BASE, I);
  for (const k of Object.keys(rows)) {
    boots[k].auc.push(auc(rows[k].s, yM, I) - baseAuc);
    boots[k].ll.push(ll(probs[k], I) - baseLl);
  }
}
const ci = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return { lo: s[Math.floor(0.025 * (s.length - 1))], hi: s[Math.floor(0.975 * (s.length - 1))] };
};
const safe = Object.fromEntries(
  Object.entries(rows).map(([k, v]) => [
    k,
    {
      cls: v.cls,
      auc: auc(v.s, yM),
      logLoss: ll(probs[k], all),
      brier: brier(probs[k], all),
      dAucVsBase: { est: auc(v.s, yM) - auc(rows.BASE.s, yM), ...ci(boots[k].auc) },
      dLogLossVsBase: { est: ll(probs[k], all) - ll(probs.BASE, all), ...ci(boots[k].ll) },
      corrWithBase: pearson(v.s, rows.BASE.s),
    },
  ]),
);
// in-game tier roll as a probability (no fitting): P(radiant) from tiers + High Skill
const fc = caches.full;
const tierP = Array.from({ length: M }, (_, m) => {
  const d = replayDiff(fc, m, P0);
  const ad = Math.abs(d);
  const w = ad > 1.3 ? 1 : ad > 0.5 ? 0.62 : 0.53;
  let p = d > 0.15 ? w : d < -0.15 ? 1 - w : 0.5;
  if (fc.flags && !fc.flags[m * 3 + 2]) {
    const pull = (q: number) => (q > 0.5 ? Math.max(0.5, q - 0.05) : q < 0.5 ? Math.min(0.5, q + 0.05) : q);
    if (fc.flags[m * 3]) p = pull(p);
    if (fc.flags[m * 3 + 1]) p = pull(p);
  }
  return Math.min(1 - 1e-6, Math.max(1e-6, p));
});
const favWins = (() => {
  let n = 0, w = 0;
  const tiers: Record<string, [number, number]> = { Low: [0, 0], Moderate: [0, 0], High: [0, 0] };
  for (let m = 0; m < M; m++) {
    const d = replayDiff(fc, m, P0);
    if (Math.abs(d) <= 0.15) continue;
    const t = Math.abs(d) > 1.3 ? 'High' : Math.abs(d) > 0.5 ? 'Moderate' : 'Low';
    const fw = (d > 0) === (yM[m] === 1);
    n++;
    if (fw) w++;
    tiers[t][0]++;
    if (fw) tiers[t][1]++;
  }
  return { nonEven: n, favoriteWinRate: w / n, byTier: Object.fromEntries(Object.entries(tiers).map(([t, [a, b]]) => [t, { n: a, favoriteWinRate: b / a }])) };
})();
const safeExtra = { constant: { logLoss: ll(constP, all), brier: brier(constP, all), radiantWinRate: mean(yM) }, inGameTierRoll: { brier: brier(tierP, all), logLoss: ll(tierP, all), ...favWins } };

// ---------------- (4) Н6.1 cheap match-level logistic ----------------
// Generic L2 logistic via Newton (p ≤ 128).
function fitLogistic(X: number[][], y: number[], I: number[], lambda: number): number[] {
  const p = X[0].length;
  let w = new Array(p + 1).fill(0);
  for (let it = 0; it < 30; it++) {
    const g = new Array(p + 1).fill(0);
    const Hm = Array.from({ length: p + 1 }, () => new Array(p + 1).fill(0));
    for (const i of I) {
      const xi = [1, ...X[i]];
      const eta = xi.reduce((s, v, k) => s + v * w[k], 0);
      const pr = 1 / (1 + Math.exp(-eta));
      const ww = pr * (1 - pr);
      for (let a = 0; a <= p; a++) {
        g[a] += (y[i] - pr) * xi[a];
        if (xi[a] === 0) continue;
        for (let b = 0; b <= a; b++) Hm[a][b] += ww * xi[a] * xi[b];
      }
    }
    for (let a = 1; a <= p; a++) {
      g[a] -= lambda * w[a];
      Hm[a][a] += lambda;
    }
    for (let a = 0; a <= p; a++) for (let b = 0; b < a; b++) Hm[b][a] = Hm[a][b];
    // solve Hm d = g (Gaussian elimination)
    const A = Hm.map((r, k) => [...r, g[k]]);
    const n = p + 1;
    for (let c = 0; c < n; c++) {
      let piv = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
      [A[c], A[piv]] = [A[piv], A[c]];
      for (let r = c + 1; r < n; r++) {
        const f = A[r][c] / A[c][c];
        for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k];
      }
    }
    const d = new Array(n).fill(0);
    for (let r = n - 1; r >= 0; r--) {
      let s = A[r][n];
      for (let k = r + 1; k < n; k++) s -= A[r][k] * d[k];
      d[r] = s / A[r][r];
    }
    w = w.map((v, k) => v + d[k]);
    if (d.reduce((s, v) => s + Math.abs(v), 0) < 1e-8) break;
  }
  return w;
}
const predict = (w: number[], x: number[]) => 1 / (1 + Math.exp(-(w[0] + x.reduce((s, v, k) => s + v * w[k + 1], 0))));
function timeSplitEval(X: number[][], lambda: number) {
  // train on the earlier half, test on the later half, and the reverse; report both
  const res = [] as { auc: number; ll: number }[];
  let wFirst: number[] = [];
  for (const [tr, te] of [[half1, half2], [half2, half1]]) {
    const w = fitLogistic(X, yM, tr, lambda);
    if (!wFirst.length) wFirst = w;
    const p = new Array(M).fill(0.5);
    for (const i of te) p[i] = predict(w, X[i]);
    res.push({ auc: auc(p, yM, te), ll: ll(p, te) });
  }
  return { aucEarlyToLate: res[0].auc, aucLateToEarly: res[1].auc, llEarlyToLate: res[0].ll, w: wFirst };
}
const axesX = pool.map((m) =>
  AXES.map((a) => mean(m.heroIdx.slice(0, 5).map((h) => heroesJ[h].evaluation_values[a] ?? 0)) - mean(m.heroIdx.slice(5).map((h) => heroesJ[h].evaluation_values[a] ?? 0))),
);
const heroX = pool.map((m) => {
  const x = new Array(H).fill(0);
  m.heroIdx.forEach((h, k) => (x[h] += k < 5 ? 1 : -1));
  return x;
});
const axesModel = timeSplitEval(axesX, 1);
const btModels = [1, 10, 100].map((lam) => ({ lambda: lam, ...timeSplitEval(heroX, lam) }));
const bestBT = btModels.sort((a, b) => b.aucEarlyToLate - a.aucEarlyToLate)[0];
const btStrength = bestBT.w.slice(1);
const n61 = {
  teamAxesLogistic: { aucEarlyToLate: axesModel.aucEarlyToLate, aucLateToEarly: axesModel.aucLateToEarly, llEarlyToLate: axesModel.llEarlyToLate, coef: Object.fromEntries(AXES.map((a, i) => [a, axesModel.w[i + 1]])) },
  heroBradleyTerry: { lambda: bestBT.lambda, aucEarlyToLate: bestBT.aucEarlyToLate, aucLateToEarly: bestBT.aucLateToEarly, llEarlyToLate: bestBT.llEarlyToLate, rStrengthVsAugWR: pearson(btStrength, Yaug), rStrengthVsOct67: pearson(btStrength, oct67) },
  // chain back: hero-level score implied by the axes logistic (its linear predictor per hero)
  axesModelImpliedHeroScore: (() => {
    const s = heroesJ.map((h) => AXES.reduce((acc, a, i) => acc + axesModel.w[i + 1] * (h.evaluation_values[a] ?? 0), 0));
    return { rVsAug: pearson(s, Yaug), rVsOct67: pearson(s, oct67), rVsBnakedFav: pearson(s, xN) };
  })(),
};

const out = { generatedAt: new Date().toISOString(), nMatches: M, window: '2026-10-01 14:47–23:59 UTC, Divine (71–75), ranked AP', ceiling, hiddenOos, safe, safeExtra, n61 };
fs.writeFileSync(path.join(OUT, 'kt3.json'), JSON.stringify(out, null, 2));
appendRun({ kind: 'kt3-safe', label: 'safe-once', config: { shortlist: Object.keys(rows), primary: 'AUC pair channels OFF', calib: 'logistic cross-fit time halves', boot: B }, seed: 0, nMatches: M, metrics: out, wallMs: Date.now() - t0 });
console.log(`kt3 written in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
void REPO_ROOT;
void favoredRates;
void replayCounts;
void ruler;
