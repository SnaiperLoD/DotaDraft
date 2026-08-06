import * as fs from 'fs';
import * as path from 'path';

// Second (heavier) data-collection pass for Blueprint/12-next-session-
// priorities.md item 6, filling in the tempo/scaling components deliberately
// left out of fetch-role-split-axis-data.ts: the win-rate-by-duration TREND
// (same underlying signal feeds both axes — falling trend -> tempo, rising
// trend -> scaling, per calibrate-evaluation-values.ts), the win/loss
// duration gap, and early-kills-per-game. Per the user's explicit
// instruction this session (unlike the direct per-match stats, which stay
// shared for tempo/scaling's OTHER inputs — gpm/xpm — already collected),
// these three DO get recomputed per role, not shared across a hero's roles.
//
// Same role classifier, same patch-start-bounded window, same "one combined
// query per hero" pattern as fetch-role-split-axis-data.ts and
// research-role-classification-final.ts. Early-kills count is a scalar
// correlated subquery directly on the row's own kills_log array (no self-join
// needed, unlike research-tempo-mobility-data.ts's version — that script
// wanted ONE hero-wide total, this needs a PER-MATCH value to bucket by role).
//
// Blink/BoT purchase rate (research-tempo-mobility-data.ts's other output)
// is NOT re-fetched here — it feeds mobility/initiating, which stay
// hero-level hand-tagged/constant per the earlier scope decision, not
// role-split.
const HEROES_PATH = path.join(__dirname, '..', 'data', 'heroes.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'role-split-tempo-data.json');
const EXPLORER_URL = 'https://api.opendota.com/api/explorer';
const MIN_GAMES = 15;

type Position = 'Carry' | 'Mid' | 'Offlane' | 'Support';
const POSITIONS: Position[] = ['Carry', 'Mid', 'Offlane', 'Support'];

interface RawHero {
  id: number;
  name: string;
}

interface BucketTempo {
  position: Position;
  games: number;
  winDuration: number | null;
  lossDuration: number | null;
  gapSeconds: number | null;
  wrShort: number | null;
  wrMid: number | null;
  wrLong: number | null;
  earlyKillsPerGame: number | null;
}

interface HeroResult {
  heroId: number;
  name: string;
  buckets: BucketTempo[];
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
      await sleep(3000);
    }
  }
  return null;
}

async function getPatchStartMatchId(): Promise<number> {
  const patchesRes = await fetch('https://api.opendota.com/api/constants/patch');
  const patches = (await patchesRes.json()) as { name: string; date: string }[];
  const currentPatch = patches[patches.length - 1];
  const patchStartUnix = Math.floor(new Date(currentPatch.date).getTime() / 1000);
  const rows = await explorerQuery(
    `SELECT match_id FROM matches WHERE start_time > ${patchStartUnix} ORDER BY match_id ASC LIMIT 1`,
  );
  console.log(`Current patch: ${currentPatch.name} (started ${currentPatch.date.slice(0, 10)})`);
  return Number(rows[0]?.match_id ?? 0);
}

