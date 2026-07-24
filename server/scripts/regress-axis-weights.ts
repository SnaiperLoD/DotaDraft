import * as fs from 'fs';
import * as path from 'path';

// Blueprint/10-tech-debt-backlog.md, "Поворотный момент": a session of
// one-axis-at-a-time manual weight tuning kept whack-a-moling because
// durability/burst/teamfight/objectives/scaling turned out to be highly
// correlated (up to r=0.782) — not 11 independent signals. This script
// replaces guessing with fitting: regress real OpenDota winRate on the 11
// raw evaluation_values axes across all 127 heroes, and report the
// coefficients as a candidate basis for axis-weights.json.
//
// Plain OLS is expected to be unstable given the known collinearity (that's
// exactly what high VIF means: the normal equations matrix is close to
// singular, so small data changes swing coefficients wildly and standard
// errors blow up). Ridge regression (L2-penalized) is the standard fix —
// this script reports both, plus VIF per axis, so instability is visible
// rather than silently producing a confident-looking wrong answer.
const HEROES_PATH = path.join(__dirname, '..', 'data', 'heroes.json');
const HERO_META_PATH = path.join(__dirname, '..', 'data', 'hero-meta.json');

const AXES = [
  'teamfight',
  'tempo',
  'scaling',
  'mobility',
  'objectives',
  'control',
  'durability',
  'burst',
  'map_control',
  'saving',
  'initiating',
] as const;

interface Hero {
  id: number;
  name: string;
  evaluation_values: Record<string, number>;
}

// ---------- minimal linear algebra (no external deps, matches this repo's plain-Node script style) ----------

type Matrix = number[][];

function transpose(m: Matrix): Matrix {
  return m[0].map((_, j) => m.map((row) => row[j]));
}

function matMul(a: Matrix, b: Matrix): Matrix {
  const result: Matrix = Array.from({ length: a.length }, () => new Array(b[0].length).fill(0));
  for (let i = 0; i < a.length; i++) {
    for (let k = 0; k < b.length; k++) {
      const aik = a[i][k];
      if (aik === 0) continue;
      for (let j = 0; j < b[0].length; j++) {
        result[i][j] += aik * b[k][j];
      }
    }
  }
  return result;
}

