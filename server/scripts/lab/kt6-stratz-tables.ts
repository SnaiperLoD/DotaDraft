// STRATZ tables T1–T3 (plan: Blueprint/16 "STRATZ tables T1–T3 — analysis plan").
// Declared deviations (forced by payload shape, recorded in Blueprint):
//  - winWeek/winGameVersion rows carry NO position/bracket label (return type has only
//    week|gameVersionId, heroId, durationMinute, winCount, matchCount; 12 unlabeled rows per
//    hero-week) → used only at hero level (sum of rows). Position WR for T1(b) comes from
//    `stats` (time=0 rows: matchCount/winCount per hero × position, week 1789344000).
//  - laneOutcome rows: one per (heroId1, heroId2), position field constant → pair level only.
//   cd server && npx ts-node scripts/lab/kt6-stratz-tables.ts
import * as fs from 'fs';
import * as path from 'path';
import { DATA_DIR, LAB_DIR, appendRun, ensureLabDir, mulberry32 } from './lab-common';
import { STRATZ_ROOT } from './stratz-common';
import { mean, pearson, sd, spearman } from './lab-metrics';
import { NA, NP, productionParams } from './feature-cache';
import { AXES } from '../../src/assessment-core/axes';
import { pickAxisValue } from '../../src/assessment-core/axis-average';
import { HeroMetaService } from '../../src/hero-meta/hero-meta.service';
import type { Hero } from 'shared';

const OUT = ensureLabDir('kt6');
const BR = ['LEGEND_ANCIENT', 'DIVINE_IMMORTAL'];
const rd = (p: string) => JSON.parse(fs.readFileSync(path.join(STRATZ_ROOT, p), 'utf-8')).data as any[];
const heroes: Hero[] = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'heroes.json'), 'utf-8'));
const metaJ = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'hero-meta.json'), 'utf-8')).heroes as { heroId: number; winRate: number; positions: { position: string; share: number }[] }[];
for (const h of heroes) h.presumed_positions = (metaJ.find((m) => m.heroId === h.id)?.positions ?? []) as Hero['presumed_positions'];
const ids = heroes.map((h) => h.id);
const augWR = new Map(metaJ.map((m) => [m.heroId, m.winRate]));
const hsOct = new Map((JSON.parse(fs.readFileSync(path.join(LAB_DIR, 'opendota', 'heroStats.json'), 'utf-8')) as Record<string, number>[]).map((x) => [x.id, ((x['6_win'] ?? 0) + (x['7_win'] ?? 0)) / ((x['6_pick'] ?? 0) + (x['7_pick'] ?? 0))]));
// window B hero WR
const pool = JSON.parse(fs.readFileSync(path.join(LAB_DIR, 'opendota-wide', 'wide-pool.json'), 'utf-8')) as { heroIdx: number[] }[];
const outc = JSON.parse(fs.readFileSync(path.join(LAB_DIR, 'opendota-wide', 'wide-outcome.json'), 'utf-8')) as { radiantWin: boolean }[];
const bG = new Float64Array(heroes.length);
const bW = new Float64Array(heroes.length);
pool.forEach((m, i) => m.heroIdx.forEach((h, k) => { bG[h]++; if ((k < 5) === outc[i].radiantWin) bW[h]++; }));
const wrB = new Map(ids.map((id, h) => [id, bW[h] / bG[h]]));
const relBinom = (p: number[], n: number[]) => 1 - mean(p.map((v, i) => (v * (1 - v)) / n[i])) / sd(p) ** 2;

