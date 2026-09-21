// R2.1 combined Battle f + isolated farm_need_v2.
// Hidden calibration OFF, open tags ON, same mulberry32 seed as R0/R1.
// Does not persist axis-weights.json.
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { CUSTOM_TAG_DEFINITIONS } from 'shared';
import { ensureArtifactDir, serverDataDir } from './lib/artifact-paths';

const DATA_DIR = serverDataDir();
const WEIGHTS = path.join(DATA_DIR, 'axis-weights.json');
const WORKER = path.join(__dirname, 'run-axis-regression-b0-worker.ts');
const R0_DIR = path.join(ensureArtifactDir('self-play', 'r0-2026-09-21'));
const R1_DIR = path.join(ensureArtifactDir('self-play', 'r1-2026-09-21'));

const N_MATCHES = Number(process.env.R2_MATCHES ?? 100000);
const SEED = Number(process.env.R2_SEED ?? 1);
const RUN_ID = process.env.R2_RUN_ID ?? 'r2-2026-09-21';

const HIDDEN_CALIBRATION_TAGS = CUSTOM_TAG_DEFINITIONS.filter((d) => !d.visible && !d.revealable).map(
  (d) => d.name,
);

const SHADOWS = ['r2_f', 'farm_need_v2'] as const;

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

function gateVs(kpi: Kpi, floorR: number, floorCov: number): { pass: boolean; reason: string } {
  const r = kpi.rFavReal ?? -1;
  const failR = r < floorR;
  const failCov = kpi.coverage7Pct < floorCov - 0.05;
  const pass = !failR && !failCov;
  const reason = pass
    ? 'pass'
    : [failR ? `r ${r.toFixed(3)} < ${floorR.toFixed(3)}` : '', failCov ? `coverage ${kpi.coverage7Pct.toFixed(1)} < ${floorCov.toFixed(1)}` : '']
        .filter(Boolean)
        .join('; ');
  return { pass, reason };
}

