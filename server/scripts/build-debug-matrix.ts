// Driver for the testing-only hero calibration matrix. Produces all three
// favoured-rate datasets the /debug page reads, each in its own child process.
//
// Why child processes: both knobs these datasets vary are baked at import
// time — axis-weights.json's realWinRateWeight is read into a top-level const
// by battle-resolution.ts, DISABLED_TAGS by custom-tags.ts — so they cannot be
// changed inside a single run.
//
// Why a driver at all instead of three documented commands: the
// realWinRateWeight patch has to be undone afterwards, and every previous
// incident in this project's notes with that file is someone forgetting. The
// restore here is in a `finally`, so it also survives a crash or Ctrl-C
// mid-run.
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { CUSTOM_TAG_DEFINITIONS } from 'shared';

const DATA_DIR = path.join(__dirname, '..', 'data');
const WEIGHTS = path.join(DATA_DIR, 'axis-weights.json');
const WORKER = path.join(__dirname, 'build-debug-datasets.ts');

const ALL_TAGS = CUSTOM_TAG_DEFINITIONS.map((d) => d.name).join(',');

const RUNS = [
  { label: 'debug-ds-no-tags', realWinRateWeight: 0, disabledTags: ALL_TAGS },
  { label: 'debug-ds-tags', realWinRateWeight: 0, disabledTags: '' },
  // Production configuration — realWinRateWeight is restored to whatever the
  // file had before this script ran, not hardcoded, so a retuned production
  // value is picked up automatically.
  { label: 'debug-ds-tags-blend', realWinRateWeight: null as number | null, disabledTags: '' },
];

function setWeight(value: number): void {
  const w = JSON.parse(fs.readFileSync(WEIGHTS, 'utf-8')) as Record<string, unknown>;
  w.realWinRateWeight = value;
  fs.writeFileSync(WEIGHTS, JSON.stringify(w, null, 2) + '\n');
}

function main(): void {
  const original = fs.readFileSync(WEIGHTS, 'utf-8');
  const productionWeight = (JSON.parse(original) as { realWinRateWeight: number }).realWinRateWeight;
  console.log(`production realWinRateWeight=${productionWeight}; will be restored when done\n`);

  try {
    for (const run of RUNS) {
      const weight = run.realWinRateWeight ?? productionWeight;
      setWeight(weight);
      // Spawn node directly rather than the `npx` shim: on Windows npx is a
      // .cmd, and since the CVE-2024-27980 fix Node refuses to spawn .cmd
      // without shell:true — which would then need its own quoting. Going
      // straight to process.execPath sidesteps both.
      const result = spawnSync(process.execPath, ['-r', 'ts-node/register', WORKER], {
        cwd: path.join(__dirname, '..'),
        stdio: 'inherit',
        env: {
          ...process.env,
          DATASET_LABEL: run.label,
          DOTADRAFT_DISABLED_TAGS: run.disabledTags,
        },
      });
      // status is null when the child never ran or died on a signal, and then
      // the useful detail is in result.error — reporting only the status would
      // hide it.
      if (result.error) throw new Error(`${run.label} could not start: ${result.error.message}`);
      if (result.status !== 0) {
        throw new Error(`${run.label} failed with exit code ${String(result.status)}`);
      }
    }
  } finally {
    fs.writeFileSync(WEIGHTS, original);
    const restored = (JSON.parse(fs.readFileSync(WEIGHTS, 'utf-8')) as { realWinRateWeight: number })
      .realWinRateWeight;
    console.log(`\naxis-weights.json restored (realWinRateWeight=${restored})`);
  }
}

main();