// ---------------- T1 ----------------
const weekRows = BR.flatMap((b) => rd(`positions/current/winWeek/${b}-all-allpos.json`));
const weeks = [...new Set(weekRows.map((r) => r.week as number))].sort((a, b) => a - b);
const B_START = 1790304851; // ≈ 2026-09-25 02:54 UTC (window B start)
const latestWeek = weeks.filter((w) => w + 7 * 86400 <= B_START).pop()!;
const heroWeek = (w: number) => {
  const g = new Map<number, number>();
  const win = new Map<number, number>();
  for (const r of weekRows) if (r.week === w) { g.set(r.heroId, (g.get(r.heroId) ?? 0) + r.matchCount); win.set(r.heroId, (win.get(r.heroId) ?? 0) + r.winCount); }
  return { g, wr: new Map([...g].map(([id, n]) => [id, win.get(id)! / n])) };
};
const hw = heroWeek(latestWeek);
const ok = ids.filter((id) => (hw.g.get(id) ?? 0) > 0);
const pW = ok.map((id) => hw.wr.get(id)!);
const nW = ok.map((id) => hw.g.get(id)!);
const weekPairs = weeks.slice(-5).map((w, i, arr) => (i === 0 ? null : (() => { const a = heroWeek(arr[i - 1]); const b = heroWeek(w); const c = ids.filter((id) => a.g.get(id) && b.g.get(id)); return { from: arr[i - 1], to: w, r: pearson(c.map((id) => a.wr.get(id)!), c.map((id) => b.wr.get(id)!)) }; })())).filter(Boolean);
const verRows = BR.flatMap((b) => rd(`positions/current/winGameVersion/${b}-all-allpos.json`));
const versions = [...new Set(verRows.map((r) => r.gameVersionId as number))].sort((a, b) => a - b);
const heroVer = (v: number) => {
  const g = new Map<number, number>();
  const w = new Map<number, number>();
  for (const r of verRows) if (r.gameVersionId === v) { g.set(r.heroId, (g.get(r.heroId) ?? 0) + r.matchCount); w.set(r.heroId, (w.get(r.heroId) ?? 0) + r.winCount); }
  return { g, wr: new Map([...g].map(([id, n]) => [id, w.get(id)! / n])) };
};
const [v1, v2] = versions.slice(-2);
const hv1 = heroVer(v1);
const hv2 = heroVer(v2);
const vIds = ids.filter((id) => (hv1.g.get(id) ?? 0) >= 1000 && (hv2.g.get(id) ?? 0) >= 1000);
const t1a = {
  latestWeekBeforeB: new Date(latestWeek * 1000).toISOString().slice(0, 10),
  picksPerHero: { min: Math.min(...nW), median: [...nW].sort((a, b) => a - b)[Math.floor(nW.length / 2)], max: Math.max(...nW) },
  sdPp: sd(pW) * 100,
  binomialReliability: relBinom(pW, nW),
  rVsAugWinRate: pearson(pW, ok.map((id) => augWR.get(id)!)),
  rVsOctHeroStats: pearson(pW, ok.map((id) => hsOct.get(id)!)),
  rVsWindowB: pearson(pW, ok.map((id) => wrB.get(id)!)),
  weekToWeek: weekPairs,
  patch: { versions: [v1, v2], heroes: vIds.length, r: pearson(vIds.map((id) => hv1.wr.get(id)!), vIds.map((id) => hv2.wr.get(id)!)), matches: [mean(vIds.map((id) => hv1.g.get(id)!)), mean(vIds.map((id) => hv2.g.get(id)!))] },
};

