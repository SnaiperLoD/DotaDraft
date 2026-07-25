import * as fs from 'fs';
import * as path from 'path';

// Follow-up to regress-axis-weights.ts: that regression's F-test came back
// non-significant (F(11,115)=1.850 vs critical ~1.88) — 127 heroes isn't
// enough data to fit 11 collinear predictors reliably. This script groups
// the 11 raw axes into 6 composites (Blueprint/10-tech-debt-backlog.md) —
// four merged pairs grounded in the correlation matrix regress-axis-
// weights.ts already found (burst<->teamfight r=0.782, objectives<->
// scaling r=0.549; mobility<->initiating r=0.287 and saving<->map_control
// r=0.226 are weaker, more thematic than statistical), plus durability and
// control left standalone since they're the least collinear with
// everything else (durability<->control r=-0.210). Fewer, less collinear
// predictors should both raise the predictor-to-n ratio and lower VIF.
//
// Reads raw evaluation_values directly from heroes.json, same as
// regress-axis-weights.ts — these are NOT run through axis-weights.json's
// runtime multipliers (tempo/durability/objectives/burst/saving/
// map_control), which only apply at Battle/Evaluation Engine's aggregation
// step, never touch the stored per-hero calibration. So this was already
// measuring "clean impact" before any of this session's manual weight
// tuning, with or without this composite regrouping.
const HEROES_PATH = path.join(__dirname, '..', 'data', 'heroes.json');
const HERO_META_PATH = path.join(__dirname, '..', 'data', 'hero-meta.json');

const COMPOSITE_GROUPS: Record<string, string[]> = {
  damage_dealing: ['burst', 'teamfight'],
  movement: ['mobility', 'initiating'],
  pushing_power: ['objectives', 'scaling'],
  supporting: ['saving', 'map_control'],
  durability: ['durability'],
  control: ['control'],
};
const COMPOSITES = Object.keys(COMPOSITE_GROUPS);
const TEMPO_STANDALONE = 'tempo'; // not part of the user's grouping — kept as its own predictor, not dropped

interface Hero {
  id: number;
  name: string;
  evaluation_values: Record<string, number>;
}

// ---------- minimal linear algebra (same as regress-axis-weights.ts) ----------

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

function standardizeColumns(X: Matrix): Matrix {
  const cols = transpose(X);
  const means = cols.map((c) => mean(c));
  const sds = cols.map((c, j) => stdev(c, means[j]));
  const standardizedCols = cols.map((c, j) => c.map((v) => (sds[j] === 0 ? 0 : (v - means[j]) / sds[j])));
  return transpose(standardizedCols);
}

function ridgeRegress(X: Matrix, y: number[], lambda: number): number[] {
  const Xt = transpose(X);
  const XtX = matMul(Xt, X);
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

function overallFStat(r2: number, n: number, p: number): number {
  return r2 / p / ((1 - r2) / (n - p - 1));
}

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

  const predictorLabels = [...COMPOSITES, TEMPO_STANDALONE];
  console.log(`n=${rows.length} heroes, ${predictorLabels.length} predictors (down from 11): ${predictorLabels.join(', ')}\n`);
  for (const [composite, members] of Object.entries(COMPOSITE_GROUPS)) {
    if (members.length > 1) console.log(`  ${composite} = mean(${members.join(', ')})`);
  }
  console.log('');

  const X: Matrix = rows.map((r) =>
    predictorLabels.map((label) => {
      if (label === TEMPO_STANDALONE) return r.hero.evaluation_values.tempo;
      const members = COMPOSITE_GROUPS[label];
      return mean(members.map((m) => r.hero.evaluation_values[m]));
    }),
  );
  const yRaw = rows.map((r) => r.winRate);

  const Xs = standardizeColumns(X);
  const yMean = mean(yRaw);
  const yCentered = yRaw.map((v) => v - yMean);

  console.log('=== Variance Inflation Factors (>5 concerning, >10 severe) ===');
  const vif = varianceInflationFactors(Xs, predictorLabels);
  for (const label of predictorLabels) {
    const flag = vif[label] > 10 ? '  <-- SEVERE' : vif[label] > 5 ? '  <-- concerning' : '';
    console.log(`  ${label.padEnd(16)} ${vif[label].toFixed(2)}${flag}`);
  }

  const lambdas = [0, 1, 5, 10];
  const results = lambdas.map((lambda) => ({ lambda, beta: ridgeRegress(Xs, yCentered, lambda) }));

  console.log('\n=== OLS (lambda=0) vs Ridge ===');
  const header = 'predictor'.padEnd(16) + lambdas.map((l) => `λ=${l}`.padStart(9)).join('');
  console.log('  ' + header);
  predictorLabels.forEach((label, j) => {
    const row = results.map((r) => r.beta[j].toFixed(4).padStart(9)).join('');
    console.log('  ' + label.padEnd(16) + row);
  });

  const olsBeta = results.find((r) => r.lambda === 0)!.beta;
  const r2Ols = rSquared(
    yRaw,
    predict(Xs, olsBeta).map((v) => v + yMean),
  );
  const n = rows.length;
  const p = predictorLabels.length;
  const fStat = overallFStat(r2Ols, n, p);
  console.log(`\n=== R²=${r2Ols.toFixed(4)}  |  F(${p},${n - p - 1})=${fStat.toFixed(3)} (critical ~2.18 at p<0.05) ===`);
  console.log(fStat > 2.18 ? '  Model as a whole IS significant.' : '  Model as a whole is still not significant.');

  const { se, t } = olsInference(Xs, yCentered, olsBeta);
  console.log('\n=== Per-predictor OLS significance (|t|>~1.98 for p<0.05) ===');
  predictorLabels.forEach((label, j) => {
    const sig = Math.abs(t[j]) > 1.98 ? '  <-- significant' : '';
    console.log(
      `  ${label.padEnd(16)} beta=${olsBeta[j].toFixed(4).padStart(8)}  SE=${se[j].toFixed(4)}  t=${t[j].toFixed(2).padStart(6)}${sig}`,
    );
  });

  const CANDIDATE_LAMBDA = 5;
  const candidateBeta = results.find((r) => r.lambda === CANDIDATE_LAMBDA)!.beta;
  console.log(`\n=== Candidate weights from λ=${CANDIDATE_LAMBDA} ridge (proposal only, not applied) ===`);
  const maxAbsBeta = Math.max(...candidateBeta.map((b) => Math.abs(b)));
  predictorLabels.forEach((label, j) => {
    const beta = candidateBeta[j];
    const scaledWeight = 1 + (beta / maxAbsBeta) * 0.3;
    console.log(`  ${label.padEnd(16)} beta=${beta.toFixed(4).padStart(8)}  candidate weight=${scaledWeight.toFixed(3)}`);
  });
}

main();
