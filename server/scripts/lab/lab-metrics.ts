// The ruler (prompt rule 3): scale vs rank metrics, bootstrap by hero,
// paired bootstrap. Inputs are aligned per-hero vectors (x = system rate,
// y = real winRate), both as fractions.
import { mulberry32 } from './lab-common';

export function mean(xs: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += xs[i];
  return s / xs.length;
}
export function sd(xs: ArrayLike<number>): number {
  const m = mean(xs);
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += (xs[i] - m) ** 2;
  return Math.sqrt(s / xs.length);
}
export function pearson(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const ma = mean(a);
  const mb = mean(b);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da === 0 || db === 0 ? 0 : num / Math.sqrt(da * db);
}
export function ranks(xs: ArrayLike<number>): number[] {
  const idx = Array.from({ length: xs.length }, (_, i) => i).sort((i, j) => xs[i] - xs[j]);
  const r = new Array<number>(xs.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && xs[idx[j + 1]] === xs[idx[i]]) j++;
    for (let k = i; k <= j; k++) r[idx[k]] = (i + j) / 2;
    i = j + 1;
  }
  return r;
}
export function spearman(a: ArrayLike<number>, b: ArrayLike<number>): number {
  return pearson(ranks(a), ranks(b));
}
/** OLS y = a + b x. */
export function ols(x: ArrayLike<number>, y: ArrayLike<number>): { a: number; b: number } {
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < x.length; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
  }
  const b = sxx === 0 ? 0 : sxy / sxx;
  return { a: my - b * mx, b };
}
/** Pool-adjacent-violators: isotonic (non-decreasing) fit of y on x. */
export function isotonicFit(x: ArrayLike<number>, y: ArrayLike<number>): number[] {
  const order = Array.from({ length: x.length }, (_, i) => i).sort((i, j) => x[i] - x[j]);
  const vals: number[] = [];
  const wts: number[] = [];
  const sizes: number[] = [];
  for (const i of order) {
    vals.push(y[i]);
    wts.push(1);
    sizes.push(1);
    while (vals.length > 1 && vals[vals.length - 2] > vals[vals.length - 1]) {
      const v2 = vals.pop()!;
      const w2 = wts.pop()!;
      const s2 = sizes.pop()!;
      const v1 = vals.pop()!;
      const w1 = wts.pop()!;
      const s1 = sizes.pop()!;
      vals.push((v1 * w1 + v2 * w2) / (w1 + w2));
      wts.push(w1 + w2);
      sizes.push(s1 + s2);
    }
  }
  const fit = new Array<number>(x.length);
  let k = 0;
  for (let b = 0; b < vals.length; b++) for (let s = 0; s < sizes[b]; s++) fit[order[k++]] = vals[b];
  return fit;
}

export interface Ruler {
  r: number;
  spearman: number;
  slopeRealOnSys: number; // b in real = a + b·sys; scale-only miss → b far from 1
  sdRatio: number; // SD(sys)/SD(real)
  maeAffPp: number; // MAE of real vs best affine map of sys
  maeIsoPp: number; // MAE of real vs isotonic map of sys (in-sample, optimistic)
  maeConstPp: number; // floor: predict mean real for everyone
  residAff3: number; // heroes with |real − affine(sys)| ≥ 3pp
  residAff5: number;
  topDecileOverlap: number; // |top-13 by sys ∩ top-13 by real|
  bottomDecileOverlap: number;
  // legacy (scale-confounded) metrics
  maePp: number;
  coverage7Pct: number;
  flagged10: number;
}

export const RULER_KEYS: (keyof Ruler)[] = [
  'r',
  'spearman',
  'slopeRealOnSys',
  'sdRatio',
  'maeAffPp',
  'maeIsoPp',
  'maeConstPp',
  'residAff3',
  'residAff5',
  'topDecileOverlap',
  'bottomDecileOverlap',
  'maePp',
  'coverage7Pct',
  'flagged10',
];

