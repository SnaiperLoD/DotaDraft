// Axis structure analysis (Phase 1 of axis-regression plan).
// Correlation matrix, PCA, hierarchical clustering, partial correlations
 // with realWinRate controlling for axisSum, VIF on current Battle AXES.
// Read-only w.r.t. axis-weights.json — writes JSON report only.
import * as fs from 'fs';
import * as path from 'path';

const HEROES_PATH = path.join(__dirname, '..', 'data', 'heroes.json');
const HERO_META_PATH = path.join(__dirname, '..', 'data', 'hero-meta.json');
const OUT = path.join(__dirname, '..', 'data', 'axis-structure-analysis.json');

// Must match battle-resolution.ts AXES (Battle Engine combat axes).
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
  'skirmish_rate',
  'camp_stacking',
] as const;
type Axis = (typeof AXES)[number];

// Hand composites from regress-composite-clusters.ts (for comparison).
const HAND_COMPOSITES: Record<string, string[]> = {
  damage_dealing: ['burst', 'teamfight'],
  movement: ['mobility', 'initiating'],
  pushing_power: ['objectives', 'scaling'],
  supporting: ['saving', 'map_control'],
  durability: ['durability'],
  control: ['control'],
  tempo: ['tempo'],
  skirmish_rate: ['skirmish_rate'],
  camp_stacking: ['camp_stacking'],
};

type Matrix = number[][];

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function stdev(xs: number[], m = mean(xs)): number {
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}
function pearson(a: number[], b: number[]): number {
  const ma = mean(a);
  const mb = mean(b);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  const den = Math.sqrt(da * db);
  return den === 0 ? 0 : num / den;
}
function transpose(m: Matrix): Matrix {
  return m[0].map((_, j) => m.map((row) => row[j]));
}
function matMul(a: Matrix, b: Matrix): Matrix {
  const result: Matrix = Array.from({ length: a.length }, () => new Array(b[0].length).fill(0));
  for (let i = 0; i < a.length; i++) {
    for (let k = 0; k < a[0].length; k++) {
      const aik = a[i][k];
      if (aik === 0) continue;
      for (let j = 0; j < b[0].length; j++) result[i][j] += aik * b[k][j];
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
    if (Math.abs(aug[pivotRow][col]) < 1e-10) throw new Error(`singular at ${col}`);
    [aug[col], aug[pivotRow]] = [aug[pivotRow], aug[col]];
    const pivot = aug[col][col];
    for (let j = 0; j < 2 * n; j++) aug[col][j] /= pivot;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = aug[r][col];
      if (f === 0) continue;
      for (let j = 0; j < 2 * n; j++) aug[r][j] -= f * aug[col][j];
    }
  }
  return aug.map((row) => row.slice(n));
}
function ridgeRegress(X: Matrix, y: number[], lambda: number): number[] {
  const Xt = transpose(X);
  const XtX = matMul(Xt, X);
  const penalized = XtX.map((row, i) => row.map((v, j) => (i === j ? v + lambda : v)));
  const XtY = matMul(
    Xt,
    y.map((v) => [v]),
  );
  return matMul(invert(penalized), XtY).map((r) => r[0]);
}
function predict(X: Matrix, beta: number[]): number[] {
  return X.map((row) => row.reduce((s, v, j) => s + v * beta[j], 0));
}
function rSquared(yTrue: number[], yPred: number[]): number {
  const yMean = mean(yTrue);
  const ssRes = yTrue.reduce((s, y, i) => s + (y - yPred[i]) ** 2, 0);
  const ssTot = yTrue.reduce((s, y) => s + (y - yMean) ** 2, 0);
  return 1 - ssRes / ssTot;
}

function standardizeColumns(X: Matrix): Matrix {
  const cols = transpose(X);
  return transpose(
    cols.map((c) => {
      const m = mean(c);
      const sd = stdev(c, m);
      return c.map((v) => (sd === 0 ? 0 : (v - m) / sd));
    }),
  );
}

