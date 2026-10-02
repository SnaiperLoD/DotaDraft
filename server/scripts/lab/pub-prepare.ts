// Public-match safe, step 0: turn the pulled OpenDota pages into a fixed pool
// for build-feature-cache.ts (LAB_POOL_FILE) + outcome sidecar. No network.
// Roles: none in publicMatches → each side gets the 5-role permutation that
// maximises Σ log(blended position weight) (same weights as the self-play pool).
//   cd server && npx ts-node scripts/lab/pub-prepare.ts
import * as fs from 'fs';
import * as path from 'path';
import { ROLES } from 'shared';
import { LAB_DIR, appendRun, blendedRoleWeights, loadHeroes } from './lab-common';

const PAGES = path.join(LAB_DIR, 'opendota', 'pages');
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
  m.game_mode === 22 && m.lobby_type === 7 && m.duration > 0 && m.radiant_win != null && m.radiant_team?.length === 5 && m.dire_team?.length === 5 && !m.radiant_team.includes(0) && !m.dire_team.includes(0);

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
function roles(team: number[]): string[] {
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
}

const seen = new Set<number>();
let raw = 0;
let unknownHero = 0;
const pool: { heroIdx: number[]; roles: string[] }[] = [];
const outcome: { matchId: number; startTime: number; duration: number; radiantWin: boolean; avgRankTier: number }[] = [];
for (const f of fs.readdirSync(PAGES).sort()) {
  for (const m of JSON.parse(fs.readFileSync(path.join(PAGES, f), 'utf-8')) as PM[]) {
    raw++;
    if (!usable(m) || seen.has(m.match_id)) continue;
    seen.add(m.match_id);
    const ids = [...m.radiant_team, ...m.dire_team];
    if (ids.some((id) => !idx.has(id))) {
      unknownHero++;
      continue;
    }
    pool.push({ heroIdx: ids.map((id) => idx.get(id)!), roles: [...roles(m.radiant_team), ...roles(m.dire_team)] });
    outcome.push({ matchId: m.match_id, startTime: m.start_time, duration: m.duration, radiantWin: !!m.radiant_win, avgRankTier: m.avg_rank_tier });
  }
}
fs.writeFileSync(path.join(LAB_DIR, 'opendota', 'pub-pool.json'), JSON.stringify(pool));
fs.writeFileSync(path.join(LAB_DIR, 'opendota', 'pub-outcome.json'), JSON.stringify(outcome));
const ts = outcome.map((o) => o.startTime);
const summary = {
  raw,
  usable: pool.length,
  unknownHero,
  radiantWinRate: outcome.filter((o) => o.radiantWin).length / outcome.length,
  window: [new Date(Math.min(...ts) * 1000).toISOString(), new Date(Math.max(...ts) * 1000).toISOString()],
  rankTier: [Math.min(...outcome.map((o) => o.avgRankTier)), Math.max(...outcome.map((o) => o.avgRankTier))],
};
appendRun({ kind: 'pub-prepare', label: 'pub-pool', config: { filter: 'AP ranked, no turbo, no broken rows, dedup', roles: 'argmax Σ log blended weight' }, seed: 0, nMatches: pool.length, metrics: summary, wallMs: 0 });
console.log(JSON.stringify(summary));