// T1(b) role-fit direction from stats time=0 rows (week 1789344000)
const statsRows = BR.flatMap((b) => rd(`stats/w1789344000/stats/${b}-all-allpos.json`));
const POS: Record<string, string> = { POSITION_1: 'Carry', POSITION_2: 'Mid', POSITION_3: 'Offlane', POSITION_4: 'Soft Support', POSITION_5: 'Hard Support' };
const cell = new Map<string, { g: number; w: number }>();
for (const r of statsRows) if (r.time === 0) {
  const k = `${r.heroId}|${r.position}`;
  const c = cell.get(k) ?? { g: 0, w: 0 };
  c.g += r.matchCount;
  c.w += r.winCount;
  cell.set(k, c);
}
const P0 = productionParams(0);
const power = (h: Hero, role: string) => {
  let blended = 0;
  for (let p = 0; p < NP; p++) {
    let s = 0;
    let t = 0;
    for (let a = 0; a < NA; a++) {
      s += pickAxisValue({ hero: h, assignedRole: role }, AXES[a], undefined, (['early', 'mid', 'late'] as const)[p]) * P0.w[p * NA + a];
      t += P0.w[p * NA + a];
    }
    blended += P0.pd[p] * (t ? s / t : 0);
  }
  return blended;
};
const cells: { heroId: number; pos: string; dPos: number; dRf: number; g: number }[] = [];
for (const h of heroes) {
  const cs = Object.keys(POS).map((p) => ({ p, c: cell.get(`${h.id}|${p}`) ?? { g: 0, w: 0 } }));
  const tot = cs.reduce((s, x) => s + x.c.g, 0);
  if (!tot) continue;
  const wrH = cs.reduce((s, x) => s + x.c.w, 0) / tot;
  const pw = cs.map((x) => ({ ...x, pw: power(h, POS[x.p]) }));
  const meanPw = pw.reduce((s, x) => s + (x.c.g / tot) * x.pw, 0);
  for (const x of pw) if (x.c.g >= 1000) cells.push({ heroId: h.id, pos: x.p, dPos: x.c.w / x.c.g - wrH, dRf: x.pw - meanPw, g: x.c.g });
}
const multi = cells.filter((c) => cells.filter((d) => d.heroId === c.heroId).length >= 2);
const rCells = (cs: typeof cells) => pearson(cs.map((c) => c.dRf), cs.map((c) => c.dPos));
const heroIdsMulti = [...new Set(multi.map((c) => c.heroId))];
const rng = mulberry32(6060);
const bootR: number[] = [];
for (let b = 0; b < 2000; b++) {
  const sample: typeof cells = [];
  for (let i = 0; i < heroIdsMulti.length; i++) {
    const id = heroIdsMulti[Math.floor(rng() * heroIdsMulti.length)];
    sample.push(...multi.filter((c) => c.heroId === id));
  }
  bootR.push(rCells(sample));
}
bootR.sort((a, b) => a - b);
const rRf = rCells(multi);
const ciRf = [bootR[49], bootR[1949]];
const t1b = {
  cells: multi.length,
  heroes: heroIdsMulti.length,
  r: rRf,
  spearman: spearman(multi.map((c) => c.dRf), multi.map((c) => c.dPos)),
  ci95: ciRf,
  verdict: ciRf[0] > 0 ? 'direction validated' : ciRf[1] < 0 ? 'contradicted' : 'not supported',
  sdDeltaPosPp: sd(multi.map((c) => c.dPos)) * 100,
  worstCells: [...multi].sort((a, b) => a.dRf * a.dPos - b.dRf * b.dPos).slice(0, 8).map((c) => ({ hero: heroes.find((h) => h.id === c.heroId)!.name, pos: POS[c.pos], dPosPp: +(c.dPos * 100).toFixed(1), dRf: +c.dRf.toFixed(3), g: c.g })),
};

// ---------------- T2 ----------------
const lane = new Map<string, { g: number; w: number; l: number; d: number; mw: number }>();
for (const b of BR)
  for (const r of rd(`lanes/w1789344000/laneOutcome/${b}-all-allpos-vs.json`)) {
    const k = `${r.heroId1}-${r.heroId2}`;
    const c = lane.get(k) ?? { g: 0, w: 0, l: 0, d: 0, mw: 0 };
    c.g += r.matchCount;
    c.w += r.winCount;
    c.l += r.lossCount;
    c.d += r.drawCount;
    c.mw += r.matchWinCount;
    lane.set(k, c);
  }
const proLookup = new HeroMetaService();
const stzMeta = JSON.parse(fs.readFileSync(path.join(STRATZ_ROOT, 'hero-meta.stratz-both.json'), 'utf-8')).heroes as { heroId: number; matchups: { opponentHeroId: number; games: number; wins: number }[] }[];
const stzM = new Map<string, number>();
for (const e of stzMeta) for (const m of e.matchups) stzM.set(`${e.heroId}-${m.opponentHeroId}`, (m.wins + 10) / (m.games + 20));
const pairs = [...lane.entries()].filter(([, c]) => c.g >= 200 && c.w + c.l > 0);
const laneWR = pairs.map(([, c]) => c.w / (c.w + c.l));
const proxy = pairs.map(([k]) => { const [a, o] = k.split('-').map(Number); return proLookup.getMatchupWinRate(a, o); });
const proxyOk = proxy.map((v, i) => [v, laneWR[i]] as [number | null, number]).filter((x) => x[0] != null) as [number, number][];
const gameWR = pairs.map(([, c]) => c.mw / c.g);
const t2 = {
  rows: lane.size,
  pairsWith200: pairs.length,
  medianLanesPerPair: [...pairs.map(([, c]) => c.g)].sort((a, b) => a - b)[Math.floor(pairs.length / 2)],
  drawSharePct: mean(pairs.map(([, c]) => c.d / c.g)) * 100,
  laneWRsdPp: sd(laneWR) * 100,
  proxyCoverage: proxyOk.length / pairs.length,
  spearmanProxyVsLane: spearman(proxyOk.map((x) => x[0]), proxyOk.map((x) => x[1])),
  spearmanStratzGameMatchupVsLane: spearman(pairs.map(([k]) => stzM.get(k) ?? 0.5), laneWR),
  spearmanSameRowsGameWRvsLane: spearman(gameWR, laneWR),
};
const t2verdict = t2.spearmanProxyVsLane < 0.3 ? 'lane cards do NOT describe lanes (proxy ≈ game matchup)' : 'proxy tracks lanes';