/** Jacobi eigen-decomposition for symmetric matrices (correlation / cov). */
function jacobiEigen(Ain: Matrix, maxIter = 200): { values: number[]; vectors: Matrix } {
  const n = Ain.length;
  const A = Ain.map((r) => [...r]);
  const V: Matrix = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  );
  for (let iter = 0; iter < maxIter; iter++) {
    let p = 0;
    let q = 1;
    let max = Math.abs(A[0][1]);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const v = Math.abs(A[i][j]);
        if (v > max) {
          max = v;
          p = i;
          q = j;
        }
      }
    }
    if (max < 1e-12) break;
    const app = A[p][p];
    const aqq = A[q][q];
    const apq = A[p][q];
    const theta = 0.5 * Math.atan2(2 * apq, aqq - app);
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    for (let i = 0; i < n; i++) {
      if (i === p || i === q) continue;
      const aip = A[i][p];
      const aiq = A[i][q];
      A[i][p] = A[p][i] = c * aip - s * aiq;
      A[i][q] = A[q][i] = s * aip + c * aiq;
    }
    A[p][p] = c * c * app - 2 * s * c * apq + s * s * aqq;
    A[q][q] = s * s * app + 2 * s * c * apq + c * c * aqq;
    A[p][q] = A[q][p] = 0;
    for (let i = 0; i < n; i++) {
      const vip = V[i][p];
      const viq = V[i][q];
      V[i][p] = c * vip - s * viq;
      V[i][q] = s * vip + c * viq;
    }
  }
  const values = A.map((row, i) => row[i]);
  const order = values.map((_, i) => i).sort((a, b) => values[b] - values[a]);
  return {
    values: order.map((i) => values[i]),
    vectors: order.map((j) => V.map((row) => row[j])),
  };
}

function hierarchicalClusters(
  labels: readonly string[],
  dist: Matrix,
  targetK: number,
): { clusters: string[][]; mergeHistory: Array<{ a: string; b: string; dist: number }> } {
  // Average-linkage agglomerative clustering.
  type Node = { members: number[]; label: string };
  const nodes: Node[] = labels.map((l, i) => ({ members: [i], label: l }));
  const active = new Set(nodes.map((_, i) => i));
  const mergeHistory: Array<{ a: string; b: string; dist: number }> = [];
  let nextId = nodes.length;

  function avgDist(a: Node, b: Node): number {
    let s = 0;
    let n = 0;
    for (const i of a.members) {
      for (const j of b.members) {
        s += dist[Math.min(i, j)][Math.max(i, j)] ?? dist[i][j];
        n++;
      }
    }
    return s / n;
  }

  while (active.size > targetK) {
    const ids = [...active];
    let bestA = ids[0];
    let bestB = ids[1];
    let bestD = Infinity;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const d = avgDist(nodes[ids[i]], nodes[ids[j]]);
        if (d < bestD) {
          bestD = d;
          bestA = ids[i];
          bestB = ids[j];
        }
      }
    }
    const a = nodes[bestA];
    const b = nodes[bestB];
    mergeHistory.push({ a: a.label, b: b.label, dist: bestD });
    const merged: Node = {
      members: [...a.members, ...b.members],
      label: `(${a.label}+${b.label})`,
    };
    nodes.push(merged);
    active.delete(bestA);
    active.delete(bestB);
    active.add(nextId++);
  }

  const clusters = [...active].map((id) =>
    nodes[id].members.map((mi) => labels[mi]).sort(),
  );
  return { clusters, mergeHistory };
}

function partialCorr(x: number[], y: number[], z: number[]): number {
  // corr(x,y | z) via residuals of x~z and y~z.
  const mz = mean(z);
  const mx = mean(x);
  const my = mean(y);
  let numXZ = 0;
  let denZ = 0;
  let numYZ = 0;
  for (let i = 0; i < z.length; i++) {
    const dz = z[i] - mz;
    denZ += dz * dz;
    numXZ += (x[i] - mx) * dz;
    numYZ += (y[i] - my) * dz;
  }
  const bx = denZ === 0 ? 0 : numXZ / denZ;
  const by = denZ === 0 ? 0 : numYZ / denZ;
  const rx = x.map((v, i) => v - (mx + bx * (z[i] - mz)));
  const ry = y.map((v, i) => v - (my + by * (z[i] - mz)));
  return pearson(rx, ry);
}

