import * as fs from 'fs';
import * as path from 'path';

// Research-only fetch (Blueprint/10-tech-debt-backlog.md, "support cluster" investigation
// session): assists_per_min is the one core OpenDota signal never fetched for this project —
// candidate for a new axis that would specifically differentiate supports (who rack up
// assists via presence/utility, not personal kills) from carries. Same Explorer pattern as
// fetch-deaths-camps-data.ts. Not wired into evaluation_values — this script only produces
// the raw signal for correlation analysis.
const HEROES_PATH = path.join(__dirname, '..', 'data', 'heroes.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'support-signal-data.json');
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
    assistsPerMin: number | null;
  }[] = [];

  for (const [index, hero] of heroes.entries()) {
    process.stdout.write(`[${index + 1}/${heroes.length}] ${hero.name}...\r`);

    const rows = await withRetry(() =>
      explorerQuery(
        `SELECT COUNT(*) as games, ` +
          `SUM(pm.assists) as total_assists, ` +
          `SUM(m.duration) as total_duration ` +
          `FROM player_matches pm JOIN matches m ON pm.match_id = m.match_id ` +
          `WHERE pm.hero_id = ${hero.id} AND pm.match_id > ${threshold}`,
      ),
    );

    const row = rows?.[0];
    const games = row ? Number(row.games) : 0;
    if (row && games >= MIN_GAMES) {
      const totalDuration = Number(row.total_duration ?? 0);
      const totalMinutes = totalDuration / 60;
      const totalAssists = row.total_assists != null ? Number(row.total_assists) : null;

      results.push({
        heroId: hero.id,
        name: hero.name,
        games,
        assistsPerMin:
          totalAssists !== null && totalMinutes > 0
            ? Math.round((totalAssists / totalMinutes) * 1000) / 1000
            : null,
      });
    }

    await sleep(500);
  }

  console.log(
    `\n\nComputed for ${results.length}/${heroes.length} heroes (min ${MIN_GAMES} games in window).\n`,
  );
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2));

  const byAssists = [...results]
    .filter((r) => r.assistsPerMin !== null)
    .sort((a, b) => (b.assistsPerMin as number) - (a.assistsPerMin as number));
  console.log('=== TOP 15 ASSISTS/MIN ===');
  byAssists.slice(0, 15).forEach((r) => console.log(`${r.name.padEnd(20)} ${r.assistsPerMin}/min`));
  console.log('\n=== BOTTOM 15 ASSISTS/MIN ===');
  byAssists
    .slice(-15)
    .reverse()
    .forEach((r) => console.log(`${r.name.padEnd(20)} ${r.assistsPerMin}/min`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
