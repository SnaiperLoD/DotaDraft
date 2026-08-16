// Honest measurement after 2026-08-16 tag batch (Disable Battery / Haunt
// Absolute / Mirage Tax / Paper Utility + Prone strengthen). Patches
// realWinRateWeight→0, runs the same B0 worker (child processes — weights
// bake at import), restores weights in finally. Compares to
// axis-regression-b0.json / seed1 hero table. Does NOT write coefficients.
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const DATA_DIR = path.join(__dirname, '..');
const WEIGHTS = path.join(DATA_DIR, 'data', 'axis-weights.json');
const B0 = path.join(DATA_DIR, 'data', 'axis-regression-b0.json');
const B0_SEED1 = path.join(DATA_DIR, 'data', 'axis-regression-b0-selfplay-seed1.json');
const WORKER = path.join(__dirname, 'run-axis-regression-b0-worker.ts');
const OUT = path.join(DATA_DIR, 'data', 'tag-batch-measure.json');

const N_MATCHES = Number(process.env.TAG_MEASURE_MATCHES ?? 100000);
const SEEDS = [1, 2, 3, 4, 5];

const POOLS: Record<string, string[]> = {
  'Disable Battery': [
    'Disruptor',
    'Shadow Shaman',
    'Crystal Maiden',
    'Lich',
    'Ancient Apparition',
    'Silencer',
    'Skywrath Mage',
    'Dark Willow',
  ],
  'Haunt Absolute': ['Spectre'],
  'Mirage Tax': ['Naga Siren', 'Terrorblade'],
  'Paper Utility': [
    'Keeper of the Light',
    'Snapfire',
    'Treant Protector',
    'Batrider',
    'Enchantress',
  ],
  'Prone To Burst': ['Huskar', 'Phoenix', 'Enchantress', 'Necrophos', 'Monkey King'],
  'Army of Clones (control)': ['Phantom Lancer', 'Terrorblade', 'Naga Siren', 'Chaos Knight'],
  'Raid Boss': [
    'Phantom Lancer',
    'Medusa',
    'Troll Warlord',
    'Phantom Assassin',
    'Sven',
    'Ursa',
  ],
  'Showstopper Tax': [
    'Ember Spirit',
    'Kunkka',
    'Marci',
    'Primal Beast',
    'Centaur Warrunner',
    'Earthshaker',
    'Legion Commander',
    'Earth Spirit',
    'Dawnbreaker',
  ],
  'False Immortal': ['Necrophos', 'Monkey King', 'Phoenix'],
  'Siege Voltage': ['Death Prophet', 'Lina', 'Outworld Destroyer'],
};

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function stdev(xs: number[], m: number): number {
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

function spawnWorker(env: Record<string, string>): string {
  const result = spawnSync(process.execPath, ['-r', 'ts-node/register', WORKER], {
    cwd: DATA_DIR,
    encoding: 'utf-8',
    env: { ...process.env, ...env },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`worker failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout || '';
}

type HeroRow = { name: string; divergenceFromReal: number; favoredRate: number; realWinRate: number };

function poolStats(table: HeroRow[], names: string[]) {
  const rows = names.map((n) => table.find((h) => h.name === n)).filter(Boolean) as HeroRow[];
  const divs = rows.map((h) => h.divergenceFromReal * 100);
  const flagged = rows.filter((h) => Math.abs(h.divergenceFromReal) >= 0.1).length;
  return {
    n: rows.length,
    meanDivPp: Math.round(mean(divs) * 10) / 10,
    flagged,
    heroes: rows
      .map((h) => ({
        name: h.name,
        divPp: Math.round(h.divergenceFromReal * 1000) / 10,
      }))
      .sort((a, b) => Math.abs(b.divPp) - Math.abs(a.divPp)),
  };
}

function main(): void {
  const original = fs.readFileSync(WEIGHTS, 'utf-8');
  const w = JSON.parse(original) as { realWinRateWeight: number };
  const productionWeight = w.realWinRateWeight;
  const b0 = fs.existsSync(B0)
    ? (JSON.parse(fs.readFileSync(B0, 'utf-8')) as {
        honestSelfPlay?: {
          rMean?: number;
          flaggedMean?: number;
          avgAbsDivMean?: number;
        };
      })
    : null;
  const b0Seed1 = fs.existsSync(B0_SEED1)
    ? (JSON.parse(fs.readFileSync(B0_SEED1, 'utf-8')) as { heroTable: HeroRow[] })
    : null;

  console.log(
    `Tag-batch measure: production rwr=${productionWeight}; honest runs at 0`,
  );
  console.log(`self-play: ${SEEDS.length} seeds × ${N_MATCHES} matches, blended\n`);

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
      const summaryPath = path.join(
        DATA_DIR,
        'data',
        `tag-batch-measure-seed${seed}-summary.json`,
      );
      const stdout = spawnWorker({
        B0_SEED: String(seed),
        B0_MATCHES: String(N_MATCHES),
        B0_WRITE_OUTPUT: seed === 1 ? '1' : '0',
        B0_OUTPUT_PATH: path.join(DATA_DIR, 'data', 'tag-batch-measure-selfplay-seed1.json'),
        B0_SUMMARY_PATH: summaryPath,
      });
      process.stdout.write(stdout);
      seedResults.push(JSON.parse(fs.readFileSync(summaryPath, 'utf-8')));
    }

    const rs = seedResults.map((r) => r.rFavReal).filter((v): v is number => v !== null);
    const divs = seedResults.map((r) => r.avgAbsDivergencePp);
    const flagged = seedResults.map((r) => r.flaggedCount);
    const rMean = mean(rs);
    const flaggedMean = mean(flagged);

    const afterSeed1 = JSON.parse(
      fs.readFileSync(path.join(DATA_DIR, 'data', 'tag-batch-measure-selfplay-seed1.json'), 'utf-8'),
    ) as { heroTable: HeroRow[] };

    const pools: Record<string, { before: ReturnType<typeof poolStats> | null; after: ReturnType<typeof poolStats> }> =
      {};
    for (const [name, heroes] of Object.entries(POOLS)) {
      pools[name] = {
        before: b0Seed1 ? poolStats(b0Seed1.heroTable, heroes) : null,
        after: poolStats(afterSeed1.heroTable, heroes),
      };
    }

    const out = {
      measuredAt: new Date().toISOString(),
      nMatches: N_MATCHES,
      seeds: SEEDS,
      honest: {
        rMean: Math.round(rMean * 1000) / 1000,
        rStdev: Math.round(stdev(rs, rMean) * 1000) / 1000,
        flaggedMean: Math.round(flaggedMean * 10) / 10,
        avgAbsDivergencePpMean: Math.round(mean(divs) * 100) / 100,
        perSeed: seedResults,
      },
      b0Baseline: b0?.honestSelfPlay
        ? {
            rMean: b0.honestSelfPlay.rMean,
            flaggedMean: b0.honestSelfPlay.flaggedMean,
            avgAbsDivergencePpMean: b0.honestSelfPlay.avgAbsDivMean,
          }
        : null,
      deltaVsB0: b0?.honestSelfPlay
        ? {
            r: Math.round((rMean - (b0.honestSelfPlay.rMean ?? 0)) * 1000) / 1000,
            flagged: Math.round((flaggedMean - (b0.honestSelfPlay.flaggedMean ?? 0)) * 10) / 10,
            avgAbsDivPp:
              Math.round((mean(divs) - (b0.honestSelfPlay.avgAbsDivMean ?? mean(divs))) * 100) /
              100,
            note:
              'B0 predates camp_stacking=0 and resource_efficiency-in-Battle; global Δ mixes those with tags. Pool before/after still uses B0 seed1 hero table.',
          }
        : null,
      pools,
    };

    fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
    console.log('\n=== SUMMARY ===');
    console.log(JSON.stringify(out.honest, null, 2));
    console.log('deltaVsB0', out.deltaVsB0);
    for (const [name, p] of Object.entries(pools)) {
      console.log(
        `\n${name}: meanDiv ${p.before?.meanDivPp ?? '?'} → ${p.after.meanDivPp}pp  ` +
          `flagged ${p.before?.flagged ?? '?'}/${p.before?.n ?? '?'} → ${p.after.flagged}/${p.after.n}`,
      );
      for (const h of p.after.heroes) {
        const before = p.before?.heroes.find((x) => x.name === h.name)?.divPp;
        console.log(
          `  ${String(h.divPp).padStart(6)}pp  ${h.name.padEnd(22)}` +
            (before != null ? ` (was ${before})` : ''),
        );
      }
    }
    console.log(`\nWrote ${OUT}`);
  } finally {
    fs.writeFileSync(WEIGHTS, original);
    console.log(`Restored axis-weights.json (rwr=${productionWeight})`);
  }
}

main();
