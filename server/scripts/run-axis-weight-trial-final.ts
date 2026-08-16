// Final metrics after applying a weight trial. Patches realWinRateWeight for
// honest run in a child process, restores in finally. Also runs production
 // (weight as on disk) self-play sanity + pro calibrate.
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const DATA_DIR = path.join(__dirname, '..');
const WEIGHTS = path.join(DATA_DIR, 'data', 'axis-weights.json');
const OUT = path.join(DATA_DIR, 'data', 'axis-weight-trial-final.json');
const WORKER = path.join(__dirname, 'run-axis-regression-b0-worker.ts');
const CALIBRATE = path.join(__dirname, 'calibrate-battle-engine.ts');

const N_MATCHES = Number(process.env.FINAL_MATCHES ?? 100000);
const SEEDS = (process.env.FINAL_SEEDS ?? '1,2,3,4,5').split(',').map(Number);

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
}
function stdev(xs: number[], m: number): number {
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
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

function parsePro(stdout: string): Record<string, unknown> {
  const directionMatch = stdout.match(/advantageDirection hit-rate[^:]*:\s*([\d.]+)%/i);
  const tier: Record<string, string> = {};
  for (const t of ['Low', 'Moderate', 'High'] as const) {
    const re = new RegExp(`^\\s*${t}\\s+(\\d+)\\s+([\\d.]+)%`, 'im');
    const m = stdout.match(re);
    if (m) tier[t] = m[2];
  }
  return {
    directionHitRatePct: directionMatch?.[1] ?? null,
    tiers: tier,
    rawTail: stdout.trim().split('\n').slice(-30),
  };
}

function runSeeds(label: string): {
  perSeed: Array<{ seed: number; rFavReal: number | null; flaggedCount: number; avgAbsDivergencePp: number }>;
  rMean: number;
  rSd: number;
  flaggedMean: number;
  avgAbsDivMean: number;
} {
  const perSeed = [];
  for (const seed of SEEDS) {
    const summaryPath = path.join(DATA_DIR, 'data', `axis-final-${label}-seed${seed}.json`);
    spawnTs(WORKER, {
      B0_SEED: String(seed),
      B0_MATCHES: String(N_MATCHES),
      B0_WRITE_OUTPUT: seed === SEEDS[0] ? '1' : '0',
      B0_OUTPUT_PATH: path.join(DATA_DIR, 'data', `axis-final-${label}-selfplay-seed1.json`),
      B0_SUMMARY_PATH: summaryPath,
    });
    perSeed.push(JSON.parse(fs.readFileSync(summaryPath, 'utf-8')));
    console.log(
      `${label} seed=${seed} r=${perSeed[perSeed.length - 1].rFavReal?.toFixed(3)} flagged=${perSeed[perSeed.length - 1].flaggedCount}`,
    );
  }
  const rs = perSeed.map((r) => r.rFavReal).filter((v): v is number => v !== null);
  const rMean = mean(rs);
  return {
    perSeed,
    rMean,
    rSd: stdev(rs, rMean),
    flaggedMean: mean(perSeed.map((r) => r.flaggedCount)),
    avgAbsDivMean: mean(perSeed.map((r) => r.avgAbsDivergencePp)),
  };
}

function main(): void {
  const original = fs.readFileSync(WEIGHTS, 'utf-8');
  const w = JSON.parse(original) as { realWinRateWeight: number; axisWeights: { camp_stacking: number } };
  console.log(
    `Final metrics: camp_stacking=${w.axisWeights.camp_stacking} production realWinRateWeight=${w.realWinRateWeight}`,
  );

  try {
    // Honest
    const honestCfg = JSON.parse(original);
    honestCfg.realWinRateWeight = 0;
    fs.writeFileSync(WEIGHTS, JSON.stringify(honestCfg, null, 2) + '\n');
    console.log('\n=== Honest self-play ===');
    const honest = runSeeds('honest');
    console.log('\n=== Pro calibrate (honest weight file) ===');
    const proHonest = parsePro(spawnTs(CALIBRATE));
    console.log((proHonest.rawTail as string[]).join('\n'));

    // Production sanity
    fs.writeFileSync(WEIGHTS, original);
    console.log('\n=== Production self-play sanity ===');
    const production = runSeeds('prod');
    console.log('\n=== Pro calibrate (production) ===');
    const proProd = parsePro(spawnTs(CALIBRATE));
    console.log((proProd.rawTail as string[]).join('\n'));

    const payload = {
      generatedAt: new Date().toISOString(),
      appliedTrial: 'T_camp0',
      axisWeightsSnapshot: JSON.parse(original),
      nMatchesPerSeed: N_MATCHES,
      seeds: SEEDS,
      honest,
      proHonest,
      production,
      proProduction: proProd,
    };
    fs.writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n');
    console.log(`\nWrote ${OUT}`);
    console.log(
      `SUMMARY honest r=${honest.rMean.toFixed(3)}±${honest.rSd.toFixed(3)} flagged≈${honest.flaggedMean.toFixed(1)} pro=${proHonest.directionHitRatePct}%`,
    );
    console.log(
      `SUMMARY prod   r=${production.rMean.toFixed(3)}±${production.rSd.toFixed(3)} flagged≈${production.flaggedMean.toFixed(1)} pro=${proProd.directionHitRatePct}%`,
    );
  } finally {
    fs.writeFileSync(WEIGHTS, original);
    console.log('axis-weights.json restored to applied trial (production)');
  }
}

main();
