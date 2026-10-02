// KT1 "state of the ruler": steps 1–2 of the lab prompt (Н1.2–Н1.5, Н2.1–Н2.4).
// Pure measurement on cached production pools + stored 2026-09-21 hero tables.
// No fitting to real winRate except the explicitly-labelled 1-parameter
// scale k in Н1.3 and the affine/isotonic maps inside the ruler.
//   cd server && npx ts-node scripts/lab/kt1-analysis.ts
// Needs caches from: LAB_BUILDS (see README, KT1 section).
import * as fs from 'fs';
import * as path from 'path';
import { CUSTOM_TAG_DEFINITIONS } from 'shared';
import { DATA_DIR, REPO_ROOT, appendRun, ensureLabDir, mulberry32 } from './lab-common';
import { NA, cacheDir, favoredRates, loadCache, productionParams, replayCounts, replayDiff, replayHeroProb, taggedPower, type FeatureCache, type ReplayParams } from './feature-cache';
import { RULER_KEYS, bootstrapRuler, mean, pairedDelta, pearson, ruler, sd, spearman, ols, type CI, type Ruler } from './lab-metrics';
import { AXES } from '../../src/assessment-core/axes';
import { DEFAULT_DIFF_INPUTS, WIN_WEIGHT_BY_TIER } from '../../src/battle/battle-resolution';
import { HIGH_SKILL_UPSET_SHIFT } from '../../src/battle/custom-tags';

const N = 100000;
const OUT = ensureLabDir('kt1');
const B = Number(process.env.LAB_BOOT ?? 2000);
const t0 = Date.now();

// ---------- targets ----------
interface MetaEntry {
  heroId: number;
  winRate: number | null;
  matchups: { opponentHeroId: number; games: number; wins: number }[];
  synergy: { allyHeroId: number; games: number; wins: number }[];
}
const meta: MetaEntry[] = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'hero-meta.json'), 'utf-8')).heroes;
const metaById = new Map(meta.map((e) => [e.heroId, e]));

const caches = new Map<string, FeatureCache>();
function cache(label: string, seed = 1): FeatureCache {
  const k = `${seed}:${label}`;
  if (!caches.has(k)) caches.set(k, loadCache(cacheDir(seed, N, label)));
  return caches.get(k)!;
}
const base = cache('full');
const heroIds = base.meta.heroIds;
const heroNames = base.meta.heroNames;
const H = heroIds.length;
const Y = heroIds.map((id) => metaById.get(id)!.winRate as number);
if (Y.some((v) => v == null)) throw new Error('missing winRate');

const P0 = productionParams(0);
const prm = (patch: Partial<ReplayParams> & { wPatch?: (w: Float64Array) => void } = {}): ReplayParams => {
  const p: ReplayParams = { ...P0, w: Float64Array.from(P0.w), pd: Float64Array.from(P0.pd), ...patch };
  patch.wPatch?.(p.w);
  return p;
};
const fav = (c: FeatureCache, p: ReplayParams): number[] => favoredRates(replayCounts(c, p));
const RE = AXES.indexOf('resource_efficiency');
const oldRE = (w: Float64Array) => [0.4, 0.5, 0.55].forEach((v, p) => (w[p * NA + RE] = v));

// ---------- variant registry ----------
interface Variant {
  id: string;
  group: string;
  note: string;
  x: number[];
}
const variants: Variant[] = [];
const add = (id: string, group: string, note: string, x: number[]) => variants.push({ id, group, note, x });

add('B-naked', 'base', 'current prod, hidden OFF, rwr 0', fav(cache('naked-open'), P0));
add('B-full', 'base', 'current prod, hidden ON, rwr 0 (FROZEN BASE)', fav(base, P0));
add('0921-naked', '0921', 'pre-74f517b RE weights, hidden OFF', fav(cache('naked-open'), prm({ wPatch: oldRE })));
add('0921-full', '0921', 'pre-74f517b RE weights + Mirage Tax (lab copy), hidden ON', fav(cache('full-mirageTax'), prm({ wPatch: oldRE })));

