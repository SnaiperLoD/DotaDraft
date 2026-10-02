// Small, dependency-free regression toolkit for n≈127 heroes (no sklearn on
// this machine). Every model standardizes on the TRAINING fold only.
import { mulberry32 } from './lab-common';
import { pearson } from './lab-metrics';

export type Mat = number[][];

export interface Model {
  name: string;
  /** Inner-CV-tuned fit; returns a predictor. */
  fit(X: Mat, y: number[], rng: () => number): (X: Mat) => number[];
}

function colStats(X: Mat): { mu: number[]; sd: number[] } {
  const p = X[0].length;
  const n = X.length;
  const mu = new Array(p).fill(0);
  const sd = new Array(p).fill(0);
  for (const row of X) for (let j = 0; j < p; j++) mu[j] += row[j] / n;
  for (const row of X) for (let j = 0; j < p; j++) sd[j] += (row[j] - mu[j]) ** 2 / n;
  for (let j = 0; j < p; j++) sd[j] = Math.sqrt(sd[j]) || 1;
  return { mu, sd };
}
function standardize(X: Mat, s: { mu: number[]; sd: number[] }): Mat {
  return X.map((row) => row.map((v, j) => (v - s.mu[j]) / s.sd[j]));
}
const meanOf = (y: number[]) => y.reduce((a, b) => a + b, 0) / y.length;

/** Solve (A) x = b for SPD A via Cholesky. */
function cholSolve(A: Mat, b: number[]): number[] {
  const n = A.length;
  const L: Mat = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++)
    for (let j = 0; j <= i; j++) {
      let s = A[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      L[i][j] = i === j ? Math.sqrt(Math.max(s, 1e-12)) : s / L[j][j];
    }
  const z = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= L[i][k] * z[k];
    z[i] = s / L[i][i];
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = z[i];
    for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k];
    x[i] = s / L[i][i];
  }
  return x;
}

function ridgeRaw(Z: Mat, yc: number[], lambda: number): number[] {
  const p = Z[0].length;
  const A: Mat = Array.from({ length: p }, () => new Array(p).fill(0));
  const b = new Array(p).fill(0);
  for (let i = 0; i < Z.length; i++)
    for (let j = 0; j < p; j++) {
      b[j] += Z[i][j] * yc[i];
      for (let k = 0; k <= j; k++) A[j][k] += Z[i][j] * Z[i][k];
    }
  for (let j = 0; j < p; j++) {
    for (let k = 0; k < j; k++) A[k][j] = A[j][k];
    A[j][j] += lambda;
  }
  return cholSolve(A, b);
}

function lassoRaw(Z: Mat, yc: number[], lambda: number, beta0?: number[]): number[] {
  const n = Z.length;
  const p = Z[0].length;
  const beta = beta0 ? [...beta0] : new Array(p).fill(0);
  const r = yc.map((v, i) => v - Z[i].reduce((s, z, j) => s + z * beta[j], 0));
  const zz = new Array(p).fill(0);
  for (const row of Z) for (let j = 0; j < p; j++) zz[j] += row[j] * row[j];
  for (let it = 0; it < 200; it++) {
    let maxd = 0;
    for (let j = 0; j < p; j++) {
      if (zz[j] === 0) continue;
      let rho = 0;
      for (let i = 0; i < n; i++) rho += Z[i][j] * (r[i] + Z[i][j] * beta[j]);
      const nb = Math.sign(rho) * Math.max(0, Math.abs(rho) - lambda * n) / zz[j];
      const d = nb - beta[j];
      if (d !== 0) {
        for (let i = 0; i < n; i++) r[i] -= Z[i][j] * d;
        beta[j] = nb;
        maxd = Math.max(maxd, Math.abs(d));
      }
    }
    if (maxd < 1e-7) break;
  }
  return beta;
}

