// Offline S1/S2/S3 candidates + nested validation (hero → self-play → pro).
// Never writes production permanently — patches axis-weights.json in a
// try/finally and restores. Child processes required (import-time bake).
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const DATA_DIR = path.join(__dirname, '..');
const WEIGHTS = path.join(DATA_DIR, 'data', 'axis-weights.json');
const STRUCTURE = path.join(DATA_DIR, 'data', 'axis-structure-analysis.json');
const B0 = path.join(DATA_DIR, 'data', 'axis-regression-b0.json');
const HEROES = path.join(DATA_DIR, 'data', 'heroes.json');
const HERO_META = path.join(DATA_DIR, 'data', 'hero-meta.json');
const OUT = path.join(DATA_DIR, 'data', 'axis-candidate-validation.json');
const WORKER = path.join(__dirname, 'run-axis-regression-b0-worker.ts');
const CALIBRATE = path.join(__dirname, 'calibrate-battle-engine.ts');

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

const N_MATCHES = Number(process.env.CAND_MATCHES ?? 80000);
const SEEDS = (process.env.CAND_SEEDS ?? '1,2,3').split(',').map(Number);
const PRO_FLOOR_DROP_PP = 1.5;

type WeightsFile = {
  axisWeights: Partial<Record<Axis, number>>;
  phaseWeights?: Partial<Record<'early' | 'late', Partial<Record<Axis, number>>>>;
  realWinRateWeight: number;
  [k: string]: unknown;
};

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
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

function effectiveMidWeight(w: WeightsFile, axis: Axis): number {
  if (axis === 'map_control') return w.axisWeights.map_control ?? 0;
  return w.axisWeights[axis] ?? 1;
}

function cloneWeights(w: WeightsFile): WeightsFile {
  return JSON.parse(JSON.stringify(w)) as WeightsFile;
}

/** S1: keep each factor's total mid budget; equal-share among members. Preserve late.scaling. */
function buildS1(base: WeightsFile, factors: string[][]): WeightsFile {
  const out = cloneWeights(base);
  for (const members of factors) {
    const budget = members.reduce((s, m) => s + effectiveMidWeight(base, m as Axis), 0);
    const share = budget / members.length;
    for (const m of members) {
      out.axisWeights[m as Axis] = Math.round(share * 1000) / 1000;
    }
  }
  // Dead axis stays dead — equal-share must not revive map_control from a mobility pair.
  out.axisWeights.map_control = base.axisWeights.map_control ?? 0;
  // Scale early/late combat-ish overrides proportionally to mid change (except late.scaling).
  for (const phase of ['early', 'late'] as const) {
    const pw = out.phaseWeights?.[phase];
    if (!pw) continue;
    for (const axis of AXES) {
      if (pw[axis] === undefined) continue;
      if (phase === 'late' && axis === 'scaling') continue;
      if (axis === 'map_control') {
        pw[axis] = out.axisWeights.map_control ?? 0;
        continue;
      }
      const mid0 = effectiveMidWeight(base, axis);
      const mid1 = effectiveMidWeight(out, axis);
      if (mid0 === 0) continue;
      pw[axis] = Math.round(((pw[axis] as number) * mid1) / mid0 * 1000) / 1000;
    }
  }
  return out;
}

/**
 * S2: hard budget on combat PC1 cluster (burst/teamfight/scaling/objectives/durability)
 * — redistribute their mid sum by |partial r| shares (floor epsilon), keep other axes.
 * late.scaling untouched.
 */