// stored 2026-09-21 tables (shadow variants measured on the 09-21 state)
const OLD = [
  ['r0-2026-09-21', 'naked-open', 'R0 naked (stored)'],
  ['r0-2026-09-21', 'full', 'R0 full (stored)'],
  ['r1-2026-09-21', 'combat_pc1', 'shadow combat_pc1, hidden OFF'],
  ['r1-2026-09-21', 'explicit', 'shadow explicit, hidden OFF'],
  ['r1-2026-09-21', 'body_integrity', 'shadow body_integrity, hidden OFF'],
  ['r1-2026-09-21', 'farm_need', 'shadow farm_need, hidden OFF'],
  ['r1-2026-09-21', 'skirmish_role', 'shadow skirmish_role, hidden OFF'],
  ['r2-2026-09-21', 'r2_f', 'shadow r2_f, hidden OFF'],
  ['r2-2026-09-21', 'farm_need_v2', 'shadow farm_need_v2, hidden OFF'],
  ['r2-dis-2026-09-21', 'r2_f_dis', 'shadow r2_f_dis, hidden OFF'],
  ['r2-farm-2026-09-21', 'r2_f_farm', 'shadow r2_f_farm, hidden OFF'],
  ['r2-farm-hidden-2026-09-21', 'r2_f_farm_hidden', 'shadow r2_f_farm, hidden ON'],
  ['r2-save0-2026-09-21', 'r2_f_farm_save0', 'shadow r2_f_farm saving=0, hidden OFF'],
] as const;
let oldRealMaxDiff = 0;
for (const [dir, file, note] of OLD) {
  const p = path.join(REPO_ROOT, 'artifacts', 'self-play', dir, `${file}-heroTable.json`);
  if (!fs.existsSync(p)) continue;
  const rows = (JSON.parse(fs.readFileSync(p, 'utf-8')) as { heroTable: { heroId: number; favoredRate: number; realWinRate: number }[] }).heroTable;
  const byId = new Map(rows.map((r) => [r.heroId, r]));
  heroIds.forEach((id, h) => (oldRealMaxDiff = Math.max(oldRealMaxDiff, Math.abs(byId.get(id)!.realWinRate - Y[h]))));
  add(`old:${file}`, 'old-0921', note, heroIds.map((id) => byId.get(id)!.favoredRate));
}