function buildQuery(heroId: number, threshold: number): string {
  return (
    `SELECT bucket, COUNT(*) as games, ` +
    `AVG(CASE WHEN win = 1.0 THEN duration END) as win_duration, ` +
    `AVG(CASE WHEN win = 0.0 THEN duration END) as loss_duration, ` +
    `AVG(CASE WHEN duration < 1500 THEN win END) as wr_short, ` +
    `AVG(CASE WHEN duration >= 1500 AND duration < 2400 THEN win END) as wr_mid, ` +
    `AVG(CASE WHEN duration >= 2400 THEN win END) as wr_long, ` +
    `AVG(early_kills) as avg_early_kills ` +
    `FROM ( ` +
    `  SELECT win, duration, early_kills, ` +
    `    (CASE ` +
    `      WHEN is_roaming THEN 'Support' ` +
    `      WHEN lane_role = 2 THEN 'Mid' ` +
    `      WHEN lane_role = 1 AND gpm_rank <= 3 THEN 'Carry' ` +
    `      WHEN lane_role = 1 THEN 'Support' ` +
    `      WHEN lane_role = 3 AND gpm_rank <= 3 THEN 'Offlane' ` +
    `      WHEN lane_role = 3 THEN 'Support' ` +
    `      ELSE NULL END) as bucket ` +
    `  FROM ( ` +
    `    SELECT pm.hero_id, ` +
    `      (CASE WHEN (pm.player_slot < 128) = m.radiant_win THEN 1.0 ELSE 0.0 END) as win, ` +
    `      m.duration, pm.lane_role, pm.is_roaming, ` +
    `      (SELECT COUNT(*) FROM unnest(pm.kills_log) k WHERE (k->>'time')::int < 1500) as early_kills, ` +
    `      RANK() OVER (PARTITION BY pm.match_id, (pm.player_slot < 128) ORDER BY pm.gold_per_min DESC) as gpm_rank ` +
    `    FROM player_matches pm JOIN matches m ON pm.match_id = m.match_id ` +
    `    WHERE pm.match_id IN (SELECT match_id FROM player_matches WHERE hero_id = ${heroId} AND match_id > ${threshold}) ` +
    `  ) ranked ` +
    `  WHERE hero_id = ${heroId} ` +
    `) filtered ` +
    `WHERE bucket IS NOT NULL ` +
    `GROUP BY bucket`
  );
}

async function main() {
  const heroes: RawHero[] = JSON.parse(fs.readFileSync(HEROES_PATH, 'utf-8'));

  const existing: HeroResult[] = fs.existsSync(OUTPUT_PATH)
    ? (JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf-8')) as HeroResult[])
    : [];
  const doneHeroIds = new Set(existing.map((r) => r.heroId));
  const remaining = heroes.filter((h) => !doneHeroIds.has(h.id));
  if (existing.length > 0) {
    console.log(`Resuming: ${doneHeroIds.size}/${heroes.length} heroes already in ${OUTPUT_PATH}.`);
  }

  const threshold = await getPatchStartMatchId();
  const results: HeroResult[] = [...existing];

  for (const [index, hero] of remaining.entries()) {
    process.stdout.write(`[${index + 1}/${remaining.length}] ${hero.name}...\n`);

    const rows = await withRetry(() => explorerQuery(buildQuery(hero.id, threshold)));

    if (rows) {
      const buckets: BucketTempo[] = [];
      for (const r of rows) {
        const games = Number(r.games);
        if (games < MIN_GAMES) continue;
        const winDuration = r.win_duration != null ? Number(r.win_duration) : null;
        const lossDuration = r.loss_duration != null ? Number(r.loss_duration) : null;
        buckets.push({
          position: r.bucket as Position,
          games,
          winDuration,
          lossDuration,
          gapSeconds: winDuration !== null && lossDuration !== null ? Math.round(lossDuration - winDuration) : null,
          wrShort: r.wr_short != null ? Math.round(Number(r.wr_short) * 1000) / 1000 : null,
          wrMid: r.wr_mid != null ? Math.round(Number(r.wr_mid) * 1000) / 1000 : null,
          wrLong: r.wr_long != null ? Math.round(Number(r.wr_long) * 1000) / 1000 : null,
          earlyKillsPerGame: r.avg_early_kills != null ? Math.round(Number(r.avg_early_kills) * 100) / 100 : null,
        });
      }
      if (buckets.length > 0) {
        buckets.sort((a, b) => POSITIONS.indexOf(a.position) - POSITIONS.indexOf(b.position));
        results.push({ heroId: hero.id, name: hero.name, buckets });
      }
    }

    if ((index + 1) % 10 === 0) {
      fs.writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2));
    }
    await sleep(500);
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2));
  console.log(`\n\nDone. ${results.length}/${heroes.length} heroes written to ${OUTPUT_PATH}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
