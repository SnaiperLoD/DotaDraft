// Refined weight trials after failed S1/S2 equal-share.
// Data-driven from factor map: camp_stacking has partial r≈−0.25 while
 // still positively weighted; do NOT dilute skirmish_rate / saving.
// Child-process self-play (import-time bake). Restores weights in finally.
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const DATA_DIR = path.join(__dirname, '..');
const WEIGHTS = path.join(DATA_DIR, 'data', 'axis-weights.json');
const B0 = path.join(DATA_DIR, 'data', 'axis-regression-b0.json');
const OUT = path.join(DATA_DIR, 'data', 'axis-weight-trials.json');
const WORKER = path.join(__dirname, 'run-axis-regression-b0-worker.ts');
const CALIBRATE = path.join(__dirname, 'calibrate-battle-engine.ts');

const N_MATCHES = Number(process.env.TRIAL_MATCHES ?? 80000);
const SEEDS = (process.env.TRIAL_SEEDS ?? '1,2,3').split(',').map(Number);
const PRO_FLOOR_DROP_PP = 1.5;

type WeightsFile = {
  axisWeights: Record<string, number>;
  phaseWeights?: {
    early?: Record<string, number>;
    late?: Record<string, number>;
  };
  realWinRateWeight: number;
  [k: string]: unknown;
};

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
}

function setCampStacking(base: WeightsFile, mid: number): WeightsFile {
  const w = clone(base);
  const mid0 = base.axisWeights.camp_stacking ?? 0.5;
  w.axisWeights.camp_stacking = mid;
  if (w.phaseWeights?.early?.camp_stacking !== undefined && mid0 > 0) {
    w.phaseWeights.early.camp_stacking =
      Math.round((w.phaseWeights.early.camp_stacking * mid) / mid0 * 1000) / 1000;
  } else if (w.phaseWeights?.early) {
    w.phaseWeights.early.camp_stacking = mid;
  }
  if (w.phaseWeights?.late?.camp_stacking !== undefined && mid0 > 0) {
    w.phaseWeights.late.camp_stacking =
      Math.round((w.phaseWeights.late.camp_stacking * mid) / mid0 * 1000) / 1000;
  } else if (w.phaseWeights?.late) {
    w.phaseWeights.late.camp_stacking = mid;
  }
  return w;
}

/** Equal-share only pure combat five; leave skirmish/saving/tempo/camp untouched. */
function combatEqualShare(base: WeightsFile): WeightsFile {
  const combat = ['burst', 'teamfight', 'scaling', 'objectives', 'durability'] as const;
  const w = clone(base);
  const budget = combat.reduce((s, a) => s + (base.axisWeights[a] ?? 1), 0);
  const share = Math.round((budget / combat.length) * 1000) / 1000;
  for (const a of combat) {
    const mid0 = base.axisWeights[a] ?? 1;
    w.axisWeights[a] = share;
    for (const phase of ['early', 'late'] as const) {
      const pw = w.phaseWeights?.[phase];
      if (!pw || pw[a] === undefined) continue;
      if (phase === 'late' && a === 'scaling') continue;
      if (mid0 === 0) continue;
      pw[a] = Math.round((pw[a] * share) / mid0 * 1000) / 1000;
    }
  }
  return w;
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

function parsePro(stdout: string): number | null {
  const m = stdout.match(/advantageDirection hit-rate[^:]*:\s*([\d.]+)%/i);
  return m ? Number(m[1]) : null;
}

function runHonest(label: string): {
  rMean: number;
  flaggedMean: number;
  avgAbsDivMean: number;
  flaggedNames: string[];
  perSeed: Array<{ seed: number; rFavReal: number | null; flaggedCount: number; avgAbsDivergencePp: number }>;
} {
  const perSeed = [];
  let flaggedNames: string[] = [];
  for (const seed of SEEDS) {
    const summaryPath = path.join(DATA_DIR, 'data', `axis-trial-${label}-seed${seed}.json`);
    const fullPath = path.join(DATA_DIR, 'data', `axis-trial-${label}-selfplay-seed${seed}.json`);
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
        .map((h) => h.name);
    }
  }
  const rs = perSeed.map((r) => r.rFavReal).filter((v): v is number => v !== null);
  return {
    rMean: mean(rs),
    flaggedMean: mean(perSeed.map((r) => r.flaggedCount)),
    avgAbsDivMean: mean(perSeed.map((r) => r.avgAbsDivergencePp)),
    flaggedNames,
    perSeed,
  };
}