// ---------- Н2.1/Н2.2 ablations (current prod state) ----------
let powSum = 0;
for (let m = 0; m < base.n; m++) powSum += taggedPower(base, m, 0, P0) + taggedPower(base, m, 1, P0);
const MEAN_POWER = powSum / (2 * base.n); // constant power for axes-OFF ablations keeps the diff scale
const abl: [string, string, FeatureCache, ReplayParams][] = [
  ['A:full rwr=2 (shipped, circular)', 'C', base, prm({ rwr: 2 })],
  ['A:no synergy', 'A', base, prm({ synergyCoeff: 0 })],
  ['A:no matchup', 'A', base, prm({ matchupCoeff: 0 })],
  ['A:no synergy+matchup', 'A', base, prm({ synergyCoeff: 0, matchupCoeff: 0 })],
  ['A:no syn+mat+shutdown (all pair-WR leaks off)', 'A', cache('full-noShutdown'), prm({ synergyCoeff: 0, matchupCoeff: 0 })],
  ['A:naked no syn+mat+shutdown', 'A', cache('naked-open-noShutdown'), prm({ synergyCoeff: 0, matchupCoeff: 0 })],
  ['A:no shutdown', 'A', cache('full-noShutdown'), P0],
  ['A:no hard-carry', 'A', cache('full-noHardCarry'), P0],
  ['A:no utility-stack', 'A', cache('full-noUtility'), P0],
  ['A:no manual overrides', 'A', cache('full-noManual'), P0],
  ['A:no role-fit (roles=null)', 'A', cache('full-noRoles'), P0],
  ['A:no tags at all (open+hidden off)', 'A', cache('notags'), P0],
  ['A:phase early only', 'A', base, prm({ pd: Float64Array.from([1, 0, 0]) })],
  ['A:phase mid only', 'A', base, prm({ pd: Float64Array.from([0, 1, 0]) })],
  ['A:phase late only', 'A', base, prm({ pd: Float64Array.from([0, 0, 1]) })],
  ['A:phase equal 1/3', 'A', base, prm({ pd: Float64Array.from([1 / 3, 1 / 3, 1 / 3]) })],
  ['A:one weight set (mid) all phases', 'A', base, prm({ wPatch: (w) => { for (let p = 0; p < 3; p++) for (let a = 0; a < NA; a++) w[p * NA + a] = P0.w[NA + a]; } })],
  ['A:all axis weights 1', 'A', base, prm({ wPatch: (w) => w.fill(1) })],
  ['ONLY:axes raw (no tags/penalties, no syn/mat)', 'A', base, prm({ useRaw: true, synergyCoeff: 0, matchupCoeff: 0 })],
  ['ONLY:axes+tags+penalties (no syn/mat)', 'A', base, prm({ synergyCoeff: 0, matchupCoeff: 0 })],
  ['ONLY:synergy', 'A', base, prm({ constPower: MEAN_POWER, matchupCoeff: 0 })],
  ['ONLY:matchup', 'A', base, prm({ constPower: MEAN_POWER, synergyCoeff: 0 })],
  ['ONLY:synergy+matchup (axes off)', 'A', base, prm({ constPower: MEAN_POWER })],
  ['ONLY:real winRate rwr=2 (axes off)', 'C', base, prm({ constPower: MEAN_POWER, synergyCoeff: 0, matchupCoeff: 0, rwr: 2 })],
];
for (const [id, cls, c, p] of abl) add(id, `ablation-${cls}`, '', fav(c, p));

// ---------- ruler + CIs for every variant ----------
const rulerRows: Record<string, { group: string; note: string; ci: Record<keyof Ruler, CI> }> = {};
for (const v of variants) {
  rulerRows[v.id] = { group: v.group, note: v.note, ci: bootstrapRuler(v.x, Y, B) };
  appendRun({
    kind: 'kt1-ruler',
    label: v.id,
    config: { variant: v.id, group: v.group, seed: 1, nMatches: N, boot: B },
    seed: 1,
    nMatches: N,
    metrics: Object.fromEntries(RULER_KEYS.map((k) => [k, rulerRows[v.id].ci[k].est])),
    wallMs: 0,
  });
}
const X = (id: string) => variants.find((v) => v.id === id)!.x;
const paired: Record<string, unknown> = {};
for (const v of variants) {
  if (v.id === 'B-full') continue;
  const ref = v.group === 'old-0921' || v.group === '0921' ? '0921-full' : 'B-full';
  if (v.id === ref) continue;
  paired[v.id] = { ref, corrX: pearson(v.x, X(ref)), delta: pairedDelta(X(ref), v.x, Y, ['r', 'spearman', 'maeAffPp', 'sdRatio', 'maePp'], B) };
}

