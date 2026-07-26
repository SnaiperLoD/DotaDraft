import * as fs from 'fs';
import * as path from 'path';

// Laning-stage research pass, option (b) (Blueprint/10-tech-debt-backlog.md,
// "Симуляция lane matchups (влияние на Tempo)") — the honest matchup-level
// follow-up to option (a) (research-lane-tempo-data.ts, which measured
// "gold at 10min rank within own team" and was rejected: pure confound
// with axisSum for divergence, and 75-85% redundant with skirmish_rate's
// existing deaths_per_min/last_hits_per_min for real winRate).
//
// This measures something (a) couldn't: gold_t[10] DELTA against the
// actual opposing lane (same `lane` value, opposite side — OpenDota's
// `lane` is physical position: 1=Bot/2=Mid/3=Top, not role-relative), not
// just rank within one's own team. Filters is_roaming=false on BOTH sides
// to reduce the noise class already documented for Support in this
// project ("Оценка героя не учитывает назначенную роль", role-fit v1) —
// known trade-off: this likely under-samples heroes who roam constantly
// (many Support picks), same risk flagged when this option was deferred.
const HEROES_PATH = path.join(__dirname, '..', 'data', 'heroes.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'research-lane-matchup-output.json');
const EXPLORER_URL = 'https://api.opendota.com/api/explorer';
const RECENT_WINDOW = 150_000_000;
const MIN_GAMES = 15;

interface RawHero {
  id: number;
  name: string;
}

interface LaneMatchupRow {
  heroId: number;
  name: string;
  games: number;
  avgMyGoldAt10: number;
  avgOppGoldAt10: number;
  avgDelta: number;
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

  const existing: LaneMatchupRow[] = fs.existsSync(OUTPUT_PATH)
    ? (JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf-8')) as LaneMatchupRow[])
    : [];
  const doneHeroIds = new Set(existing.map((r) => r.heroId));
  const heroesToFetch = heroes.filter((h) => !doneHeroIds.has(h.id));
  if (existing.length > 0) {
    console.log(`Resuming: ${doneHeroIds.size}/${heroes.length} heroes already in ${OUTPUT_PATH}.`);
  }

  const maxRows = await explorerQuery('SELECT match_id FROM matches ORDER BY match_id DESC LIMIT 1');
  const maxMatchId = Number(maxRows[0]?.match_id ?? 8_900_000_000);
  const threshold = maxMatchId - RECENT_WINDOW;

  const results: LaneMatchupRow[] = [...existing];

  for (const [index, hero] of heroesToFetch.entries()) {
    process.stdout.write(`[${index + 1}/${heroesToFetch.length}] ${hero.name}...\r`);

    const rows = await withRetry(() =>
      explorerQuery(
        `WITH my_games AS ( ` +
          `  SELECT match_id, player_slot, lane, gold_t[11] as my_gold ` +
          `  FROM player_matches ` +
          `  WHERE hero_id = ${hero.id} AND match_id > ${threshold} ` +
          `    AND lane IS NOT NULL AND is_roaming = false AND array_length(gold_t, 1) >= 11 ` +
          `), opponents AS ( ` +
          `  SELECT pm.match_id, pm.lane, AVG(pm.gold_t[11]) as opp_avg_gold ` +
          `  FROM player_matches pm ` +
          `  JOIN my_games mg ON pm.match_id = mg.match_id AND pm.lane = mg.lane ` +
          `  WHERE (pm.player_slot < 128) != (mg.player_slot < 128) ` +
          `    AND pm.is_roaming = false AND array_length(pm.gold_t, 1) >= 11 ` +
          `  GROUP BY pm.match_id, pm.lane ` +
          `) ` +
          `SELECT COUNT(*) as n, AVG(mg.my_gold) as avg_my_gold, ` +
          `  AVG(o.opp_avg_gold) as avg_opp_gold, AVG(mg.my_gold - o.opp_avg_gold) as avg_delta ` +
          `FROM my_games mg JOIN opponents o ON mg.match_id = o.match_id AND mg.lane = o.lane`,
      ),
    );

    const row = rows?.[0];
    const games = row ? Number(row.n) : 0;
    if (row && games >= MIN_GAMES) {
      results.push({
        heroId: hero.id,
        name: hero.name,
        games,
        avgMyGoldAt10: Math.round(Number(row.avg_my_gold)),
        avgOppGoldAt10: Math.round(Number(row.avg_opp_gold)),
        avgDelta: Math.round(Number(row.avg_delta)),
      });
    }

    await sleep(700);
  }

  console.log(
    `\n\nComputed ${results.length}/${heroes.length} heroes (min ${MIN_GAMES} games with a resolvable lane opponent).\n`,
  );
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2));

  const byDelta = [...results].sort((a, b) => b.avgDelta - a.avgDelta);
  console.log('=== TOP 15 lane delta (wins lane economically) ===');
  byDelta.slice(0, 15).forEach((r) => console.log(`${r.name.padEnd(20)} +${r.avgDelta}g  (n=${r.games})`));
  console.log('\n=== BOTTOM 15 lane delta (loses lane economically) ===');
  byDelta
    .slice(-15)
    .reverse()
    .forEach((r) => console.log(`${r.name.padEnd(20)} ${r.avgDelta}g  (n=${r.games})`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
