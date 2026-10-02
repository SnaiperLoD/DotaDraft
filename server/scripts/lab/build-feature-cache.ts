// Builds the feature cache for one tag set by running PRODUCTION assessBattle()
// over the fixed blended pool, plus the weight-independent pieces the replay
// needs. Driver mode (no LAB_CACHE_LABEL): spawns one child per tag set,
// because DOTADRAFT_DISABLED_TAGS is baked at import.
//   cd server && npx ts-node scripts/lab/build-feature-cache.ts      (seed 1 × 100k, both tag sets)
//   LAB_SEED=2 npx ts-node scripts/lab/build-feature-cache.ts
// Output: artifacts/lab/cache/seed<S>-n<N>-<label>/
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { HeroEvaluationValues } from 'shared';
import { ROLES, CUSTOM_TAG_DEFINITIONS } from 'shared';
import {
  HIDDEN_CALIBRATION_TAGS,
  REPO_ROOT,
  appendRun,
  assertLabPreconditions,
  ensureLabDir,
  generatePool,
  type PoolMatch,
  loadHeroes,
  setRealWinRateWeightInMemory,
} from './lab-common';
import { NA, NP, PHASES, SIDE_FIELDS, cacheDir, productionParams, taggedPower, replayDiff, type FeatureCache } from './feature-cache';
import { AXES } from '../../src/assessment-core/axes';
import { assessBattle, type BattlePick } from '../../src/battle/battle-resolution';
import { axisAverage } from '../../src/assessment-core/axis-average';
import {
  blessingEffectsFor,
  curseEffectsOnOpponent,
  emptyTagEffects,
  mergeTagEffects,
  highSkillHeroesOn,
  mechanicalHeroesOn,
  isTagDisabled,
} from '../../src/battle/custom-tags';
import { hardCarryAxisMultipliers } from '../../src/common/hard-carry';
import { utilityStackAxisMultipliers } from '../../src/common/utility-stacking';
import { manualPowerMultiplier } from '../../src/common/manual-power-overrides';
import { shutdownHeroes, shutdownHeroMultipliers } from '../../src/common/shutdown';
import { HeroMetaService } from '../../src/hero-meta/hero-meta.service';
import type { Hero } from 'shared';

const SEED = Number(process.env.LAB_SEED ?? 1);
// LAB_POOL_FILE: replay a FIXED list of real matches ({heroIdx[10], roles[10]}) instead
// of the generated self-play pool (used for the public-match safe). seed is then 0.
const POOL_FILE = process.env.LAB_POOL_FILE;
const FIXED_POOL: PoolMatch[] | null = POOL_FILE ? JSON.parse(fs.readFileSync(POOL_FILE, 'utf-8')) : null;
const N = FIXED_POOL ? FIXED_POOL.length : Number(process.env.LAB_MATCHES ?? 100000);
const LABEL = process.env.LAB_CACHE_LABEL;
// Lab-only variants of the tag/penalty layer (never production):
//   noHardCarry, noUtility, noManual, noShutdown — drop that multiplier source
//   noRoles — every pick assignedRole=null (no role-fit / miscast)
//   mirageTax — re-adds retired hidden Mirage Tax (Naga Siren, Terrorblade ×0.85,
//               own-team flat power; code as of 74f517b^) for the 09-21 state
const VARIANTS = new Set((process.env.LAB_VARIANT ?? '').split('+').filter(Boolean));

export const TAG_SETS: Record<string, string> = {
  'naked-open': HIDDEN_CALIBRATION_TAGS.join(','),
  full: '',
  notags: CUSTOM_TAG_DEFINITIONS.map((d) => d.name).join(','),
};

// LAB_BUILDS="seed:tagset[:variant+variant],..." builds in parallel (≤LAB_PAR).
// Default: seed LAB_SEED, tag sets naked-open and full, no variant.
async function driver(): Promise<void> {
  const specs = (process.env.LAB_BUILDS ?? `${SEED}:naked-open,${SEED}:full`).split(',').map((x) => {
    const [seed, tagset, variant = ''] = x.split(':');
    return { seed, tagset, variant, label: variant ? `${tagset}-${variant}` : tagset };
  });
  const par = Number(process.env.LAB_PAR ?? 8);
  let next = 0;
  let failed = 0;
  const runOne = (sp: (typeof specs)[number]) =>
    new Promise<void>((resolve) => {
      const ch = spawn(process.execPath, ['-r', 'ts-node/register', __filename], {
        cwd: path.join(REPO_ROOT, 'server'),
        stdio: 'inherit',
        env: {
          ...process.env,
          LAB_SEED: sp.seed,
          LAB_CACHE_LABEL: sp.label,
          LAB_VARIANT: sp.variant,
          DOTADRAFT_DISABLED_TAGS: TAG_SETS[sp.tagset],
          DOTADRAFT_BATTLE_SHADOW: '',
        },
      });
      ch.on('exit', (code) => {
        if (code !== 0) {
          failed++;
          console.error(`child ${sp.seed}:${sp.label} failed: ${code}`);
        }
        resolve();
      });
    });
  const workers = Array.from({ length: Math.min(par, specs.length) }, async () => {
    while (next < specs.length) await runOne(specs[next++]);
  });
  await Promise.all(workers);
  if (failed) process.exitCode = 1;
}