function main(): void {
  const original = fs.readFileSync(WEIGHTS, 'utf-8');
  const base = JSON.parse(original) as WeightsFile;
  const b0 = JSON.parse(fs.readFileSync(B0, 'utf-8')) as {
    honestSelfPlay: {
      rMean: number;
      flaggedMean: number;
      flaggedHeroesSeed1: Array<{ name: string }>;
    };
    proMatchCalibrate: { directionHitRatePct: string | null };
  };
  const b0R = b0.honestSelfPlay.rMean;
  const b0Flag = b0.honestSelfPlay.flaggedMean;
  const b0Pro = Number(b0.proMatchCalibrate.directionHitRatePct);
  const b0Core = new Set(b0.honestSelfPlay.flaggedHeroesSeed1.map((h) => h.name));

  const trials: Record<string, WeightsFile> = {
    T_camp02: setCampStacking(base, 0.2),
    T_camp0: setCampStacking(base, 0),
    T_combatEq: combatEqualShare(base),
    T_camp0_combatEq: combatEqualShare(setCampStacking(base, 0)),
  };

  const results: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    nMatchesPerSeed: N_MATCHES,
    seeds: SEEDS,
    b0: { rMean: b0R, flaggedMean: b0Flag, proDir: b0Pro },
    trials: {},
  };

  try {
    for (const [label, cfg] of Object.entries(trials)) {
      console.log(`\n=== Trial ${label} ===`);
      const runCfg = clone(cfg);
      runCfg.realWinRateWeight = 0;
      fs.writeFileSync(WEIGHTS, JSON.stringify(runCfg, null, 2) + '\n');
      const sp = runHonest(label);
      const proDir = parsePro(spawnTs(CALIBRATE));
      const rDelta = sp.rMean - b0R;
      const flaggedOk = sp.flaggedMean <= b0Flag + 0.5;
      const proDrop = proDir === null ? null : b0Pro - proDir;
      const proOk = proDrop === null ? null : proDrop <= PRO_FLOOR_DROP_PP;
      const coreRemain = sp.flaggedNames.filter((n) => b0Core.has(n)).length;
      const pass = rDelta > 0.005 && flaggedOk && proOk === true;
      (results.trials as Record<string, unknown>)[label] = {
        midCamp: runCfg.axisWeights.camp_stacking,
        midCombat: {
          burst: runCfg.axisWeights.burst,
          teamfight: runCfg.axisWeights.teamfight,
          scaling: runCfg.axisWeights.scaling,
          objectives: runCfg.axisWeights.objectives,
          durability: runCfg.axisWeights.durability,
          skirmish_rate: runCfg.axisWeights.skirmish_rate,
        },
        selfPlay: sp,
        proDir,
        vsB0: { rDelta, flaggedOk, proDrop, coreRemain, b0Core: b0Core.size, pass },
        productionPatch: cfg, // with production realWinRateWeight intact
      };
      console.log(
        `${label}: r=${sp.rMean.toFixed(3)} (Δ${rDelta >= 0 ? '+' : ''}${rDelta.toFixed(3)}) flagged≈${sp.flaggedMean.toFixed(1)} pro=${proDir}% pass=${pass}`,
      );
    }
  } finally {
    fs.writeFileSync(WEIGHTS, original);
    console.log('axis-weights.json restored');
  }

  const ranked = Object.entries(results.trials as Record<string, { vsB0: { pass: boolean; rDelta: number }; selfPlay: { rMean: number } }>)
    .map(([id, t]) => ({
      id,
      pass: t.vsB0.pass,
      rDelta: t.vsB0.rDelta,
      rMean: t.selfPlay.rMean,
    }))
    .sort((a, b) => Number(b.pass) - Number(a.pass) || b.rDelta - a.rDelta);

  results.ranking = ranked;
  results.winner = ranked.find((r) => r.pass)?.id ?? null;
  results.recommendation = results.winner
    ? `Apply ${results.winner} to axis-weights.json (user-approved trial).`
    : 'No trial met stop criteria; do not apply. Closest by rDelta listed in ranking.';

  fs.writeFileSync(OUT, JSON.stringify(results, null, 2) + '\n');
  console.log(`\nWrote ${OUT}`);
  console.log('ranking', JSON.stringify(ranked, null, 2));
  console.log('winner', results.winner);
}

main();
