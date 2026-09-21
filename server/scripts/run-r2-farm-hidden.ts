// Existing hidden tags ON, on the frozen r2_f_farm formula.
// No new magnitudes. Same seed, open tags stay ON. Does not persist axis-weights.json.
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { CUSTOM_TAG_DEFINITIONS } from 'shared';
import { ensureArtifactDir, serverDataDir } from './lib/artifact-paths';

const DATA_DIR = serverDataDir();
const WEIGHTS = path.join(DATA_DIR, 'axis-weights.json');
const WORKER = path.join(__dirname, 'run-axis-regression-b0-worker.ts');
const FARM_TABLE = path.join(ensureArtifactDir('self-play', 'r2-farm-2026-09-21'), 'r2_f_farm-heroTable.json');

const N_MATCHES = Number(process.env.R2_MATCHES ?? 100000);
const SEED = Number(process.env.R2_SEED ?? 1);
const RUN_ID = process.env.R2_FARM_HIDDEN_RUN_ID ?? 'r2-farm-hidden-2026-09-21';

const HIDDEN = CUSTOM_TAG_DEFINITIONS.filter((d) => !d.visible && !d.revealable);

// Flat power from custom-tags.ts. >1 buff (naked f should underrate), <1 penalty.
const HIDDEN_FLAT: Record<string, number> = {
  'Disable Battery': 1.25,
  'Haunt Absolute': 1.12,
  'Paper Utility': 0.75,
  'Raid Boss': 1.18,
  'Showstopper Tax': 0.75,
  'False Immortal': 0.82,
  'Siege Voltage': 1.12,
  'Summoning Sickness': 0.7,
};

