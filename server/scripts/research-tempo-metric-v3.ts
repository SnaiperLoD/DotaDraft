import * as fs from 'fs';
import * as path from 'path';

// Research script v3 — combines the two metrics confirmed useful:
//   1. Same-hero win-duration vs loss-duration gap (high weight, per user).
//   2. Win rate trend across match-duration buckets (<25min / 25-40min /
//      40min+) — a falling win rate as games run longer flags a Tempo
//      hero, a rising one flags a Scaling hero. Feeds both axes from one
//      underlying signal, with the slope's magnitude setting the strength.
// Both computed in a single query per hero to keep API load down after two
// prior runs hit OpenDota's rate limit partway through.
const HEROES_PATH = path.join(__dirname, '..', 'data', 'heroes.json');
const EXPLORER_URL = 'https://api.opendota.com/api/explorer';
const RECENT_WINDOW = 150_000_000;
const MIN_GAMES = 15;

interface RawHero {
  id: number;
  name: string;
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

async function withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === retries) {
        console.warn(`    failed after ${retries + 1} attempt(s): ${(err as Error).message}`);
        return null;
      }
      await sleep(2000);
    }
  }
  return null;
}

function num(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}

async function main() {
  const heroes: RawHero[] = JSON.parse(fs.readFileSync(HEROES_PATH, 'utf-8'));

  const maxRows = await explorerQuery('SELECT match_id FROM matches ORDER BY match_id DESC LIMIT 1');
  const maxMatchId = Number(maxRows[0]?.match_id ?? 8_900_000_000);
  const threshold = maxMatchId - RECENT_WINDOW;

  const results: {
    heroId: number;
    name: string;
    games: number;
    winDuration: number | null;
    lossDuration: number | null;
    gapSeconds: number | null;
    wrShort: number | null; // <25min
    wrMid: number | null; // 25-40min
    wrLong: number | null; // 40min+
  }[] = [];

  for (const [index, hero] of heroes.entries()) {
    process.stdout.write(`[${index + 1}/${heroes.length}] ${hero.name}...\r`);

    const rows = await withRetry(() =>
      explorerQuery(
        `SELECT COUNT(*) as games, ` +
          `AVG(CASE WHEN (pm.player_slot < 128) = m.radiant_win THEN m.duration END) as win_duration, ` +
          `AVG(CASE WHEN (pm.player_slot < 128) != m.radiant_win THEN m.duration END) as loss_duration, ` +
          `AVG(CASE WHEN m.duration < 1500 THEN (CASE WHEN (pm.player_slot < 128) = m.radiant_win THEN 1.0 ELSE 0.0 END) END) as wr_short, ` +
          `AVG(CASE WHEN m.duration >= 1500 AND m.duration < 2400 THEN (CASE WHEN (pm.player_slot < 128) = m.radiant_win THEN 1.0 ELSE 0.0 END) END) as wr_mid, ` +
          `AVG(CASE WHEN m.duration >= 2400 THEN (CASE WHEN (pm.player_slot < 128) = m.radiant_win THEN 1.0 ELSE 0.0 END) END) as wr_long ` +
          `FROM player_matches pm JOIN matches m ON pm.match_id = m.match_id ` +
          `WHERE pm.hero_id = ${hero.id} AND pm.match_id > ${threshold}`,
      ),
    );

    const row = rows?.[0];
    const games = row ? Number(row.games) : 0;
    if (row && games >= MIN_GAMES) {
      const winDuration = num(row.win_duration);
      const lossDuration = num(row.loss_duration);
      results.push({
        heroId: hero.id,
        name: hero.name,
        games,
        winDuration,
        lossDuration,
        gapSeconds: winDuration !== null && lossDuration !== null ? lossDuration - winDuration : null,
        wrShort: num(row.wr_short),
        wrMid: num(row.wr_mid),
        wrLong: num(row.wr_long),
      });
    }

    await sleep(450);
  }

  console.log(`\n\nComputed for ${results.length}/${heroes.length} heroes (min ${MIN_GAMES} games in window).\n`);

  fs.writeFileSync(
    path.join(__dirname, '..', 'data', 'research-tempo-v3-output.json'),
    JSON.stringify(results, null, 2),
  );

  const withGap = results.filter((r) => r.gapSeconds !== null);
  const byGap = [...withGap].sort((a, b) => (b.gapSeconds as number) - (a.gapSeconds as number));
  console.log('=== TOP 10 by WIN/LOSS DURATION GAP ===');
  byGap.slice(0, 10).forEach((r) =>
    console.log(
      `${r.name.padEnd(20)} gap ${(r.gapSeconds! / 60).toFixed(1)}min (win ${(r.winDuration! / 60).toFixed(1)} / loss ${(r.lossDuration! / 60).toFixed(1)}), n=${r.games}`,
    ),
  );
  console.log('\n=== BOTTOM 10 by WIN/LOSS DURATION GAP ===');
  byGap
    .slice(-10)
    .reverse()
    .forEach((r) =>
      console.log(
        `${r.name.padEnd(20)} gap ${(r.gapSeconds! / 60).toFixed(1)}min (win ${(r.winDuration! / 60).toFixed(1)} / loss ${(r.lossDuration! / 60).toFixed(1)}), n=${r.games}`,
      ),
    );

  const withTrend = results.filter((r) => r.wrShort !== null && r.wrLong !== null);
  const byTrend = [...withTrend].sort((a, b) => (a.wrLong! - a.wrShort!) - (b.wrLong! - b.wrShort!));
  console.log('\n=== TOP 10 TEMPO by WIN-RATE TREND (win rate falls hardest as games run long) ===');
  byTrend.slice(0, 10).forEach((r) =>
    console.log(
      `${r.name.padEnd(20)} <25m: ${(r.wrShort! * 100).toFixed(0)}%  25-40m: ${r.wrMid !== null ? (r.wrMid * 100).toFixed(0) + '%' : 'n/a'}  40m+: ${(r.wrLong! * 100).toFixed(0)}%`,
    ),
  );
  console.log('\n=== TOP 10 SCALING by WIN-RATE TREND (win rate rises hardest as games run long) ===');
  [...withTrend]
    .sort((a, b) => (b.wrLong! - b.wrShort!) - (a.wrLong! - a.wrShort!))
    .slice(0, 10)
    .forEach((r) =>
      console.log(
        `${r.name.padEnd(20)} <25m: ${(r.wrShort! * 100).toFixed(0)}%  25-40m: ${r.wrMid !== null ? (r.wrMid * 100).toFixed(0) + '%' : 'n/a'}  40m+: ${(r.wrLong! * 100).toFixed(0)}%`,
      ),
    );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
