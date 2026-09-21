// R1 Battle shadow measurement. Hidden calibration OFF, open tags ON,
// same mulberry32 seed as R0. Does not persist axis-weights.json.
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { CUSTOM_TAG_DEFINITIONS } from 'shared';
import { ensureArtifactDir, serverDataDir } from './lib/artifact-paths';
import type { Hero, HeroEvaluationValues } from 'shared';

const DATA_DIR = serverDataDir();
const WEIGHTS = path.join(DATA_DIR, 'axis-weights.json');
const HEROES = path.join(DATA_DIR, 'heroes.json');
const HERO_META = path.join(DATA_DIR, 'hero-meta.json');
const WORKER = path.join(__dirname, 'run-axis-regression-b0-worker.ts');
const R0_DIR = path.join(ensureArtifactDir('self-play', 'r0-2026-09-21'));

const N_MATCHES = Number(process.env.R1_MATCHES ?? 100000);
const SEED = Number(process.env.R1_SEED ?? 1);
const RUN_ID = process.env.R1_RUN_ID ?? 'r1-2026-09-21';

const HIDDEN_CALIBRATION_TAGS = CUSTOM_TAG_DEFINITIONS.filter((d) => !d.visible && !d.revealable).map(
  (d) => d.name,
);

const SHADOWS = ['explicit', 'combat_pc1', 'skirmish_role', 'farm_need', 'body_integrity'] as const;

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

function resourceEfficiencyAudit(): Record<string, number | null> {
  const heroes: Hero[] = JSON.parse(fs.readFileSync(HEROES, 'utf-8'));
  const meta = JSON.parse(fs.readFileSync(HERO_META, 'utf-8')) as {
    heroes: { heroId: number; winRate: number | null }[];
  };
  const wr = new Map(meta.heroes.map((h) => [h.heroId, h.winRate]));
  const other: (keyof HeroEvaluationValues)[] = [
    'teamfight',
    'tempo',
    'scaling',
    'mobility',
    'objectives',
    'control',
    'durability',
    'burst',
    'saving',
    'initiating',
    'skirmish_rate',
  ];
  const re: number[] = [];
  const win: number[] = [];
  const sumNoRe: number[] = [];
  const sumWithRe: number[] = [];
  for (const h of heroes) {
    const w = wr.get(h.id);
    if (w == null) continue;
    re.push(h.evaluation_values.resource_efficiency);
    win.push(w);
    const s = other.reduce((acc, k) => acc + (h.evaluation_values[k] ?? 0), 0);
    sumNoRe.push(s);
    sumWithRe.push(s + h.evaluation_values.resource_efficiency);
  }
  return {
    n: re.length,
    rReWr: pearson(re, win),
    rAxisSumNoReWr: pearson(sumNoRe, win),
    rAxisSumWithReWr: pearson(sumWithRe, win),
  };
}

function fmt(k: Kpi): string {
  const r = k.rFavReal == null ? 'n/a' : k.rFavReal.toFixed(3);
  return `r=${r}  MAE=${k.maePp.toFixed(2)}pp  P95=${k.p95AbsPp.toFixed(2)}pp  ±7=${k.coverage7Pct.toFixed(1)}%  ≥7=${k.flagged7}  ≥10=${k.flagged10}`;
}

