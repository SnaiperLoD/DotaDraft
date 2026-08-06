import * as fs from 'fs';
import * as path from 'path';

// Fixes a gap in fetch-role-split-axis-data.ts: wardsPerMin (obs_placed +
// sen_placed, feeds map_control's visionScore.wardScore in calibrate-
// evaluation-values.ts) is real per-match data and should have been
// role-split alongside the other direct stats there, but was missed.
// Fetched separately (not by re-running the whole heavy combined query) and
// merged into the existing role-split-axis-data.json bucket objects, to
// avoid re-pulling data already collected and re-risking 429s on fields
// that didn't change.
const HEROES_PATH = path.join(__dirname, '..', 'data', 'heroes.json');
const AXIS_DATA_PATH = path.join(__dirname, '..', 'data', 'role-split-axis-data.json');
const EXPLORER_URL = 'https://api.opendota.com/api/explorer';
const MIN_GAMES = 15;

type Position = 'Carry' | 'Mid' | 'Offlane' | 'Support';

interface RawHero {
  id: number;
  name: string;
}

interface BucketAgg {
  position: Position;
  games: number;
  wardsPerMin?: number | null;
  [key: string]: unknown;
}

interface HeroResult {
  heroId: number;
  name: string;
  totalGames: number;
  buckets: BucketAgg[];
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
    `SELECT bucket, COUNT(*) as games, SUM(wards) as total_wards, SUM(duration) as total_duration ` +
    `FROM ( ` +
    `  SELECT wards, duration, ` +
    `    (CASE ` +
    `      WHEN is_roaming THEN 'Support' ` +
    `      WHEN lane_role = 2 THEN 'Mid' ` +
    `      WHEN lane_role = 1 AND gpm_rank <= 3 THEN 'Carry' ` +
    `      WHEN lane_role = 1 THEN 'Support' ` +
    `      WHEN lane_role = 3 AND gpm_rank <= 3 THEN 'Offlane' ` +
    `      WHEN lane_role = 3 THEN 'Support' ` +
    `      ELSE NULL END) as bucket ` +
    `  FROM ( ` +
    `    SELECT pm.hero_id, (pm.obs_placed + pm.sen_placed) as wards, m.duration, ` +
    `      pm.lane_role, pm.is_roaming, ` +
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
  const axisData: HeroResult[] = JSON.parse(fs.readFileSync(AXIS_DATA_PATH, 'utf-8'));
  const axisByHero = new Map(axisData.map((h) => [h.heroId, h]));

  const alreadyDone = axisData.every((h) => h.buckets.every((b) => b.wardsPerMin !== undefined));
  if (alreadyDone) {
    console.log('wardsPerMin already present on every bucket — nothing to do.');
    return;
  }

  const threshold = await getPatchStartMatchId();

  for (const [index, hero] of heroes.entries()) {
    const heroEntry = axisByHero.get(hero.id);
    if (!heroEntry) continue; // hero had no bucket data at all in the axis fetch
    if (heroEntry.buckets.every((b) => b.wardsPerMin !== undefined)) continue; // already merged

    process.stdout.write(`[${index + 1}/${heroes.length}] ${hero.name}...\n`);

    const rows = await withRetry(() => explorerQuery(buildQuery(hero.id, threshold)));

    if (rows) {
      for (const r of rows) {
        const games = Number(r.games);
        if (games < MIN_GAMES) continue;
        const bucket = heroEntry.buckets.find((b) => b.position === r.bucket);
        if (!bucket) continue; // bucket didn't clear MIN_GAMES in the original axis fetch either
        const totalMinutes = Number(r.total_duration ?? 0) / 60;
        bucket.wardsPerMin =
          r.total_wards != null && totalMinutes > 0
            ? Math.round((Number(r.total_wards) / totalMinutes) * 1000) / 1000
            : null;
      }
    }

    if ((index + 1) % 10 === 0) {
      fs.writeFileSync(AXIS_DATA_PATH, JSON.stringify(axisData, null, 2));
    }
    await sleep(500);
  }

  fs.writeFileSync(AXIS_DATA_PATH, JSON.stringify(axisData, null, 2));
  console.log(`\n\nDone. Merged wardsPerMin into ${AXIS_DATA_PATH}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
