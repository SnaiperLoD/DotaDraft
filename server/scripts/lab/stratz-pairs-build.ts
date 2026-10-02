// STRATZ pairs → pre-checks (Blueprint/16 "Pre-registration: STRATZ pair stats") and
// lab hero-meta copies. No network. Reads artifacts/lab/stratz/raw/{<bracket>,w<week>/<bracket>}/<id>.json.
//   cd server && npx ts-node scripts/lab/stratz-pairs-build.ts
import * as fs from 'fs';
import * as path from 'path';
import { DATA_DIR, appendRun } from './lab-common';
import { STRATZ_ROOT } from './stratz-common';

const WEEK = process.env.LAB_STRATZ_WEEK ?? '1789344000';
const BRACKETS = ['LEGEND_ANCIENT', 'DIVINE_IMMORTAL'];
interface Entry { heroId2: number; matchCount: number; winCount: number }
interface Raw { heroId: number; bracket: string; week: number | null; advantage: { with: Entry[]; vs: Entry[] } | null }

function load(bracket: string, id: number): Raw | null {
  for (const p of [path.join(STRATZ_ROOT, 'raw', `w${WEEK}`, bracket, `${id}.json`), path.join(STRATZ_ROOT, 'raw', bracket, `${id}.json`)]) {
    if (!fs.existsSync(p)) continue;
    const r = JSON.parse(fs.readFileSync(p, 'utf-8')) as Raw;
    if (String(r.week) === WEEK) return r;
  }
  return null;
}

const meta = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'hero-meta.json'), 'utf-8'));
const ids: number[] = meta.heroes.map((h: { heroId: number }) => h.heroId);
// counts[bracketSet][kind] : Map "h-o" → {g,w}
type Cnt = Map<string, { g: number; w: number }>;
const make = () => ({ with: new Map() as Cnt, vs: new Map() as Cnt });
const sets: Record<string, ReturnType<typeof make>> = { both: make(), divine: make() };
const missing: string[] = [];
for (const b of BRACKETS)
  for (const id of ids) {
    const r = load(b, id);
    if (!r?.advantage) {
      missing.push(`${b}/${id}`);
      continue;
    }
    for (const kind of ['with', 'vs'] as const)
      for (const e of r.advantage[kind]) {
        for (const s of b === 'DIVINE_IMMORTAL' ? ['both', 'divine'] : ['both']) {
          const k = `${id}-${e.heroId2}`;
          const cur = sets[s][kind].get(k) ?? { g: 0, w: 0 };
          cur.g += e.matchCount;
          cur.w += e.winCount;
          sets[s][kind].set(k, cur);
        }
      }
  }

// ---- pre-checks on the primary (both brackets) ----
const P = sets.both;
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(1, (a + b) / 2);
let synPairs = 0, synMatchOk = 0, synWinOk = 0;
for (const [k, v] of P.with) {
  const [h, a] = k.split('-').map(Number);
  if (h > a) continue;
  const o = P.with.get(`${a}-${h}`);
  if (!o) continue;
  synPairs++;
  if (rel(v.g, o.g) <= 0.01) synMatchOk++;
  if (rel(v.w, o.w) <= 0.01) synWinOk++;
}
let vsPairs = 0, vsSumOk = 0, vsEqOk = 0, vsMatchSym = 0;
for (const [k, v] of P.vs) {
  const [h, o] = k.split('-').map(Number);
  if (h > o) continue;
  const r = P.vs.get(`${o}-${h}`);
  if (!r) continue;
  vsPairs++;
  if (rel(v.g, r.g) <= 0.01) vsMatchSym++;
  if (rel(v.w + r.w, v.g) <= 0.01) vsSumOk++;
  if (rel(v.w, r.w) <= 0.01) vsEqOk++;
}
const nPairs = (ids.length * (ids.length - 1)) / 2;
let covered = 0;
const vsCounts: number[] = [];
const withCounts: number[] = [];
for (let i = 0; i < ids.length; i++)
  for (let j = i + 1; j < ids.length; j++) {
    const g = (P.vs.get(`${ids[i]}-${ids[j]}`)?.g ?? 0) + (P.with.get(`${ids[i]}-${ids[j]}`)?.g ?? 0);
    if ((P.vs.get(`${ids[i]}-${ids[j]}`)?.g ?? 0) > 0 && (P.with.get(`${ids[i]}-${ids[j]}`)?.g ?? 0) > 0) covered++;
    vsCounts.push(P.vs.get(`${ids[i]}-${ids[j]}`)?.g ?? 0);
    withCounts.push(P.with.get(`${ids[i]}-${ids[j]}`)?.g ?? 0);
    void g;
  }