function main(): void {
  const outDir = ensureArtifactDir('self-play', RUN_ID);
  const original = fs.readFileSync(WEIGHTS, 'utf-8');
  const productionWeight = (JSON.parse(original) as { realWinRateWeight: number }).realWinRateWeight;

  const r0Naked = JSON.parse(fs.readFileSync(path.join(R0_DIR, 'naked-open-heroTable.json'), 'utf-8')) as {
    heroTable: HeroRow[];
  };
  const r1Pc1 = JSON.parse(fs.readFileSync(path.join(R1_DIR, 'combat_pc1-heroTable.json'), 'utf-8')) as {
    heroTable: HeroRow[];
  };
  const baseline = kpiFromTable(r0Naked.heroTable);
  const pc1 = kpiFromTable(r1Pc1.heroTable);
  const nakedFloorR = (baseline.rFavReal ?? 0) - 0.02;
  const pc1FloorR = (pc1.rFavReal ?? 0) - 0.02;

  console.log(`R2 ${RUN_ID}: production rwr=${productionWeight}; honest 0; hidden OFF; open ON`);
  console.log(`pool seed=${SEED} n=${N_MATCHES}`);
  console.log(`Naked+open: ${fmt(baseline)}`);
  console.log(`combat_pc1:  ${fmt(pc1)}`);
  console.log(`r2_f stop vs Naked: r < ${nakedFloorR.toFixed(3)} or ±7 < ${baseline.coverage7Pct.toFixed(1)}%`);
  console.log(
    `r2_f stop vs pc1:    r < ${pc1FloorR.toFixed(3)} or ±7 < ${pc1.coverage7Pct.toFixed(1)}% (stack must not kill the winner)\n`,
  );

  const results: Record<
    string,
    { kpi: Kpi; vsNaked: { pass: boolean; reason: string }; vsPc1?: { pass: boolean; reason: string }; clusters: Record<string, number | null> }
  > = {};

  try {
    const w = JSON.parse(original) as { realWinRateWeight: number };
    w.realWinRateWeight = 0;
    fs.writeFileSync(WEIGHTS, JSON.stringify(w, null, 2) + '\n');

    for (const shadow of SHADOWS) {
      console.log(`\n--- shadow=${shadow} ---`);
      const output = path.join(outDir, `${shadow}-heroTable.json`);
      const summary = path.join(outDir, `${shadow}-summary.json`);
      spawnWorker({
        B0_SEED: String(SEED),
        B0_MATCHES: String(N_MATCHES),
        B0_WRITE_OUTPUT: '1',
        B0_OUTPUT_PATH: output,
        B0_SUMMARY_PATH: summary,
        DOTADRAFT_DISABLED_TAGS: HIDDEN_CALIBRATION_TAGS.join(','),
        DOTADRAFT_BATTLE_SHADOW: shadow,
      });
      const table = (JSON.parse(fs.readFileSync(output, 'utf-8')) as { heroTable: HeroRow[] }).heroTable;
      const kpi = kpiFromTable(table);
      const vsNaked = gateVs(kpi, nakedFloorR, baseline.coverage7Pct);
      const vsPc1 = shadow === 'r2_f' ? gateVs(kpi, pc1FloorR, pc1.coverage7Pct) : undefined;
      const clusters: Record<string, number | null> = {};
      for (const [name, heroes] of Object.entries(CLUSTERS)) {
        clusters[name] = clusterMae(table, heroes);
      }
      results[shadow] = { kpi, vsNaked, vsPc1, clusters };
      const extra = vsPc1 ? `  vs pc1: ${vsPc1.pass ? 'PASS' : 'FAIL'} ${vsPc1.reason}` : '';
      console.log(
        `${shadow}: ${fmt(kpi)}  vs Naked: ${vsNaked.pass ? 'PASS' : 'FAIL'} ${vsNaked.reason}${extra}`,
      );
    }
  } finally {
    fs.writeFileSync(WEIGHTS, original);
    const restored = (JSON.parse(fs.readFileSync(WEIGHTS, 'utf-8')) as { realWinRateWeight: number })
      .realWinRateWeight;
    console.log(`\naxis-weights.json restored (realWinRateWeight=${restored})`);
  }

  const clusterCols = ['baseline', 'combat_pc1', ...SHADOWS];
  const clusterTables: Record<string, HeroRow[]> = {
    baseline: r0Naked.heroTable,
    combat_pc1: r1Pc1.heroTable,
  };
  for (const s of SHADOWS) {
    clusterTables[s] = JSON.parse(fs.readFileSync(path.join(outDir, `${s}-heroTable.json`), 'utf-8')).heroTable;
  }

  const r2 = results.r2_f;
  const drNaked = (r2.kpi.rFavReal ?? 0) - (baseline.rFavReal ?? 0);
  const drPc1 = (r2.kpi.rFavReal ?? 0) - (pc1.rFavReal ?? 0);
  const pick =
    r2.vsPc1?.pass && r2.vsNaked.pass
      ? 'Pick r2_f as R2 feature set (pc1 + body-in-pc1 + explicit + RE=0).'
      : r2.vsNaked.pass && !r2.vsPc1?.pass
        ? 'Stacking body/explicit/RE0 hurt pc1. Keep combat_pc1 as the R2 base, do not ship the combo.'
        : 'r2_f failed vs Naked. Keep combat_pc1.';

  const lines = [
    `# R2 Battle f — ${RUN_ID}`,
    '',
    'Hidden calibration OFF, open/revealable ON, `realWinRateWeight=0`.',
    `Pool: mulberry32 seed=${SEED}, ${N_MATCHES} matches.`,
    'r2_f = combat_pc1 + body damping inside PC1 + explicit missing=0 + resource_efficiency weight 0 (shadow only).',
    'farm_need_v2 = replace scaling with clamp(5 + scaling − tempo). Isolated on production weights, not stacked on r2_f.',
    '',
    '## KPI',
    '',
    `| Shadow | r | Δr Naked | Δr pc1 | MAE | ±7 | ≥10 | vs Naked | vs pc1 |`,
    `|---|---:|---:|---:|---:|---:|---:|---|---|`,
    `| Naked+open | ${baseline.rFavReal?.toFixed(3)} | — | — | ${baseline.maePp.toFixed(2)} | ${baseline.coverage7Pct.toFixed(1)}% | ${baseline.flagged10} | — | — |`,
    `| combat_pc1 (R1) | ${pc1.rFavReal?.toFixed(3)} | +${((pc1.rFavReal ?? 0) - (baseline.rFavReal ?? 0)).toFixed(3)} | — | ${pc1.maePp.toFixed(2)} | ${pc1.coverage7Pct.toFixed(1)}% | ${pc1.flagged10} | PASS | — |`,
    ...SHADOWS.map((s) => {
      const row = results[s];
      const dn = (row.kpi.rFavReal ?? 0) - (baseline.rFavReal ?? 0);
      const dp = (row.kpi.rFavReal ?? 0) - (pc1.rFavReal ?? 0);
      const vsP = row.vsPc1 ? `${row.vsPc1.pass ? 'PASS' : 'FAIL'} ${row.vsPc1.reason}` : 'n/a (isolated)';
      return `| ${s} | ${row.kpi.rFavReal?.toFixed(3)} | ${dn >= 0 ? '+' : ''}${dn.toFixed(3)} | ${dp >= 0 ? '+' : ''}${dp.toFixed(3)} | ${row.kpi.maePp.toFixed(2)} | ${row.kpi.coverage7Pct.toFixed(1)}% | ${row.kpi.flagged10} | ${row.vsNaked.pass ? 'PASS' : 'FAIL'} ${row.vsNaked.reason} | ${vsP} |`;
    }),
    '',
    `r2_f vs Naked Δr=${drNaked >= 0 ? '+' : ''}${drNaked.toFixed(3)}; vs pc1 Δr=${drPc1 >= 0 ? '+' : ''}${drPc1.toFixed(3)}.`,
    pick,
    '',
    '## Cluster MAE п.п. (lower better)',
    '',
    `| Cluster | ${clusterCols.join(' | ')} |`,
    `|---|${clusterCols.map(() => '---:').join('|')}|`,
    ...Object.keys(CLUSTERS).map((c) => {
      const rest = clusterCols
        .map((col) => clusterMae(clusterTables[col], CLUSTERS[c])?.toFixed(1) ?? '')
        .join(' | ');
      return `| ${c} | ${rest} |`;
    }),
    '',
    'Production `axis-weights.json` was restored. No coefficients written.',
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
        baseline,
        pc1,
        results,
        pick,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`\n${pick}`);
  console.log(`wrote ${outDir}`);
}

main();
