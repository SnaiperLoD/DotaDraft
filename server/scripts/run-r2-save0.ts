// Ablation: r2_f_farm with saving weight 0 in every phase.
// Same seed, hidden OFF, open ON. Does not persist axis-weights.json.
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { CUSTOM_TAG_DEFINITIONS, type Hero } from 'shared';
import { ensureArtifactDir, serverDataDir } from './lib/artifact-paths';

const DATA_DIR = serverDataDir();
const WEIGHTS = path.join(DATA_DIR, 'axis-weights.json');
const WORKER = path.join(__dirname, 'run-axis-regression-b0-worker.ts');
const FARM_TABLE = path.join(ensureArtifactDir('self-play', 'r2-farm-2026-09-21'), 'r2_f_farm-heroTable.json');

const N_MATCHES = Number(process.env.R2_MATCHES ?? 100000);
const SEED = Number(process.env.R2_SEED ?? 1);
const RUN_ID = process.env.R2_SAVE0_RUN_ID ?? 'r2-save0-2026-09-21';

const HIDDEN_CALIBRATION_TAGS = CUSTOM_TAG_DEFINITIONS.filter((d) => !d.visible && !d.revealable).map(
  (d) => d.name,
);
const PAPER = CUSTOM_TAG_DEFINITIONS.find((d) => d.name === 'Paper Utility')?.heroNames ?? [];
const SPOTLIGHT = [
  'Keeper of the Light',
  'Pugna',
  'Snapfire',
  'Necrophos',
  'Phoenix',
  'Treant Protector',
  'Spectre',
  'Phantom Lancer',
  'Medusa',
  'Crystal Maiden',
  'Sand King',
  'Pangolier',
];

interface HeroRow {
  name: string;
  favoredRate: number;
  realWinRate: number | null;
  divergenceFromReal?: number | null;
}

interface Kpi {
  n: number;
  rFavReal: number | null;
  maePp: number;
  p95AbsPp: number;
  coverage7Pct: number;
  flagged7: number;
  flagged10: number;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 3) return null;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - pos) + sorted[hi] * (pos - lo);
}

function divOf(h: HeroRow): number | null {
  if (h.realWinRate == null) return null;
  return h.divergenceFromReal != null ? h.divergenceFromReal : h.favoredRate - h.realWinRate;
}

function rowsWithDiv(table: HeroRow[]): { name: string; favoredRate: number; realWinRate: number; div: number }[] {
  return table.flatMap((h) => {
    const div = divOf(h);
    if (div == null || h.realWinRate == null) return [];
    return [{ name: h.name, favoredRate: h.favoredRate, realWinRate: h.realWinRate, div }];
  });
}

function kpiFromTable(table: HeroRow[]): Kpi {
  const rows = rowsWithDiv(table);
  const abs = rows.map((h) => Math.abs(h.div)).sort((a, b) => a - b);
  return {
    n: rows.length,
    rFavReal: pearson(
      rows.map((h) => h.favoredRate),
      rows.map((h) => h.realWinRate),
    ),
    maePp: mean(abs) * 100,
    p95AbsPp: quantile(abs, 0.95) * 100,
    coverage7Pct: (rows.filter((h) => Math.abs(h.div) <= 0.07).length / rows.length) * 100,
    flagged7: rows.filter((h) => Math.abs(h.div) >= 0.07).length,
    flagged10: rows.filter((h) => Math.abs(h.div) >= 0.1).length,
  };
}

function spawnWorker(env: Record<string, string>): void {
  const result = spawnSync(process.execPath, ['-r', 'ts-node/register', WORKER], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf-8',
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`worker failed with status ${String(result.status)}`);
}

function fmt(k: Kpi): string {
  const r = k.rFavReal == null ? 'n/a' : k.rFavReal.toFixed(3);
  return `r=${r}  MAE=${k.maePp.toFixed(2)}pp  P95=${k.p95AbsPp.toFixed(2)}pp  ±7=${k.coverage7Pct.toFixed(1)}%  ≥7=${k.flagged7}  ≥10=${k.flagged10}`;
}

