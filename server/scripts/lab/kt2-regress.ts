// Н3.1 / Н3.3 — what can hero-level features explain about real winRate,
// out of fold by hero? Repeated 10×5 K-fold (nested inner 5-fold for every
// hyper-parameter), plus a permutation null (≥200 shuffles of the target) for
// each procedure AND for "best of all procedures" (winner's curse).
//   cd server && npx ts-node scripts/lab/kt2-regress.ts
// Env: LAB_PERMS (200), LAB_NULL_REPEATS (3), LAB_PAR (12).
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { DATA_DIR, REPO_ROOT, appendRun, ensureLabDir, mulberry32 } from './lab-common';
import { MODELS, oof, type Mat, type Model } from './lab-ml';
import { pairedDelta, pearson, spearman, bootstrapRuler } from './lab-metrics';
import { AXES } from '../../src/assessment-core/axes';

const OUT = ensureLabDir('kt2', 'regress');
const PERMS = Number(process.env.LAB_PERMS ?? 200);
const NULL_REPEATS = Number(process.env.LAB_NULL_REPEATS ?? 3);
const MAIN_REPEATS = 10;

// ---------- features (local data only) ----------
interface HeroJ {
  id: number;
  name: string;
  primary_attribute: string;
  attack_type: string;
  roles: string[];
  evaluation_values: Record<string, number>;
  vision_ability_tier: number;
  mobility_ability_tier: number;
  mobility_items_tier: number;
}
export function buildFeatures() {
  const heroes: HeroJ[] = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'heroes.json'), 'utf-8'));
  const meta = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'hero-meta.json'), 'utf-8')).heroes as {
    heroId: number;
    winRate: number;
    positions: { position: string; share: number }[];
    matchups: { games: number }[];
    benchmarks: Record<string, { percentile: number; value: number }[]> | null;
  }[];
  const consts = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'hero-constants.json'), 'utf-8')) as Record<string, Record<string, number>>;
  const pro = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'pro-matches.json'), 'utf-8')).matches as { radiantHeroIds: number[]; direHeroIds: number[] }[];
  const proPicks = new Map<number, number>();
  for (const m of pro) for (const id of [...m.radiantHeroIds, ...m.direHeroIds]) proPicks.set(id, (proPicks.get(id) ?? 0) + 1);
  const metaById = new Map(meta.map((e) => [e.heroId, e]));
  const ROLE_LIST = ['Carry', 'Escape', 'Nuker', 'Initiator', 'Durable', 'Disabler', 'Support', 'Pusher'];
  const CONST_KEYS = ['base_health_regen', 'base_armor', 'base_attack_min', 'base_str', 'base_agi', 'base_int', 'str_gain', 'agi_gain', 'int_gain', 'attack_range', 'attack_rate', 'attack_point', 'move_speed', 'night_vision'];
  const BENCH = ['gold_per_min', 'xp_per_min', 'kills_per_min', 'deaths_per_min', 'assists_per_min', 'last_hits_per_min', 'denies_per_min', 'hero_damage_per_min', 'hero_healing_per_min', 'tower_damage'];
  const groups: Record<string, string[]> = { axes: [], pos: [], attr: [], kit: [], consts: [], pop: [], bench: [] };
  const rows = heroes.map((h) => {
    const m = metaById.get(h.id)!;
    const c = consts[String(h.id)] ?? {};
    const f: Record<string, number> = {};
    for (const a of AXES) f[`axes_${a}`] = h.evaluation_values[a] ?? 0;
    for (const p of ['Carry', 'Mid', 'Offlane', 'Support']) f[`pos_${p}`] = m.positions.find((x) => x.position === p)?.share ?? 0;
    for (const a of ['str', 'agi', 'int', 'all']) f[`attr_${a}`] = h.primary_attribute === a ? 1 : 0;
    f.kit_melee = h.attack_type === 'Melee' ? 1 : 0;
    for (const r of ROLE_LIST) f[`kit_role_${r}`] = h.roles.includes(r) ? 1 : 0;
    f.kit_visionTier = h.vision_ability_tier ?? 0;
    f.kit_mobTier = h.mobility_ability_tier ?? 0;
    f.kit_mobItemsTier = h.mobility_items_tier ?? 0;
    for (const k of CONST_KEYS) f[`consts_${k}`] = Number(c[k] ?? 0);
    f.pop_logProMatchupGames = Math.log(m.matchups.reduce((s, x) => s + x.games, 0) / 5 + 1);
    f.pop_logProMatchPicks = Math.log((proPicks.get(h.id) ?? 0) + 1);
    for (const b of BENCH) f[`bench_${b}`] = m.benchmarks?.[b]?.find((x) => Math.abs(x.percentile - 0.5) < 1e-9)?.value ?? 0;
    return { id: h.id, name: h.name, y: m.winRate, f };
  });
  for (const k of Object.keys(rows[0].f)) groups[k.split('_')[0]].push(k);
  return { rows, groups };
}

