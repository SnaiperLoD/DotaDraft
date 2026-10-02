// Н1.1 gate: reproduce R0 Naked+open and R0 Full (hidden ON) on seed=1 × 100k,
// realWinRateWeight=0 in memory (no file patching). Runs the two configs as
// child processes (tags are baked at import). Appends both to runs.jsonl.
//   cd server && npx ts-node scripts/lab/reproduce-r0.ts
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { HIDDEN_CALIBRATION_TAGS, REPO_ROOT, appendRun, ensureLabDir, kpi, type HeroRow } from './lab-common';

const SEED = Number(process.env.LAB_SEED ?? 1);
const N = Number(process.env.LAB_MATCHES ?? 100000);

const EXPECTED: Record<string, { r: number; maePp: number; coverage7Pct: number; flagged10: number }> = {
  'naked-open': { r: 0.094, maePp: 8.68, coverage7Pct: 46.5, flagged10: 46 },
  full: { r: 0.381, maePp: 6.39, coverage7Pct: 61.4, flagged10: 27 },
};
const TOL_R = 0.01;
const TOL_MAE = 0.15;

const outDir = ensureLabDir('r0', `seed${SEED}-n${N}`);
const runs = [
  { label: 'naked-open', disabled: HIDDEN_CALIBRATION_TAGS.join(',') },
  { label: 'full', disabled: '' },
];

let allPass = true;
for (const run of runs) {
  const out = path.join(outDir, `${run.label}-heroTable.json`);
  const t0 = Date.now();
  const res = spawnSync(process.execPath, ['-r', 'ts-node/register', path.join(__dirname, 'r0-worker.ts')], {
    cwd: path.join(REPO_ROOT, 'server'),
    encoding: 'utf-8',
    stdio: 'inherit',
    env: {
      ...process.env,
      LAB_SEED: String(SEED),
      LAB_MATCHES: String(N),
      LAB_RWR: '0',
      LAB_OUT: out,
      DOTADRAFT_DISABLED_TAGS: run.disabled,
      DOTADRAFT_BATTLE_SHADOW: '',
    },
  });
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error(`worker ${run.label} failed: ${res.status}`);
  const wallProcMs = Date.now() - t0;
  const data = JSON.parse(fs.readFileSync(out, 'utf-8')) as { wallMs: number; heroTable: HeroRow[] };
  const k = kpi(data.heroTable);
  const exp = EXPECTED[run.label];
  const pass =
    SEED === 1 && N === 100000 ? Math.abs(k.r - exp.r) <= TOL_R && Math.abs(k.maePp - exp.maePp) <= TOL_MAE : null;
  if (pass === false) allPass = false;

  // Per-hero drift vs the original 2026-09-21 R0 artifact, if present.
  let driftVsR0: { maxAbsFavPp: number; heroesOver0_1pp: number } | null = null;
  const old = path.join(REPO_ROOT, 'artifacts', 'self-play', 'r0-2026-09-21', `${run.label}-heroTable.json`);
  if (fs.existsSync(old) && SEED === 1 && N === 100000) {
    const oldRows = (JSON.parse(fs.readFileSync(old, 'utf-8')) as { heroTable: HeroRow[] }).heroTable;
    const byId = new Map(oldRows.map((h) => [h.heroId, h.favoredRate]));
    const d = data.heroTable.map((h) => Math.abs(h.favoredRate - (byId.get(h.heroId) ?? NaN)) * 100);
    driftVsR0 = { maxAbsFavPp: Math.max(...d), heroesOver0_1pp: d.filter((x) => !(x <= 0.1)).length };
  }

  console.log(
    `${run.label}: r=${k.r.toFixed(4)} (exp ${exp.r}) MAE=${k.maePp.toFixed(2)} (exp ${exp.maePp}) ±7=${k.coverage7Pct.toFixed(1)}% (exp ${exp.coverage7Pct}) ≥10=${k.flagged10} (exp ${exp.flagged10}) pass=${pass} sim=${(data.wallMs / 1000).toFixed(1)}s proc=${(wallProcMs / 1000).toFixed(1)}s drift=${JSON.stringify(driftVsR0)}`,
  );
  appendRun({
    kind: 'r0-reproduction',
    label: run.label,
    config: { seed: SEED, nMatches: N, rwr: 0, roleMode: 'blended', disabledTags: run.disabled, shadow: 'off' },
    seed: SEED,
    nMatches: N,
    metrics: { ...k, expected: exp, pass, driftVsR0 },
    wallMs: data.wallMs,
    notes: `runSimulation (2 assessBattle/match incl. no-role counterfactual); process wall ${wallProcMs}ms`,
  });
}
console.log(allPass ? 'R0 GATE: PASS' : 'R0 GATE: FAIL');
process.exitCode = allPass ? 0 : 1;