function dominantPosition(h: {
  presumed_positions?: { position: string; share: number }[];
}): string {
  const top = [...(h.presumed_positions ?? [])].sort((a, b) => b.share - a.share)[0];
  return top?.position ?? 'Unknown';
}

function main(): void {
  const heroes: Array<{
    id: number;
    name: string;
    evaluation_values: Record<string, number>;
    presumed_positions?: { position: string; share: number }[];
  }> = JSON.parse(fs.readFileSync(HEROES_PATH, 'utf-8'));
  const meta = JSON.parse(fs.readFileSync(HERO_META_PATH, 'utf-8')) as {
    heroes: { heroId: number; winRate: number | null; positions?: { position: string; share: number }[] }[];
  };
  const winById = new Map(meta.heroes.map((e) => [e.heroId, e.winRate]));
  const posById = new Map(meta.heroes.map((e) => [e.heroId, e.positions ?? []]));
  for (const h of heroes) h.presumed_positions = posById.get(h.id) ?? [];

  const rows = heroes
    .map((h) => ({ hero: h, winRate: winById.get(h.id) ?? null }))
    .filter((r): r is { hero: (typeof heroes)[0]; winRate: number } => r.winRate !== null);

  const n = rows.length;
  console.log(`n=${n} heroes with winRate\n`);

  // --- correlation matrix ---
  const cols: Record<Axis, number[]> = Object.fromEntries(
    AXES.map((a) => [a, rows.map((r) => r.hero.evaluation_values[a] ?? 5)]),
  ) as Record<Axis, number[]>;
  const winRates = rows.map((r) => r.winRate);
  const axisSums = rows.map((r) => AXES.reduce((s, a) => s + (r.hero.evaluation_values[a] ?? 5), 0));

  const corr: Record<string, Record<string, number>> = {};
  for (const a of AXES) {
    corr[a] = {};
    for (const b of AXES) corr[a][b] = Math.round(pearson(cols[a], cols[b]) * 1000) / 1000;
  }

  const simpleR: Record<string, number> = {};
  const partialR: Record<string, number> = {};
  for (const a of AXES) {
    simpleR[a] = Math.round(pearson(cols[a], winRates) * 1000) / 1000;
    partialR[a] = Math.round(partialCorr(cols[a], winRates, axisSums) * 1000) / 1000;
  }

  // --- VIF ---
  const X = standardizeColumns(rows.map((r) => AXES.map((a) => r.hero.evaluation_values[a] ?? 5)));
  const vif: Record<string, number> = {};
  for (let j = 0; j < AXES.length; j++) {
    const others = X.map((row) => row.filter((_, k) => k !== j));
    const target = transpose(X)[j];
    const beta = ridgeRegress(others, target, 0);
    const r2 = rSquared(target, predict(others, beta));
    vif[AXES[j]] = Math.round((1 / Math.max(1e-6, 1 - r2)) * 100) / 100;
  }

  // --- PCA ---
  const corrMat: Matrix = AXES.map((a) => AXES.map((b) => corr[a][b]));
  const { values: eigVals, vectors: eigVecs } = jacobiEigen(corrMat);
  const totalVar = eigVals.reduce((s, v) => s + Math.max(0, v), 0);
  let cum = 0;
  const components = eigVals.map((v, i) => {
    const ev = Math.max(0, v);
    cum += ev;
    const loadings: Record<string, number> = {};
    AXES.forEach((a, j) => {
      loadings[a] = Math.round(eigVecs[i][j] * Math.sqrt(ev) * 1000) / 1000;
    });
    const top = Object.entries(loadings)
      .sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]))
      .slice(0, 5);
    return {
      index: i + 1,
      eigenvalue: Math.round(ev * 1000) / 1000,
      varianceShare: Math.round((ev / totalVar) * 1000) / 1000,
      cumulativeShare: Math.round((cum / totalVar) * 1000) / 1000,
      topLoadings: top,
      loadings,
    };
  });

  const k80 = components.findIndex((c) => c.cumulativeShare >= 0.8) + 1;
  const k90 = components.findIndex((c) => c.cumulativeShare >= 0.9) + 1;

  // --- hierarchical clustering on 1-|r| ---
  const dist: Matrix = AXES.map((a, i) =>
    AXES.map((b, j) => (i === j ? 0 : 1 - Math.abs(corr[a][b]))),
  );
  const clusterResults: Record<string, string[][]> = {};
  for (const k of [4, 5, 6]) {
    clusterResults[`k${k}`] = hierarchicalClusters(AXES, dist, k).clusters;
  }
  const { mergeHistory } = hierarchicalClusters(AXES, dist, 1);

  // Factor map proposal: take k=5 clusters + label by strongest |simpleR| member / PCA PC1 alignment
  const proposedFactors = clusterResults.k5.map((members, idx) => {
    const bestSignal = [...members].sort(
      (a, b) => Math.abs(partialR[b as Axis] ?? 0) - Math.abs(partialR[a as Axis] ?? 0),
    )[0];
    const avgAbsPartial =
      members.reduce((s, m) => s + Math.abs(partialR[m as Axis] ?? 0), 0) / members.length;
    return {
      id: `F${idx + 1}`,
      members,
      anchor: bestSignal,
      meanAbsPartialR: Math.round(avgAbsPartial * 1000) / 1000,
      handCompositeOverlap: Object.entries(HAND_COMPOSITES)
        .map(([name, hs]) => ({
          name,
          overlap: hs.filter((h) => members.includes(h)).length,
          handSize: hs.length,
        }))
        .filter((o) => o.overlap > 0),
    };
  });

  // Compare hand composites: within-group mean |r| vs cross-group
  const handQuality = Object.entries(HAND_COMPOSITES).map(([name, members]) => {
    const present = members.filter((m) => (AXES as readonly string[]).includes(m));
    let within = 0;
    let wn = 0;
    for (let i = 0; i < present.length; i++) {
      for (let j = i + 1; j < present.length; j++) {
        within += Math.abs(corr[present[i] as Axis][present[j] as Axis]);
        wn++;
      }
    }
    return {
      name,
      members: present,
      meanAbsWithinCorr: wn === 0 ? null : Math.round((within / wn) * 1000) / 1000,
      simpleRMembers: Object.fromEntries(present.map((m) => [m, simpleR[m as Axis]])),
      partialRMembers: Object.fromEntries(present.map((m) => [m, partialR[m as Axis]])),
    };
  });

  // Position × axis means (for role-conditioned bias hints / S3)
  const byPos: Record<string, typeof rows> = {};
  for (const r of rows) {
    const p = dominantPosition(r.hero);
    (byPos[p] ??= []).push(r);
  }
  const axisMeansByPosition: Record<string, Record<string, number>> = {};
  for (const [pos, list] of Object.entries(byPos)) {
    axisMeansByPosition[pos] = Object.fromEntries(
      AXES.map((a) => [
        a,
        Math.round(mean(list.map((r) => r.hero.evaluation_values[a] ?? 5)) * 100) / 100,
      ]),
    );
  }

  // S1 candidate: equal-share within proposed factors — factor-level OLS on winRate
  const factorScores: number[][] = rows.map((r) =>
    proposedFactors.map((f) => mean(f.members.map((m) => r.hero.evaluation_values[m] ?? 5))),
  );
  const Fs = standardizeColumns(factorScores);
  const yMean = mean(winRates);
  const yC = winRates.map((v) => v - yMean);
  const factorBeta = ridgeRegress(Fs, yC, 1);
  const factorPred = predict(Fs, factorBeta).map((v) => v + yMean);
  const factorR2 = rSquared(winRates, factorPred);

  // Leave-position-out CV for factor model
  const positions = [...new Set(rows.map((r) => dominantPosition(r.hero)))];
  const cvFolds = positions.map((hold) => {
    const trainIdx = rows.map((r, i) => (dominantPosition(r.hero) !== hold ? i : -1)).filter((i) => i >= 0);
    const testIdx = rows.map((r, i) => (dominantPosition(r.hero) === hold ? i : -1)).filter((i) => i >= 0);
    if (trainIdx.length < 20 || testIdx.length < 3) {
      return { hold, nTest: testIdx.length, r: null as number | null };
    }
    const Xtr = standardizeColumns(trainIdx.map((i) => factorScores[i]));
    const ytr = trainIdx.map((i) => winRates[i]);
    const ym = mean(ytr);
    const beta = ridgeRegress(
      Xtr,
      ytr.map((v) => v - ym),
      1,
    );
    // apply train scaling roughly: re-standardize test with train means — simplified: use raw scores + beta from standardized train is imperfect; use pearson of predicted rank
    const Xte = testIdx.map((i) => factorScores[i]);
    // Fit on raw train factors for transferability
    const XtrRaw = standardizeColumns(trainIdx.map((i) => factorScores[i]));
    const betaRaw = ridgeRegress(
      XtrRaw,
      trainIdx.map((i) => winRates[i] - ym),
      1,
    );
    const testCols = transpose(Xte);
    const trainCols = transpose(trainIdx.map((i) => factorScores[i]));
    const tMeans = trainCols.map((c) => mean(c));
    const tSds = trainCols.map((c, j) => stdev(c, tMeans[j]));
    const XteS = Xte.map((row) =>
      row.map((v, j) => (tSds[j] === 0 ? 0 : (v - tMeans[j]) / tSds[j])),
    );
    const pred = predict(XteS, betaRaw).map((v) => v + ym);
    const actual = testIdx.map((i) => winRates[i]);
    return { hold, nTest: testIdx.length, r: Math.round(pearson(pred, actual) * 1000) / 1000 };
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    n,
    axes: [...AXES],
    correlation: corr,
    simpleCorrWithWinRate: simpleR,
    partialCorrWithWinRate_ctrlAxisSum: partialR,
    vif,
    pca: {
      componentsTo80pct: k80,
      componentsTo90pct: k90,
      components: components.slice(0, 8),
    },
    hierarchicalClusters: clusterResults,
    mergeHistoryTail: mergeHistory.slice(-12),
    proposedFactors,
    handCompositeQuality: handQuality,
    axisMeansByPosition,
    candidateS1FactorEqualShare: {
      description:
        'Mean within data-driven k=5 clusters; ridge λ=1 on standardized factor scores → winRate',
      factorLabels: proposedFactors.map((f) => f.id + ':' + f.members.join('+')),
      ridgeBeta: factorBeta.map((b) => Math.round(b * 1000) / 1000),
      inSampleR2: Math.round(factorR2 * 1000) / 1000,
      leavePositionOutPearson: cvFolds,
    },
    notes: [
      'Do NOT copy multivariate OLS axis betas into axis-weights (suppression lesson).',
      'Prefer partial r and simple r over multivariate t for deciding which axes carry independent signal.',
      'map_control is in AXES but Battle weight is 0 — expect near-zero decision influence.',
    ],
  };

  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n');
  console.log('=== Simple r (axis ↔ winRate) ===');
  for (const a of [...AXES].sort((x, y) => Math.abs(simpleR[y]) - Math.abs(simpleR[x]))) {
    console.log(`  ${a.padEnd(14)} r=${simpleR[a].toFixed(3)}  partial=${partialR[a].toFixed(3)}  VIF=${vif[a]}`);
  }
  console.log(`\nPCA: ${k80} comps ≥80% var, ${k90} ≥90%`);
  console.log('\nProposed factors (k=5 clusters):');
  for (const f of proposedFactors) {
    console.log(`  ${f.id}: [${f.members.join(', ')}] anchor=${f.anchor} |partial|≈${f.meanAbsPartialR}`);
  }
  console.log(`\nS1 factor model in-sample R²=${factorR2.toFixed(3)}`);
  console.log(`Wrote ${OUT}`);
}

main();
