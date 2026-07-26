import * as fs from 'fs';
import * as path from 'path';

// Laning-stage research pass, option (a) (Blueprint/10-tech-debt-backlog.md,
// "Симуляция lane matchups (влияние на Tempo)"): per-hero rank of
// cumulative gold at the 10-minute mark WITHIN THEIR OWN TEAM (not a
// lane-opponent matchup — that's option (b), deferred due to is_roaming
// unreliability, same risk class already documented for role-fit v1).
//
// Same window-function-over-a-scoped-subquery pattern as
// research-role-fit-gpm-rank.ts (restrict the scan to only the target
// hero's own matches before ranking, not the full player_matches table) —
// just ranking by gold_t[11] (10-minute cumulative gold; gold_t is
// 1-indexed with index 1 = minute 0, confirmed via a manual Explorer probe)
// instead of gold_per_min (final-game GPM).
const HEROES_PATH = path.join(__dirname, '..', 'data', 'heroes.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'research-lane-tempo-output.json');
const EXPLORER_URL = 'https://api.opendota.com/api/explorer';
const RECENT_WINDOW = 150_000_000;
const MIN_GAMES = 15;

interface RawHero {
  id: number;
  name: string;
}

interface RankRow {
  heroId: number;
  name: string;
  rank: number;
  games: number;
  wins: number;
  winRate: number;
  share: number;
}

interface HeroSummary {
  heroId: number;
  name: string;
  games: number;
  avgGoldAt10: number;
  avgEarlyRank: number;
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
  const heroes: RawHero[] = JSON.parse(fs.readFileSync(HEROES_PATH, 'utf-8'));

  const maxRows = await explorerQuery('SELECT match_id FROM matches ORDER BY match_id DESC LIMIT 1');
  const maxMatchId = Number(maxRows[0]?.match_id ?? 8_900_000_000);
  const threshold = maxMatchId - RECENT_WINDOW;

  const rankRows: RankRow[] = [];
  const summaries: HeroSummary[] = [];

  for (const [index, hero] of heroes.entries()) {
    process.stdout.write(`[${index + 1}/${heroes.length}] ${hero.name}...\r`);

    const rows = await withRetry(() =>
      explorerQuery(
        `SELECT gold_rank, COUNT(*) as cnt, SUM(win) as wins, AVG(gold_at_10) as avg_gold_at_10 ` +
          `FROM ( ` +
          `  SELECT pm.match_id, pm.hero_id, pm.player_slot, pm.gold_t[11] as gold_at_10, ` +
          `    (CASE WHEN (pm.player_slot < 128) = m.radiant_win THEN 1 ELSE 0 END) as win, ` +
          `    RANK() OVER (PARTITION BY pm.match_id, (pm.player_slot < 128) ORDER BY pm.gold_t[11] DESC) as gold_rank ` +
          `  FROM player_matches pm ` +
          `  JOIN matches m ON pm.match_id = m.match_id ` +
          `  WHERE pm.match_id IN (SELECT match_id FROM player_matches WHERE hero_id = ${hero.id} AND match_id > ${threshold}) ` +
          `    AND array_length(pm.gold_t, 1) >= 11 ` +
          `) sub ` +
          `WHERE hero_id = ${hero.id} ` +
          `GROUP BY gold_rank`,
      ),
    );

    if (rows) {
      let total = 0;
      let weightedGold = 0;
      let weightedRank = 0;
      const byRank = new Map<number, { games: number; wins: number; avgGold: number }>();
      rows.forEach((r) => {
        const rank = Number(r.gold_rank);
        if (rank < 1 || rank > 5) return;
        const cnt = Number(r.cnt);
        const avgGold = Number(r.avg_gold_at_10 ?? 0);
        byRank.set(rank, { games: cnt, wins: Number(r.wins ?? 0), avgGold });
        total += cnt;
        weightedGold += avgGold * cnt;
        weightedRank += rank * cnt;
      });

      if (total >= MIN_GAMES) {
        summaries.push({
          heroId: hero.id,
          name: hero.name,
          games: total,
          avgGoldAt10: Math.round(weightedGold / total),
          avgEarlyRank: Math.round((weightedRank / total) * 1000) / 1000,
        });

        for (const [rank, { games, wins }] of byRank) {
          if (games >= MIN_GAMES) {
            rankRows.push({
              heroId: hero.id,
              name: hero.name,
              rank,
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

  console.log(`\n\nComputed ${summaries.length}/${heroes.length} hero summaries (min ${MIN_GAMES} games).\n`);

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify({ summaries, rankRows }, null, 2));

  const byGold = [...summaries].sort((a, b) => b.avgGoldAt10 - a.avgGoldAt10);
  console.log('=== TOP 15 avg gold at 10min ===');
  byGold.slice(0, 15).forEach((r) => console.log(`${r.name.padEnd(20)} ${r.avgGoldAt10}g  (avgEarlyRank ${r.avgEarlyRank})`));
  console.log('\n=== BOTTOM 15 avg gold at 10min ===');
  byGold
    .slice(-15)
    .reverse()
    .forEach((r) => console.log(`${r.name.padEnd(20)} ${r.avgGoldAt10}g  (avgEarlyRank ${r.avgEarlyRank})`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
