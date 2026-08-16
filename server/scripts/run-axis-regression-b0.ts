// B0 baseline for axis-structure / weight work (Blueprint plan):
// honest self-play (realWinRateWeight=0) + pro-match calibrate on the
// CURRENT axis-weights.json. Restores weights in `finally`. Does NOT
// change coefficients — measurement only.
//
// Self-play runs in child processes: battle-resolution bakes weights at
// import time (see simulate-self-play.ts GOTCHA / build-debug-matrix.ts).
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const DATA_DIR = path.join(__dirname, '..');
const WEIGHTS = path.join(DATA_DIR, 'data', 'axis-weights.json');
const OUT = path.join(DATA_DIR, 'data', 'axis-regression-b0.json');
const WORKER = path.join(__dirname, 'run-axis-regression-b0-worker.ts');
const CALIBRATE = path.join(__dirname, 'calibrate-battle-engine.ts');

const N_MATCHES = Number(process.env.B0_MATCHES ?? 100000);
const SEEDS = [1, 2, 3, 4, 5];

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
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

function parseProCalibrate(stdout: string): Record<string, unknown> {
  const directionMatch = stdout.match(
    /advantageDirection hit-rate[^:]*:\s*([\d.]+)%/i,
  );
  const resolvedMatch = stdout.match(/resolvedOutcome hit-rate[^:]*:\s*([\d.]+)%/i);
  const tier: Record<string, { n?: string; favoredPct?: string }> = {};
  for (const t of ['Low', 'Moderate', 'High'] as const) {
    // table lines look like: "  Low        12  54.5% ... "
    const re = new RegExp(`^\\s*${t}\\s+(\\d+)\\s+([\\d.]+)%`, 'im');
    const m = stdout.match(re);
    if (m) tier[t] = { n: m[1], favoredPct: m[2] };
  }
  return {
    rawTail: stdout.trim().split('\n').slice(-40),
    directionHitRatePct: directionMatch?.[1] ?? null,
    resolvedHitRatePct: resolvedMatch?.[1] ?? null,
    tiers: tier,
  };
}

function main(): void {
  const original = fs.readFileSync(WEIGHTS, 'utf-8');
  const w = JSON.parse(original) as { realWinRateWeight: number };
  const productionWeight = w.realWinRateWeight;
  console.log(`B0 baseline: production realWinRateWeight=${productionWeight}; honest runs at 0`);
  console.log(`self-play: ${SEEDS.length} seeds × ${N_MATCHES} matches, roleMode=blended (child processes)\n`);

  try {
    w.realWinRateWeight = 0;
    fs.writeFileSync(WEIGHTS, JSON.stringify(w, null, 2) + '\n');

    const seedResults: Array<{
      seed: number;
      rFavReal: number | null;
      avgAbsDivergencePp: number;
      flaggedCount: number;
    }> = [];

    for (const seed of SEEDS) {
      const summaryPath = path.join(DATA_DIR, 'data', `axis-regression-b0-seed${seed}-summary.json`);
      const stdout = spawnTs(WORKER, {
        B0_SEED: String(seed),
        B0_MATCHES: String(N_MATCHES),
        B0_WRITE_OUTPUT: seed === 1 ? '1' : '0',
        B0_OUTPUT_PATH: path.join(DATA_DIR, 'data', 'axis-regression-b0-selfplay-seed1.json'),
        B0_SUMMARY_PATH: summaryPath,
      });
      process.stdout.write(stdout);
      seedResults.push(JSON.parse(fs.readFileSync(summaryPath, 'utf-8')));
    }

    const rs = seedResults.map((r) => r.rFavReal).filter((v): v is number => v !== null);
    const divs = seedResults.map((r) => r.avgAbsDivergencePp);
    const flagged = seedResults.map((r) => r.flaggedCount);
    const rMean = mean(rs);

    const seed1 = JSON.parse(
      fs.readFileSync(path.join(DATA_DIR, 'data', 'axis-regression-b0-selfplay-seed1.json'), 'utf-8'),
    ) as {
      heroTable: Array<{
        name: string;
        favoredRate: number;
        realWinRate: number | null;
        divergenceFromReal: number | null;
      }>;
    };
    const flaggedHeroes = seed1.heroTable
      .filter((h) => h.divergenceFromReal !== null && Math.abs(h.divergenceFromReal!) >= 0.1)
      .map((h) => ({
        name: h.name,
        divergencePp: Math.round(h.divergenceFromReal! * 1000) / 10,
        favoredPct: Math.round(h.favoredRate * 1000) / 10,
        realPct: h.realWinRate === null ? null : Math.round(h.realWinRate * 1000) / 10,
      }))
      .sort((a, b) => Math.abs(b.divergencePp) - Math.abs(a.divergencePp));

    console.log('\n=== Pro-match calibrate (honest realWinRateWeight=0) ===');
    const proStdout = spawnTs(CALIBRATE);
    const proSummary = parseProCalibrate(proStdout);
    console.log((proSummary.rawTail as string[]).join('\n'));

    const payload = {
      generatedAt: new Date().toISOString(),
      label: 'B0',
      nMatchesPerSeed: N_MATCHES,
      seeds: SEEDS,
      productionRealWinRateWeight: productionWeight,
      honestSelfPlay: {
        roleMode: 'blended',
        perSeed: seedResults,
        rMean,
        rSd: stdev(rs, rMean),
        avgAbsDivMean: mean(divs),
        flaggedMean: mean(flagged),
        flaggedHeroesSeed1: flaggedHeroes,
      },
      proMatchCalibrate: proSummary,
      axisWeightsSnapshot: JSON.parse(original),
    };
    fs.writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n');
    console.log(`\nWrote ${OUT}`);
    console.log(
      `SUMMARY honest r mean=${rMean.toFixed(3)}±${stdev(rs, rMean).toFixed(3)}  flagged≈${mean(flagged).toFixed(1)}  avg|div|=${mean(divs).toFixed(2)}pp`,
    );
  } finally {
    fs.writeFileSync(WEIGHTS, original);
    console.log('axis-weights.json restored');
  }
}

main();
