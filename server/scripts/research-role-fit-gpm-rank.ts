import * as fs from 'fs';
import * as path from 'path';

// Role-fit calibration input, v2 (Blueprint/10-tech-debt-backlog.md, "Оценка
// героя не учитывает назначенную роль"). research-role-fit-data.ts (v1,
// lane_role/is_roaming bucketing) turned out unusable for Support: is_roaming
// only catches heroes that actively roam, not heroes standing static in a
// lane playing support — no hero's top-share bucket was ever "Support".
//
// v2 uses per-match GPM rank within the hero's own team instead — the
// standard Dota position convention (1=highest GPM ... 5=lowest GPM maps to
// Carry/Mid/Offlane/Soft Support/Hard Support). This gives all 5 draft
// roles directly, not just 4 lane buckets, so it replaces v1 entirely for
// role-fit purposes (does not touch hero-meta.json/presumed_positions,
// which is a separate, already-documented system).
//
// Query shape: restrict the window-function scan to only the matches the
// target hero played (subquery on match_id), not the full player_matches
// table — verified this keeps each query under ~1s instead of risking a
// timeout scanning tens of millions of rows.
const HEROES_PATH = path.join(__dirname, '..', 'data', 'heroes.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'research-role-fit-gpm-output.json');
const EXPLORER_URL = 'https://api.opendota.com/api/explorer';
const RECENT_WINDOW = 150_000_000;
const MIN_GAMES = 15;

const RANK_TO_ROLE: Record<number, string> = {
  1: 'Carry',
  2: 'Mid',
  3: 'Offlane',
  4: 'Soft Support',
  5: 'Hard Support',
};

interface RawHero {
  id: number;
  name: string;
}

interface RoleRow {
  heroId: number;
  name: string;
  role: string;
  games: number;
  wins: number;
  winRate: number;
  share: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function explorerQuery(sql: string): Promise<any[]> {
  const res = await fetch(`${EXPLORER_URL}?sql=${encodeURIComponent(sql)}`);
  if (!res.ok) throw new Error(`Explorer HTTP ${res.status}`);
  const json = await res.json();
  if (json.err) throw new Error(`Explorer error: ${json.err}`);
  return json.rows ?? [];
}

async function withRetry<T>(fn: () => Promise<T>, retries = 4): Promise<T | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === retries) {
        console.warn(`    failed after ${retries + 1} attempt(s): ${(err as Error).message}`);
        return null;
      }
      await sleep(2500);
    }
  }
  return null;
}

async function main() {
  const allHeroes: RawHero[] = JSON.parse(fs.readFileSync(HEROES_PATH, 'utf-8'));

  const existing: RoleRow[] = fs.existsSync(OUTPUT_PATH)
    ? (JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf-8')) as RoleRow[])
    : [];
  const doneHeroIds = new Set(existing.map((r) => r.heroId));
  const heroes = allHeroes.filter((h) => !doneHeroIds.has(h.id));
  if (existing.length > 0) {
    console.log(`Resuming: ${doneHeroIds.size}/${allHeroes.length} heroes already in ${OUTPUT_PATH}.`);
  }

  const maxRows = await explorerQuery('SELECT match_id FROM matches ORDER BY match_id DESC LIMIT 1');
  const maxMatchId = Number(maxRows[0]?.match_id ?? 8_900_000_000);
  const threshold = maxMatchId - RECENT_WINDOW;

  const results: RoleRow[] = [...existing];

  for (const [index, hero] of heroes.entries()) {
    process.stdout.write(`[${index + 1}/${heroes.length}] ${hero.name}...\r`);

    const rows = await withRetry(() =>
      explorerQuery(
        `SELECT gpm_rank, COUNT(*) as cnt, SUM(win) as wins ` +
          `FROM ( ` +
          `  SELECT pm.match_id, pm.hero_id, pm.player_slot, ` +
          `    (CASE WHEN (pm.player_slot < 128) = m.radiant_win THEN 1 ELSE 0 END) as win, ` +
          `    RANK() OVER (PARTITION BY pm.match_id, (pm.player_slot < 128) ORDER BY pm.gold_per_min DESC) as gpm_rank ` +
          `  FROM player_matches pm ` +
          `  JOIN matches m ON pm.match_id = m.match_id ` +
          `  WHERE pm.match_id IN (SELECT match_id FROM player_matches WHERE hero_id = ${hero.id} AND match_id > ${threshold}) ` +
          `) sub ` +
          `WHERE hero_id = ${hero.id} ` +
          `GROUP BY gpm_rank`,
      ),
    );

    if (rows) {
      let total = 0;
      const byRank = new Map<number, { games: number; wins: number }>();
      rows.forEach((r) => {
        const rank = Number(r.gpm_rank);
        if (rank < 1 || rank > 5) return; // ranks >5 can't happen (5 players/team) but guard anyway
        const cnt = Number(r.cnt);
        byRank.set(rank, { games: cnt, wins: Number(r.wins ?? 0) });
        total += cnt;
      });

      if (total > 0) {
        for (const [rank, { games, wins }] of byRank) {
          if (games >= MIN_GAMES) {
            results.push({
              heroId: hero.id,
              name: hero.name,
              role: RANK_TO_ROLE[rank],
              games,
              wins,
              winRate: Math.round((wins / games) * 1000) / 1000,
              share: Math.round((games / total) * 1000) / 1000,
            });
          }
        }
      }
    }

    await sleep(400);
  }

  console.log(`\n\nComputed ${results.length} (hero, role) rows (min ${MIN_GAMES} games each).\n`);

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2));

  const byHero = new Map<number, RoleRow[]>();
  results.forEach((r) => {
    if (!byHero.has(r.heroId)) byHero.set(r.heroId, []);
    byHero.get(r.heroId)!.push(r);
  });

  const naturalRoleCounts: Record<string, number> = {};
  for (const [, rows] of byHero) {
    const natural = [...rows].sort((a, b) => b.share - a.share)[0];
    naturalRoleCounts[natural.role] = (naturalRoleCounts[natural.role] || 0) + 1;
  }
  console.log('Natural-role distribution (top-share position per hero):', naturalRoleCounts);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
