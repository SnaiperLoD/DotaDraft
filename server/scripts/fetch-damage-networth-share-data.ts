import * as fs from 'fs';
import * as path from 'path';

// Fetches damage-per-networth-share per hero: how much hero_damage a hero
// deals relative to the % of their team's total net worth they represent
// (Blueprint/10-tech-debt-backlog.md, "Damage per Networth Share" research)
// — a resource-efficiency read on damage output, distinct from raw
// hero_damage_per_min (teamfight axis): a hero who deals modest total
// damage but needs very little of the team's economy to do it (Pudge, Zeus)
// scores high here even if raw damage/min ranks them low; a farm-hungry
// carry (Terrorblade, Juggernaut) with comparable raw damage scores low,
// since that damage was "bought" with a large share of team resources.
// Averaged per-match (not ratio-of-sums) to avoid aggregation bias.
const HEROES_PATH = path.join(__dirname, '..', 'data', 'heroes.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'damage-networth-share-data.json');
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
    damagePerNetworthShare: number | null;
  }[] = [];

  for (const [index, hero] of heroes.entries()) {
    process.stdout.write(`[${index + 1}/${heroes.length}] ${hero.name}...\r`);

    const rows = await withRetry(() =>
      explorerQuery(
        `SELECT COUNT(*) as games, ` +
          `AVG(pm.hero_damage::float / NULLIF(pm.net_worth::float / NULLIF(( ` +
          `  SELECT SUM(pm2.net_worth) FROM player_matches pm2 ` +
          `  WHERE pm2.match_id = pm.match_id AND (pm2.player_slot < 128) = (pm.player_slot < 128) ` +
          `), 0), 0)) as avg_damage_per_networth_share ` +
          `FROM player_matches pm ` +
          `WHERE pm.hero_id = ${hero.id} AND pm.match_id > ${threshold} AND pm.net_worth > 0`,
      ),
    );

    const row = rows?.[0];
    const games = row ? Number(row.games) : 0;
    if (row && games >= MIN_GAMES) {
      const value = row.avg_damage_per_networth_share != null ? Number(row.avg_damage_per_networth_share) : null;
      results.push({
        heroId: hero.id,
        name: hero.name,
        games,
        damagePerNetworthShare: value !== null ? Math.round(value) : null,
      });
    }

    await sleep(500);
  }

  console.log(
    `\n\nComputed for ${results.length}/${heroes.length} heroes (min ${MIN_GAMES} games in window).\n`,
  );
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2));

  const ranked = [...results]
    .filter((r) => r.damagePerNetworthShare !== null)
    .sort((a, b) => (b.damagePerNetworthShare as number) - (a.damagePerNetworthShare as number));
  console.log('=== TOP 15 DAMAGE PER NETWORTH SHARE ===');
  ranked.slice(0, 15).forEach((r) => console.log(`${r.name.padEnd(20)} ${r.damagePerNetworthShare}`));
  console.log('\n=== BOTTOM 15 ===');
  ranked.slice(-15).reverse().forEach((r) => console.log(`${r.name.padEnd(20)} ${r.damagePerNetworthShare}`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