function main(): void {
  const outDir = ensureArtifactDir('self-play', RUN_ID);
  const original = fs.readFileSync(WEIGHTS, 'utf-8');
  const productionWeight = (JSON.parse(original) as { realWinRateWeight: number }).realWinRateWeight;
  const reAudit = resourceEfficiencyAudit();

  const r0Naked = JSON.parse(
    fs.readFileSync(path.join(R0_DIR, 'naked-open-heroTable.json'), 'utf-8'),
  ) as { heroTable: HeroRow[] };
  const baseline = kpiFromTable(r0Naked.heroTable);
  const rFloor = (baseline.rFavReal ?? 0) - 0.02;
  const covFloor = baseline.coverage7Pct;

  console.log(`R1 ${RUN_ID}: production rwr=${productionWeight}; honest 0; hidden OFF; open ON`);
  console.log(`pool seed=${SEED} n=${N_MATCHES} (same generator as R0)`);
  console.log(`baseline Naked+open: ${fmt(baseline)}`);
  console.log(
    `stop: r < ${rFloor.toFixed(3)} or ±7 coverage < ${covFloor.toFixed(1)}% → fail that shadow\n`,
  );
  console.log(
    `R1.5 resource_efficiency: n=${reAudit.n} r(RE,WR)=${reAudit.rReWr?.toFixed(3)}  r(sum\\RE,WR)=${reAudit.rAxisSumNoReWr?.toFixed(3)}  r(sum+RE,WR)=${reAudit.rAxisSumWithReWr?.toFixed(3)}\n`,
  );

  const results: Record<string, { kpi: Kpi; pass: boolean; reason: string; clusters: Record<string, number | null> }> =
    {};

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
      const r = kpi.rFavReal ?? -1;
      const failR = r < rFloor;
      const failCov = kpi.coverage7Pct < covFloor - 0.05;
      const pass = !failR && !failCov;
      const reason = pass
        ? 'pass'
        : [failR ? `r ${r.toFixed(3)} < ${rFloor.toFixed(3)}` : '', failCov ? `coverage ${kpi.coverage7Pct.toFixed(1)} < ${covFloor.toFixed(1)}` : '']
            .filter(Boolean)
            .join('; ');
      const clusters: Record<string, number | null> = {};
      for (const [name, heroes] of Object.entries(CLUSTERS)) {
        clusters[name] = clusterMae(table, heroes);
      }
      results[shadow] = { kpi, pass, reason, clusters };
      console.log(`${shadow}: ${fmt(kpi)}  ${pass ? 'PASS' : 'FAIL'} ${reason}`);
    }
  } finally {
    fs.writeFileSync(WEIGHTS, original);
    const restored = (JSON.parse(fs.readFileSync(WEIGHTS, 'utf-8')) as { realWinRateWeight: number })
      .realWinRateWeight;
    console.log(`\naxis-weights.json restored (realWinRateWeight=${restored})`);
  }

  const baselineClusters: Record<string, number | null> = {};
  for (const [name, heroes] of Object.entries(CLUSTERS)) {
    baselineClusters[name] = clusterMae(r0Naked.heroTable, heroes);
  }

  const lines = [
    `# R1 Battle shadows — ${RUN_ID}`,
    '',
    'Hidden calibration OFF, open/revealable ON, `realWinRateWeight=0`.',
    `Pool: mulberry32 seed=${SEED}, ${N_MATCHES} matches (same as R0 Naked+open).`,
    `Stop: r drop > 0.02 vs baseline ${baseline.rFavReal?.toFixed(3)}, or ±7 coverage worse than ${baseline.coverage7Pct.toFixed(1)}%.`,
    '',
    '## R1.5 resource_efficiency (local correlation, no self-play)',
    '',
    `| | r |`,
    `|---|---:|`,
    `| resource_efficiency vs realWR | ${reAudit.rReWr?.toFixed(3)} |`,
    `| axisSum without RE vs realWR | ${reAudit.rAxisSumNoReWr?.toFixed(3)} |`,
    `| axisSum with RE vs realWR | ${reAudit.rAxisSumWithReWr?.toFixed(3)} |`,
    '',
    reAudit.rAxisSumWithReWr != null &&
    reAudit.rAxisSumNoReWr != null &&
    reAudit.rAxisSumWithReWr <= reAudit.rAxisSumNoReWr
      ? 'Verdict: RE does not add roster-level WR signal on top of the other axes. Battle weight 0.5 is unjustified from this audit.'
      : 'Verdict: RE adds a little roster-level signal; keep as candidate, do not raise weight without a Battle shadow.',
    '',
    '## Shadows vs Naked+open',
    '',
    `| Shadow | r | Δr | MAE | ±7 | ≥10 | gate |`,
    `|---|---:|---:|---:|---:|---:|---|`,
    `| Naked+open baseline | ${baseline.rFavReal?.toFixed(3)} | — | ${baseline.maePp.toFixed(2)} | ${baseline.coverage7Pct.toFixed(1)}% | ${baseline.flagged10} | — |`,
    ...SHADOWS.map((s) => {
      const r = results[s];
      const dr = (r.kpi.rFavReal ?? 0) - (baseline.rFavReal ?? 0);
      return `| ${s} | ${r.kpi.rFavReal?.toFixed(3)} | ${dr >= 0 ? '+' : ''}${dr.toFixed(3)} | ${r.kpi.maePp.toFixed(2)} | ${r.kpi.coverage7Pct.toFixed(1)}% | ${r.kpi.flagged10} | ${r.pass ? 'PASS' : 'FAIL'} ${r.reason} |`;
    }),
    '',
    '## Cluster MAE п.п. (lower better)',
    '',
    `| Cluster | baseline | ${SHADOWS.join(' | ')} |`,
    `|---|---:|${SHADOWS.map(() => '---:').join('|')}|`,
    ...Object.keys(CLUSTERS).map((c) => {
      const b = baselineClusters[c]?.toFixed(1) ?? '';
      const rest = SHADOWS.map((s) => results[s].clusters[c]?.toFixed(1) ?? '').join(' | ');
      return `| ${c} | ${b} | ${rest} |`;
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
        resourceEfficiencyAudit: reAudit,
        results,
        rFloor,
        covFloor,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`\nwrote ${outDir}`);
}

main();
