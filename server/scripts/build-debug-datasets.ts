// Produces one favoured-rate dataset for the testing-only hero calibration
// matrix (client /debug, server /dev/hero-matrix). Runs the real self-play
// core once and writes a named file under server/data.
//
// One process per dataset, because both knobs it varies are baked at import
// time: axis-weights.json's realWinRateWeight is read into a top-level const
// by battle-resolution.ts, and DISABLED_TAGS by custom-tags.ts. So the caller
// sets the environment, runs this, and repeats. You normally don't run this
// directly — `npm run build-debug-matrix` drives all three runs and restores
// axis-weights.json afterwards.
//
// Deliberately a single seed at a lower match count than simulate-self-play's
// 300k x 5 driver: per-hero favoredRate was measured stable to well under a
// point across seeds (sd 0.002-0.003 on the run-level r), and this output
// feeds a display, not a calibration decision.
import * as fs from 'fs';
import * as path from 'path';
import { runSimulation } from './simulate-self-play';
import { DISABLED_TAGS } from '../src/battle/custom-tags';

const OUT_DIR = path.join(__dirname, '..', 'data');

const label = process.env.DATASET_LABEL;
if (!label) {
  console.error('DATASET_LABEL is required (used as the output filename stem).');
  process.exit(1);
}

const nMatches = Number(process.env.DATASET_MATCHES ?? 200000);
const seed = Number(process.env.DATASET_SEED ?? 1);

const weights = JSON.parse(
  fs.readFileSync(path.join(OUT_DIR, 'axis-weights.json'), 'utf-8'),
) as { realWinRateWeight: number };

const res = runSimulation({ seed, roleMode: 'blended', nMatches, verbose: false, writeOutput: false });

const outPath = path.join(OUT_DIR, `${label}.json`);
fs.writeFileSync(
  outPath,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      // Recorded so the page can state the exact configuration each column
      // came from instead of the reader having to remember it.
      config: {
        seed,
        nMatches,
        roleMode: 'blended',
        realWinRateWeight: weights.realWinRateWeight,
        disabledTags: [...DISABLED_TAGS].sort(),
      },
      heroTable: res.heroTable.map((h) => ({
        heroId: h.heroId,
        name: h.name,
        favoredRate: h.favoredRate,
        realWinRate: h.realWinRate,
      })),
    },
    null,
    2,
  ) + '\n',
);

console.log(
  `${label}: ${res.heroTable.length} heroes, realWinRateWeight=${weights.realWinRateWeight}, ` +
    `disabledTags=${DISABLED_TAGS.size}, r=${res.rFavReal?.toFixed(3)}, avgAbsDiv=${res.avgAbsDivergencePp.toFixed(2)}pp -> ${outPath}`,
);
