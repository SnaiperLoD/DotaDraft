import * as fs from 'fs';
import * as path from 'path';

// Lane-fight @10 research — NON-gold follow-up to closed lane-economy work
// (Blueprint/10-tech-debt-backlog.md: reopen only with fields that are not
// gold/farm derivatives). Same physical-lane self-join as
// research-lane-matchup-data.ts (lane 1/2/3, opposite side, is_roaming=false
// both sides). Signals: xp_t[11], lh_t[11], dn_t[11] deltas vs lane opponent.
// XP is the primary "fight/outcome" read; LH/DN kept for confound checks
// (LH likely overlaps skirmish; DN is deny pressure).
const HEROES_PATH = path.join(__dirname, '..', 'data', 'heroes.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'research-lane-fight-output.json');
const EXPLORER_URL = 'https://api.opendota.com/api/explorer';
const RECENT_WINDOW = 150_000_000;
const MIN_GAMES = 15;

interface RawHero {
  id: number;
  name: string;
}

interface LaneFightRow {
  heroId: number;
  name: string;
  games: number;
  avgXpDelta: number;
  avgLhDelta: number;
  avgDnDelta: number;
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

  const existing: LaneFightRow[] = fs.existsSync(OUTPUT_PATH)
    ? (JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf-8')) as LaneFightRow[])
    : [];
  const doneHeroIds = new Set(existing.map((r) => r.heroId));
  const heroesToFetch = heroes.filter((h) => !doneHeroIds.has(h.id));
  if (existing.length > 0) {
    console.log(`Resuming: ${doneHeroIds.size}/${heroes.length} heroes already in ${OUTPUT_PATH}.`);
  }

  const maxRows = await explorerQuery('SELECT match_id FROM matches ORDER BY match_id DESC LIMIT 1');
  const maxMatchId = Number(maxRows[0]?.match_id ?? 8_900_000_000);
  const threshold = maxMatchId - RECENT_WINDOW;

  const results: LaneFightRow[] = [...existing];

  for (const [index, hero] of heroesToFetch.entries()) {
    process.stdout.write(`[${index + 1}/${heroesToFetch.length}] ${hero.name}...                    \r`);

    const rows = await withRetry(() =>
      explorerQuery(
        `WITH my_games AS ( ` +
          `  SELECT match_id, player_slot, lane, ` +
          `    xp_t[11] AS my_xp, lh_t[11] AS my_lh, dn_t[11] AS my_dn ` +
          `  FROM player_matches ` +
          `  WHERE hero_id = ${hero.id} AND match_id > ${threshold} ` +
          `    AND lane IS NOT NULL AND is_roaming = false ` +
          `    AND array_length(xp_t, 1) >= 11 ` +
          `    AND array_length(lh_t, 1) >= 11 ` +
          `    AND array_length(dn_t, 1) >= 11 ` +
          `), opponents AS ( ` +
          `  SELECT pm.match_id, pm.lane, ` +
          `    AVG(pm.xp_t[11]) AS opp_xp, ` +
          `    AVG(pm.lh_t[11]) AS opp_lh, ` +
          `    AVG(pm.dn_t[11]) AS opp_dn ` +
          `  FROM player_matches pm ` +
          `  JOIN my_games mg ON pm.match_id = mg.match_id AND pm.lane = mg.lane ` +
          `  WHERE (pm.player_slot < 128) != (mg.player_slot < 128) ` +
          `    AND pm.is_roaming = false ` +
          `    AND array_length(pm.xp_t, 1) >= 11 ` +
          `    AND array_length(pm.lh_t, 1) >= 11 ` +
          `    AND array_length(pm.dn_t, 1) >= 11 ` +
          `  GROUP BY pm.match_id, pm.lane ` +
          `) ` +
          `SELECT COUNT(*) AS n, ` +
          `  AVG(mg.my_xp - o.opp_xp) AS xp_delta, ` +
          `  AVG(mg.my_lh - o.opp_lh) AS lh_delta, ` +
          `  AVG(mg.my_dn - o.opp_dn) AS dn_delta ` +
          `FROM my_games mg ` +
          `JOIN opponents o ON mg.match_id = o.match_id AND mg.lane = o.lane`,
      ),
    );

    const row = rows?.[0];
    const games = row ? Number(row.n) : 0;
    if (row && games >= MIN_GAMES && row.xp_delta != null) {
      results.push({
        heroId: hero.id,
        name: hero.name,
        games,
        avgXpDelta: Math.round(Number(row.xp_delta)),
        avgLhDelta: Math.round(Number(row.lh_delta) * 100) / 100,
        avgDnDelta: Math.round(Number(row.dn_delta) * 100) / 100,
      });
      fs.writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2));
    }

    await sleep(700);
  }

  console.log(
    `\n\nComputed ${results.length}/${heroes.length} heroes ` +
      `(min ${MIN_GAMES} games with a resolvable lane opponent).\n`,
  );
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2));

  const byXp = [...results].sort((a, b) => b.avgXpDelta - a.avgXpDelta);
  console.log('=== TOP 15 XP Δ @10 (wins lane on XP) ===');
  byXp
    .slice(0, 15)
    .forEach((r) =>
      console.log(
        `${r.name.padEnd(20)} XP ${r.avgXpDelta >= 0 ? '+' : ''}${r.avgXpDelta}  ` +
          `LH ${r.avgLhDelta >= 0 ? '+' : ''}${r.avgLhDelta}  DN ${r.avgDnDelta >= 0 ? '+' : ''}${r.avgDnDelta}  (n=${r.games})`,
      ),
    );
  console.log('\n=== BOTTOM 15 XP Δ @10 ===');
  byXp
    .slice(-15)
    .reverse()
    .forEach((r) =>
      console.log(
        `${r.name.padEnd(20)} XP ${r.avgXpDelta >= 0 ? '+' : ''}${r.avgXpDelta}  ` +
          `LH ${r.avgLhDelta >= 0 ? '+' : ''}${r.avgLhDelta}  DN ${r.avgDnDelta >= 0 ? '+' : ''}${r.avgDnDelta}  (n=${r.games})`,
      ),
    );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
