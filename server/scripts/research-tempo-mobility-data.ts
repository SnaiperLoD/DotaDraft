import * as fs from 'fs';
import * as path from 'path';

// Combines two research signals into one query per hero to limit API load:
//   1. Early kills (kills_log, time < 25min) — third Tempo component.
//   2. Blink Dagger / Boots of Travel purchase rate — supporting signal
//      (not a runtime input) for curating the mobilityScore ability tier
//      list by hand.
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

  const results: {
    heroId: number;
    name: string;
    games: number;
    earlyKills: number;
    earlyKillsPerGame: number;
    blinkGames: number;
    blinkRate: number;
    botGames: number;
    botRate: number;
  }[] = [];

  for (const [index, hero] of heroes.entries()) {
    process.stdout.write(`[${index + 1}/${heroes.length}] ${hero.name}...\r`);

    const rows = await withRetry(() =>
      explorerQuery(
        `SELECT ` +
          `(SELECT COUNT(*) FROM player_matches pm2, unnest(pm2.kills_log) k ` +
          `  WHERE pm2.hero_id = ${hero.id} AND pm2.match_id > ${threshold} AND (k->>'time')::int < 1500) as early_kills, ` +
          `(SELECT COUNT(DISTINCT pm3.match_id) FROM player_matches pm3, unnest(pm3.purchase_log) p ` +
          `  WHERE pm3.hero_id = ${hero.id} AND pm3.match_id > ${threshold} AND p->>'key' = 'blink') as blink_games, ` +
          `(SELECT COUNT(DISTINCT pm4.match_id) FROM player_matches pm4, unnest(pm4.purchase_log) p ` +
          `  WHERE pm4.hero_id = ${hero.id} AND pm4.match_id > ${threshold} AND p->>'key' IN ('travel_boots','travel_boots_2')) as bot_games, ` +
          `(SELECT COUNT(*) FROM player_matches pm5 WHERE pm5.hero_id = ${hero.id} AND pm5.match_id > ${threshold}) as games`,
      ),
    );

    const row = rows?.[0];
    const games = row ? Number(row.games) : 0;
    if (row && games >= MIN_GAMES) {
      const earlyKills = Number(row.early_kills ?? 0);
      const blinkGames = Number(row.blink_games ?? 0);
      const botGames = Number(row.bot_games ?? 0);
      results.push({
        heroId: hero.id,
        name: hero.name,
        games,
        earlyKills,
        earlyKillsPerGame: Math.round((earlyKills / games) * 100) / 100,
        blinkGames,
        blinkRate: Math.round((blinkGames / games) * 1000) / 1000,
        botGames,
        botRate: Math.round((botGames / games) * 1000) / 1000,
      });
    }

    await sleep(500);
  }

  console.log(
    `\n\nComputed for ${results.length}/${heroes.length} heroes (min ${MIN_GAMES} games in window).\n`,
  );

  fs.writeFileSync(
    path.join(__dirname, '..', 'data', 'research-tempo-mobility-output.json'),
    JSON.stringify(results, null, 2),
  );

  const byEarlyKills = [...results].sort((a, b) => b.earlyKillsPerGame - a.earlyKillsPerGame);
  console.log('=== TOP 15 EARLY KILLS PER GAME (<25min) ===');
  byEarlyKills
    .slice(0, 15)
    .forEach((r) => console.log(`${r.name.padEnd(20)} ${r.earlyKillsPerGame}/game, n=${r.games}`));
  console.log('\n=== BOTTOM 15 EARLY KILLS PER GAME ===');
  byEarlyKills
    .slice(-15)
    .reverse()
    .forEach((r) => console.log(`${r.name.padEnd(20)} ${r.earlyKillsPerGame}/game, n=${r.games}`));

  const byBlink = [...results].sort((a, b) => b.blinkRate - a.blinkRate);
  console.log('\n=== TOP 20 BLINK DAGGER PURCHASE RATE ===');
  byBlink
    .slice(0, 20)
    .forEach((r) => console.log(`${r.name.padEnd(20)} ${(r.blinkRate * 100).toFixed(1)}%, n=${r.games}`));

  const byBot = [...results].sort((a, b) => b.botRate - a.botRate);
  console.log('\n=== TOP 20 BOOTS OF TRAVEL PURCHASE RATE ===');
  byBot
    .slice(0, 20)
    .forEach((r) => console.log(`${r.name.padEnd(20)} ${(r.botRate * 100).toFixed(1)}%, n=${r.games}`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