// ---------- Н1.3 three "winrates" ----------
function threeRates(label: string) {
  const c = cache(label);
  const f = fav(c, P0);
  const tier = Array.from(
    replayHeroProb(c, P0, { kind: 'tier', moderate: DEFAULT_DIFF_INPUTS.moderateAbsDiff, high: DEFAULT_DIFF_INPUTS.highAbsDiff, w: WIN_WEIGHT_BY_TIER, hsShift: HIGH_SKILL_UPSET_SHIFT }),
  );
  // k matched to SD(real) — a pure scale parameter (uses only SD of the target).
  let lo = 0.01;
  let hi = 20;
  for (let i = 0; i < 25; i++) {
    const k = Math.sqrt(lo * hi);
    const s = sd(Array.from(replayHeroProb(c, P0, { kind: 'logistic', k })));
    if (s > sd(Y)) hi = k;
    else lo = k;
  }
  const k = Math.sqrt(lo * hi);
  const logi = Array.from(replayHeroProb(c, P0, { kind: 'logistic', k }));
  // diff distribution (for reading k)
  const diffs: number[] = [];
  for (let m = 0; m < c.n; m += 10) diffs.push(Math.abs(replayDiff(c, m, P0)));
  diffs.sort((a, b) => a - b);
  const row = (x: number[]) => {
    const r = ruler(x, Y);
    return { r: r.r, spearman: r.spearman, sdPp: sd(x) * 100, sdRatio: r.sdRatio, slope: r.slopeRealOnSys, rangePp: [Math.min(...x) * 100, Math.max(...x) * 100], maePp: r.maePp, maeAffPp: r.maeAffPp, coverage7Pct: r.coverage7Pct, flagged10: r.flagged10 };
  };
  return { favored: row(f), tierExpected: row(tier), logistic: { k, medianAbsDiff: diffs[Math.floor(diffs.length / 2)], ...row(logi) } };
}
const scale = { realSdPp: sd(Y) * 100, realRangePp: [Math.min(...Y) * 100, Math.max(...Y) * 100], naked: threeRates('naked-open'), full: threeRates('full') };

// ---------- Н1.4 ceiling ----------
const nGames = heroIds.map((id) => metaById.get(id)!.matchups.reduce((s, m) => s + m.games, 0) / 5);
const wrMatch = heroIds.map((id) => {
  const ms = metaById.get(id)!.matchups;
  return ms.reduce((s, m) => s + m.wins, 0) / ms.reduce((s, m) => s + m.games, 0);
});
const varY = sd(Y) ** 2;
const noiseVar = mean(Y.map((p, h) => (p * (1 - p)) / nGames[h]));
const relBinom = 1 - noiseVar / varY;
// seeds
const seedKpi: Record<string, { r: number[]; corrVsSeed1: number[]; maeAff: number[] }> = {};
for (const label of ['naked-open', 'full']) {
  const x1 = fav(cache(label, 1), P0);
  seedKpi[label] = { r: [], corrVsSeed1: [], maeAff: [] };
  for (const s of [1, 2, 3, 4, 5]) {
    const xs = s === 1 ? x1 : fav(cache(label, s), P0);
    const rr = ruler(xs, Y, { iso: false });
    seedKpi[label].r.push(rr.r);
    seedKpi[label].maeAff.push(rr.maeAffPp);
    if (s > 1) seedKpi[label].corrVsSeed1.push(pearson(xs, x1));
  }
}
const relSystem = mean(seedKpi.full.corrVsSeed1); // test-retest at 100k
// pro matches (independent target, other meta group)
interface ProMatch { radiantWin: boolean; radiantHeroIds: number[]; direHeroIds: number[] }
const pro: ProMatch[] = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'pro-matches.json'), 'utf-8')).matches;
const proG = new Map<number, number>();
const proW = new Map<number, number>();
for (const m of pro) {
  for (const id of m.radiantHeroIds) {
    proG.set(id, (proG.get(id) ?? 0) + 1);
    if (m.radiantWin) proW.set(id, (proW.get(id) ?? 0) + 1);
  }
  for (const id of m.direHeroIds) {
    proG.set(id, (proG.get(id) ?? 0) + 1);
    if (!m.radiantWin) proW.set(id, (proW.get(id) ?? 0) + 1);
  }
}
const proOk = heroIds.map((id) => (proG.get(id) ?? 0) >= 30);
const idxPro = heroIds.map((_, h) => h).filter((h) => proOk[h]);
const proWR = idxPro.map((h) => (proW.get(heroIds[h]) ?? 0) / proG.get(heroIds[h])!);
const proN = idxPro.map((h) => proG.get(heroIds[h])!);
const relPro = 1 - mean(proWR.map((p, i) => (p * (1 - p)) / proN[i])) / sd(proWR) ** 2;
const ceiling = {
  nHeroes: H,
  gamesPerHero: { median: [...nGames].sort((a, b) => a - b)[Math.floor(H / 2)], min: Math.min(...nGames), max: Math.max(...nGames) },
  realSdPp: sd(Y) * 100,
  binomNoiseSdPp: Math.sqrt(noiseVar) * 100,
  // WRONG denominator kept only to check prompt O5: these games are PRO matchup games
  // (/heroes/{id}/matchups), not the pub sample behind winRate (heroStats 6_/7_ picks, not stored locally).
  reliabilityIfNFromProMatchups: relBinom,
  rCeilingIfNFromProMatchups: Math.sqrt(relBinom * relSystem),
  // Sensitivity: binomial reliability of winRate if each hero had P Ancient+Divine picks.
  reliabilityIfPubPicks: Object.fromEntries([1000, 2000, 5000, 20000, 100000].map((P) => {
    const nv = mean(Y.map((p) => (p * (1 - p)) / P));
    const rel = 1 - nv / varY;
    return [P, { noiseSdPp: Math.sqrt(nv) * 100, reliability: rel, rCeiling: Math.sqrt(Math.max(0, rel) * relSystem) }];
  })),
  rWinRateVsMatchupPooledWR: pearson(Y, wrMatch),
  meanAbsWinRateMinusMatchupWRpp: mean(Y.map((y, h) => Math.abs(y - wrMatch[h]))) * 100,
  popularity: { pearson: pearson(nGames, Y), spearman: spearman(nGames, Y) },
  reliabilitySystem100k: relSystem,
  seedKpi,
  pro: { nMatches: pro.length, heroesWith30: idxPro.length, medianGames: [...proN].sort((a, b) => a - b)[Math.floor(proN.length / 2)], sdPp: sd(proWR) * 100, reliability: relPro, rPubVsPro: pearson(idxPro.map((h) => Y[h]), proWR) },
};