const q = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.floor(p * (a.length - 1))];
const orientationStrict = vsSumOk / vsPairs >= 0.95 ? 'own' : vsEqOk / vsPairs >= 0.95 ? 'opponent' : 'unknown';
// AMENDED pre-check (author-approved 2026-10-02, changed AFTER seeing the data): share-level.
// STRATZ samples each hero's query separately, so mirror COUNTS differ by sampling; rates must agree.
const ratios: number[] = [];
const wrPairs: [number, number][] = [];
const devs: number[] = [];
const synPairsR: [number, number][] = [];
for (const [k, v] of P.vs) {
  const [h, o] = k.split('-').map(Number);
  if (h > o) continue;
  const r = P.vs.get(`${o}-${h}`);
  if (!r || !v.g || !r.g) continue;
  ratios.push(v.g / r.g);
  wrPairs.push([v.w / v.g, 1 - r.w / r.g]);
  devs.push(Math.abs(v.w / v.g + r.w / r.g - 1));
}
for (const [k, v] of P.with) {
  const [h, a] = k.split('-').map(Number);
  if (h > a) continue;
  const r = P.with.get(`${a}-${h}`);
  if (r && v.g && r.g) synPairsR.push([v.w / v.g, r.w / r.g]);
}
const medRatio = [...ratios].sort((x, y) => x - y)[Math.floor(ratios.length / 2)];
const rOwn = (() => { const n = wrPairs.length; const mx = wrPairs.reduce((s, p) => s + p[0], 0) / n; const my = wrPairs.reduce((s, p) => s + p[1], 0) / n; let c = 0, x = 0, y = 0; for (const [a, b] of wrPairs) { c += (a - mx) * (b - my); x += (a - mx) ** 2; y += (b - my) ** 2; } return c / Math.sqrt(x * y); })();
const meanDevPp = (devs.reduce((s, v) => s + v, 0) / devs.length) * 100;
const amended = { medianMirrorRatio: medRatio, rOwnOrientation: rOwn, meanDeviationPp: meanDevPp, pass: Math.abs(medRatio - 1) <= 0.02 && rOwn >= 0.9 && meanDevPp <= 2.5 };
const orientation = amended.pass ? 'own' : orientationStrict;
// mirror averaging (part of the amendment): symmetric quantities use both directions
for (const s of ['both', 'divine'] as const) {
  const W2 = sets[s].with;
  const V2 = sets[s].vs;
  const wNew = new Map<string, { g: number; w: number }>();
  for (const [k, v] of W2) { const [h, a] = k.split('-'); const r = W2.get(`${a}-${h}`) ?? v; wNew.set(k, { g: (v.g + r.g) / 2, w: (v.w + r.w) / 2 }); }
  const vNew = new Map<string, { g: number; w: number }>();
  for (const [k, v] of V2) { const [h, o] = k.split('-'); const r = V2.get(`${o}-${h}`) ?? { g: v.g, w: v.g - v.w }; vNew.set(k, { g: (v.g + r.g) / 2, w: (v.w + (r.g - r.w)) / 2 }); }
  sets[s].with = wNew;
  sets[s].vs = vNew;
}
const checks = {
  week: WEEK,
  missingFiles: missing,
  synergySymmetry: { pairs: synPairs, matchCountWithin1pct: synMatchOk / synPairs, winCountWithin1pct: synWinOk / synPairs },
  matchupOrientation: { pairs: vsPairs, matchCountSymmetric: vsMatchSym / vsPairs, winsSumToGames: vsSumOk / vsPairs, winsEqual: vsEqOk / vsPairs, orientationStrict, orientation },
  amendedShareLevel: amended,
  coverage: { pairs: nPairs, coveredBoth: covered, frac: covered / nPairs },
  vsGamesPerPair: { min: q(vsCounts, 0), p10: q(vsCounts, 0.1), median: q(vsCounts, 0.5), p90: q(vsCounts, 0.9), max: q(vsCounts, 1) },
  withGamesPerPair: { min: q(withCounts, 0), p10: q(withCounts, 0.1), median: q(withCounts, 0.5), p90: q(withCounts, 0.9), max: q(withCounts, 1) },
};
const passStrict = missing.length === 0 && checks.synergySymmetry.matchCountWithin1pct >= 0.95 && checks.synergySymmetry.winCountWithin1pct >= 0.95 && orientationStrict !== 'unknown' && checks.coverage.frac >= 0.95;
const pass = missing.length === 0 && amended.pass && checks.coverage.frac >= 0.95;
void passStrict;

