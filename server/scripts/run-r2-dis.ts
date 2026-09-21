// H-DIS on top of r2_f: control_strength percentile as disable_presence,
// weight 1 = production silent default for missing `control` key.
// Hidden OFF, open ON, same seed as R0/R1/R2. Does not persist axis-weights.json.
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { CUSTOM_TAG_DEFINITIONS } from 'shared';
import { ensureArtifactDir, serverDataDir } from './lib/artifact-paths';

const DATA_DIR = serverDataDir();
const WEIGHTS = path.join(DATA_DIR, 'axis-weights.json');
const WORKER = path.join(__dirname, 'run-axis-regression-b0-worker.ts');
const R0_DIR = path.join(ensureArtifactDir('self-play', 'r0-2026-09-21'));
const R2_DIR = path.join(ensureArtifactDir('self-play', 'r2-2026-09-21'));

const N_MATCHES = Number(process.env.R2_MATCHES ?? 100000);
const SEED = Number(process.env.R2_SEED ?? 1);
const RUN_ID = process.env.R2_DIS_RUN_ID ?? 'r2-dis-2026-09-21';

const HIDDEN_CALIBRATION_TAGS = CUSTOM_TAG_DEFINITIONS.filter((d) => !d.visible && !d.revealable).map(
  (d) => d.name,
);

