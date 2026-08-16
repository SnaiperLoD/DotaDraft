import * as fs from 'fs';
import * as path from 'path';

// Farm elasticity per hero: WR when the hero's team net-worth share is at/above
// their own median minus WR when below. Distinct from resource_efficiency
// (damage / nw_share): RE asks "how much damage per farm dollar"; elasticity
// asks "how much does winning depend on getting more farm than usual".
// Same Explorer window / retry pattern as fetch-damage-networth-share-data.ts.
const HEROES_PATH = path.join(__dirname, '..', 'data', 'heroes.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'farm-elasticity-data.json');
const EXPLORER_URL = 'https://api.opendota.com/api/explorer';
const RECENT_WINDOW = 150_000_000;
const MIN_GAMES = 30;
const MIN_SPLIT = 10;

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

async function withRetry<T>(fn: () => Promise<T>, retries = 5): Promise<T | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === retries) {
        console.warn(`    failed after ${retries + 1} attempt(s): ${(err as Error).message}`);
        return null;
      }
      await sleep(3000 + attempt * 1500);
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
    gamesHigh: number;
    gamesLow: number;
    avgNwShare: number;
    wrAll: number;
    wrHighFarm: number;
    wrLowFarm: number;
    farmElasticity: number;
  }[] = [];

  for (const [index, hero] of heroes.entries()) {
    process.stdout.write(`[${index + 1}/${heroes.length}] ${hero.name}...                    \r`);

    // Win flag matches fetch-hero-meta / role-split scripts:
    // (player_slot < 128) = radiant_win. Median via aggregate subquery —
    // window PERCENTILE_CONT OVER () returns Explorer HTTP 400.
    const rows = await withRetry(() =>
      explorerQuery(
        `WITH hero_games AS ( ` +
          `  SELECT ` +
          `    CASE WHEN (pm.player_slot < 128) = m.radiant_win THEN 1.0 ELSE 0.0 END AS won, ` +
          `    pm.net_worth::float / NULLIF(( ` +
          `      SELECT SUM(pm2.net_worth)::float FROM player_matches pm2 ` +
          `      WHERE pm2.match_id = pm.match_id ` +
          `        AND (pm2.player_slot < 128) = (pm.player_slot < 128) ` +
          `    ), 0) AS nw_share ` +
          `  FROM player_matches pm ` +
          `  JOIN matches m ON m.match_id = pm.match_id ` +
          `  WHERE pm.hero_id = ${hero.id} ` +
          `    AND pm.match_id > ${threshold} ` +
          `    AND pm.net_worth > 0 ` +
          `), ` +
          `med AS ( ` +
          `  SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY nw_share) AS med_share ` +
          `  FROM hero_games WHERE nw_share IS NOT NULL ` +
          `) ` +
          `SELECT ` +
          `  COUNT(*) AS games, ` +
          `  COUNT(*) FILTER (WHERE nw_share >= med.med_share) AS games_high, ` +
          `  COUNT(*) FILTER (WHERE nw_share < med.med_share) AS games_low, ` +
          `  AVG(nw_share) AS avg_nw_share, ` +
          `  AVG(won) AS wr_all, ` +
          `  AVG(won) FILTER (WHERE nw_share >= med.med_share) AS wr_high, ` +
          `  AVG(won) FILTER (WHERE nw_share < med.med_share) AS wr_low ` +
          `FROM hero_games, med ` +
          `WHERE nw_share IS NOT NULL`,
      ),
    );

    const row = rows?.[0];
    const games = row ? Number(row.games) : 0;
    const gamesHigh = row ? Number(row.games_high) : 0;
    const gamesLow = row ? Number(row.games_low) : 0;
    if (
      row &&
      games >= MIN_GAMES &&
      gamesHigh >= MIN_SPLIT &&
      gamesLow >= MIN_SPLIT &&
      row.wr_high != null &&
      row.wr_low != null
    ) {
      const wrHigh = Number(row.wr_high);
      const wrLow = Number(row.wr_low);
      results.push({
        heroId: hero.id,
        name: hero.name,
        games,
        gamesHigh,
        gamesLow,
        avgNwShare: Math.round(Number(row.avg_nw_share) * 10000) / 10000,
        wrAll: Math.round(Number(row.wr_all) * 10000) / 10000,
        wrHighFarm: Math.round(wrHigh * 10000) / 10000,
        wrLowFarm: Math.round(wrLow * 10000) / 10000,
        farmElasticity: Math.round((wrHigh - wrLow) * 10000) / 10000,
      });
    }

    await sleep(700);
  }

  console.log(
    `\n\nComputed ${results.length}/${heroes.length} heroes ` +
      `(min ${MIN_GAMES} games, ≥${MIN_SPLIT} per farm half).\n`,
  );
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2));

  const ranked = [...results].sort((a, b) => b.farmElasticity - a.farmElasticity);
  console.log('=== TOP 15 farm-elastic (WR rises most with extra farm) ===');
  ranked.slice(0, 15).forEach((r) =>
    console.log(
      `${r.name.padEnd(20)} Δ=${(r.farmElasticity * 100).toFixed(1)}pp  ` +
        `(high ${(r.wrHighFarm * 100).toFixed(1)} / low ${(r.wrLowFarm * 100).toFixed(1)}, n=${r.games})`,
    ),
  );
  console.log('\n=== BOTTOM 15 (least farm-sensitive / inverse) ===');
  ranked
    .slice(-15)
    .reverse()
    .forEach((r) =>
      console.log(
        `${r.name.padEnd(20)} Δ=${(r.farmElasticity * 100).toFixed(1)}pp  ` +
          `(high ${(r.wrHighFarm * 100).toFixed(1)} / low ${(r.wrLowFarm * 100).toFixed(1)}, n=${r.games})`,
      ),
    );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