const MIRAGE_TAX = new Set(['Naga Siren', 'Terrorblade']);

// Mirrors assessBattle() lines that assemble tagEffectsA/B. Copy, but checked:
// taggedPower replayed from T must equal assessment.taggedPowerA/B bit-for-bit.
function tagEffectsFor(team: BattlePick[], opp: BattlePick[], lookup: HeroMetaService) {
  const heroes = team.map((p) => p.hero);
  const oppHeroes = opp.map((p) => p.hero);
  const raw = Object.fromEntries(AXES.map((a) => [a, axisAverage(team, a)])) as Partial<Record<keyof HeroEvaluationValues, number>>;
  const rawOpp = Object.fromEntries(AXES.map((a) => [a, axisAverage(opp, a)])) as Partial<Record<keyof HeroEvaluationValues, number>>;
  const util = new Map<number, Partial<Record<keyof HeroEvaluationValues, number>>>();
  for (const h of heroes) {
    const m = utilityStackAxisMultipliers(h);
    if (Object.keys(m).length > 0) util.set(h.id, m);
  }
  const manual = new Map<number, number>();
  for (const h of heroes) {
    const m = manualPowerMultiplier(h);
    if (m !== 1) manual.set(h.id, m);
  }
  const blessing = blessingEffectsFor(heroes, raw, rawOpp);
  if (VARIANTS.has('mirageTax')) {
    for (const h of heroes)
      if (MIRAGE_TAX.has(h.name)) blessing.heroPowerMultiplier.set(h.id, (blessing.heroPowerMultiplier.get(h.id) ?? 1) * 0.85);
  }
  return mergeTagEffects(
    blessing,
    curseEffectsOnOpponent(oppHeroes, heroes),
    { ...emptyTagEffects(), axisMultiplier: VARIANTS.has('noHardCarry') ? {} : hardCarryAxisMultipliers(heroes) },
    { ...emptyTagEffects(), heroAxisMultiplier: VARIANTS.has('noUtility') ? new Map() : util },
    { ...emptyTagEffects(), heroPowerMultiplier: VARIANTS.has('noManual') ? new Map() : manual },
    {
      ...emptyTagEffects(),
      heroPowerMultiplier: VARIANTS.has('noShutdown') ? new Map() : shutdownHeroMultipliers(shutdownHeroes(heroes, oppHeroes, lookup)),
    },
  );
}