// ---------------- T3 ----------------
const mainPos = new Map<number, string>();
for (const h of heroes) {
  let best = '';
  let bg = -1;
  for (const p of Object.keys(POS)) { const c = cell.get(`${h.id}|${p}`); if (c && c.g > bg) { bg = c.g; best = p; } }
  mainPos.set(h.id, best);
}
const at = (id: number, t: number) => {
  const rows = statsRows.filter((r) => r.heroId === id && r.position === mainPos.get(id) && r.time === t);
  const g = rows.reduce((s, r) => s + r.matchCount, 0);
  const f = (k: string) => rows.reduce((s, r) => s + (r[k] ?? 0) * r.matchCount, 0) / g;
  return f;
};
const feats = heroes.map((h) => {
  const t10 = at(h.id, 10);
  const t30 = at(h.id, 30);
  return {
    id: h.id,
    name: h.name,
    ev: h.evaluation_values as unknown as Record<string, number>,
    kaPerMin: (t30('kills') + t30('assists')) / 30,
    nw10: t10('networth'),
    nwGrowth: t30('networth') - t10('networth'),
    tower30: t30('towerDamage'),
    heal30: t30('healingAllies'),
    heroDmg30: t30('heroDamage'),
    disable30: t30('stunDuration') + t30('disableDuration'),
    deaths30: t30('deaths'),
  };
});
const MAP: [string, keyof (typeof feats)[number], string][] = [
  ['skirmish_rate', 'kaPerMin', 'kills+assists per min (30)'],
  ['tempo', 'nw10', 'networth at 10'],
  ['scaling', 'nwGrowth', 'networth growth 10→30'],
  ['objectives', 'tower30', 'tower damage at 30'],
  ['saving', 'heal30', 'ally healing at 30'],
  ['burst', 'heroDmg30', 'hero damage at 30'],
  ['teamfight', 'heroDmg30', 'hero damage at 30'],
  ['control', 'disable30', 'stun+disable duration at 30'],
  ['durability', 'deaths30', 'deaths at 30 (expect negative)'],
];
const z = (v: number[]) => { const m = mean(v); const s = sd(v); return v.map((x) => (x - m) / s); };
const t3 = MAP.map(([axis, f, label]) => {
  const ok3 = feats.filter((x) => Number.isFinite(x[f] as number));
  const a = ok3.map((x) => x.ev[axis] ?? 0);
  const s = ok3.map((x) => x[f] as number);
  const za = z(a);
  const zs = z(s);
  const sign = axis === 'durability' ? -1 : 1;
  const mism = ok3.map((x, i) => ({ hero: x.name, d: sign * zs[i] - za[i] })).filter((m) => Math.abs(m.d) >= 2).sort((p, q) => Math.abs(q.d) - Math.abs(p.d)).slice(0, 6).map((m) => `${m.hero} ${m.d > 0 ? 'stat≫axis' : 'axis≫stat'} (${m.d.toFixed(1)})`);
  return { axis, stat: label, spearman: spearman(a, s), mismatches: mism };
});

const out = { generatedAt: new Date().toISOString(), deviations: ['T1 position WR from stats time=0 rows (winWeek unlabeled)', 'laneOutcome is pair-level only'], t1a, t1b, t2: { ...t2, verdict: t2verdict }, t3 };
fs.writeFileSync(path.join(OUT, 'kt6-stratz-tables.json'), JSON.stringify(out, null, 2));
appendRun({ kind: 'kt6-stratz-tables', label: 'T1-T3', config: { brackets: BR, week: 1789344000 }, seed: 0, nMatches: 0, metrics: out, wallMs: 0 });
console.log(JSON.stringify(out, (k, v) => (typeof v === 'number' ? +v.toFixed(4) : v), 1));
