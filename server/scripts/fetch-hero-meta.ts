import * as fs from 'fs';
import * as path from 'path';

// One-time snapshot fetch of hero meta data from OpenDota (positions, win
// rate, ally synergy, matchups, performance benchmarks), per the plan in
// Blueprint/07-development-plan.md Milestone 3. Stored locally so the app
// keeps working offline afterward (Data Rule). Re-run manually to refresh
// (no scheduler — see Blueprint/10-tech-debt-backlog.md).
const HEROES_PATH = path.join(__dirname, '..', 'data', 'heroes.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'hero-meta.json');
const EXPLORER_URL = 'https://api.opendota.com/api/explorer';

// Match IDs are roughly monotonic with time; this is an approximation of
// "the last few months" of public matches, not a precise date range.
const RECENT_WINDOW = 150_000_000;

interface RawHero {
  id: number;
  name: string;
}

type Position = 'Carry' | 'Mid' | 'Offlane' | 'Support';

interface HeroPosition {
  position: Position;
  share: number;
}

interface HeroMetaEntry {
  heroId: number;
  positions: HeroPosition[];
  winRate: number | null;
  synergy: { allyHeroId: number; games: number; wins: number }[];
  matchups: { opponentHeroId: number; games: number; wins: number }[];
  benchmarks: unknown;
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

async function withRetry<T>(fn: () => Promise<T>, retries = 1): Promise<T | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === retries) {
        console.warn(`    failed after ${retries + 1} attempt(s): ${(err as Error).message}`);
        return null;
      }
      await sleep(1000);
    }
  }
  return null;
}

// A hero row's bucket is decided by lane + roaming flag. Roaming heroes are
// treated as Support regardless of lane, since OpenDota's is_roaming flag is
// specifically a support-style-play detector. This does NOT distinguish a
// hard support laning in the safe lane (not roaming) from the carry in that
// same lane — both land in "Carry" here. See Blueprint/10-tech-debt-backlog.md.
function classifyPositions(
  rows: { lane_role: number | null; is_roaming: boolean | null; cnt: number }[],
): HeroPosition[] {
  const buckets: Record<Position, number> = { Carry: 0, Mid: 0, Offlane: 0, Support: 0 };
  let total = 0;

  for (const row of rows) {
    if (row.lane_role == null) continue;
    const bucket: Position | null = row.is_roaming
      ? 'Support'
      : row.lane_role === 2
        ? 'Mid'
        : row.lane_role === 1
          ? 'Carry'
          : row.lane_role === 3
            ? 'Offlane'
            : null;
    if (!bucket) continue;
    buckets[bucket] += row.cnt;
    total += row.cnt;
  }

  if (total === 0) return [];

  return (Object.entries(buckets) as [Position, number][])
    .map(([position, cnt]) => ({ position, share: cnt / total }))
    .filter((p) => p.share >= 0.25)
    .sort((a, b) => b.share - a.share);
}

async function main() {
  const heroes: RawHero[] = JSON.parse(fs.readFileSync(HEROES_PATH, 'utf-8'));

  console.log('Fetching current match_id ceiling...');
  const maxRows = await explorerQuery('SELECT match_id FROM matches ORDER BY match_id DESC LIMIT 1');
  const maxMatchId = Number(maxRows[0]?.match_id ?? 8_900_000_000);
  const threshold = maxMatchId - RECENT_WINDOW;
  console.log(`Recent window: match_id > ${threshold}`);

  console.log('Fetching heroStats (win rate baseline, Ancient+Divine)...');
  const heroStatsRes = await fetch('https://api.opendota.com/api/heroStats');
  const heroStats: any[] = await heroStatsRes.json();
  const heroStatsById = new Map(heroStats.map((h) => [h.id, h]));

  const results: HeroMetaEntry[] = [];

  for (const [index, hero] of heroes.entries()) {
    console.log(`[${index + 1}/${heroes.length}] ${hero.name} (id ${hero.id})`);

    try {
      const posRows = await withRetry(() =>
        explorerQuery(
          `SELECT lane_role, is_roaming, COUNT(*) as cnt FROM player_matches WHERE hero_id = ${hero.id} AND match_id > ${threshold} GROUP BY lane_role, is_roaming`,
        ),
      );
      const positions = posRows
        ? classifyPositions(
            posRows.map((r) => ({
              lane_role: r.lane_role === null ? null : Number(r.lane_role),
              is_roaming: r.is_roaming,
              cnt: Number(r.cnt),
            })),
          )
        : [];

      await sleep(300);

      const synergyRows = await withRetry(() =>
        explorerQuery(
          `SELECT b.hero_id as ally_hero_id, COUNT(*) as games, SUM(CASE WHEN (a.player_slot < 128) = m.radiant_win THEN 1 ELSE 0 END) as wins FROM player_matches a JOIN player_matches b ON a.match_id = b.match_id AND ((a.player_slot < 128) = (b.player_slot < 128)) AND a.hero_id != b.hero_id JOIN matches m ON a.match_id = m.match_id WHERE a.hero_id = ${hero.id} AND a.match_id > ${threshold} GROUP BY b.hero_id ORDER BY games DESC LIMIT 15`,
        ),
      );
      const synergy = (synergyRows ?? [])
        .map((r) => ({
          allyHeroId: Number(r.ally_hero_id),
          games: Number(r.games),
          wins: Number(r.wins),
        }))
        .filter((r) => r.games >= 5);

      await sleep(300);

      const matchupsRes = await withRetry(async () => {
        const res = await fetch(`https://api.opendota.com/api/heroes/${hero.id}/matchups`);
        if (!res.ok) throw new Error(`matchups HTTP ${res.status}`);
        return res.json();
      });
      const matchups = ((matchupsRes as any[]) ?? []).map((m) => ({
        opponentHeroId: m.hero_id,
        games: m.games_played,
        wins: m.wins,
      }));

      await sleep(200);

      const benchmarksRes = await withRetry(async () => {
        const res = await fetch(`https://api.opendota.com/api/benchmarks?hero_id=${hero.id}`);
        if (!res.ok) throw new Error(`benchmarks HTTP ${res.status}`);
        return res.json();
      });
      const benchmarks = benchmarksRes?.result ?? null;

      const stat = heroStatsById.get(hero.id);
      let winRate: number | null = null;
      if (stat) {
        const picks = (stat['6_pick'] || 0) + (stat['7_pick'] || 0);
        const wins = (stat['6_win'] || 0) + (stat['7_win'] || 0);
        winRate = picks > 0 ? wins / picks : null;
      }

      results.push({ heroId: hero.id, positions, winRate, synergy, matchups, benchmarks });
    } catch (err) {
      console.warn(`  unexpected failure for ${hero.name}, skipping: ${(err as Error).message}`);
      results.push({
        heroId: hero.id,
        positions: [],
        winRate: null,
        synergy: [],
        matchups: [],
        benchmarks: null,
      });
    }

    await sleep(200);
  }

  const output = {
    generatedAt: new Date().toISOString(),
    recentMatchIdThreshold: threshold,
    heroes: results,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`Done. Wrote ${results.length} hero meta entries to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