// Gauss-Jordan inverse. Throws if the matrix is (numerically) singular —
// deliberately not swallowed, since a singular matrix here means the
// regression itself is not well-posed (exactly what we're checking for).
function invert(m: Matrix): Matrix {
  const n = m.length;
  const aug: Matrix = m.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(aug[r][col]) > Math.abs(aug[pivotRow][col])) pivotRow = r;
    }
    if (Math.abs(aug[pivotRow][col]) < 1e-10) {
      throw new Error(`Matrix is singular (or numerically unstable) at column ${col}`);
    }
    [aug[col], aug[pivotRow]] = [aug[pivotRow], aug[col]];
    const pivot = aug[col][col];
    for (let j = 0; j < 2 * n; j++) aug[col][j] /= pivot;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = aug[r][col];
      if (factor === 0) continue;
      for (let j = 0; j < 2 * n; j++) aug[r][j] -= factor * aug[col][j];
    }
  }
  return aug.map((row) => row.slice(n));
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function stdev(xs: number[], m: number): number {
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

// Standardizes each column to mean 0, sd 1 — essential here since the axes
// are all nominally 0-10 but have very different real spreads (mobility
// sd~0.6 vs durability sd~1.3), and without standardizing, raw regression
// coefficients would just reflect each axis's scale, not its actual
// importance, making them useless as comparable weights.
function standardizeColumns(X: Matrix): { standardized: Matrix; means: number[]; sds: number[] } {
  const cols = transpose(X);
  const means = cols.map((c) => mean(c));
  const sds = cols.map((c, j) => stdev(c, means[j]));
  const standardizedCols = cols.map((c, j) => c.map((v) => (sds[j] === 0 ? 0 : (v - means[j]) / sds[j])));
  return { standardized: transpose(standardizedCols), means, sds };
}

// Ridge regression on already-standardized X and centered y (no intercept
// term needed — see main()). lambda=0 reduces to plain OLS.
function ridgeRegress(X: Matrix, y: number[], lambda: number): number[] {
  const Xt = transpose(X);
  const XtX = matMul(Xt, X);
  const n = XtX.length;
  const penalized = XtX.map((row, i) => row.map((v, j) => (i === j ? v + lambda : v)));
  const XtY: Matrix = matMul(
    Xt,
    y.map((v) => [v]),
  );
  const inv = invert(penalized);
  const beta = matMul(inv, XtY);
  return beta.map((row) => row[0]);
}

function predict(X: Matrix, beta: number[]): number[] {
  return X.map((row) => row.reduce((sum, v, j) => sum + v * beta[j], 0));
}

function rSquared(yTrue: number[], yPred: number[]): number {
  const yMean = mean(yTrue);
  const ssRes = yTrue.reduce((s, y, i) => s + (y - yPred[i]) ** 2, 0);
  const ssTot = yTrue.reduce((s, y) => s + (y - yMean) ** 2, 0);
  return 1 - ssRes / ssTot;
}

// Standard OLS inference: SE(beta) from sigma^2 * (X'X)^-1, t = beta/SE.
// Two-tailed significance uses the normal approximation to the
// t-distribution (df=n-p=116 here is large enough that this is accurate to
// ~2 decimal places) rather than a full t-table, since this is a one-off
// diagnostic script, not a stats library.
function olsInference(X: Matrix, y: number[], beta: number[]): { se: number[]; t: number[] } {
  const n = X.length;
  const p = X[0].length;
  const pred = predict(X, beta);
  const ssRes = y.reduce((s, yi, i) => s + (yi - pred[i]) ** 2, 0);
  const sigma2 = ssRes / (n - p);
  const XtX = matMul(transpose(X), X);
  const inv = invert(XtX);
  const se = inv.map((row, j) => Math.sqrt(sigma2 * row[j]));
  const t = beta.map((b, j) => b / se[j]);
  return { se, t };
}

// F-test for the overall model (all p predictors vs none) — with R² this
// low, this checks whether the *whole* 11-axis model clears significance
// at all before trusting any individual coefficient inside it.
function overallFStat(r2: number, n: number, p: number): number {
  return (r2 / p) / ((1 - r2) / (n - p - 1));
}

// VIF_j = 1 / (1 - R²_j), where R²_j comes from regressing axis j on all
// other axes. VIF > 5 is the common "concerning" threshold, > 10 "severe".
function varianceInflationFactors(X: Matrix, labels: readonly string[]): Record<string, number> {
  const cols = transpose(X);
  const result: Record<string, number> = {};
  for (let j = 0; j < cols.length; j++) {
    const others = X.map((row) => row.filter((_, k) => k !== j));
    const target = cols[j];
    const beta = ridgeRegress(others, target, 0);
    const pred = predict(others, beta);
    const r2 = rSquared(target, pred);
    result[labels[j]] = 1 / Math.max(1e-6, 1 - r2);
  }
  return result;
}

function main() {
  const heroes: Hero[] = JSON.parse(fs.readFileSync(HEROES_PATH, 'utf-8'));
  const { heroes: metaEntries }: { heroes: { heroId: number; winRate: number | null }[] } = JSON.parse(
    fs.readFileSync(HERO_META_PATH, 'utf-8'),
  );
  const winRateById = new Map(metaEntries.map((e) => [e.heroId, e.winRate]));

  const rows = heroes
    .map((h) => ({ hero: h, winRate: winRateById.get(h.id) ?? null }))
    .filter((r): r is { hero: Hero; winRate: number } => r.winRate !== null);

  console.log(`n=${rows.length} heroes with known real winRate (of ${heroes.length} total)\n`);

  const X: Matrix = rows.map((r) => AXES.map((axis) => r.hero.evaluation_values[axis]));
  const yRaw = rows.map((r) => r.winRate);

  const { standardized: Xs } = standardizeColumns(X);
  const yMean = mean(yRaw);
  const yCentered = yRaw.map((v) => v - yMean);

  console.log('=== Variance Inflation Factors (>5 concerning, >10 severe) ===');
  const vif = varianceInflationFactors(Xs, AXES);
  for (const axis of AXES) {
    const flag = vif[axis] > 10 ? '  <-- SEVERE' : vif[axis] > 5 ? '  <-- concerning' : '';
    console.log(`  ${axis.padEnd(14)} ${vif[axis].toFixed(2)}${flag}`);
  }

  console.log('\n=== OLS (lambda=0) vs Ridge at increasing lambda ===');
  console.log('  (standardized coefficients — comparable magnitude across axes; unstable OLS shows as coefficients swinging/flipping sign as lambda rises from 0)');
  const lambdas = [0, 1, 5, 10, 20, 50];
  const results = lambdas.map((lambda) => ({ lambda, beta: ridgeRegress(Xs, yCentered, lambda) }));

  const header = 'axis'.padEnd(14) + lambdas.map((l) => `λ=${l}`.padStart(9)).join('');
  console.log('  ' + header);
  AXES.forEach((axis, j) => {
    const row = results.map((r) => r.beta[j].toFixed(4).padStart(9)).join('');
    console.log('  ' + axis.padEnd(14) + row);
  });

  console.log('\n=== R² per lambda (in-sample — n=127, 11 predictors, expect some optimism) ===');
  for (const { lambda, beta } of results) {
    const pred = predict(Xs, beta).map((v) => v + yMean);
    console.log(`  λ=${lambda}: R²=${rSquared(yRaw, pred).toFixed(4)}`);
  }

  const olsBeta = results.find((r) => r.lambda === 0)!.beta;
  const r2Ols = rSquared(
    yRaw,
    predict(Xs, olsBeta).map((v) => v + yMean),
  );
  const n = rows.length;
  const p = AXES.length;
  const fStat = overallFStat(r2Ols, n, p);
  console.log(
    `\n=== Overall model significance (OLS, λ=0): F(${p},${n - p - 1})=${fStat.toFixed(3)} (critical ~1.88 at p<0.05) ===`,
  );
  console.log(fStat > 1.88 ? '  Model as a whole clears significance, barely.' : '  Model as a whole does NOT clear significance — individual coefficients below are not reliable.');

  const { se, t } = olsInference(Xs, yCentered, olsBeta);
  console.log('\n=== Per-axis OLS coefficient significance (|t|>~1.98 for p<0.05) ===');
  AXES.forEach((axis, j) => {
    const sig = Math.abs(t[j]) > 1.98 ? '  <-- significant' : '';
    console.log(`  ${axis.padEnd(14)} beta=${olsBeta[j].toFixed(4).padStart(8)}  SE=${se[j].toFixed(4)}  t=${t[j].toFixed(2).padStart(6)}${sig}`);
  });

  // Candidate weights from a moderate-lambda ridge fit (stable, not
  // over-shrunk) — reported as a proposal, not applied to
  // axis-weights.json automatically.
  const CANDIDATE_LAMBDA = 10;
  const candidateBeta = results.find((r) => r.lambda === CANDIDATE_LAMBDA)!.beta;
  console.log(`\n=== Candidate weights from λ=${CANDIDATE_LAMBDA} ridge (proposal only, not applied) ===`);
  const maxAbsBeta = Math.max(...candidateBeta.map((b) => Math.abs(b)));
  AXES.forEach((axis, j) => {
    const beta = candidateBeta[j];
    // Scale so the strongest predictor lands near 1.3 (this session's
    // highest manually-chosen weight so far, tempo) and preserve sign —
    // a negative beta here is a real, reportable finding, not something
    // to silently clip to 0.
    const scaledWeight = 1 + (beta / maxAbsBeta) * 0.3;
    console.log(`  ${axis.padEnd(14)} beta=${beta.toFixed(4).padStart(8)}  candidate weight=${scaledWeight.toFixed(3)}`);
  });
}

main();