// ---------- Н1.5 power ----------
const seFisher = (r: number) => (1 - r * r) / Math.sqrt(H - 3);
const powerRows = ['B-naked', 'B-full'].map((id) => ({ id, r: rulerRows[id].ci.r.est, seAnalytic: seFisher(rulerRows[id].ci.r.est), seBoot: rulerRows[id].ci.r.se }));
const pairedSe = Object.entries(paired as Record<string, { ref: string; corrX: number; delta: Record<string, CI> }>)
  .filter(([, v]) => v.ref === 'B-full')
  .map(([id, v]) => ({ id, corrX: v.corrX, seDeltaR: v.delta.r.se, mde80: 2.8 * v.delta.r.se }));

// ---------- Н2.2 direct leak strength ----------
const matchupAdv = heroIds.map((id) => {
  const ms = metaById.get(id)!.matchups.filter((m) => m.games >= 10);
  return mean(ms.map((m) => m.wins / m.games - 0.5));
});
const synergyAdv = heroIds.map((id) => {
  const ss = metaById.get(id)!.synergy.filter((s) => s.games >= 10);
  return ss.length ? mean(ss.map((s) => s.wins / s.games - 0.5)) : 0;
});
const leak = {
  rMeanMatchupAdvVsWR: pearson(matchupAdv, Y),
  rMeanSynergyAdvVsWR: pearson(synergyAdv, Y),
  sdMatchupAdvPp: sd(matchupAdv) * 100,
};

