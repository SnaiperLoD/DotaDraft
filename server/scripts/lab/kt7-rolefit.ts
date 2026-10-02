// Role-fit calibration — pre-registered plan (Blueprint/16 "Role-fit calibration").
// Step 1–2 (cell level): OOF by hero + within-hero permutation null. Steps 3–4 (self-play,
// window B) run only if 1–2 pass. Lab only; reads production code, writes artifacts/lab/kt7.
// Declared deviation: r(Δ_rf, Δ_pos) is invariant to a common scale of all role-fit terms,
// so the per-role DATA term is the anchor (s_data ≡ 1) and three RELATIVE scales are fitted:
// s_heur (heuristic boost/dampen fallback), s_sup (support-miscast −10%), s_core (core-miscast
// −10%); grid 0…3 step 0.25 (no penalty; the bounded grid is the regulariser).
//   cd server && npx ts-node scripts/lab/kt7-rolefit.ts
import * as fs from 'fs';
import * as path from 'path';
import { hasRoleEvaluationData } from 'shared';
import type { Hero, HeroEvaluationValues, PresumedPosition } from 'shared';
import { DATA_DIR, appendRun, ensureLabDir, mulberry32 } from './lab-common';
import { STRATZ_ROOT } from './stratz-common';
import { NA, NP, productionParams } from './feature-cache';
import { pearson } from './lab-metrics';
import { AXES } from '../../src/assessment-core/axes';
import { roleAwareAxisValue, supportMiscastMultiplier, coreMiscastMultiplier } from '../../src/common/role-fit';
import { utilityStackBreadth } from '../../src/common/utility-stacking';

const OUT = ensureLabDir('kt7');
const heroes: Hero[] = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'heroes.json'), 'utf-8'));
const metaJ = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'hero-meta.json'), 'utf-8')).heroes as { heroId: number; positions: { position: string; share: number }[] }[];
for (const h of heroes) h.presumed_positions = (metaJ.find((m) => m.heroId === h.id)?.positions ?? []) as Hero['presumed_positions'];
const POS: Record<string, string> = { POSITION_1: 'Carry', POSITION_2: 'Mid', POSITION_3: 'Offlane', POSITION_4: 'Soft Support', POSITION_5: 'Hard Support' };
const toPresumed = (r: string): PresumedPosition => (r === 'Soft Support' || r === 'Hard Support' ? 'Support' : (r as PresumedPosition));
const cell = new Map<string, { g: number; w: number }>();
for (const b of ['LEGEND_ANCIENT', 'DIVINE_IMMORTAL'])
  for (const r of JSON.parse(fs.readFileSync(path.join(STRATZ_ROOT, 'stats', 'w1789344000', 'stats', `${b}-all-allpos.json`), 'utf-8')).data as { time: number; heroId: number; position: string; matchCount: number; winCount: number }[])
    if (r.time === 0) {
      const k = `${r.heroId}|${r.position}`;
      const c = cell.get(k) ?? { g: 0, w: 0 };
      c.g += r.matchCount;
      c.w += r.winCount;
      cell.set(k, c);
    }