function main(): void {
  const outDir = ensureArtifactDir('self-play', RUN_ID);
  const original = fs.readFileSync(WEIGHTS, 'utf-8');
  const productionWeight = (JSON.parse(original) as { realWinRateWeight: number }).realWinRateWeight;
  const farmTable = (JSON.parse(fs.readFileSync(FARM_TABLE, 'utf-8')) as { heroTable: HeroRow[] }).heroTable;
  const farm = kpiFromTable(farmTable);
  const rFloor = (farm.rFavReal ?? 0) - 0.02;
  const heroes = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'heroes.json'), 'utf-8')) as Hero[];
  const savingOf = new Map(heroes.map((h) => [h.name, h.evaluation_values.saving]));

  console.log(`r2_f_farm_save0 ${RUN_ID}: production rwr=${productionWeight}; honest 0; hidden OFF; open ON`);
  console.log(`pool seed=${SEED} n=${N_MATCHES}`);
  console.log(`r2_f_farm: ${fmt(farm)}`);
  console.log(`stop vs r2_f_farm: r < ${rFloor.toFixed(3)} or ±7 < ${farm.coverage7Pct.toFixed(1)}%`);
  console.log('saving weight = 0 in every phase. PC1 / farm_v2 / body unchanged.\n');

  let table: HeroRow[] = [];
  try {
    const w = JSON.parse(original) as { realWinRateWeight: number };
    w.realWinRateWeight = 0;
    fs.writeFileSync(WEIGHTS, JSON.stringify(w, null, 2) + '\n');
    const output = path.join(outDir, 'r2_f_farm_save0-heroTable.json');
    spawnWorker({
      B0_SEED: String(SEED),
      B0_MATCHES: String(N_MATCHES),
      B0_WRITE_OUTPUT: '1',
      B0_OUTPUT_PATH: output,
      B0_SUMMARY_PATH: path.join(outDir, 'r2_f_farm_save0-summary.json'),
      DOTADRAFT_DISABLED_TAGS: HIDDEN_CALIBRATION_TAGS.join(','),
      DOTADRAFT_BATTLE_SHADOW: 'r2_f_farm_save0',
    });
    table = (JSON.parse(fs.readFileSync(output, 'utf-8')) as { heroTable: HeroRow[] }).heroTable;
  } finally {
    fs.writeFileSync(WEIGHTS, original);
    const restored = (JSON.parse(fs.readFileSync(WEIGHTS, 'utf-8')) as { realWinRateWeight: number }).realWinRateWeight;
    console.log(`\naxis-weights.json restored (realWinRateWeight=${restored})`);
  }

  const kpi = kpiFromTable(table);
  const farmBy = new Map(rowsWithDiv(farmTable).map((h) => [h.name, h.div]));
  const nowBy = new Map(rowsWithDiv(table).map((h) => [h.name, h.div]));
  const highSaving = heroes.filter((h) => h.evaluation_values.saving >= 6).map((h) => h.name);
  const meanDiv = (names: string[], src: Map<string, number>) => {
    const xs = names.flatMap((n) => {
      const d = src.get(n);
      return d == null ? [] : [d];
    });
    return { n: xs.length, meanPp: mean(xs) * 100 };
  };
  const highBefore = meanDiv(highSaving, farmBy);
  const highAfter = meanDiv(highSaving, nowBy);
  const paperBefore = meanDiv(PAPER, farmBy);
  const paperAfter = meanDiv(PAPER, nowBy);

  const dr = (kpi.rFavReal ?? 0) - (farm.rFavReal ?? 0);
  const failR = (kpi.rFavReal ?? -1) < rFloor;
  const failCov = kpi.coverage7Pct < farm.coverage7Pct - 0.05;
  const verdict = failR
    ? 'FAIL r. saving=0 drops more than 0.02 vs r2_f_farm. Do not stack.'
    : failCov
      ? 'FAIL coverage. ±7 got worse vs r2_f_farm. Do not stack on coverage alone.'
      : dr > 0.005 || kpi.maePp < farm.maePp - 0.05
        ? 'Slope survived the pool. saving=0 is ahead of r2_f_farm on r or MAE without a coverage miss.'
        : 'No r/MAE win. saving tracks the residual on the card and does not move the pool. Do not stack.';

  const spotLines = SPOTLIGHT.map((name) => {
    const before = farmBy.get(name);
    const after = nowBy.get(name);
    const saving = savingOf.get(name);
    return `| ${name} | ${saving?.toFixed(1) ?? ''} | ${before == null ? '' : (before * 100).toFixed(1)} | ${after == null ? '' : (after * 100).toFixed(1)} |`;
  });

  console.log(`r2_f_farm_save0: ${fmt(kpi)}  Δr vs r2_f_farm=${dr >= 0 ? '+' : ''}${dr.toFixed(3)}`);
  console.log(verdict);

  const lines = [
    `# saving weight 0 on r2_f_farm — ${RUN_ID}`,
    '',
    'Hidden OFF, open ON, `realWinRateWeight=0`. Same seed=1 × 100k.',
    'r2_f_farm unchanged except saving weight = 0 in early, mid, and late. No other coefficient. JSON restored.',
    '',
    '## KPI',
    '',
    `| Shadow | r | Δr | MAE | ±7 | ≥10 |`,
    `|---|---:|---:|---:|---:|---:|`,
    `| r2_f_farm | ${farm.rFavReal?.toFixed(3)} | — | ${farm.maePp.toFixed(2)} | ${farm.coverage7Pct.toFixed(1)}% | ${farm.flagged10} |`,
    `| r2_f_farm_save0 | ${kpi.rFavReal?.toFixed(3)} | ${dr >= 0 ? '+' : ''}${dr.toFixed(3)} | ${kpi.maePp.toFixed(2)} | ${kpi.coverage7Pct.toFixed(1)}% | ${kpi.flagged10} |`,
    '',
    verdict,
    '',
    `saving ≥ 6 mean div: ${highBefore.meanPp.toFixed(1)} pp → ${highAfter.meanPp.toFixed(1)} pp (n=${highAfter.n})`,
    `Paper Utility mean div: ${paperBefore.meanPp.toFixed(1)} pp → ${paperAfter.meanPp.toFixed(1)} pp (n=${paperAfter.n})`,
    '',
    '## Spotlight div п.п.',
    '',
    '| Hero | saving | r2_f_farm | save0 |',
    '|---|---:|---:|---:|',
    ...spotLines,
    '',
    'Production `axis-weights.json` was restored.',
  ];
  fs.writeFileSync(path.join(outDir, 'kpi.md'), lines.join('\n') + '\n');
  fs.writeFileSync(
    path.join(outDir, 'manifest.json'),
    JSON.stringify(
      {
        runId: RUN_ID,
        createdAt: new Date().toISOString(),
        seed: SEED,
        nMatches: N_MATCHES,
        farm,
        kpi,
        verdict,
        highSaving: { before: highBefore, after: highAfter },
        paper: { before: paperBefore, after: paperAfter },
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`wrote ${outDir}`);
}

main();