// ---------- Н2.3 hidden tags out of sample ----------
const hiddenDefs = CUSTOM_TAG_DEFINITIONS.filter((d) => !d.visible && !d.revealable);
const xN = X('B-naked');
const xF = X('B-full');
// Rank-space divergence: z(real) − z(sys). >0 = system underrates the hero (a boost tag
// would be the right direction). Affine residuals are useless here: slope≈0.03 makes
// them ≈ real − mean, i.e. "strong hero", not "misjudged hero".
const z = (v: number[]) => { const m = mean(v); const s = sd(v); return v.map((x) => (x - m) / s); };
const zY = z(Y);
const zN = z(xN);
const residN = Y.map((_, h) => zY[h] - zN[h]);
const idxByName = new Map(heroNames.map((n, h) => [n, h]));
const tagRows: unknown[] = [];
let looHits = 0;
let looN = 0;
let inHits = 0;
let inN = 0;
let proHits = 0;
let proNn = 0;
const xNpro = idxPro.map((h) => xN[h]);
const zPro = z(proWR);
const zNpro = z(xNpro);
const proResid = new Map(idxPro.map((h, i) => [h, zPro[i] - zNpro[i]]));
const tagged = new Set<number>();
for (const d of hiddenDefs) {
  const mem = d.heroNames.map((n) => idxByName.get(n)).filter((h): h is number => h !== undefined);
  mem.forEach((h) => tagged.add(h));
  const dir = Math.sign(mean(mem.map((h) => xF[h] - xN[h]))); // +1 = tag lifts members
  const per = mem.map((h) => {
    const others = mem.filter((o) => o !== h);
    const otherSign = others.length ? Math.sign(mean(others.map((o) => residN[o]))) : 0;
    const own = Math.sign(residN[h]);
    if (others.length) {
      looN++;
      if (otherSign === own) looHits++;
    }
    inN++;
    if (dir === own) inHits++;
    const pr = proResid.get(h);
    if (pr !== undefined) {
      proNn++;
      if (Math.sign(pr) === dir) proHits++;
    }
    return { hero: heroNames[h], residNakedZ: residN[h], deltaFullMinusNakedPp: (xF[h] - xN[h]) * 100, proResidZ: pr === undefined ? null : pr };
  });
  tagRows.push({ tag: d.name, n: mem.length, direction: dir, members: per });
}
// Null for proSignHitRate: z(pro) − z(naked) shares the −z(naked) term with the tag
// selection, so hits are expected even with no signal. Permute pro WR across heroes.
const memberships: { h: number; dir: number }[] = [];
for (const d of hiddenDefs) {
  const mem = d.heroNames.map((n) => idxByName.get(n)).filter((h): h is number => h !== undefined);
  const dir = Math.sign(mean(mem.map((h) => xF[h] - xN[h])));
  mem.forEach((h) => memberships.push({ h, dir }));
}
const proPos = new Map(idxPro.map((h, i) => [h, i]));
const permRng = mulberry32(4242);
const permHits: number[] = [];
for (let it = 0; it < 2000; it++) {
  const perm = [...proWR];
  for (let i = perm.length - 1; i > 0; i--) {
    const j = Math.floor(permRng() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  const zp = z(perm);
  let hits = 0;
  let nn = 0;
  for (const { h, dir } of memberships) {
    const i = proPos.get(h);
    if (i === undefined) continue;
    nn++;
    if (Math.sign(zp[i] - zNpro[i]) === dir) hits++;
  }
  permHits.push(hits / nn);
}
permHits.sort((a, b) => a - b);
const proNull = { mean: mean(permHits), p95: permHits[Math.floor(0.95 * permHits.length)], pValue: permHits.filter((v) => v >= proHits / proNn).length / permHits.length };

const untag = heroIds.map((_, h) => h).filter((h) => !tagged.has(h));
const tagd = [...tagged];
const sub = (idx: number[], x: number[]) => ruler(idx.map((h) => x[h]), idx.map((h) => Y[h]), { iso: false });
const hiddenOos = {
  hiddenTags: hiddenDefs.map((d) => d.name),
  inSampleSignHitRate: inHits / inN,
  inSampleN: inN,
  looArchetypeHitRate: looHits / looN,
  looN,
  proSignHitRate: proHits / proNn,
  proSignHitNull: proNull,
  proN: proNn,
  untagged: { n: untag.length, naked: sub(untag, xN), full: sub(untag, xF) },
  tagged: { n: tagd.length, naked: sub(tagd, xN), full: sub(tagd, xF) },
  proTarget: {
    naked: ruler(xNpro, proWR, { iso: false }),
    full: ruler(idxPro.map((h) => xF[h]), proWR, { iso: false }),
    pubWR: ruler(idxPro.map((h) => Y[h]), proWR, { iso: false }),
    // matchup/synergy inputs are OpenDota pro data (fetch-hero-meta.ts: /heroes/{id}/matchups, Explorer
    // `matches`), so they can leak INTO this pro target; the leak-free variants show how much.
    fullNoPairLeaks: ruler(idxPro.map((h) => X('A:no syn+mat+shutdown (all pair-WR leaks off)')[h]), proWR, { iso: false }),
    nakedNoPairLeaks: ruler(idxPro.map((h) => X('A:naked no syn+mat+shutdown')[h]), proWR, { iso: false }),
    pairedFullMinusNakedNoLeaks: pairedDelta(idxPro.map((h) => X('A:naked no syn+mat+shutdown')[h]), idxPro.map((h) => X('A:no syn+mat+shutdown (all pair-WR leaks off)')[h]), proWR, ['r', 'spearman'], B),
    pairedFullMinusNaked: pairedDelta(xNpro, idxPro.map((h) => xF[h]), proWR, ['r', 'spearman', 'maeAffPp'], B),
  },
  tags: tagRows,
};

// ---------- Н2.4 influence ----------
function influence(x: number[]) {
  const r = pearson(x, Y);
  const jk = x.map((_, i) => {
    const xi = x.filter((_, j) => j !== i);
    const yi = Y.filter((_, j) => j !== i);
    return { hero: heroNames[i], h: i, dr: r - pearson(xi, yi) };
  });
  jk.sort((a, b) => b.dr - a.dr);
  const mx = mean(x);
  const my = mean(Y);
  const sx = sd(x);
  const sy = sd(Y);
  const contrib = x.map((v, i) => ((v - mx) / sx) * ((Y[i] - my) / sy));
  const tot = contrib.reduce((a, b) => a + b, 0);
  const sortedC = [...contrib].sort((a, b) => b - a);
  const top10 = new Set(jk.slice(0, 10).map((j) => j.h));
  const keep = x.map((_, i) => i).filter((i) => !top10.has(i));
  return {
    r,
    top10: jk.slice(0, 10).map((j) => ({ hero: j.hero, dr: j.dr })),
    bottom5: jk.slice(-5).map((j) => ({ hero: j.hero, dr: j.dr })),
    rWithoutTop10: pearson(keep.map((i) => x[i]), keep.map((i) => Y[i])),
    shareOfCovFromTop10Contrib: sortedC.slice(0, 10).reduce((a, b) => a + b, 0) / tot,
  };
}
const infl = { naked: influence(xN), full: influence(xF) };

// ---------- write ----------
const out = { generatedAt: new Date().toISOString(), boot: B, meanPower: MEAN_POWER, oldRealMaxDiff, ruler: rulerRows, paired, scale, ceiling, power: { rows: powerRows, pairedSe }, leak, hiddenOos, influence: infl };
fs.writeFileSync(path.join(OUT, 'kt1.json'), JSON.stringify(out, null, 2));
const per = heroIds.map((id, h) => ({ heroId: id, name: heroNames[h], real: Y[h], ...Object.fromEntries(variants.filter((v) => !v.id.startsWith('old:')).map((v) => [v.id, v.x[h]])) }));
fs.writeFileSync(path.join(OUT, 'per-hero.json'), JSON.stringify(per, null, 2));
appendRun({ kind: 'kt1-summary', label: 'kt1', config: { boot: B, variants: variants.map((v) => v.id) }, seed: 1, nMatches: N, metrics: { ceiling: { relIfProN: relBinom, relSystem }, leak, hidden: { loo: hiddenOos.looArchetypeHitRate, pro: hiddenOos.proSignHitRate } }, wallMs: Date.now() - t0 });
console.log(`KT1 written to ${OUT} in ${((Date.now() - t0) / 1000).toFixed(0)}s; old realWinRate max diff vs current=${oldRealMaxDiff}`);
