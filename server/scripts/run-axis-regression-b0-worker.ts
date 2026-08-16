// Child worker for run-axis-regression-b0.ts — must start AFTER axis-weights.json
// is patched (realWinRateWeight baked at battle-resolution import time).
import * as fs from 'fs';
import * as path from 'path';
import { runSimulation } from './simulate-self-play';

const seed = Number(process.env.B0_SEED ?? 1);
const nMatches = Number(process.env.B0_MATCHES ?? 100000);
const writeOutput = process.env.B0_WRITE_OUTPUT === '1';
const outputPath =
  process.env.B0_OUTPUT_PATH ??
  path.join(__dirname, '..', 'data', 'axis-regression-b0-selfplay-seed1.json');

const res = runSimulation({
  seed,
  nMatches,
  roleMode: 'blended',
  verbose: writeOutput,
  writeOutput,
  outputPath,
});

const summaryPath =
  process.env.B0_SUMMARY_PATH ??
  path.join(__dirname, '..', 'data', `axis-regression-b0-seed${seed}-summary.json`);

fs.writeFileSync(
  summaryPath,
  JSON.stringify(
    {
      seed: res.seed,
      rFavReal: res.rFavReal,
      avgAbsDivergencePp: res.avgAbsDivergencePp,
      flaggedCount: res.flaggedCount,
    },
    null,
    2,
  ) + '\n',
);

console.log(
  `seed=${seed}  r=${res.rFavReal?.toFixed(3)}  avg|div|=${res.avgAbsDivergencePp.toFixed(2)}pp  flagged=${res.flaggedCount}`,
);
