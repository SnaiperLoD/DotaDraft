import * as fs from 'fs';
import * as path from 'path';

// Role-fit calibration input (Blueprint/10-tech-debt-backlog.md, "Оценка
// героя не учитывает назначенную роль"): per-hero win rate broken down by
// position, not just overall win rate (hero-meta.json only has the latter).
// Uses the exact same lane_role/is_roaming bucketing as
// fetch-hero-meta.ts's classifyPositions(), so results line up with the
// already-stored presumed_positions shares.
const HEROES_PATH = path.join(__dirname, '..', 'data', 'heroes.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'research-role-fit-output.json');
const EXPLORER_URL = 'https://api.opendota.com/api/explorer';
const RECENT_WINDOW = 150_000_000;
const MIN_GAMES = 15;

type Position = 'Carry' | 'Mid' | 'Offlane' | 'Support';

interface RawHero {
  id: number;
  name: string;
}

interface PositionRow {
  heroId: number;
  name: string;
  position: Position;
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

// Same bucketing rule as fetch-hero-meta.ts's classifyPositions: roaming
// overrides lane into Support regardless of lane_role.
function bucketOf(laneRole: number | null, isRoaming: boolean | null): Position | null {
  if (laneRole == null) return null;
  if (isRoaming) return 'Support';
  if (laneRole === 2) return 'Mid';
  if (laneRole === 1) return 'Carry';
  if (laneRole === 3) return 'Offlane';
  return null;
}

async function main() {
  const allHeroes: RawHero[] = JSON.parse(fs.readFileSync(HEROES_PATH, 'utf-8'));

  // Re-runnable: skip heroes already present in a prior output file (e.g.
  // after a partial run hit OpenDota's rate limit) rather than refetching
  // everyone and risking the same 429s on the same tail of the list.
  const existing: PositionRow[] = fs.existsSync(OUTPUT_PATH)
    ? (JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf-8')) as PositionRow[])
    : [];
  const doneHeroIds = new Set(existing.map((r) => r.heroId));
  const heroes = allHeroes.filter((h) => !doneHeroIds.has(h.id));
  if (existing.length > 0) {
    console.log(`Resuming: ${doneHeroIds.size}/${allHeroes.length} heroes already in ${OUTPUT_PATH}.`);
  }

  const maxRows = await explorerQuery('SELECT match_id FROM matches ORDER BY match_id DESC LIMIT 1');
  const maxMatchId = Number(maxRows[0]?.match_id ?? 8_900_000_000);
  const threshold = maxMatchId - RECENT_WINDOW;

  const results: PositionRow[] = [...existing];

  for (const [index, hero] of heroes.entries()) {
    process.stdout.write(`[${index + 1}/${heroes.length}] ${hero.name}...\r`);

    const rows = await withRetry(() =>
      explorerQuery(
        `SELECT pm.lane_role, pm.is_roaming, COUNT(*) as cnt, ` +
          `SUM(CASE WHEN (pm.player_slot < 128) = m.radiant_win THEN 1 ELSE 0 END) as wins ` +
          `FROM player_matches pm JOIN matches m ON pm.match_id = m.match_id ` +
          `WHERE pm.hero_id = ${hero.id} AND pm.match_id > ${threshold} ` +
          `GROUP BY pm.lane_role, pm.is_roaming`,
      ),
    );

    if (rows) {
      const buckets: Record<Position, { games: number; wins: number }> = {
        Carry: { games: 0, wins: 0 },
        Mid: { games: 0, wins: 0 },
        Offlane: { games: 0, wins: 0 },
        Support: { games: 0, wins: 0 },
      };
      let total = 0;

      for (const row of rows) {
        const bucket = bucketOf(
          row.lane_role === null ? null : Number(row.lane_role),
          row.is_roaming,
        );
        if (!bucket) continue;
        const cnt = Number(row.cnt);
        buckets[bucket].games += cnt;
        buckets[bucket].wins += Number(row.wins ?? 0);
        total += cnt;
      }

      if (total > 0) {
        (Object.keys(buckets) as Position[]).forEach((position) => {
          const b = buckets[position];
          if (b.games >= MIN_GAMES) {
            results.push({
              heroId: hero.id,
              name: hero.name,
              position,
              games: b.games,
              wins: b.wins,
              winRate: Math.round((b.wins / b.games) * 1000) / 1000,
              share: Math.round((b.games / total) * 1000) / 1000,
            });
          }
        });
      }
    }

    await sleep(500);
  }

  console.log(`\n\nComputed ${results.length} (hero, position) rows (min ${MIN_GAMES} games each).\n`);

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2));

  // Natural role = the hero's most-played position (share highest, and
  // >=0.25 to match classifyPositions' threshold). Compare that position's
  // win rate against the hero's overall average across all their tracked
  // positions, as a first look at whether "plays this role a lot" also
  // means "performs above their own baseline in it."
  const byHero = new Map<number, PositionRow[]>();
  results.forEach((r) => {
    if (!byHero.has(r.heroId)) byHero.set(r.heroId, []);
    byHero.get(r.heroId)!.push(r);
  });

  console.log('=== NATURAL ROLE vs HERO-AVERAGE WIN RATE (sample) ===');
  let shown = 0;
  for (const [, rows] of byHero) {
    if (rows.length < 2) continue; // only heroes tracked in 2+ positions are interesting
    const natural = [...rows].sort((a, b) => b.share - a.share)[0];
    const avgWinRate = rows.reduce((s, r) => s + r.winRate * r.games, 0) / rows.reduce((s, r) => s + r.games, 0);
    console.log(
      `${natural.name.padEnd(20)} natural=${natural.position.padEnd(8)} wr=${(natural.winRate * 100).toFixed(1)}%  ` +
        `heroAvgWr=${(avgWinRate * 100).toFixed(1)}%  delta=${((natural.winRate - avgWinRate) * 100).toFixed(1)}pp  n=${natural.games}`,
    );
    shown++;
    if (shown >= 25) break;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