/** PLS1 (NIPALS) with k components → coefficients in standardized space. */
function plsRaw(Z: Mat, yc: number[], k: number): number[] {
  const n = Z.length;
  const p = Z[0].length;
  let E = Z.map((r) => [...r]);
  let f = [...yc];
  const W: number[][] = [];
  const P: number[][] = [];
  const q: number[] = [];
  for (let c = 0; c < Math.min(k, p); c++) {
    const w = new Array(p).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < p; j++) w[j] += E[i][j] * f[i];
    const wn = Math.sqrt(w.reduce((s, v) => s + v * v, 0)) || 1;
    for (let j = 0; j < p; j++) w[j] /= wn;
    const t = E.map((row) => row.reduce((s, v, j) => s + v * w[j], 0));
    const tt = t.reduce((s, v) => s + v * v, 0) || 1e-12;
    const pp = new Array(p).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < p; j++) pp[j] += (E[i][j] * t[i]) / tt;
    const qc = t.reduce((s, v, i) => s + v * f[i], 0) / tt;
    E = E.map((row, i) => row.map((v, j) => v - t[i] * pp[j]));
    f = f.map((v, i) => v - qc * t[i]);
    W.push(w);
    P.push(pp);
    q.push(qc);
  }
  // B = W (P'W)^-1 q
  const K = W.length;
  const PW: Mat = Array.from({ length: K }, (_, a) => Array.from({ length: K }, (_, b) => P[a].reduce((s, v, j) => s + v * W[b][j], 0)));
  // PW is upper triangular-ish; solve generally via normal equations on small K
  const PWt = PW[0].map((_, j) => PW.map((r) => r[j]));
  const A = PWt.map((r) => PWt.map((r2) => r.reduce((s, v, i) => s + v * r2[i], 0)));
  const bvec = PWt.map((r) => r.reduce((s, v, i) => s + v * q[i], 0));
  const cvec = cholSolve(A, bvec);
  const beta = new Array(p).fill(0);
  for (let c = 0; c < K; c++) for (let j = 0; j < p; j++) beta[j] += W[c][j] * cvec[c];
  return beta;
}

function kfoldIdx(n: number, k: number, rng: () => number): number[][] {
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return Array.from({ length: k }, (_, f) => idx.filter((_, i) => i % k === f));
}

/** Linear model with one hyper-parameter tuned by inner 5-fold CV (MSE). */
function tunedLinear(name: string, grid: number[], solve: (Z: Mat, yc: number[], h: number) => number[]): Model {
  return {
    name,
    fit(X, y, rng) {
      const pick = () => {
        if (grid.length === 1) return grid[0];
        const folds = kfoldIdx(X.length, 5, rng);
        const err = grid.map(() => 0);
        for (const te of folds) {
          const tes = new Set(te);
          const tr = X.map((_, i) => i).filter((i) => !tes.has(i));
          const s = colStats(tr.map((i) => X[i]));
          const Ztr = standardize(tr.map((i) => X[i]), s);
          const my = meanOf(tr.map((i) => y[i]));
          const yc = tr.map((i) => y[i] - my);
          const Zte = standardize(te.map((i) => X[i]), s);
          grid.forEach((h, g) => {
            const b = solve(Ztr, yc, h);
            te.forEach((i, t) => (err[g] += (y[i] - my - Zte[t].reduce((acc, z, j) => acc + z * b[j], 0)) ** 2));
          });
        }
        return grid[err.indexOf(Math.min(...err))];
      };
      const h = pick();
      const s = colStats(X);
      const Z = standardize(X, s);
      const my = meanOf(y);
      const b = solve(Z, y.map((v) => v - my), h);
      return (Xn: Mat) => standardize(Xn, s).map((row) => my + row.reduce((acc, z, j) => acc + z * b[j], 0));
    },
  };
}