const CLUSTERS: Record<string, string[]> = {
  disable_support: [
    'Crystal Maiden',
    'Shadow Shaman',
    'Disruptor',
    'Skywrath Mage',
    'Ancient Apparition',
    'Silencer',
    'Lich',
    'Dark Willow',
  ],
  summoners: ["Nature's Prophet", 'Lone Druid', 'Lycan', 'Beastmaster', 'Chen', 'Broodmother'],
  late_cores: ['Phantom Lancer', 'Medusa', 'Phantom Assassin', 'Sven', 'Ursa', 'Troll Warlord'],
  showstopper: [
    'Ember Spirit',
    'Primal Beast',
    'Kunkka',
    'Marci',
    'Centaur Warrunner',
    'Earthshaker',
    'Legion Commander',
    'Earth Spirit',
  ],
};

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
function pearson(a: number[], b: number[]): number | null {
  if (a.length < 2) return null;
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
  return den === 0 ? null : num / den;
}
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - i) + sorted[hi] * (i - lo);
}
function rowsWithDiv(table: HeroRow[]) {
  return table
    .filter((h) => h.realWinRate != null)
    .map((h) => {
      const div = h.divergenceFromReal != null ? h.divergenceFromReal : h.favoredRate - (h.realWinRate as number);
      return { ...h, realWinRate: h.realWinRate as number, div };
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
function clusterMae(table: HeroRow[], names: string[]): number | null {
  const set = new Set(names);
  const rows = rowsWithDiv(table).filter((h) => set.has(h.name));
  if (!rows.length) return null;
  return mean(rows.map((h) => Math.abs(h.div))) * 100;
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

  const naked = kpiFromTable(
    (JSON.parse(fs.readFileSync(path.join(R0_DIR, 'naked-open-heroTable.json'), 'utf-8')) as { heroTable: HeroRow[] })
      .heroTable,
  );
  const r2Table = (
    JSON.parse(fs.readFileSync(path.join(R2_DIR, 'r2_f-heroTable.json'), 'utf-8')) as { heroTable: HeroRow[] }
  ).heroTable;
  const r2 = kpiFromTable(r2Table);
  const rFloor = (r2.rFavReal ?? 0) - 0.02;

  console.log(`H-DIS ${RUN_ID}: production rwr=${productionWeight}; honest 0; hidden OFF; open ON`);
  console.log(`pool seed=${SEED} n=${N_MATCHES}`);
  console.log(`Naked+open: ${fmt(naked)}`);
  console.log(`r2_f:       ${fmt(r2)}`);
  console.log(`stop vs r2_f: r < ${rFloor.toFixed(3)} or ±7 < ${r2.coverage7Pct.toFixed(1)}%`);
  console.log(`disable_presence = percentile(control_strength), weight 1 (production silent default)\n`);

  let table: HeroRow[] = [];
  try {
    const w = JSON.parse(original) as { realWinRateWeight: number };
    w.realWinRateWeight = 0;
    fs.writeFileSync(WEIGHTS, JSON.stringify(w, null, 2) + '\n');
    const output = path.join(outDir, 'r2_f_dis-heroTable.json');
    spawnWorker({
      B0_SEED: String(SEED),
      B0_MATCHES: String(N_MATCHES),
      B0_WRITE_OUTPUT: '1',
      B0_OUTPUT_PATH: output,
      B0_SUMMARY_PATH: path.join(outDir, 'r2_f_dis-summary.json'),
      DOTADRAFT_DISABLED_TAGS: HIDDEN_CALIBRATION_TAGS.join(','),
      DOTADRAFT_BATTLE_SHADOW: 'r2_f_dis',
    });
    table = (JSON.parse(fs.readFileSync(output, 'utf-8')) as { heroTable: HeroRow[] }).heroTable;
  } finally {
    fs.writeFileSync(WEIGHTS, original);
    const restored = (JSON.parse(fs.readFileSync(WEIGHTS, 'utf-8')) as { realWinRateWeight: number })
      .realWinRateWeight;
    console.log(`\naxis-weights.json restored (realWinRateWeight=${restored})`);
  }

  const kpi = kpiFromTable(table);
  const r = kpi.rFavReal ?? -1;
  const failR = r < rFloor;
  const failCov = kpi.coverage7Pct < r2.coverage7Pct - 0.05;
  const rUp = r > (r2.rFavReal ?? 0) + 0.005;
  const tailBetter = kpi.flagged10 <= r2.flagged10 && kpi.maePp <= r2.maePp + 0.05;
  const autoFail = failR || failCov;
  const falseFail = autoFail && !failR && rUp && tailBetter;
  const pick = failR
    ? 'H-DIS dead on r. Keep r2_f. Do not resurrect skirmish_role.'
    : falseFail
      ? 'Auto coverage gate vs r2_f is a false fail: r/MAE/tail improved. Take r2_f_dis as the new f.'
      : autoFail
        ? 'Coverage regression without a compensating r/tail win. Keep r2_f; H-DIS not stacked.'
        : 'H-DIS stacks. New f = r2_f_dis.';

  const clusters: Record<string, { r2: number | null; dis: number | null }> = {};
  for (const [name, heroes] of Object.entries(CLUSTERS)) {
    clusters[name] = { r2: clusterMae(r2Table, heroes), dis: clusterMae(table, heroes) };
  }

  const dr = r - (r2.rFavReal ?? 0);
  console.log(`r2_f_dis: ${fmt(kpi)}  Δr vs r2_f=${dr >= 0 ? '+' : ''}${dr.toFixed(3)}`);
  console.log(pick);

  const lines = [
    `# H-DIS on r2_f — ${RUN_ID}`,
    '',
    'Hidden OFF, open ON, `realWinRateWeight=0`. Same seed=1 × 100k.',
    'disable_presence = percentileRank(ability-tag `control_strength`). Weight 1 =',
    'production silent default for missing `control` (not a new tuned coefficient).',
    'Stacked on r2_f (PC1 + body-in-PC1 + explicit + RE=0). JSON not written.',
    '',
    '## KPI',
    '',
    `| Shadow | r | Δr r2_f | MAE | ±7 | ≥10 |`,
    `|---|---:|---:|---:|---:|---:|`,
    `| Naked+open | ${naked.rFavReal?.toFixed(3)} | — | ${naked.maePp.toFixed(2)} | ${naked.coverage7Pct.toFixed(1)}% | ${naked.flagged10} |`,
    `| r2_f | ${r2.rFavReal?.toFixed(3)} | — | ${r2.maePp.toFixed(2)} | ${r2.coverage7Pct.toFixed(1)}% | ${r2.flagged10} |`,
    `| r2_f_dis | ${kpi.rFavReal?.toFixed(3)} | ${dr >= 0 ? '+' : ''}${dr.toFixed(3)} | ${kpi.maePp.toFixed(2)} | ${kpi.coverage7Pct.toFixed(1)}% | ${kpi.flagged10} |`,
    '',
    pick,
    '',
    '## Cluster MAE п.п. (lower better)',
    '',
    `| Cluster | r2_f | r2_f_dis |`,
    `|---|---:|---:|`,
    ...Object.keys(CLUSTERS).map((c) => `| ${c} | ${clusters[c].r2?.toFixed(1) ?? ''} | ${clusters[c].dis?.toFixed(1) ?? ''} |`),
    '',
    'Production `axis-weights.json` was restored. No coefficients written.',
  ];
  fs.writeFileSync(path.join(outDir, 'kpi.md'), lines.join('\n') + '\n');
  fs.writeFileSync(
    path.join(outDir, 'manifest.json'),
    JSON.stringify({ runId: RUN_ID, createdAt: new Date().toISOString(), seed: SEED, nMatches: N_MATCHES, naked, r2, kpi, clusters, pick, falseFail, autoFail }, null, 2) +
      '\n',
  );
  console.log(`wrote ${outDir}`);
}

main();