const { rows, groups } = buildFeatures();
const Y = rows.map((r) => r.y);
const sel = (names: string[]): Mat => rows.map((r) => names.map((k) => r.f[k]));

// Feature sets. B = game-design features (class B); bench is outcome-contaminated
// (per-minute stats of a winning hero are better *because* it wins) → reported, flagged.
const FS: Record<string, string[]> = {
  pos: groups.pos,
  attr: groups.attr,
  pop: groups.pop,
  axes: groups.axes,
  'axes+pos+attr': [...groups.axes, ...groups.pos, ...groups.attr],
  'B:design (axes+pos+attr+kit+consts)': [...groups.axes, ...groups.pos, ...groups.attr, ...groups.kit, ...groups.consts],
  'B:design+pop': [...groups.axes, ...groups.pos, ...groups.attr, ...groups.kit, ...groups.consts, ...groups.pop],
  'bench (leaky)': groups.bench,
  'all incl. bench (leaky)': Object.values(groups).flat(),
};
const PROC: { id: string; fs: string; model: () => Model }[] = [{ id: 'constant', fs: 'pos', model: MODELS.constant }];
for (const [fs, names] of Object.entries(FS)) {
  const small = names.length <= 6;
  const ms: (keyof typeof MODELS)[] = small ? ['ols', 'ridge'] : ['ridge', 'lasso', 'pls', 'boost'];
  for (const m of ms) PROC.push({ id: `${m}|${fs}`, fs, model: MODELS[m] });
}

function runAll(y: number[], repeats: number, seed: number): Record<string, { r: number; pred: number[] }> {
  const out: Record<string, { r: number; pred: number[] }> = {};
  for (const p of PROC) {
    const o = oof(p.model(), sel(FS[p.fs]), y, repeats, seed);
    out[p.id] = { r: o.r, pred: o.pred };
  }
  return out;
}

const job = process.env.LAB_REG_JOB; // "permStart:permEnd"
if (job) {
  const [a, b] = job.split(':').map(Number);
  const res: Record<string, number[]> = {};
  for (let k = a; k < b; k++) {
    const rng = mulberry32(90000 + k);
    const yp = [...Y];
    for (let i = yp.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [yp[i], yp[j]] = [yp[j], yp[i]];
    }
    const r = runAll(yp, NULL_REPEATS, 500 + k);
    for (const [id, v] of Object.entries(r)) (res[id] ??= []).push(v.r);
  }
  fs.writeFileSync(path.join(OUT, `null-${a}-${b}.json`), JSON.stringify(res));
} else {
  void main();
}