const P0 = productionParams(0);
const pw = (val: (a: keyof HeroEvaluationValues) => number) => {
  let bl = 0;
  for (let p = 0; p < NP; p++) {
    let s = 0;
    let t = 0;
    for (let a = 0; a < NA; a++) {
      s += val(AXES[a]) * P0.w[p * NA + a];
      t += P0.w[p * NA + a];
    }
    bl += P0.pd[p] * (t ? s / t : 0);
  }
  return bl;
};
interface Cell { hero: number; name: string; role: string; share: number; dPos: number; g: number; A: number; R: number; data: boolean; sup: boolean; core: boolean }
const byHero = new Map<number, Cell[]>();
for (const h of heroes) {
  const cs = Object.keys(POS).map((p) => ({ p, c: cell.get(`${h.id}|${p}`) ?? { g: 0, w: 0 } }));
  const tot = cs.reduce((s, x) => s + x.c.g, 0);
  if (!tot) continue;
  const wrH = cs.reduce((s, x) => s + x.c.w, 0) / tot;
  const A = pw((a) => h.evaluation_values[a]);
  const breadth = utilityStackBreadth(h);
  const list: Cell[] = cs.map((x) => {
    const role = POS[x.p];
    return {
      hero: h.id,
      name: h.name,
      role,
      share: x.c.g / tot,
      dPos: x.c.g ? x.c.w / x.c.g - wrH : 0,
      g: x.c.g,
      A,
      R: pw((a) => roleAwareAxisValue(a, h, role, breadth)),
      data: hasRoleEvaluationData(h, toPresumed(role)),
      sup: supportMiscastMultiplier(h, role) !== 1,
      core: coreMiscastMultiplier(h, role) !== 1,
    };
  });
  byHero.set(h.id, list);
}
type Theta = [number, number, number]; // s_heur, s_sup, s_core
const powerT = (c: Cell, t: Theta) => (c.sup ? 1 - 0.1 * t[1] : c.core ? 1 - 0.1 * t[2] : 1) * (c.A + (c.data ? 1 : t[0]) * (c.R - c.A));
// Δ_rf for all evaluated cells of a hero (share-weighted mean over ALL its positions)
function dRf(hid: number, t: Theta): { c: Cell; d: number }[] {
  const list = byHero.get(hid)!;
  const mean = list.reduce((s, c) => s + c.share * powerT(c, t), 0);
  return list.filter((c) => c.g >= 1000).map((c) => ({ c, d: powerT(c, t) - mean }));
}
const heroIds = [...byHero.keys()].filter((id) => byHero.get(id)!.filter((c) => c.g >= 1000).length >= 2);
const rFor = (ids: number[], t: Theta, dpos?: Map<string, number>) => {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const id of ids) for (const { c, d } of dRf(id, t)) { xs.push(d); ys.push(dpos?.get(`${id}|${c.role}`) ?? c.dPos); }
  return pearson(xs, ys);
};
const GRID: Theta[] = [];
const G = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];
for (const a of G) for (const b of G) for (const c of G) GRID.push([a, b, c]);
const fit = (ids: number[], dpos?: Map<string, number>): Theta => {
  let best: Theta = [1, 1, 1];
  let br = -Infinity;
  for (const t of GRID) {
    const r = rFor(ids, t, dpos);
    if (r > br) { br = r; best = t; }
  }
  return best;
};
function oof(seed: number, repeats: number, dpos?: Map<string, number>) {
  const rng = mulberry32(seed);
  const rs: number[] = [];
  let last: { id: number; role: string; d: number; y: number }[] = [];
  const thetas: Theta[] = [];
  for (let rep = 0; rep < repeats; rep++) {
    const ids = [...heroIds];
    for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
    const pred: { id: number; role: string; d: number; y: number }[] = [];
    for (let f = 0; f < 5; f++) {
      const te = ids.filter((_, i) => i % 5 === f);
      const tr = ids.filter((_, i) => i % 5 !== f);
      const t = fit(tr, dpos);
      thetas.push(t);
      for (const id of te) for (const { c, d } of dRf(id, t)) pred.push({ id, role: c.role, d, y: dpos?.get(`${id}|${c.role}`) ?? c.dPos });
    }
    rs.push(pearson(pred.map((p) => p.d), pred.map((p) => p.y)));
    last = pred;
  }
  return { r: rs.reduce((a, b) => a + b, 0) / rs.length, rs, last, thetas };
}
const t0 = Date.now();
const nCells = heroIds.reduce((s, id) => s + dRf(id, [1, 1, 1]).length, 0);
const miscastCells = heroIds.reduce((s, id) => s + dRf(id, [1, 1, 1]).filter(({ c }) => c.sup || c.core).length, 0);
const heurCells = heroIds.reduce((s, id) => s + dRf(id, [1, 1, 1]).filter(({ c }) => !c.data).length, 0);
const current = rFor(heroIds, [1, 1, 1]);
const main = oof(1, 10);
const inSample = fit(heroIds);
// paired cluster bootstrap: OOF (last repeat) vs current, by hero
const cur = new Map<string, number>();
for (const id of heroIds) for (const { c, d } of dRf(id, [1, 1, 1])) cur.set(`${id}|${c.role}`, d);
const rng = mulberry32(777);
const dr: number[] = [];
for (let b = 0; b < 2000; b++) {
  const pick: number[] = [];
  for (let i = 0; i < heroIds.length; i++) pick.push(heroIds[Math.floor(rng() * heroIds.length)]);
  const xs: number[] = [], cs: number[] = [], ys: number[] = [];
  for (const id of pick) for (const p of main.last.filter((q) => q.id === id)) { xs.push(p.d); cs.push(cur.get(`${id}|${p.role}`)!); ys.push(p.y); }
  dr.push(pearson(xs, ys) - pearson(cs, ys));
}
dr.sort((a, b) => a - b);
// null: permute Δ_pos within hero, 200×, 1 repeat
const main1 = oof(2, 1);
const nul: number[] = [];
const prng = mulberry32(999);
for (let k = 0; k < 200; k++) {
  const dpos = new Map<string, number>();
  for (const id of heroIds) {
    const cs = byHero.get(id)!.filter((c) => c.g >= 1000);
    const vals = cs.map((c) => c.dPos);
    for (let i = vals.length - 1; i > 0; i--) { const j = Math.floor(prng() * (i + 1)); [vals[i], vals[j]] = [vals[j], vals[i]]; }
    cs.forEach((c, i) => dpos.set(`${id}|${c.role}`, vals[i]));
  }
  nul.push(oof(3000 + k, 1, dpos).r);
}
nul.sort((a, b) => a - b);
const res = {
  cells: nCells,
  heroes: heroIds.length,
  heuristicCells: heurCells,
  miscastCells,
  currentR: current,
  oofR10x5: main.r,
  oofRrepeats: main.rs,
  inSampleTheta: { s_heur: inSample[0], s_sup: inSample[1], s_core: inSample[2], r: rFor(heroIds, inSample) },
  oofThetaMode: (() => { const m = new Map<string, number>(); for (const t of main.thetas) m.set(t.join(','), (m.get(t.join(',')) ?? 0) + 1); return [...m].sort((a, b) => b[1] - a[1]).slice(0, 5); })(),
  pairedDeltaR: { est: main.last.length ? pearson(main.last.map((p) => p.d), main.last.map((p) => p.y)) - current : 0, ci95: [dr[49], dr[1949]] },
  nullComparable: { oofR1x5: main1.r, nullMean: nul.reduce((a, b) => a + b, 0) / nul.length, nullP95: nul[189], p: (nul.filter((v) => v >= main1.r).length + 1) / 201 },
};
const pass12 = res.pairedDeltaR.ci95[0] > 0 && res.pairedDeltaR.est >= 0.05 && main1.r > res.nullComparable.nullP95;
const out = { ...res, steps12Pass: pass12, verdict: pass12 ? 'steps 1–2 PASS → run self-play + window B' : 'FAIL at steps 1–2 → keep current role-fit; no proposal' };
fs.writeFileSync(path.join(OUT, 'kt7-rolefit.json'), JSON.stringify(out, null, 2));
appendRun({ kind: 'kt7-rolefit', label: 'role-fit relative scales, cell level', config: { grid: G, anchor: 's_data=1', cv: '10x5 by hero', null: '200 within-hero permutations' }, seed: 1, nMatches: 0, metrics: out, wallMs: Date.now() - t0 });
console.log(JSON.stringify(out, (k, v) => (typeof v === 'number' ? +v.toFixed(4) : v), 1));
