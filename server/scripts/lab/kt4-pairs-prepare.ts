// Pre-registered pair-channel test (Blueprint/16 "Pre-registration: pair channels"),
// step 1: wide pages → fixed pool + outcomes, with the data checks the protocol
// requires (rank filter as assumed, exclusion of the 2026-10-01 pull, minimums).
//   cd server && npx ts-node scripts/lab/kt4-pairs-prepare.ts
import * as fs from 'fs';
import * as path from 'path';
import { ROLES } from 'shared';
import { LAB_DIR, appendRun, blendedRoleWeights, loadHeroes } from './lab-common';

const DIR = path.join(LAB_DIR, 'opendota-wide', 'pages');
const OUT = path.join(LAB_DIR, 'opendota-wide');
interface PM {
  match_id: number;
  radiant_win: boolean | null;
  start_time: number;
  duration: number;
  lobby_type: number;
  game_mode: number;
  avg_rank_tier: number;
  radiant_team: number[];
  dire_team: number[];
}
const usableWide = (m: PM) =>
  m.game_mode === 22 && m.lobby_type === 7 && m.duration > 0 && m.radiant_win != null && m.avg_rank_tier >= 60 && m.avg_rank_tier <= 75 &&
  m.radiant_team?.length === 5 && m.dire_team?.length === 5 && !m.radiant_team.includes(0) && !m.dire_team.includes(0);

const excluded = new Set<number>();
for (const f of fs.readdirSync(path.join(LAB_DIR, 'opendota', 'pages')))
  for (const m of JSON.parse(fs.readFileSync(path.join(LAB_DIR, 'opendota', 'pages', f), 'utf-8')) as PM[]) excluded.add(m.match_id);

const { heroes, positionsById } = loadHeroes();
const idx = new Map(heroes.map((h, i) => [h.id, i]));
const W = new Map(heroes.map((h) => [h.id, blendedRoleWeights(positionsById.get(h.id) ?? [])]));
const perms: number[][] = [];
const permute = (a: number[], k = 0) => {
  if (k === a.length) perms.push([...a]);
  for (let i = k; i < a.length; i++) {
    [a[k], a[i]] = [a[i], a[k]];
    permute(a, k + 1);
    [a[k], a[i]] = [a[i], a[k]];
  }
};
permute([0, 1, 2, 3, 4]);
const roles = (team: number[]) => {
  let best = -Infinity;
  let bp = perms[0];
  for (const p of perms) {
    let s = 0;
    for (let k = 0; k < 5; k++) s += Math.log(Math.max(1e-3, W.get(team[k])![ROLES[p[k]]] ?? 1e-3));
    if (s > best) {
      best = s;
      bp = p;
    }
  }
  return bp.map((r) => ROLES[r]);
};

const tierHist: Record<string, number> = {};
let raw = 0;
let dup = 0;
let excl = 0;
let unknown = 0;
const seen = new Set<number>();
const pool: { heroIdx: number[]; roles: string[] }[] = [];
const outcome: { matchId: number; startTime: number; radiantWin: boolean; avgRankTier: number; day: string }[] = [];
for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.json')).sort()) {
  for (const m of JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf-8')) as PM[]) {
    raw++;
    tierHist[m.avg_rank_tier] = (tierHist[m.avg_rank_tier] ?? 0) + 1;
    if (!usableWide(m)) continue;
    if (seen.has(m.match_id)) {
      dup++;
      continue;
    }
    seen.add(m.match_id);
    if (excluded.has(m.match_id)) {
      excl++;
      continue;
    }
    const ids = [...m.radiant_team, ...m.dire_team];
    if (ids.some((id) => !idx.has(id))) {
      unknown++;
      continue;
    }
    pool.push({ heroIdx: ids.map((id) => idx.get(id)!), roles: [...roles(m.radiant_team), ...roles(m.dire_team)] });
    outcome.push({ matchId: m.match_id, startTime: m.start_time, radiantWin: !!m.radiant_win, avgRankTier: m.avg_rank_tier, day: new Date(m.start_time * 1000).toISOString().slice(0, 10) });
  }
}
fs.writeFileSync(path.join(OUT, 'wide-pool.json'), JSON.stringify(pool));
fs.writeFileSync(path.join(OUT, 'wide-outcome.json'), JSON.stringify(outcome));
const byDay: Record<string, number> = {};
for (const o of outcome) byDay[o.day] = (byDay[o.day] ?? 0) + 1;
const ancient = outcome.filter((o) => o.avgRankTier < 70).length;
const checks = {
  rawRows: raw,
  rawTierRange: [Math.min(...Object.keys(tierHist).map(Number)), Math.max(...Object.keys(tierHist).map(Number))],
  rawOutside60to75: Object.entries(tierHist).filter(([t]) => +t < 60 || +t > 75).reduce((s, [, n]) => s + n, 0),
  duplicates: dup,
  excludedFrom1001Pull: excl,
  unknownHero: unknown,
  usable: pool.length,
  ancient,
  divine: pool.length - ancient,
  days: byDay,
  nDays: Object.keys(byDay).length,
  daysWith1k: Object.values(byDay).filter((n) => n >= 1000).length,
};
const pass = checks.usable >= 50000 && checks.ancient >= 5000 && checks.divine >= 5000 && checks.daysWith1k >= 5;
appendRun({ kind: 'kt4-pairs-prepare', label: 'wide-pool', config: { filter: 'AP ranked, 60≤tier≤75, dedup, exclude 2026-10-01 pull', roles: 'argmax Σ log blended weight' }, seed: 0, nMatches: pool.length, metrics: { ...checks, minimumsPass: pass }, wallMs: 0 });
console.log(JSON.stringify({ ...checks, minimumsPass: pass }, null, 1));
