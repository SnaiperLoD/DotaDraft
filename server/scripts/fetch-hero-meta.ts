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

// Position bucket from per-match GPM rank within the hero's own team (1 =
// highest GPM ... 5 = lowest), the standard Dota position convention —
// rank 1-3 map straight to Carry/Mid/Offlane, ranks 4-5 (Soft/Hard Support)
// merge into the single Support bucket this 4-position system expects.
//
// Replaces the original lane_role/is_roaming classification, which
// couldn't tell a hard support standing static in the safe lane from the
// actual carry in that lane — is_roaming only catches heroes that
// *actively* roam, so support heroes who mostly stay put (Chen, Jakiro,
// Crystal Maiden, Lich, ...) came back "mostly Carry". Confirmed and fixed
// once already this way via research-role-fit-gpm-rank.ts + a one-off
// patch script (recompute-presumed-positions.ts) — ported into the
// standard fetch here so a future full re-fetch doesn't regress back to
// the old bug. See Blueprint/10-tech-debt-backlog.md.
const GPM_RANK_TO_POSITION: Record<number, Position> = {
  1: 'Carry',
  2: 'Mid',
  3: 'Offlane',
  4: 'Support',
  5: 'Support',
};

function classifyPositions(rows: { gpm_rank: number; cnt: number }[]): HeroPosition[] {
  const buckets: Record<Position, number> = { Carry: 0, Mid: 0, Offlane: 0, Support: 0 };
  let total = 0;

  for (const row of rows) {
    const bucket = GPM_RANK_TO_POSITION[row.gpm_rank];
    if (!bucket) continue; // ranks >5 can't happen (5 players/team) but guard anyway
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
      // Scoped to only this hero's own matches (subquery) rather than
      // scanning the full player_matches table before ranking — keeps the
      // window-function query fast (~0.5s/hero, verified in
      // research-role-fit-gpm-rank.ts) regardless of table size.
      const posRows = await withRetry(() =>
        explorerQuery(
          `SELECT gpm_rank, COUNT(*) as cnt ` +
            `FROM ( ` +
            `  SELECT pm.match_id, pm.hero_id, ` +
            `    RANK() OVER (PARTITION BY pm.match_id, (pm.player_slot < 128) ORDER BY pm.gold_per_min DESC) as gpm_rank ` +
            `  FROM player_matches pm ` +
            `  WHERE pm.match_id IN (SELECT match_id FROM player_matches WHERE hero_id = ${hero.id} AND match_id > ${threshold}) ` +
            `) sub ` +
            `WHERE hero_id = ${hero.id} ` +
            `GROUP BY gpm_rank`,
        ),
      );
      const positions = posRows
        ? classifyPositions(posRows.map((r) => ({ gpm_rank: Number(r.gpm_rank), cnt: Number(r.cnt) })))
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
  const emptyPositions = results.filter((h) => !h.positions.length).length;
  console.log(`Done. Wrote ${results.length} hero meta entries to ${OUTPUT_PATH}`);
  if (emptyPositions > 0) {
    console.warn(
      `  ${emptyPositions} heroes have empty positions — run npm run refetch-incomplete-hero-meta, then:`,
    );
  }
  console.log(
    'Next (required for UI role tooltips): npm run recompute-presumed-positions && npm run seed',
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
