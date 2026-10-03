// Blind window C (Blueprint/16 "Pre-registration: blind window C"), step 1:
// opendota-c pages → fixed pool + outcomes, with the pre-registered data checks.
// Prints COUNTS ONLY (no score / AUC), so a top-up pull may be decided on counts alone.
//   cd server && npx ts-node scripts/lab/kt8-c-prepare.ts
import * as fs from 'fs';
import * as path from 'path';
import { ROLES } from 'shared';
import { LAB_DIR, appendRun, blendedRoleWeights, loadHeroes } from './lab-common';

export const C_START = 1790812800; // 2026-10-01 00:00 UTC = end of STRATZ week 1790208000 (09-24..09-30)
export const C_MIN = { usable: 40000, perBracket: 5000, datesWith1k: 2 };
const DIR = path.join(LAB_DIR, 'opendota-c', 'pages');
const OUT = path.join(LAB_DIR, 'opendota-c');
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
const usable = (m: PM) =>
  m.game_mode === 22 && m.lobby_type === 7 && m.duration > 0 && m.radiant_win != null && m.avg_rank_tier >= 60 && m.avg_rank_tier <= 75 &&
  m.radiant_team?.length === 5 && m.dire_team?.length === 5 && !m.radiant_team.includes(0) && !m.dire_team.includes(0);

function idsIn(dir: string): Set<number> {
  const s = new Set<number>();
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir).filter((x) => x.endsWith('.json')) : [])
    for (const m of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')) as PM[]) s.add(m.match_id);
  return s;
}

export function prepareC(): { pass: boolean; checks: Record<string, unknown> } {
  if (!fs.existsSync(DIR)) throw new Error(`no pages in ${DIR} — run fetch-public-matches-c.ts first`);
  const in8h = idsIn(path.join(LAB_DIR, 'opendota', 'pages'));
  const inB = idsIn(path.join(LAB_DIR, 'opendota-wide', 'pages'));

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
  // same role rule as KT3 / KT4: per side, argmax Σ log(blended position weight)
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
  let raw = 0, dup = 0, before = 0, ex8h = 0, exB = 0, unknown = 0;
  const seen = new Set<number>();
  const pool: { heroIdx: number[]; roles: string[] }[] = [];
  const outcome: { matchId: number; startTime: number; radiantWin: boolean; avgRankTier: number; day: string; block6h: string }[] = [];
  for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.json')).sort()) {
    for (const m of JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf-8')) as PM[]) {
      raw++;
      tierHist[m.avg_rank_tier] = (tierHist[m.avg_rank_tier] ?? 0) + 1;
      if (!usable(m)) continue;
      if (seen.has(m.match_id)) { dup++; continue; }
      seen.add(m.match_id);
      if (m.start_time < C_START) { before++; continue; }
      if (in8h.has(m.match_id)) { ex8h++; continue; }
      if (inB.has(m.match_id)) { exB++; continue; }
      const ids = [...m.radiant_team, ...m.dire_team];
      if (ids.some((id) => !idx.has(id))) { unknown++; continue; }
      const iso = new Date(m.start_time * 1000).toISOString();
      pool.push({ heroIdx: ids.map((id) => idx.get(id)!), roles: [...roles(m.radiant_team), ...roles(m.dire_team)] });
      outcome.push({ matchId: m.match_id, startTime: m.start_time, radiantWin: !!m.radiant_win, avgRankTier: m.avg_rank_tier, day: iso.slice(0, 10), block6h: `${iso.slice(5, 10)} ${String(Math.floor(+iso.slice(11, 13) / 6) * 6).padStart(2, '0')}h` });
    }
  }
  // guard: window C strictly after the STRATZ week (pairs + winRate source)
  if (outcome.some((o) => o.startTime < C_START)) throw new Error('leakage guard: a match before 2026-10-01 00:00 UTC is in C');
  fs.writeFileSync(path.join(OUT, 'c-pool.json'), JSON.stringify(pool));
  fs.writeFileSync(path.join(OUT, 'c-outcome.json'), JSON.stringify(outcome));
  const byDay: Record<string, number> = {};
  for (const o of outcome) byDay[o.day] = (byDay[o.day] ?? 0) + 1;
  const ancient = outcome.filter((o) => o.avgRankTier < 70).length;
  const tiers = Object.keys(tierHist).map(Number);
  const checks = {
    rawRows: raw,
    rawTierRange: tiers.length ? [Math.min(...tiers), Math.max(...tiers)] : [],
    rawOutside60to75: Object.entries(tierHist).filter(([t]) => +t < 60 || +t > 75).reduce((s, [, n]) => s + n, 0),
    duplicates: dup,
    beforeWindowStart: before,
    excludedIn8hPull: ex8h,
    excludedInWideB: exB,
    unknownHero: unknown,
    usable: pool.length,
    ancient,
    divine: pool.length - ancient,
    startTimeRange: outcome.length ? [new Date(Math.min(...outcome.map((o) => o.startTime)) * 1000).toISOString(), new Date(Math.max(...outcome.map((o) => o.startTime)) * 1000).toISOString()] : [],
    days: byDay,
    datesWith1k: Object.values(byDay).filter((n) => n >= 1000).length,
    minimums: C_MIN,
  };
  const pass = checks.usable >= C_MIN.usable && checks.ancient >= C_MIN.perBracket && checks.divine >= C_MIN.perBracket && checks.datesWith1k >= C_MIN.datesWith1k;
  appendRun({ kind: 'kt8-c-prepare', label: 'window C pool', config: { filter: 'AP ranked, 60≤tier≤75, dedup, start≥2026-10-01, exclude 8h pull + B', roles: 'argmax Σ log blended weight' }, seed: 0, nMatches: pool.length, metrics: { ...checks, minimumsPass: pass }, wallMs: 0 });
  return { pass, checks };
}

if (require.main === module) {
  const { pass, checks } = prepareC();
  console.log(JSON.stringify({ ...checks, minimumsPass: pass }, null, 1));
}