function build(label: string): void {
  assertLabPreconditions();
  const t0 = Date.now();
  const { heroes, positionsById } = loadHeroes();
  const lookup = new HeroMetaService();
  // LAB_HERO_META: lab-only copy of hero-meta.json (e.g. STRATZ pairs). Swapped IN MEMORY on
  // this lookup instance; production file and HeroMetaService code untouched.
  if (process.env.LAB_HERO_META) {
    const alt = JSON.parse(fs.readFileSync(process.env.LAB_HERO_META, 'utf-8')) as { heroes: { heroId: number }[] };
    const map = (lookup as unknown as { byHeroId: Map<number, unknown> }).byHeroId;
    map.clear();
    for (const e of alt.heroes) map.set(e.heroId, e);
  }
  const H = heroes.length;
  const heroIdx = new Int16Array(N * 10);
  const roleIdx = new Int8Array(N * 10);
  const T = new Float64Array(N * 2 * NP * NA);
  const R = new Float64Array(N * 2 * NA);
  const side = new Float64Array(N * 5);
  // flags: [highSkill on A, highSkill on B, mechanical anywhere] (resolveBattle's upset layer)
  const flags = new Int8Array(N * 3);
  const hsOff = isTagDisabled('High Skill');
  const mechOff = isTagDisabled('Mechanical');
  // production counts per rwr (0 = honest KPI, 2 = shipped)
  const RWRS = VARIANTS.size === 0 ? [0, 2] : [0];
  const prod = RWRS.map(() => ({ fav: new Float64Array(H), even: new Float64Array(H), app: new Float64Array(H) }));
  let taggedMismatch = 0;
  let diffMismatch = 0;
  const partial: FeatureCache = { dir: '', meta: { label, seed: SEED, nMatches: N, nHeroes: H, axes: [], phases: [], heroIds: [], heroNames: [], roles: [], disabledTags: '' }, n: N, heroIdx, roleIdx, T, R, side, flags };

  let m = 0;
  for (const match of FIXED_POOL ?? generatePool(heroes, positionsById, SEED, N)) {
    const picks: BattlePick[] = match.heroIdx.map((hi, k) => ({ hero: heroes[hi], assignedRole: VARIANTS.has('noRoles') ? null : match.roles[k] }));
    const teamA = picks.slice(0, 5);
    const teamB = picks.slice(5);
    for (let k = 0; k < 10; k++) {
      heroIdx[m * 10 + k] = match.heroIdx[k];
      roleIdx[m * 10 + k] = (ROLES as readonly string[]).indexOf(match.roles[k]);
    }
    {
      const hA = teamA.map((p) => p.hero);
      const hB = teamB.map((p) => p.hero);
      flags[m * 3] = !hsOff && highSkillHeroesOn(hA).length > 0 ? 1 : 0;
      flags[m * 3 + 1] = !hsOff && highSkillHeroesOn(hB).length > 0 ? 1 : 0;
      flags[m * 3 + 2] = !mechOff && (mechanicalHeroesOn(hA).length > 0 || mechanicalHeroesOn(hB).length > 0) ? 1 : 0;
    }
    const effA = tagEffectsFor(teamA, teamB, lookup);
    const effB = tagEffectsFor(teamB, teamA, lookup);
    for (const [s, team, eff] of [
      [0, teamA, effA],
      [1, teamB, effB],
    ] as const) {
      for (let a = 0; a < NA; a++) {
        R[(m * 2 + s) * NA + a] = axisAverage(team as BattlePick[], AXES[a]);
        for (let p = 0; p < NP; p++) T[((m * 2 + s) * NP + p) * NA + a] = axisAverage(team as BattlePick[], AXES[a], eff, PHASES[p]);
      }
    }
    let first = true;
    for (let ri = 0; ri < RWRS.length; ri++) {
      setRealWinRateWeightInMemory(RWRS[ri]);
      const as = assessBattle(teamA, teamB, lookup);
      if (first) {
        side[m * 5] = as.synergyBonusA;
        side[m * 5 + 1] = as.synergyBonusB;
        side[m * 5 + 2] = as.edgeA;
        side[m * 5 + 3] = as.winRateEdgeA;
        side[m * 5 + 4] = as.winRateEdgeB;
        const prm0 = productionParams(RWRS[ri]);
        if (taggedPower(partial, m, 0, prm0) !== as.taggedPowerA || taggedPower(partial, m, 1, prm0) !== as.taggedPowerB) taggedMismatch++;
        first = false;
      }
      if (replayDiff(partial, m, productionParams(RWRS[ri])) !== as.diff) diffMismatch++;
      const c = prod[ri];
      for (let k = 0; k < 10; k++) {
        const h = match.heroIdx[k];
        c.app[h]++;
        if (as.advantageDirection === 'Even') c.even[h]++;
        else if (as.advantageDirection === (k < 5 ? 'A' : 'B')) c.fav[h]++;
      }
    }
    m++;
    if (m % 20000 === 0) console.log(`  [${label}] ${m}/${N}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  setRealWinRateWeightInMemory(0);

  const dir = cacheDir(SEED, N, label);
  fs.mkdirSync(dir, { recursive: true });
  const w = (f: string, a: ArrayBufferView) => fs.writeFileSync(path.join(dir, f), Buffer.from(a.buffer, a.byteOffset, a.byteLength));
  w('heroIdx.bin', heroIdx);
  w('roleIdx.bin', roleIdx);
  w('T.bin', T);
  w('R.bin', R);
  w('side.bin', side);
  w('flags.bin', flags);
  const meta = {
    label,
    seed: SEED,
    nMatches: N,
    nHeroes: H,
    axes: AXES,
    phases: PHASES,
    sideFields: SIDE_FIELDS,
    heroIds: heroes.map((h: Hero) => h.id),
    heroNames: heroes.map((h: Hero) => h.name),
    roles: ROLES,
    disabledTags: process.env.DOTADRAFT_DISABLED_TAGS ?? '',
    variants: [...VARIANTS],
    // For variants, prod-counts/buildChecks compare against PRODUCTION assessBattle and are expected to differ.
    builtAt: new Date().toISOString(),
    buildChecks: { taggedMismatch, diffMismatch },
  };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
  fs.writeFileSync(
    path.join(dir, 'prod-counts.json'),
    JSON.stringify(
      Object.fromEntries(RWRS.map((r, i) => [`rwr${r}`, { appearances: Array.from(prod[i].app), favored: Array.from(prod[i].fav), even: Array.from(prod[i].even) }])),
    ),
  );
  const wallMs = Date.now() - t0;
  console.log(`[${label}] built ${dir} in ${(wallMs / 1000).toFixed(1)}s  taggedMismatch=${taggedMismatch} diffMismatch=${diffMismatch}`);
  ensureLabDir();
  appendRun({
    kind: 'cache-build',
    label,
    config: { seed: SEED, nMatches: N, disabledTags: meta.disabledTags, variants: meta.variants, shadow: 'off' },
    seed: SEED,
    nMatches: N,
    metrics: { taggedMismatch, diffMismatch },
    wallMs,
    notes: '2 production assessBattle/match (rwr 0 and 2) + tagged/raw axisAverage capture',
  });
}

// Dispatch last: module-level consts above must be initialised first.
if (!LABEL) void driver();
else build(LABEL);
