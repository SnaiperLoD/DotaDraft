// R0 measurement: Naked+open vs Full on the same seeded self-play pool.
// Patches realWinRateWeight→0 for the worker, restores in finally.
// Does NOT write axis-weights / tags / coefficients.
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

const N_MATCHES = Number(process.env.R0_MATCHES ?? 100000);
const SEED = Number(process.env.R0_SEED ?? 1);
const RUN_ID = process.env.R0_RUN_ID ?? 'r0-2026-09-21';

const HIDDEN_CALIBRATION_TAGS = CUSTOM_TAG_DEFINITIONS.filter((d) => !d.visible && !d.revealable).map(
  (d) => d.name,
);
const OPEN_OR_REVEALABLE = CUSTOM_TAG_DEFINITIONS.filter((d) => d.visible || d.revealable).map((d) => d.name);

const COMBAT_AXES: (keyof HeroEvaluationValues)[] = [
  'burst',
  'teamfight',
  'scaling',
  'objectives',
  'durability',
];

interface HeroRow {
  heroId: number;
  name: string;
  appearances?: number;
  favoredRate: number;
  realWinRate: number | null;
  divergenceFromReal?: number | null;
  avgContribution?: number;
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

function rowsFromTable(table: HeroRow[]): Array<HeroRow & { div: number }> {
  return table
    .filter((h) => h.realWinRate != null)
    .map((h) => {
      const favored = h.favoredRate;
      const real = h.realWinRate as number;
      const div = h.divergenceFromReal != null ? h.divergenceFromReal : favored - real;
      return { ...h, realWinRate: real, div };
    });
}

function kpiFromTable(table: HeroRow[]): Kpi {
  const rows = rowsFromTable(table);
  const abs = rows.map((h) => Math.abs(h.div)).sort((a, b) => a - b);
  const r = pearson(
    rows.map((h) => h.favoredRate),
    rows.map((h) => h.realWinRate as number),
  );
  return {
    n: rows.length,
    rFavReal: r,
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
  if (result.status !== 0) {
    throw new Error(`worker failed with status ${String(result.status)}`);
  }
}

function fmtKpi(k: Kpi): string {
  const r = k.rFavReal == null ? 'n/a' : k.rFavReal.toFixed(3);
  return `n=${k.n}  r=${r}  MAE=${k.maePp.toFixed(2)}pp  P95|div|=${k.p95AbsPp.toFixed(2)}pp  ±7 coverage=${k.coverage7Pct.toFixed(1)}%  flagged≥7=${k.flagged7}  ≥10=${k.flagged10}`;
}

function main(): void {
  const outDir = ensureArtifactDir('self-play', RUN_ID);
  const original = fs.readFileSync(WEIGHTS, 'utf-8');
  const productionWeight = (JSON.parse(original) as { realWinRateWeight: number }).realWinRateWeight;

  const heroes: Hero[] = JSON.parse(fs.readFileSync(HEROES, 'utf-8'));
  const heroMeta = JSON.parse(fs.readFileSync(HERO_META, 'utf-8')) as {
    heroes: { heroId: number; positions: { position: string; share: number }[] }[];
  };
  const posById = new Map(heroMeta.heroes.map((e) => [e.heroId, e.positions]));

  const stale: Record<string, Kpi | null> = {};
  for (const file of ['debug-ds-no-tags.json', 'debug-ds-tags.json', 'debug-ds-tags-blend.json']) {
    const p = path.join(DATA_DIR, file);
    if (!fs.existsSync(p)) {
      stale[file] = null;
      continue;
    }
    const ds = JSON.parse(fs.readFileSync(p, 'utf-8')) as { heroTable: HeroRow[]; config?: unknown };
    stale[file] = kpiFromTable(ds.heroTable);
  }

  console.log(`R0 ${RUN_ID}: production rwr=${productionWeight}; honest runs at 0`);
  console.log(`pool: seed=${SEED} nMatches=${N_MATCHES} roleMode=blended (mulberry32 — identical 5v5s across configs)`);
  console.log(`hidden OFF list (${HIDDEN_CALIBRATION_TAGS.length}): ${HIDDEN_CALIBRATION_TAGS.join(', ')}`);
  console.log(`open/revealable kept ON (${OPEN_OR_REVEALABLE.length}): ${OPEN_OR_REVEALABLE.join(', ')}\n`);

  const runs: Array<{ label: string; disabled: string; output: string; summary: string }> = [
    {
      label: 'naked-open',
      disabled: HIDDEN_CALIBRATION_TAGS.join(','),
      output: path.join(outDir, 'naked-open-heroTable.json'),
      summary: path.join(outDir, 'naked-open-summary.json'),
    },
    {
      label: 'full',
      disabled: '',
      output: path.join(outDir, 'full-heroTable.json'),
      summary: path.join(outDir, 'full-summary.json'),
    },
  ];

  try {
    const w = JSON.parse(original) as { realWinRateWeight: number };
    w.realWinRateWeight = 0;
    fs.writeFileSync(WEIGHTS, JSON.stringify(w, null, 2) + '\n');

    for (const run of runs) {
      console.log(`\n--- ${run.label} ---`);
      spawnWorker({
        B0_SEED: String(SEED),
        B0_MATCHES: String(N_MATCHES),
        B0_WRITE_OUTPUT: '1',
        B0_OUTPUT_PATH: run.output,
        B0_SUMMARY_PATH: run.summary,
        DOTADRAFT_DISABLED_TAGS: run.disabled,
      });
    }
  } finally {
    fs.writeFileSync(WEIGHTS, original);
    const restored = (JSON.parse(fs.readFileSync(WEIGHTS, 'utf-8')) as { realWinRateWeight: number })
      .realWinRateWeight;
    console.log(`\naxis-weights.json restored (realWinRateWeight=${restored})`);
  }

  const naked = JSON.parse(fs.readFileSync(path.join(outDir, 'naked-open-heroTable.json'), 'utf-8')) as {
    heroTable: HeroRow[];
    generatedAt?: string;
  };
  const full = JSON.parse(fs.readFileSync(path.join(outDir, 'full-heroTable.json'), 'utf-8')) as {
    heroTable: HeroRow[];
  };

  const kpiNaked = kpiFromTable(naked.heroTable);
  const kpiFull = kpiFromTable(full.heroTable);

  const tagsByHero = new Map<string, { hidden: string[]; open: string[] }>();
  for (const h of heroes) tagsByHero.set(h.name, { hidden: [], open: [] });
  for (const def of CUSTOM_TAG_DEFINITIONS) {
    const bucket = !def.visible && !def.revealable ? 'hidden' : 'open';
    for (const name of def.heroNames) {
      const rec = tagsByHero.get(name);
      if (!rec) continue;
      rec[bucket].push(def.name);
    }
  }

  const fullByName = new Map(rowsFromTable(full.heroTable).map((h) => [h.name, h]));
  const decomp = rowsFromTable(naked.heroTable)
    .map((n) => {
      const hero = heroes.find((h) => h.id === n.heroId);
      const ev = hero?.evaluation_values;
      const positions = posById.get(n.heroId) ?? [];
      const topPos = [...positions].sort((a, b) => b.share - a.share)[0];
      const combatMean = ev ? mean(COMBAT_AXES.map((a) => ev[a] ?? 0)) : null;
      const axisEntries = ev
        ? (Object.entries(ev) as [string, number][]).sort((a, b) => b[1] - a[1])
        : [];
      const f = fullByName.get(n.name);
      const tags = tagsByHero.get(n.name) ?? { hidden: [], open: [] };
      return {
        heroId: n.heroId,
        name: n.name,
        position: topPos?.position ?? '',
        positionShare: topPos?.share ?? 0,
        realWinRatePct: Math.round((n.realWinRate as number) * 1000) / 10,
        nakedFavoredPct: Math.round(n.favoredRate * 1000) / 10,
        nakedDivPp: Math.round(n.div * 1000) / 10,
        fullFavoredPct: f ? Math.round(f.favoredRate * 1000) / 10 : null,
        fullDivPp: f ? Math.round(f.div * 1000) / 10 : null,
        hiddenDeltaPp: f ? Math.round((f.div - n.div) * 1000) / 10 : null,
        combatMean: combatMean == null ? null : Math.round(combatMean * 100) / 100,
        topAxis: axisEntries[0]?.[0] ?? '',
        topAxisValue: axisEntries[0]?.[1] ?? null,
        skirmish: ev?.skirmish_rate ?? null,
        saving: ev?.saving ?? null,
        camp: ev?.camp_stacking ?? null,
        tempo: ev?.tempo ?? null,
        hkbTags: (hero?.tags ?? []).join('|'),
        hiddenTags: tags.hidden.join('|'),
        openTags: tags.open.join('|'),
      };
    })
    .sort((a, b) => Math.abs(b.nakedDivPp) - Math.abs(a.nakedDivPp));

  const csvHeader = Object.keys(decomp[0] ?? {}).join(',');
  const csvEsc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [
    csvHeader,
    ...decomp.map((row) => Object.values(row).map(csvEsc).join(',')),
  ].join('\n');
  fs.writeFileSync(path.join(outDir, 'tail-decomp.csv'), csv + '\n');

  const tailNaked = decomp.filter((r) => Math.abs(r.nakedDivPp) >= 7);
  const tailFull = decomp.filter((r) => r.fullDivPp != null && Math.abs(r.fullDivPp) >= 7);

  const report = [
    `# R0 calibration snapshot — ${RUN_ID}`,
    '',
    'Honest self-play (`realWinRateWeight=0`). Open/revealable tags always ON.',
    'Hidden calibration tags (`visible=false` and `revealable=false`) OFF in Naked+open, ON in Full.',
    '',
    '## Pool',
    '',
    `- Generator: \`simulate-self-play\` mulberry32 seed=${SEED}, blended roles, ${N_MATCHES} matches.`,
    '- Same seed ⇒ identical 5v5 pairings across Naked+open and Full.',
    '- Existing `debug-ds-*.json` (2026-08-12, 200k, seed 1) are **stale**: `no-tags` disabled open tags; roster predates Aug 16 hidden batch; code/weights drifted. Not used as current KPI.',
    '- `axis-percentile-distributions.json` holds 50k unique Ancient+Divine 5-sets as **score samples only**, not stored drafts — cannot replay as a Battle pool.',
    '',
    '## Hidden list (disabled in Naked+open)',
    '',
    HIDDEN_CALIBRATION_TAGS.map((t) => `- ${t}`).join('\n'),
    '',
    '## KPI (primary = Naked+open)',
    '',
    `| Mode | r | MAE п.п. | P95 \\|div\\| | ±7 coverage | ≥7 | ≥10 |`,
    `|---|---:|---:|---:|---:|---:|---:|`,
    `| Naked+open | ${kpiNaked.rFavReal?.toFixed(3)} | ${kpiNaked.maePp.toFixed(2)} | ${kpiNaked.p95AbsPp.toFixed(2)} | ${kpiNaked.coverage7Pct.toFixed(1)}% | ${kpiNaked.flagged7} | ${kpiNaked.flagged10} |`,
    `| Full (hidden ON) | ${kpiFull.rFavReal?.toFixed(3)} | ${kpiFull.maePp.toFixed(2)} | ${kpiFull.p95AbsPp.toFixed(2)} | ${kpiFull.coverage7Pct.toFixed(1)}% | ${kpiFull.flagged7} | ${kpiFull.flagged10} |`,
    '',
    '### Stale debug-ds (historical, do not treat as current)',
    '',
    Object.entries(stale)
      .map(([file, k]) => (k ? `- ${file}: ${fmtKpi(k)}` : `- ${file}: missing`))
      .join('\n'),
    '',
    '## Naked+open tail \\|div\\| ≥ 7 п.п. (sorted by \\|div\\|)',
    '',
    '| Hero | pos | naked | full | hidden Δ | misspec hints |',
    '|---|---|---:|---:|---:|---|',
    ...tailNaked.map(
      (r) =>
        `| ${r.name} | ${r.position} | ${r.nakedDivPp > 0 ? '+' : ''}${r.nakedDivPp} | ${r.fullDivPp == null ? '' : (r.fullDivPp > 0 ? '+' : '') + r.fullDivPp} | ${r.hiddenDeltaPp == null ? '' : (r.hiddenDeltaPp > 0 ? '+' : '') + r.hiddenDeltaPp} | top=${r.topAxis} combat=${r.combatMean} skirm=${r.skirmish} save=${r.saving} hidden=${r.hiddenTags || '—'} open=${r.openTags || '—'} |`,
    ),
    '',
    `Full remaining ≥7: ${tailFull.length} heroes.`,
    '',
    '## Files',
    '',
    `- \`${path.join('artifacts', 'self-play', RUN_ID, 'naked-open-heroTable.json')}\``,
    `- \`${path.join('artifacts', 'self-play', RUN_ID, 'full-heroTable.json')}\``,
    `- \`${path.join('artifacts', 'self-play', RUN_ID, 'tail-decomp.csv')}\``,
  ].join('\n');

  fs.writeFileSync(path.join(outDir, 'kpi.md'), report + '\n');
  fs.writeFileSync(
    path.join(outDir, 'manifest.json'),
    JSON.stringify(
      {
        runId: RUN_ID,
        createdAt: new Date().toISOString(),
        seed: SEED,
        nMatches: N_MATCHES,
        roleMode: 'blended',
        productionRealWinRateWeight: productionWeight,
        honestRealWinRateWeight: 0,
        hiddenCalibrationTags: HIDDEN_CALIBRATION_TAGS,
        openOrRevealableKeptOn: OPEN_OR_REVEALABLE,
        kpi: { nakedOpen: kpiNaked, full: kpiFull, staleDebugDs: stale },
      },
      null,
      2,
    ) + '\n',
  );

  console.log('\n=== R0 KPI ===');
  console.log(`Naked+open: ${fmtKpi(kpiNaked)}`);
  console.log(`Full:       ${fmtKpi(kpiFull)}`);
  console.log(`wrote ${outDir}`);
}

main();