async function main() {
  const t0 = Date.now();
  // nulls in parallel workers
  const par = Number(process.env.LAB_PAR ?? 12);
  const chunk = Math.ceil(PERMS / par);
  const jobs: string[] = [];
  for (let a = 0; a < PERMS; a += chunk) jobs.push(`${a}:${Math.min(PERMS, a + chunk)}`);
  const nullDone = Promise.all(
    jobs.map(
      (j) =>
        new Promise<void>((resolve, reject) => {
          const ch = spawn(process.execPath, ['-r', 'ts-node/register', __filename], { cwd: path.join(REPO_ROOT, 'server'), stdio: 'inherit', env: { ...process.env, LAB_REG_JOB: j } });
          ch.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`null ${j} failed ${c}`))));
        }),
    ),
  );
  // main (10×5) in this process
  const main10 = runAll(Y, MAIN_REPEATS, 1);
  const main3 = runAll(Y, NULL_REPEATS, 2); // same repeat count as the null, for a like-for-like p-value
  await nullDone;
  const nul: Record<string, number[]> = {};
  for (const j of jobs) {
    const part = JSON.parse(fs.readFileSync(path.join(OUT, `null-${j.replace(':', '-')}.json`), 'utf-8')) as Record<string, number[]>;
    for (const [id, v] of Object.entries(part)) (nul[id] ??= []).push(...v);
  }
  const nPerm = nul[PROC[0].id].length;
  const famMax = Array.from({ length: nPerm }, (_, k) => Math.max(...PROC.filter((p) => p.id !== 'constant').map((p) => nul[p.id][k])));
  const q = (arr: number[], p: number) => [...arr].sort((a, b) => a - b)[Math.floor(p * (arr.length - 1))];
  const table = PROC.map((p) => {
    const ci = bootstrapRuler(main10[p.id].pred, Y, 2000);
    return {
      id: p.id,
      nFeatures: FS[p.fs].length,
      oofR10x5: main10[p.id].r,
      oofR3x5: main3[p.id].r,
      rOfAvgPred: { est: ci.r.est, lo: ci.r.lo, hi: ci.r.hi },
      spearmanOfAvgPred: spearman(main10[p.id].pred, Y),
      maeAffPp: ci.maeAffPp.est,
      null: { mean: nul[p.id].reduce((a, b) => a + b, 0) / nPerm, p95: q(nul[p.id], 0.95) },
      pPerm: (nul[p.id].filter((v) => v >= main3[p.id].r).length + 1) / (nPerm + 1),
      pFamily: (famMax.filter((v) => v >= main3[p.id].r).length + 1) / (nPerm + 1),
    };
  });
  // the system's own predictor (no fitting except affine): B-naked / B-full favoredRate
  const per = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'artifacts', 'lab', 'kt1', 'per-hero.json'), 'utf-8')) as Record<string, number>[];
  const perById = new Map(per.map((p) => [p.heroId, p]));
  const sys = (k: string) => rows.map((r) => perById.get(r.id)![k]);
  const best = [...table].filter((t) => !t.id.includes('leaky') && t.id !== 'constant').sort((a, b) => b.oofR10x5 - a.oofR10x5)[0];
  const vsSystem = {
    best: best.id,
    pairedVsBnaked: pairedDelta(sys('B-naked'), main10[best.id].pred, Y, ['r', 'spearman', 'maeAffPp']),
    pairedVsBfull: pairedDelta(sys('B-full'), main10[best.id].pred, Y, ['r', 'spearman', 'maeAffPp']),
    rAxesPredVsBnaked: pearson(main10['ridge|axes'].pred, sys('B-naked')),
  };
  const out = {
    generatedAt: new Date().toISOString(),
    nHeroes: rows.length,
    perms: nPerm,
    nullRepeats: NULL_REPEATS,
    familyMax: { mean: famMax.reduce((a, b) => a + b, 0) / nPerm, p95: q(famMax, 0.95), p99: q(famMax, 0.99) },
    attemptsInFamily: PROC.length - 1,
    table,
    vsSystem,
    featureGroups: groups,
  };
  fs.writeFileSync(path.join(OUT, 'regress.json'), JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(OUT, 'oof-preds.json'), JSON.stringify(rows.map((r, i) => ({ heroId: r.id, name: r.name, real: r.y, ...Object.fromEntries(PROC.map((p) => [p.id, main10[p.id].pred[i]])) }))));
  for (const t of table)
    appendRun({ kind: 'kt2-regress', label: t.id, config: { proc: t.id, cv: '10x5 nested', nullPerms: nPerm, nullRepeats: NULL_REPEATS }, seed: 1, nMatches: 0, metrics: t, wallMs: 0 });
  appendRun({ kind: 'kt2-regress-summary', label: 'family', config: { procs: PROC.map((p) => p.id) }, seed: 1, nMatches: 0, metrics: { familyMax: out.familyMax, best: best.id }, wallMs: Date.now() - t0 });
  console.log(`regress done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