function buildS2(
  base: WeightsFile,
  combatMembers: Axis[],
  partialAbs: Record<string, number>,
): WeightsFile {
  const out = cloneWeights(base);
  const budget = combatMembers.reduce((s, m) => s + effectiveMidWeight(base, m), 0);
  const weights = combatMembers.map((m) => Math.max(0.02, Math.abs(partialAbs[m] ?? 0)));
  const wSum = weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < combatMembers.length; i++) {
    const m = combatMembers[i];
    out.axisWeights[m] = Math.round((budget * weights[i]) / wSum * 1000) / 1000;
  }
  for (const phase of ['early', 'late'] as const) {
    const pw = out.phaseWeights?.[phase];
    if (!pw) continue;
    for (const axis of combatMembers) {
      if (pw[axis] === undefined) continue;
      if (phase === 'late' && axis === 'scaling') continue;
      const mid0 = effectiveMidWeight(base, axis);
      const mid1 = effectiveMidWeight(out, axis);
      if (mid0 === 0) continue;
      pw[axis] = Math.round(((pw[axis] as number) * mid1) / mid0 * 1000) / 1000;
    }
  }
  return out;
}

/**
 * S3: not a weight patch — role-conditioned input note. Hero-level score:
 * residualize skirmish_rate within dominant position (z-score), correlate with winRate.
 * If this beats raw skirmish r, recommend percentileRankScaleByGroup refresh — no weight write.
 */
function evalS3HeroLevel(): Record<string, unknown> {
  const heroes = JSON.parse(fs.readFileSync(HEROES, 'utf-8')) as Array<{
    id: number;
    name: string;
    evaluation_values: Record<string, number>;
    presumed_positions?: Array<{ position: string; share: number }>;
  }>;
  const meta = JSON.parse(fs.readFileSync(HERO_META, 'utf-8')) as {
    heroes: Array<{
      heroId: number;
      winRate: number | null;
      positions?: Array<{ position: string; share: number }>;
    }>;
  };
  const wr = new Map(meta.heroes.map((h) => [h.heroId, h.winRate]));
  const posById = new Map(meta.heroes.map((h) => [h.heroId, h.positions ?? []]));
  for (const h of heroes) h.presumed_positions = posById.get(h.id) ?? [];

  function dominant(h: (typeof heroes)[0]): string {
    const ps = h.presumed_positions ?? [];
    if (ps.length === 0) return 'unknown';
    return [...ps].sort((a, b) => b.share - a.share)[0].position;
  }

  const rows = heroes
    .map((h) => ({
      h,
      wr: wr.get(h.id) ?? null,
      pos: dominant(h),
      sk: h.evaluation_values.skirmish_rate ?? 5,
    }))
    .filter((r) => r.wr !== null) as Array<{
    h: (typeof heroes)[0];
    wr: number;
    pos: string;
    sk: number;
  }>;

  const byPos: Record<string, typeof rows> = {};
  for (const r of rows) (byPos[r.pos] ??= []).push(r);

  const residual: number[] = [];
  const winRates: number[] = [];
  const raw: number[] = [];
  for (const [pos, list] of Object.entries(byPos)) {
    if (list.length < 4) continue;
    const m = mean(list.map((x) => x.sk));
    const sd = Math.sqrt(mean(list.map((x) => (x.sk - m) ** 2))) || 1;
    for (const x of list) {
      residual.push((x.sk - m) / sd);
      winRates.push(x.wr);
      raw.push(x.sk);
    }
  }
  const rRaw = pearson(raw, winRates);
  const rWithin = pearson(residual, winRates);
  return {
    description:
      'Within-position z-score of skirmish_rate vs winRate (S3 input-normalization probe)',
    n: winRates.length,
    rRawSkirmish: Math.round(rRaw * 1000) / 1000,
    rWithinPositionZ: Math.round(rWithin * 1000) / 1000,
    improves: Math.abs(rWithin) > Math.abs(rRaw) + 0.02,
    recommendation: Math.abs(rWithin) > Math.abs(rRaw) + 0.02
      ? 'Consider reinforcing role-group ranking for skirmish inputs (already partially used); not a weight change.'
      : 'No clear S3 win from within-position residualization on current scores — skip weight/input change.',
    positionMeans: Object.fromEntries(
      Object.entries(byPos).map(([p, list]) => [p, Math.round(mean(list.map((x) => x.sk)) * 100) / 100]),
    ),
  };
}