const SPOTLIGHT = [
  'Keeper of the Light',
  'Pugna',
  'Snapfire',
  'Necrophos',
  'Phoenix',
  'Chen',
  'Spectre',
  'Phantom Lancer',
  'Medusa',
  'Crystal Maiden',
  'Shadow Shaman',
  'Sand King',
  'Pangolier',
  'Ringmaster',
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

function tagNote(flat: number | null, beforePp: number, afterPp: number): string {
  if (flat == null) return 'complex shape, magnitude not judged';
  if (Math.abs(afterPp) <= 2) return 'settled near zero';
  const penalty = flat < 1;
  const flipped = penalty ? afterPp < -2 : afterPp > 2;
  if (flipped) return 'sign flipped — magnitude looks hot on this f';
  if (Math.abs(afterPp) < Math.abs(beforePp)) return 'same sign, error shrunk';
  return 'same sign, error grew';
}

function main(): void {
  const outDir = ensureArtifactDir('self-play', RUN_ID);
  const original = fs.readFileSync(WEIGHTS, 'utf-8');
  const productionWeight = (JSON.parse(original) as { realWinRateWeight: number }).realWinRateWeight;
  const farmTable = (JSON.parse(fs.readFileSync(FARM_TABLE, 'utf-8')) as { heroTable: HeroRow[] }).heroTable;
  const farm = kpiFromTable(farmTable);
  const rFloor = (farm.rFavReal ?? 0) - 0.02;

  console.log(`r2_f_farm + hidden ON ${RUN_ID}: production rwr=${productionWeight}; honest 0; open ON`);
  console.log(`hidden tags left ON: ${HIDDEN.map((d) => d.name).join(', ')}`);
  console.log(`pool seed=${SEED} n=${N_MATCHES}`);
  console.log(`r2_f_farm hidden OFF: ${fmt(farm)}`);
  console.log(`stop vs r2_f_farm: r < ${rFloor.toFixed(3)} or ±7 worse than ${farm.coverage7Pct.toFixed(1)}% by more than 1 hero`);
  console.log('no magnitude edits\n');

  let table: HeroRow[] = [];
  try {
    const w = JSON.parse(original) as { realWinRateWeight: number };
    w.realWinRateWeight = 0;
    fs.writeFileSync(WEIGHTS, JSON.stringify(w, null, 2) + '\n');
    const output = path.join(outDir, 'r2_f_farm_hidden-heroTable.json');
    spawnWorker({
      B0_SEED: String(SEED),
      B0_MATCHES: String(N_MATCHES),
      B0_WRITE_OUTPUT: '1',
      B0_OUTPUT_PATH: output,
      B0_SUMMARY_PATH: path.join(outDir, 'r2_f_farm_hidden-summary.json'),
      DOTADRAFT_DISABLED_TAGS: '',
      DOTADRAFT_BATTLE_SHADOW: 'r2_f_farm',
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
  const dr = (kpi.rFavReal ?? 0) - (farm.rFavReal ?? 0);
  const failR = (kpi.rFavReal ?? -1) < rFloor;
  const oneHeroPp = 100 / Math.max(kpi.n, 1);
  const failCov = kpi.coverage7Pct < farm.coverage7Pct - oneHeroPp;
  const gate = failR
    ? 'FAIL r. Hidden tags on r2_f_farm drop more than 0.02. Do not stack, do not retune magnitudes.'
    : failCov
      ? 'FAIL coverage. ±7 got worse by more than one hero. Do not stack, do not retune magnitudes.'
      : 'PASS gate vs r2_f_farm. Magnitudes not retuned.';

  const tagLines = HIDDEN.map((def) => {
    const members = def.heroNames.filter((n) => farmBy.has(n) && nowBy.has(n));
    const before = mean(members.map((n) => farmBy.get(n) as number)) * 100;
    const after = mean(members.map((n) => nowBy.get(n) as number)) * 100;
    const flat = HIDDEN_FLAT[def.name] ?? null;
    return `| ${def.name} | ${members.length} | ${flat == null ? 'complex' : flat.toFixed(2)} | ${before.toFixed(1)} | ${after.toFixed(1)} | ${tagNote(flat, before, after)} |`;
  });

  const spotLines = SPOTLIGHT.map((name) => {
    const before = farmBy.get(name);
    const after = nowBy.get(name);
    const tags = HIDDEN.filter((d) => d.heroNames.includes(name)).map((d) => d.name);
    return `| ${name} | ${tags.join(', ') || '—'} | ${before == null ? '' : (before * 100).toFixed(1)} | ${after == null ? '' : (after * 100).toFixed(1)} |`;
  });

  console.log(`r2_f_farm + hidden: ${fmt(kpi)}  Δr vs hidden OFF=${dr >= 0 ? '+' : ''}${dr.toFixed(3)}`);
  console.log(gate);

  const lines = [
    `# hidden tags on r2_f_farm — ${RUN_ID}`,
    '',
    'Hidden ON, open ON, `realWinRateWeight=0`. Same seed=1 × 100k. Shadow `r2_f_farm`.',
    'Existing magnitudes only. No coefficient edits. JSON restored.',
    '',
    '## KPI',
    '',
    `| Shadow | r | Δr | MAE | ±7 | ≥10 |`,
    `|---|---:|---:|---:|---:|---:|`,
    `| r2_f_farm, hidden OFF | ${farm.rFavReal?.toFixed(3)} | — | ${farm.maePp.toFixed(2)} | ${farm.coverage7Pct.toFixed(1)}% | ${farm.flagged10} |`,
    `| r2_f_farm, hidden ON | ${kpi.rFavReal?.toFixed(3)} | ${dr >= 0 ? '+' : ''}${dr.toFixed(3)} | ${kpi.maePp.toFixed(2)} | ${kpi.coverage7Pct.toFixed(1)}% | ${kpi.flagged10} |`,
    '',
    gate,
    '',
    'Old production formula with hidden ON was r 0.381, ±7 61.4%, MAE 6.39. That row is a different f, not the gate.',
    '',
    '## Per hidden tag, mean div п.п.',
    '',
    'Positive div = overrated. Flat < 1 is a penalty (naked f should be positive). Flat > 1 is a buff.',
    '',
    '| Tag | n | flat | hidden OFF | hidden ON | note |',
    '|---|---:|---:|---:|---:|---|',
    ...tagLines,
    '',
    '## Spotlight div п.п.',
    '',
    '| Hero | hidden | OFF | ON |',
    '|---|---|---:|---:|',
    ...spotLines,
    '',
    'Production `axis-weights.json` was restored. Magnitudes not changed.',
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
        shadow: 'r2_f_farm',
        hidden: 'on',
        farm,
        kpi,
        gate,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`wrote ${outDir}`);
}

main();
