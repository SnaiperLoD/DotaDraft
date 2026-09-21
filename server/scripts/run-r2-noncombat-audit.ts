// Local residual audit on the frozen r2_f_farm hero table.
// Correlates div with the axes that still enter outside PC1, and with
// late-minus-early solo power. Does not write tags, multipliers, or
// axis-weights.json. Does not launch self-play.
import * as fs from 'fs';
import * as path from 'path';
import { CUSTOM_TAG_DEFINITIONS, type Hero, type HeroEvaluationValues } from 'shared';
import { AXES } from '../src/assessment-core/axes';
import { axisWeightsConfig, type GamePhase } from '../src/common/axis-weights-config';
import { shadowOverallPowerForPhase } from '../src/battle/battle-shadow';
import { ensureArtifactDir, serverDataDir } from './lib/artifact-paths';

const TABLE =
  process.env.R2_NONCOMBAT_TABLE ??
  path.join(ensureArtifactDir('self-play', 'r2-farm-2026-09-21'), 'r2_f_farm-heroTable.json');
const RUN_ID = process.env.R2_NONCOMBAT_RUN_ID ?? 'r2-noncombat-2026-09-21';

const PHASES: GamePhase[] = ['early', 'mid', 'late'];
const COMBAT = new Set<keyof HeroEvaluationValues>(['burst', 'scaling', 'objectives', 'teamfight', 'durability']);
const CANDIDATES: (keyof HeroEvaluationValues)[] = ['saving', 'tempo', 'skirmish_rate', 'initiating'];
const CONTEXT: (keyof HeroEvaluationValues)[] = ['control', 'burst', 'durability', 'teamfight'];
const SPOTLIGHT = [
  'Keeper of the Light',
  'Pugna',
  'Snapfire',
  'Necrophos',
  'Phoenix',
  'Spectre',
  'Phantom Lancer',
  'Medusa',
  'Crystal Maiden',
  'Shadow Shaman',
  'Sand King',
  'Pangolier',
];

const HIDDEN = CUSTOM_TAG_DEFINITIONS.filter((d) => !d.visible && !d.revealable);

interface HeroRow {
  name: string;
  favoredRate: number;
  realWinRate: number | null;
  divergenceFromReal?: number | null;
}

interface Sample {
  name: string;
  div: number;
  hidden: string[];
  axes: HeroEvaluationValues;
  early: number;
  mid: number;
  late: number;
  delta: number;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3) return NaN;
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
  if (dx === 0 || dy === 0) return NaN;
  return num / Math.sqrt(dx * dy);
}

function solve(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    }
    [m[col], m[pivot]] = [m[pivot], m[col]];
    const div = m[col][col];
    if (Math.abs(div) < 1e-12) throw new Error('singular OLS');
    for (let c = col; c <= n; c++) m[col][c] /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col];
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }
  return m.map((row) => row[n]);
}

function ols(y: number[], cols: number[][]): { beta: number[]; resid: number[] } {
  const n = y.length;
  const k = cols.length + 1;
  const xtx = Array.from({ length: k }, () => Array(k).fill(0));
  const xty = Array(k).fill(0);
  for (let i = 0; i < n; i++) {
    const row = [1, ...cols.map((c) => c[i])];
    for (let a = 0; a < k; a++) {
      xty[a] += row[a] * y[i];
      for (let b = 0; b < k; b++) xtx[a][b] += row[a] * row[b];
    }
  }
  const beta = solve(xtx, xty);
  const resid = y.map((yi, i) => {
    let fit = beta[0];
    cols.forEach((c, j) => {
      fit += beta[j + 1] * c[i];
    });
    return yi - fit;
  });
  return { beta, resid };
}

function zscore(xs: number[]): number[] {
  const m = mean(xs);
  const s = Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
  if (s === 0) return xs.map(() => 0);
  return xs.map((x) => (x - m) / s);
}

function r2Weight(axis: keyof HeroEvaluationValues, phase: GamePhase): number {
  if (axis === 'resource_efficiency') return 0;
  const phaseW = axisWeightsConfig.phaseWeights?.[phase]?.[axis];
  if (phaseW !== undefined) return phaseW;
  return axisWeightsConfig.axisWeights[axis] ?? 0;
}

function budgetLines(): string[] {
  const dist = axisWeightsConfig.phaseDistribution ?? { early: 0.15, mid: 0.35, late: 0.5 };
  const lines = [
    '## Weight budget inside r2_f_farm',
    '',
    'Combat axes are collapsed into PC1 but still spend this budget. Missing key = 0. resource_efficiency = 0.',
    '',
    '| Phase | share | combat budget | non-combat budget | non-combat axes |',
    '|---|---:|---:|---:|---|',
  ];
  for (const phase of PHASES) {
    let combat = 0;
    let other = 0;
    const named: string[] = [];
    for (const axis of AXES) {
      const w = r2Weight(axis, phase);
      if (w === 0) continue;
      if (COMBAT.has(axis)) combat += w;
      else {
        other += w;
        named.push(`${axis} ${w}`);
      }
    }
    lines.push(`| ${phase} | ${dist[phase]} | ${combat.toFixed(2)} | ${other.toFixed(2)} | ${named.join(', ')} |`);
  }
  lines.push('');
  return lines;
}

