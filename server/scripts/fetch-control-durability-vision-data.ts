import * as fs from 'fs';
import * as path from 'path';

// Fetches the raw per-hero sums needed for Control (stuns/min), Durability
// (damage_taken:deaths), and the ward component of Map Control's
// visionScore (obs_placed+sen_placed per min). One combined query per hero
// to limit API load. Writes a snapshot JSON; a separate calibration step
// turns these into 0-10 axis scores.
const HEROES_PATH = path.join(__dirname, '..', 'data', 'heroes.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'control-durability-vision-data.json');
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
    stunsPerMin: number | null;
    wardsPerMin: number | null;
    durability: number | null; // damage_taken per death
  }[] = [];

  for (const [index, hero] of heroes.entries()) {
    process.stdout.write(`[${index + 1}/${heroes.length}] ${hero.name}...\r`);

    const rows = await withRetry(() =>
      explorerQuery(
        `SELECT COUNT(*) as games, ` +
          `SUM(pm.stuns) as total_stuns, ` +
          `SUM(pm.obs_placed + pm.sen_placed) as total_wards, ` +
          `SUM((SELECT SUM(value::numeric) FROM json_each_text(pm.damage_taken))) as total_damage_taken, ` +
          `SUM(pm.deaths) as total_deaths, ` +
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
      const totalStuns = row.total_stuns != null ? Number(row.total_stuns) : null;
      const totalWards = row.total_wards != null ? Number(row.total_wards) : null;
      const totalDamageTaken = row.total_damage_taken != null ? Number(row.total_damage_taken) : null;
      const totalDeaths = row.total_deaths != null ? Number(row.total_deaths) : null;

      results.push({
        heroId: hero.id,
        name: hero.name,
        games,
        stunsPerMin:
          totalStuns !== null && totalMinutes > 0
            ? Math.round((totalStuns / totalMinutes) * 1000) / 1000
            : null,
        wardsPerMin:
          totalWards !== null && totalMinutes > 0
            ? Math.round((totalWards / totalMinutes) * 1000) / 1000
            : null,
        durability:
          totalDamageTaken !== null && totalDeaths && totalDeaths > 0
            ? Math.round(totalDamageTaken / totalDeaths)
            : null,
      });
    }

    await sleep(500);
  }

  console.log(
    `\n\nComputed for ${results.length}/${heroes.length} heroes (min ${MIN_GAMES} games in window).\n`,
  );
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2));

  const byStuns = [...results]
    .filter((r) => r.stunsPerMin !== null)
    .sort((a, b) => (b.stunsPerMin as number) - (a.stunsPerMin as number));
  console.log('=== TOP 10 STUNS/MIN (Control) ===');
  byStuns.slice(0, 10).forEach((r) => console.log(`${r.name.padEnd(20)} ${r.stunsPerMin}/min`));

  const byWards = [...results]
    .filter((r) => r.wardsPerMin !== null)
    .sort((a, b) => (b.wardsPerMin as number) - (a.wardsPerMin as number));
  console.log('\n=== TOP 10 WARDS/MIN ===');
  byWards.slice(0, 10).forEach((r) => console.log(`${r.name.padEnd(20)} ${r.wardsPerMin}/min`));

  const byDurability = [...results]
    .filter((r) => r.durability !== null)
    .sort((a, b) => (b.durability as number) - (a.durability as number));
  console.log('\n=== TOP 10 DURABILITY (damage taken per death) ===');
  byDurability.slice(0, 10).forEach((r) => console.log(`${r.name.padEnd(20)} ${r.durability}`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