// ---- lab hero-meta copies (synergy/matchups replaced; everything else production) ----
for (const s of ['both', 'divine'] as const) {
  const copy = JSON.parse(JSON.stringify(meta));
  copy.generatedAt = new Date().toISOString();
  copy.pairSource = `STRATZ heroVsHeroMatchup, ${s === 'both' ? 'LEGEND_ANCIENT+DIVINE_IMMORTAL' : 'DIVINE_IMMORTAL'}, week ${WEEK}`;
  for (const h of copy.heroes) {
    h.synergy = [...sets[s].with.entries()].filter(([k]) => k.startsWith(`${h.heroId}-`)).map(([k, v]) => ({ allyHeroId: Number(k.split('-')[1]), games: v.g, wins: v.w }));
    h.matchups = [...sets[s].vs.entries()].filter(([k]) => k.startsWith(`${h.heroId}-`)).map(([k, v]) => ({ opponentHeroId: Number(k.split('-')[1]), games: v.g, wins: v.w }));
  }
  fs.writeFileSync(path.join(STRATZ_ROOT, `hero-meta.stratz-${s}.json`), JSON.stringify(copy));
}
// ---- CLEANED pairs (pre-registered 2026-10-02 after raw STZ was seen on B) ----
// Base WR per hero = STRATZ stats time=0, same week, both brackets. Expected pair rate under
// "no interaction" (logit-additive): matchup e = σ(logit W_h − logit W_o); synergy
// e = σ(logit W_h + logit W_a − logit 0.5·…) ≈ σ(logit W_h + logit W_a). Cleaned rate =
// clamp(0.5 + (observed − e), 0.01, 0.99); stored as wins = rate × games so production
// shrinkage (K = 20) applies unchanged.
{
  const statsW = new Map<number, { g: number; w: number }>();
  for (const b of BRACKETS)
    for (const r of JSON.parse(fs.readFileSync(path.join(STRATZ_ROOT, 'stats', `w${WEEK}`, 'stats', `${b}-all-allpos.json`), 'utf-8')).data as { time: number; heroId: number; matchCount: number; winCount: number }[])
      if (r.time === 0) {
        const c = statsW.get(r.heroId) ?? { g: 0, w: 0 };
        c.g += r.matchCount;
        c.w += r.winCount;
        statsW.set(r.heroId, c);
      }
  const W = (id: number) => { const c = statsW.get(id)!; return c.w / c.g; };
  const logit = (p: number) => Math.log(p / (1 - p));
  const sig = (x: number) => 1 / (1 + Math.exp(-x));
  const clamp = (v: number) => Math.min(0.99, Math.max(0.01, v));
  const copy = JSON.parse(JSON.stringify(meta));
  copy.generatedAt = new Date().toISOString();
  copy.pairSource = `STRATZ heroVsHeroMatchup CLEANED (logit-additive base WR removed), LEGEND_ANCIENT+DIVINE_IMMORTAL, week ${WEEK}`;
  for (const h of copy.heroes) {
    h.synergy = [...sets.both.with.entries()].filter(([k]) => k.startsWith(`${h.heroId}-`)).map(([k, v]) => {
      const a = Number(k.split('-')[1]);
      const e = sig(logit(W(h.heroId)) + logit(W(a)));
      return { allyHeroId: a, games: v.g, wins: clamp(0.5 + (v.w / v.g - e)) * v.g };
    });
    h.matchups = [...sets.both.vs.entries()].filter(([k]) => k.startsWith(`${h.heroId}-`)).map(([k, v]) => {
      const o = Number(k.split('-')[1]);
      const e = sig(logit(W(h.heroId)) - logit(W(o)));
      return { opponentHeroId: o, games: v.g, wins: clamp(0.5 + (v.w / v.g - e)) * v.g };
    });
  }
  fs.writeFileSync(path.join(STRATZ_ROOT, 'hero-meta.stratz-clean.json'), JSON.stringify(copy));
}
appendRun({ kind: 'stratz-pairs-build', label: `week ${WEEK}`, config: { brackets: BRACKETS }, seed: 0, nMatches: 0, metrics: { ...checks, prechecksPass: pass }, wallMs: 0 });
console.log(JSON.stringify({ ...checks, prechecksPass: pass }, null, 1));