function corrTable(rows: Sample[], axes: (keyof HeroEvaluationValues)[]): string[] {
  const div = rows.map((r) => r.div);
  const lines = ['| Axis | r(div) |', '|---|---:|'];
  for (const axis of axes) {
    const r = pearson(
      rows.map((h) => h.axes[axis]),
      div,
    );
    lines.push(`| ${axis} | ${r.toFixed(3)} |`);
  }
  return lines;
}

function fmtPp(x: number): string {
  return (x * 100).toFixed(1);
}

function main(): void {
  if (!fs.existsSync(TABLE)) throw new Error(`missing hero table: ${TABLE}`);
  const heroes = JSON.parse(fs.readFileSync(path.join(serverDataDir(), 'heroes.json'), 'utf-8')) as Hero[];
  const byName = new Map(heroes.map((h) => [h.name, h]));
  const table = (JSON.parse(fs.readFileSync(TABLE, 'utf-8')) as { heroTable: HeroRow[] }).heroTable;

  const rows: Sample[] = [];
  const missing: string[] = [];
  for (const row of table) {
    if (row.realWinRate == null) continue;
    const hero = byName.get(row.name);
    if (!hero) {
      missing.push(row.name);
      continue;
    }
    const div = row.divergenceFromReal != null ? row.divergenceFromReal : row.favoredRate - row.realWinRate;
    const pick = [{ hero, assignedRole: null }];
    const early = shadowOverallPowerForPhase(pick, 'early', undefined, 'r2_f_farm');
    const mid = shadowOverallPowerForPhase(pick, 'mid', undefined, 'r2_f_farm');
    const late = shadowOverallPowerForPhase(pick, 'late', undefined, 'r2_f_farm');
    rows.push({
      name: row.name,
      div,
      hidden: HIDDEN.filter((d) => d.heroNames.includes(row.name)).map((d) => d.name),
      axes: hero.evaluation_values,
      early,
      mid,
      late,
      delta: late - early,
    });
  }

  const untagged = rows.filter((r) => r.hidden.length === 0);
  const tagged = rows.filter((r) => r.hidden.length > 0);

  const divAll = rows.map((r) => r.div);
  const deltaAll = rows.map((r) => r.delta);
  const rDelta = pearson(deltaAll, divAll);
  const rDeltaUntagged = pearson(
    untagged.map((r) => r.delta),
    untagged.map((r) => r.div),
  );

  const candCols = CANDIDATES.map((axis) => rows.map((r) => r.axes[axis]));
  const olsRaw = ols(divAll, candCols);
  const olsZ = ols(
    zscore(divAll),
    candCols.map((c) => zscore(c)),
  );
  const untCols = CANDIDATES.map((axis) => untagged.map((r) => r.axes[axis]));
  const olsUntZ = ols(
    zscore(untagged.map((r) => r.div)),
    untCols.map((c) => zscore(c)),
  );

  const deltaResid = ols(
    deltaAll,
    candCols,
  ).resid;
  const partialDelta = pearson(deltaResid, olsRaw.resid);

  const highSaving = rows.filter((r) => r.axes.saving >= 6);
  const lowSaving = rows.filter((r) => r.axes.saving <= 2);
  const backLoaded = [...rows].sort((a, b) => b.delta - a.delta).slice(0, 15);
  const frontLoaded = [...rows].sort((a, b) => a.delta - b.delta).slice(0, 15);

  const spot = SPOTLIGHT.map((name) => rows.find((r) => r.name === name)).filter((r): r is Sample => r != null);

  const lines = [
    `# Non-combat residual audit — ${RUN_ID}`,
    '',
    `Source table: ${TABLE}`,
    'div = favoredRate − realWR on r2_f_farm (hidden OFF, open ON). Positive = overrated.',
    'Solo power is one hero, assignedRole null, no tag effects, same r2_f_farm phase function as Battle shadow.',
    'This is the card, not a replay of that hero inside 5v5. No self-play. No weights written.',
    missing.length ? `Heroes in the table missing from heroes.json: ${missing.join(', ')}` : '',
    '',
    ...budgetLines(),
    '## Pearson r(axis, div)',
    '',
    `n all = ${rows.length}, untagged = ${untagged.length}, tagged = ${tagged.length}.`,
    '',
    '### Candidates (still weighted outside PC1)',
    '',
    'All heroes',
    '',
    ...corrTable(rows, CANDIDATES),
    '',
    'Untagged only',
    '',
    ...corrTable(untagged, CANDIDATES),
    '',
    'Tagged only (context: these already have a flat crutch)',
    '',
    ...corrTable(tagged, CANDIDATES),
    '',
    '### Context axes (not ablation candidates)',
    '',
    ...corrTable(rows, CONTEXT),
    '',
    '## OLS div ~ saving + tempo + skirmish_rate + initiating',
    '',
    'Standardized beta (z-scored div and predictors, intercept omitted). Raw beta is div per 1 point of the 0–10 axis.',
    '',
    '| Predictor | std beta all | raw beta all (div per point) | std beta untagged |',
    '|---|---:|---:|---:|',
    ...CANDIDATES.map((axis, i) => {
      return `| ${axis} | ${olsZ.beta[i + 1].toFixed(3)} | ${olsRaw.beta[i + 1].toFixed(4)} | ${olsUntZ.beta[i + 1].toFixed(3)} |`;
    }),
    '',
    `Raw intercept (div at axes = 0, not a meaningful hero): ${olsRaw.beta[0].toFixed(4)}`,
    '',
    '## Phase shape',
    '',
    `r(late − early, div) all = ${rDelta.toFixed(3)}`,
    `r(late − early, div) untagged = ${rDeltaUntagged.toFixed(3)}`,
    `partial r(late − early, div | the four axes) all = ${partialDelta.toFixed(3)}`,
    '',
    'Partial is after residualizing both sides on saving, tempo, skirmish_rate, initiating.',
    '',
    `saving ≥ 6: n=${highSaving.length}, mean div ${fmtPp(mean(highSaving.map((r) => r.div)))} pp, MAE ${fmtPp(mean(highSaving.map((r) => Math.abs(r.div))))} pp`,
    `saving ≤ 2: n=${lowSaving.length}, mean div ${fmtPp(mean(lowSaving.map((r) => r.div)))} pp, MAE ${fmtPp(mean(lowSaving.map((r) => Math.abs(r.div))))} pp`,
    '',
    '### Most back-loaded (high late − early)',
    '',
    '| Hero | late−early | early | late | div pp | hidden |',
    '|---|---:|---:|---:|---:|---|',
    ...backLoaded.map(
      (h) => `| ${h.name} | ${h.delta.toFixed(2)} | ${h.early.toFixed(2)} | ${h.late.toFixed(2)} | ${fmtPp(h.div)} | ${h.hidden.join(', ') || '—'} |`,
    ),
    '',
    '### Most front-loaded (low late − early)',
    '',
    '| Hero | late−early | early | late | div pp | hidden |',
    '|---|---:|---:|---:|---:|---|',
    ...frontLoaded.map(
      (h) => `| ${h.name} | ${h.delta.toFixed(2)} | ${h.early.toFixed(2)} | ${h.late.toFixed(2)} | ${fmtPp(h.div)} | ${h.hidden.join(', ') || '—'} |`,
    ),
    '',
    '## Spotlight cards',
    '',
    '| Hero | div pp | saving | tempo | skirmish | initiating | early | mid | late | late−early |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...spot.map(
      (h) =>
        `| ${h.name} | ${fmtPp(h.div)} | ${h.axes.saving.toFixed(1)} | ${h.axes.tempo.toFixed(1)} | ${h.axes.skirmish_rate.toFixed(1)} | ${h.axes.initiating.toFixed(1)} | ${h.early.toFixed(2)} | ${h.mid.toFixed(2)} | ${h.late.toFixed(2)} | ${h.delta.toFixed(2)} |`,
    ),
    '',
    'No weights written. A shadow (saving = 0, or a phase-mix shift) only if this file shows a live slope.',
  ];

  const outDir = ensureArtifactDir('self-play', RUN_ID);
  const text = lines.join('\n') + '\n';
  fs.writeFileSync(path.join(outDir, 'kpi.md'), text);
  fs.writeFileSync(
    path.join(outDir, 'manifest.json'),
    JSON.stringify(
      {
        runId: RUN_ID,
        createdAt: new Date().toISOString(),
        table: TABLE,
        n: rows.length,
        correlations: {
          all: Object.fromEntries(CANDIDATES.map((axis) => [axis, pearson(rows.map((h) => h.axes[axis]), divAll)])),
          untagged: Object.fromEntries(
            CANDIDATES.map((axis) => [axis, pearson(untagged.map((h) => h.axes[axis]), untagged.map((h) => h.div))]),
          ),
          lateMinusEarly: rDelta,
          lateMinusEarlyUntagged: rDeltaUntagged,
          partialLateMinusEarly: partialDelta,
        },
        standardizedBetaAll: Object.fromEntries(CANDIDATES.map((axis, i) => [axis, olsZ.beta[i + 1]])),
        standardizedBetaUntagged: Object.fromEntries(CANDIDATES.map((axis, i) => [axis, olsUntZ.beta[i + 1]])),
      },
      null,
      2,
    ) + '\n',
  );
  console.log(text);
  console.log(`wrote ${outDir}`);
}

main();
