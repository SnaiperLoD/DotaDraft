import * as fs from 'fs';
import * as path from 'path';

// Two new candidate axes/signals flagged during regression work
// (Blueprint/10-tech-debt-backlog.md): death frequency (distinct from
// durability's damage_taken/deaths *ratio* — this is deaths alone, i.e.
// "how often" not "how much punishment per death") and camps_stacked
// (map-presence/farming-utility signal not captured by anything currently
// calibrated). Same Explorer pattern as fetch-control-durability-vision-
// data.ts — one combined query per hero, same recent-match window.
const HEROES_PATH = path.join(__dirname, '..', 'data', 'heroes.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'deaths-camps-data.json');
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
    deathsPerMin: number | null;
    campsStackedPerMin: number | null;
  }[] = [];

  for (const [index, hero] of heroes.entries()) {
    process.stdout.write(`[${index + 1}/${heroes.length}] ${hero.name}...\r`);

    const rows = await withRetry(() =>
      explorerQuery(
        `SELECT COUNT(*) as games, ` +
          `SUM(pm.deaths) as total_deaths, ` +
          `SUM(pm.camps_stacked) as total_camps_stacked, ` +
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
      const totalDeaths = row.total_deaths != null ? Number(row.total_deaths) : null;
      const totalCampsStacked = row.total_camps_stacked != null ? Number(row.total_camps_stacked) : null;

      results.push({
        heroId: hero.id,
        name: hero.name,
        games,
        deathsPerMin:
          totalDeaths !== null && totalMinutes > 0
            ? Math.round((totalDeaths / totalMinutes) * 1000) / 1000
            : null,
        campsStackedPerMin:
          totalCampsStacked !== null && totalMinutes > 0
            ? Math.round((totalCampsStacked / totalMinutes) * 1000) / 1000
            : null,
      });
    }

    await sleep(500);
  }

  console.log(
    `\n\nComputed for ${results.length}/${heroes.length} heroes (min ${MIN_GAMES} games in window).\n`,
  );
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2));

  const byDeaths = [...results]
    .filter((r) => r.deathsPerMin !== null)
    .sort((a, b) => (b.deathsPerMin as number) - (a.deathsPerMin as number));
  console.log('=== TOP 10 DEATHS/MIN (dies most often) ===');
  byDeaths.slice(0, 10).forEach((r) => console.log(`${r.name.padEnd(20)} ${r.deathsPerMin}/min`));
  console.log('\n=== BOTTOM 10 DEATHS/MIN (dies least often) ===');
  byDeaths
    .slice(-10)
    .reverse()
    .forEach((r) => console.log(`${r.name.padEnd(20)} ${r.deathsPerMin}/min`));

  const byCamps = [...results]
    .filter((r) => r.campsStackedPerMin !== null)
    .sort((a, b) => (b.campsStackedPerMin as number) - (a.campsStackedPerMin as number));
  console.log('\n=== TOP 10 CAMPS STACKED/MIN ===');
  byCamps.slice(0, 10).forEach((r) => console.log(`${r.name.padEnd(20)} ${r.campsStackedPerMin}/min`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