function spawnTs(script: string, env: Record<string, string> = {}): string {
  const result = spawnSync(process.execPath, ['-r', 'ts-node/register', script], {
    cwd: DATA_DIR,
    encoding: 'utf-8',
    env: { ...process.env, ...env },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${path.basename(script)} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout || '';
}

function parsePro(stdout: string): { directionHitRatePct: number | null; rawTail: string[] } {
  const m = stdout.match(/advantageDirection hit-rate[^:]*:\s*([\d.]+)%/i);
  return {
    directionHitRatePct: m ? Number(m[1]) : null,
    rawTail: stdout.trim().split('\n').slice(-25),
  };
}

function runHonestSelfPlay(label: string): {
  perSeed: Array<{ seed: number; rFavReal: number | null; avgAbsDivergencePp: number; flaggedCount: number }>;
  rMean: number;
  flaggedMean: number;
  flaggedNames: string[];
} {
  const perSeed = [];
  let flaggedNames: string[] = [];
  for (const seed of SEEDS) {
    const summaryPath = path.join(DATA_DIR, 'data', `axis-cand-${label}-seed${seed}.json`);
    const fullPath = path.join(DATA_DIR, 'data', `axis-cand-${label}-selfplay-seed${seed}.json`);
    spawnTs(WORKER, {
      B0_SEED: String(seed),
      B0_MATCHES: String(N_MATCHES),
      B0_WRITE_OUTPUT: seed === SEEDS[0] ? '1' : '0',
      B0_OUTPUT_PATH: fullPath,
      B0_SUMMARY_PATH: summaryPath,
    });
    const s = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
    perSeed.push(s);
    if (seed === SEEDS[0] && fs.existsSync(fullPath)) {
      const table = JSON.parse(fs.readFileSync(fullPath, 'utf-8')) as {
        heroTable: Array<{ name: string; divergenceFromReal: number | null }>;
      };
      flaggedNames = table.heroTable
        .filter((h) => h.divergenceFromReal !== null && Math.abs(h.divergenceFromReal!) >= 0.1)
        .map((h) => h.name)
        .sort();
    }
  }
  const rs = perSeed.map((r) => r.rFavReal).filter((v): v is number => v !== null);
  return {
    perSeed,
    rMean: mean(rs),
    flaggedMean: mean(perSeed.map((r) => r.flaggedCount)),
    flaggedNames,
  };
}

function heroLevelFactorR2(factors: string[][]): number {
  const heroes = JSON.parse(fs.readFileSync(HEROES, 'utf-8')) as Array<{
    id: number;
    evaluation_values: Record<string, number>;
  }>;
  const meta = JSON.parse(fs.readFileSync(HERO_META, 'utf-8')) as {
    heroes: Array<{ heroId: number; winRate: number | null }>;
  };
  const wr = new Map(meta.heroes.map((h) => [h.heroId, h.winRate]));
  const rows = heroes
    .map((h) => ({
      scores: factors.map((f) => mean(f.map((a) => h.evaluation_values[a] ?? 5))),
      y: wr.get(h.id),
    }))
    .filter((r) => r.y !== null) as Array<{ scores: number[]; y: number }>;
  const ys = rows.map((r) => r.y);
  const yMean = mean(ys);
  // simple multivariate least squares via normal eq on standardized X
  const X = rows.map((r) => r.scores);
  const cols = factors.map((_, j) => X.map((row) => row[j]));
  const means = cols.map((c) => mean(c));
  const sds = cols.map((c, j) => Math.sqrt(mean(c.map((v) => (v - means[j]) ** 2))) || 1);
  const Xs = X.map((row) => row.map((v, j) => (v - means[j]) / sds[j]));
  const p = factors.length;
  const XtX: number[][] = Array.from({ length: p }, () => Array(p).fill(0));
  const Xty: number[] = Array(p).fill(0);
  for (let i = 0; i < Xs.length; i++) {
    const yc = ys[i] - yMean;
    for (let a = 0; a < p; a++) {
      Xty[a] += Xs[i][a] * yc;
      for (let b = 0; b < p; b++) XtX[a][b] += Xs[i][a] * Xs[i][b];
    }
  }
  for (let a = 0; a < p; a++) XtX[a][a] += 1; // ridge λ=1
  // Gauss-Jordan
  const aug = XtX.map((row, i) => [...row, Xty[i]]);
  for (let col = 0; col < p; col++) {
    let piv = col;
    for (let r = col + 1; r < p; r++) if (Math.abs(aug[r][col]) > Math.abs(aug[piv][col])) piv = r;
    [aug[col], aug[piv]] = [aug[piv], aug[col]];
    const div = aug[col][col] || 1e-12;
    for (let j = 0; j <= p; j++) aug[col][j] /= div;
    for (let r = 0; r < p; r++) {
      if (r === col) continue;
      const f = aug[r][col];
      for (let j = 0; j <= p; j++) aug[r][j] -= f * aug[col][j];
    }
  }
  const beta = aug.map((row) => row[p]);
  const pred = Xs.map((row) => yMean + row.reduce((s, v, j) => s + v * beta[j], 0));
  const ssTot = ys.reduce((s, y) => s + (y - yMean) ** 2, 0);
  const ssRes = ys.reduce((s, y, i) => s + (y - pred[i]) ** 2, 0);
  return Math.round((1 - ssRes / ssTot) * 1000) / 1000;
}

function main(): void {
  if (!fs.existsSync(STRUCTURE)) {
    throw new Error('Run analyze-axis-structure.ts first');
  }
  const structure = JSON.parse(fs.readFileSync(STRUCTURE, 'utf-8')) as {
    hierarchicalClusters: { k6: string[][] };
    partialCorrWithWinRate_ctrlAxisSum: Record<string, number>;
  };
  const factorsK6 = structure.hierarchicalClusters.k6;
  const partial = structure.partialCorrWithWinRate_ctrlAxisSum;
  const combatCluster: Axis[] = [
    'burst',
    'teamfight',
    'scaling',
    'objectives',
    'durability',
  ];

  const original = fs.readFileSync(WEIGHTS, 'utf-8');
  const base = JSON.parse(original) as WeightsFile;
  const productionWeight = base.realWinRateWeight;

  const s1 = buildS1(base, factorsK6);
  const s2 = buildS2(base, combatCluster, partial);
  s1.realWinRateWeight = 0;
  s2.realWinRateWeight = 0;

  const b0 = fs.existsSync(B0)
    ? (JSON.parse(fs.readFileSync(B0, 'utf-8')) as {
        honestSelfPlay: { rMean: number; flaggedMean: number; flaggedHeroesSeed1: Array<{ name: string }> };
        proMatchCalibrate: { directionHitRatePct: string | null };
      })
    : null;

  const b0Flagged = new Set(b0?.honestSelfPlay.flaggedHeroesSeed1.map((h) => h.name) ?? []);
  const b0Pro = b0?.proMatchCalibrate.directionHitRatePct
    ? Number(b0.proMatchCalibrate.directionHitRatePct)
    : null;

  const results: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    nMatchesPerSeed: N_MATCHES,
    seeds: SEEDS,
    factorsUsed: factorsK6,
    heroLevel: {
      S1FactorEqualShareR2: heroLevelFactorR2(factorsK6),
      S2_note: 'S2 is weight redistribution only; hero-level uses same factor scores as S1',
      S3: evalS3HeroLevel(),
    },
    weightDiffs: {
      S1_mid: Object.fromEntries(
        AXES.map((a) => [
          a,
          {
            from: effectiveMidWeight(base, a),
            to: effectiveMidWeight(s1, a),
          },
        ]),
      ),
      S2_mid: Object.fromEntries(
        combatCluster.map((a) => [
          a,
          {
            from: effectiveMidWeight(base, a),
            to: effectiveMidWeight(s2, a),
          },
        ]),
      ),
    },
    b0Reference: b0
      ? {
          rMean: b0.honestSelfPlay.rMean,
          flaggedMean: b0.honestSelfPlay.flaggedMean,
          directionHitRatePct: b0Pro,
          flaggedCoreCount: b0Flagged.size,
        }
      : null,
    candidates: {} as Record<string, unknown>,
  };

  try {
    // Always honest
    base.realWinRateWeight = 0;

    for (const [label, cfg] of [
      ['S1', s1],
      ['S2', s2],
    ] as const) {
      console.log(`\n=== Candidate ${label} ===`);
      fs.writeFileSync(WEIGHTS, JSON.stringify(cfg, null, 2) + '\n');
      const sp = runHonestSelfPlay(label);
      const pro = parsePro(spawnTs(CALIBRATE));
      const coreRemain =
        b0Flagged.size === 0
          ? null
          : sp.flaggedNames.filter((n) => b0Flagged.has(n)).length;
      const proDrop =
        b0Pro !== null && pro.directionHitRatePct !== null
          ? b0Pro - pro.directionHitRatePct
          : null;
      const rImprove = b0 ? sp.rMean - b0.honestSelfPlay.rMean : null;
      const flaggedOk =
        b0 === null ? null : sp.flaggedMean <= b0.honestSelfPlay.flaggedMean + 0.5;
      const proOk = proDrop === null ? null : proDrop <= PRO_FLOOR_DROP_PP;
      const pass =
        rImprove !== null && rImprove > 0.005 && flaggedOk === true && proOk === true;

      (results.candidates as Record<string, unknown>)[label] = {
        selfPlay: sp,
        proDirectionPct: pro.directionHitRatePct,
        proTail: pro.rawTail,
        vsB0: {
          rDelta: rImprove,
          flaggedCoreRemaining: coreRemain,
          flaggedCoreTotalB0: b0Flagged.size,
          proDropPp: proDrop,
          passStopCriteria: pass,
        },
      };
      console.log(
        `${label}: r=${sp.rMean.toFixed(3)} flagged≈${sp.flaggedMean.toFixed(1)} proDir=${pro.directionHitRatePct}% pass=${pass}`,
      );
    }

    // S3 has no weight run
    (results.candidates as Record<string, unknown>).S3 = {
      selfPlay: null,
      note: 'Input-normalization candidate — hero-level only in this run',
      heroLevel: (results.heroLevel as { S3: unknown }).S3,
      vsB0: { passStopCriteria: false, reason: 'no weight change proposed without stronger signal' },
    };
  } finally {
    fs.writeFileSync(WEIGHTS, original);
    console.log(`\naxis-weights.json restored (production realWinRateWeight=${productionWeight})`);
  }

  // Verdict
  const cand = results.candidates as Record<
    string,
    { vsB0?: { passStopCriteria?: boolean }; selfPlay?: { rMean: number } }
  >;
  const winners = ['S1', 'S2'].filter((k) => cand[k]?.vsB0?.passStopCriteria);
  results.verdict = {
    winners,
    recommendation:
      winners.length === 0
        ? 'No candidate meets stop criteria (honest r↑ AND flagged core not worse AND pro not −>1.5pp). Do not write axis-weights.json. Prefer new predictors (Phase 3) over weight reshuffles.'
        : `Candidate(s) ${winners.join(', ')} meet stop criteria offline — REQUIRES user approve before writing axis-weights.json (Calibration Change Rule).`,
    applyGate: 'blocked_pending_user_approve',
  };

  fs.writeFileSync(OUT, JSON.stringify(results, null, 2) + '\n');
  console.log(`\nWrote ${OUT}`);
  console.log(JSON.stringify(results.verdict, null, 2));
}

main();