export const MODELS = {
  constant: (): Model => ({ name: 'constant', fit: (_X, y) => { const m = meanOf(y); return (Xn) => Xn.map(() => m); } }),
  ols: (): Model => tunedLinear('ols', [1e-6], ridgeRaw),
  ridge: (): Model => tunedLinear('ridge', [0.1, 0.3, 1, 3, 10, 30, 100, 300, 1000, 3000], ridgeRaw),
  lasso: (): Model => tunedLinear('lasso', [0.0003, 0.001, 0.002, 0.004, 0.007, 0.012, 0.02], (Z, yc, l) => lassoRaw(Z, yc, l)),
  pls: (): Model => tunedLinear('pls', [1, 2, 3, 4, 6, 8], (Z, yc, k) => plsRaw(Z, yc, k)),
  boost: (): Model => ({
    name: 'boost',
    fit(X, y, rng) {
      const CHECK = [25, 50, 100, 200, 400];
      const lr = 0.05;
      const fitStumps = (Xt: Mat, yt: number[], M: number) => {
        const n = Xt.length;
        const p = Xt[0].length;
        const f0 = meanOf(yt);
        const res = yt.map((v) => v - f0);
        const order = Array.from({ length: p }, (_, j) => Array.from({ length: n }, (_, i) => i).sort((a, b) => Xt[a][j] - Xt[b][j]));
        const stumps: { j: number; thr: number; l: number; r: number }[] = [];
        for (let m = 0; m < M; m++) {
          let best = { gain: -1, j: 0, thr: 0, l: 0, r: 0 };
          const tot = res.reduce((a, b) => a + b, 0);
          for (let j = 0; j < p; j++) {
            let sl = 0;
            const o = order[j];
            for (let k = 0; k < n - 1; k++) {
              sl += res[o[k]];
              if (Xt[o[k]][j] === Xt[o[k + 1]][j]) continue;
              const nl = k + 1;
              const nr = n - nl;
              if (nl < 5 || nr < 5) continue;
              const gain = (sl * sl) / nl + ((tot - sl) * (tot - sl)) / nr;
              if (gain > best.gain) best = { gain, j, thr: (Xt[o[k]][j] + Xt[o[k + 1]][j]) / 2, l: sl / nl, r: (tot - sl) / nr };
            }
          }
          if (best.gain < 0) break;
          stumps.push({ j: best.j, thr: best.thr, l: best.l * lr, r: best.r * lr });
          for (let i = 0; i < n; i++) res[i] -= Xt[i][best.j] <= best.thr ? best.l * lr : best.r * lr;
        }
        return (Xn: Mat, upto: number) => Xn.map((row) => stumps.slice(0, upto).reduce((s, st) => s + (row[st.j] <= st.thr ? st.l : st.r), f0));
      };
      const folds = kfoldIdx(X.length, 5, rng);
      const err = CHECK.map(() => 0);
      for (const te of folds) {
        const tes = new Set(te);
        const tr = X.map((_, i) => i).filter((i) => !tes.has(i));
        const pred = fitStumps(tr.map((i) => X[i]), tr.map((i) => y[i]), CHECK[CHECK.length - 1]);
        CHECK.forEach((M, g) => {
          const pv = pred(te.map((i) => X[i]), M);
          te.forEach((i, t) => (err[g] += (y[i] - pv[t]) ** 2));
        });
      }
      const M = CHECK[err.indexOf(Math.min(...err))];
      const final = fitStumps(X, y, M);
      return (Xn: Mat) => final(Xn, M);
    },
  }),
};

/** Repeated K-fold OOF: mean over repeats of r(OOF pred, y) on all n, plus repeat-averaged OOF predictions. */
export function oof(model: Model, X: Mat, y: number[], repeats: number, seed: number, k = 5): { r: number; rRepeats: number[]; pred: number[] } {
  const rng = mulberry32(seed);
  const n = y.length;
  const avg = new Array(n).fill(0);
  const rs: number[] = [];
  for (let rep = 0; rep < repeats; rep++) {
    const pred = new Array(n).fill(0);
    for (const te of kfoldIdx(n, k, rng)) {
      const tes = new Set(te);
      const tr = X.map((_, i) => i).filter((i) => !tes.has(i));
      const f = model.fit(tr.map((i) => X[i]), tr.map((i) => y[i]), rng);
      const pv = f(te.map((i) => X[i]));
      te.forEach((i, t) => (pred[i] = pv[t]));
    }
    rs.push(pearson(pred, y));
    for (let i = 0; i < n; i++) avg[i] += pred[i] / repeats;
  }
  return { r: rs.reduce((a, b) => a + b, 0) / repeats, rRepeats: rs, pred: avg };
}