export function ruler(x: ArrayLike<number>, y: ArrayLike<number>, opts: { iso?: boolean } = {}): Ruler {
  const n = x.length;
  const { a, b } = ols(x, y);
  const my = mean(y);
  let maeAff = 0;
  let maeConst = 0;
  let maeRaw = 0;
  let r3 = 0;
  let r5 = 0;
  let cov7 = 0;
  let f10 = 0;
  for (let i = 0; i < n; i++) {
    const res = y[i] - (a + b * x[i]);
    maeAff += Math.abs(res);
    maeConst += Math.abs(y[i] - my);
    if (Math.abs(res) >= 0.03) r3++;
    if (Math.abs(res) >= 0.05) r5++;
    const d = Math.abs(x[i] - y[i]);
    maeRaw += d;
    if (d <= 0.07) cov7++;
    if (d >= 0.1) f10++;
  }
  let maeIso = NaN;
  if (opts.iso !== false) {
    const fit = isotonicFit(x, y);
    maeIso = 0;
    for (let i = 0; i < n; i++) maeIso += Math.abs(y[i] - fit[i]);
    maeIso = (maeIso / n) * 100;
  }
  const k = Math.round(n / 10);
  const top = (v: ArrayLike<number>, hi: boolean) =>
    new Set(
      Array.from({ length: n }, (_, i) => i)
        .sort((i, j) => (hi ? v[j] - v[i] : v[i] - v[j]))
        .slice(0, k),
    );
  const overlap = (s1: Set<number>, s2: Set<number>) => [...s1].filter((i) => s2.has(i)).length;
  return {
    r: pearson(x, y),
    spearman: spearman(x, y),
    slopeRealOnSys: b,
    sdRatio: sd(x) / sd(y),
    maeAffPp: (maeAff / n) * 100,
    maeIsoPp: maeIso,
    maeConstPp: (maeConst / n) * 100,
    residAff3: r3,
    residAff5: r5,
    topDecileOverlap: overlap(top(x, true), top(y, true)),
    bottomDecileOverlap: overlap(top(x, false), top(y, false)),
    maePp: (maeRaw / n) * 100,
    coverage7Pct: (cov7 / n) * 100,
    flagged10: f10,
  };
}

export interface CI {
  est: number;
  lo: number;
  hi: number;
  se: number;
}

function pct(sorted: number[], q: number): number {
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

function ciFrom(est: number, samples: number[]): CI {
  const s = samples.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  return { est, lo: pct(s, 0.025), hi: pct(s, 0.975), se: sd(s) };
}

/** Percentile bootstrap by hero for every ruler metric. */
export function bootstrapRuler(x: number[], y: number[], B = 2000, seed = 12345): Record<keyof Ruler, CI> {
  const rng = mulberry32(seed);
  const n = x.length;
  const est = ruler(x, y);
  const samples: Record<string, number[]> = Object.fromEntries(RULER_KEYS.map((k) => [k, [] as number[]]));
  const bx = new Array<number>(n);
  const by = new Array<number>(n);
  for (let b = 0; b < B; b++) {
    for (let i = 0; i < n; i++) {
      const j = Math.floor(rng() * n);
      bx[i] = x[j];
      by[i] = y[j];
    }
    const r = ruler(bx, by, { iso: b < 500 }); // isotonic is the slow one; 500 draws suffice for its CI
    for (const k of RULER_KEYS) samples[k].push(r[k]);
  }
  return Object.fromEntries(RULER_KEYS.map((k) => [k, ciFrom(est[k], samples[k])])) as Record<keyof Ruler, CI>;
}

/** Paired bootstrap (same hero resample) of metric(B) − metric(A). */
export function pairedDelta(
  xa: number[],
  xb: number[],
  y: number[],
  keys: (keyof Ruler)[] = ['r', 'spearman', 'maeAffPp', 'sdRatio', 'maePp'],
  B = 2000,
  seed = 777,
): Record<string, CI & { pGt0: number }> {
  const rng = mulberry32(seed);
  const n = y.length;
  const ea = ruler(xa, y, { iso: false });
  const eb = ruler(xb, y, { iso: false });
  const s: Record<string, number[]> = Object.fromEntries(keys.map((k) => [k, [] as number[]]));
  const a = new Array<number>(n);
  const b2 = new Array<number>(n);
  const yy = new Array<number>(n);
  for (let b = 0; b < B; b++) {
    for (let i = 0; i < n; i++) {
      const j = Math.floor(rng() * n);
      a[i] = xa[j];
      b2[i] = xb[j];
      yy[i] = y[j];
    }
    const ra = ruler(a, yy, { iso: false });
    const rb = ruler(b2, yy, { iso: false });
    for (const k of keys) s[k].push(rb[k] - ra[k]);
  }
  return Object.fromEntries(
    keys.map((k) => {
      const ci = ciFrom(eb[k] - ea[k], s[k]);
      return [k, { ...ci, pGt0: s[k].filter((v) => v > 0).length / s[k].length }];
    }),
  );
}
