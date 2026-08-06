import * as fs from 'fs';
import * as path from 'path';

// Core data-collection step for Blueprint/12-next-session-priorities.md item 6
// (role-conditional axis values). For every hero, buckets their own matches
// into Carry/Mid/Offlane/Support using the validated per-match classifier
// (research-role-classification-final.ts: is_roaming -> Support, lane_role=2
// -> Mid, lane_role=1/3 + team-relative GPM-rank top-3 -> Carry/Offlane else
// Support), then sums/averages every DIRECT per-match raw stat that feeds a
// real-data evaluation_values axis (calibrate-evaluation-values.ts header
// comment), per bucket:
//   hero_damage      -> teamfight
//   kills             -> burst
//   gold_per_min/xp_per_min -> scaling (farm-rate component only — the
//                       win-rate-by-duration TREND component is a separate,
//                       heavier per-role query, deferred per plan)
//   tower_damage      -> objectives
//   stuns             -> control (real-stat component; hand-tagged
//                       control_strength stays hero-level, not role-split)
//   damage_taken/deaths -> durability (real-stat component; hand-tagged
//                       damage_mitigation stays hero-level)
//   hero_healing      -> saving (real-stat component; hand-tagged saving
//                       stays hero-level)
//   deaths/last_hits  -> skirmish_rate
//   camps_stacked     -> camp_stacking
//   damage per networth share -> resource_efficiency
// gapSeconds/tempo trend and early-kills (tempo/scaling's other components)
// are NOT in this pass — those need a per-role win-rate-by-duration query,
// tracked as a separate follow-up.
//
// Window: bound at the CURRENT patch's start (see research-role-classification-
// final.ts) — matches, not a fixed match_id span, so this stays correct
// without manual updates and never mixes in a prior patch's balance/meta.
//
// One combined query per hero (not per hero×role) — same "restrict scan to
// this hero's own matches" pattern used throughout this codebase — with the
// role bucket, gpm_rank, damage_taken (JSON-summed), and net-worth-share all
// computed in a single nested query, aggregated with GROUP BY bucket.
const HEROES_PATH = path.join(__dirname, '..', 'data', 'heroes.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'role-split-axis-data.json');
const EXPLORER_URL = 'https://api.opendota.com/api/explorer';
const MIN_GAMES = 15;

type Position = 'Carry' | 'Mid' | 'Offlane' | 'Support';
const POSITIONS: Position[] = ['Carry', 'Mid', 'Offlane', 'Support'];

interface RawHero {
  id: number;
  name: string;
}

interface BucketAgg {
  position: Position;
  games: number;
  damagePerMin: number | null;
  killsPerMin: number | null;
  avgGpm: number | null;
  avgXpm: number | null;
  towerDamagePerMin: number | null;
  stunsPerMin: number | null;
  healingPerMin: number | null;
  damageTakenPerDeath: number | null;
  deathsPerMin: number | null;
  lastHitsPerMin: number | null;
  campsStackedPerMin: number | null;
  avgDamagePerNetworthShare: number | null;
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
    `SELECT bucket, COUNT(*) as games, ` +
    `SUM(hero_damage) as total_damage, SUM(kills) as total_kills, ` +
    `AVG(gold_per_min) as avg_gpm, AVG(xp_per_min) as avg_xpm, ` +
    `SUM(tower_damage) as total_tower_damage, SUM(stuns) as total_stuns, ` +
    `SUM(hero_healing) as total_healing, SUM(deaths) as total_deaths, ` +
    `SUM(last_hits) as total_last_hits, SUM(camps_stacked) as total_camps_stacked, ` +
    `SUM(duration) as total_duration, SUM(damage_taken_sum) as total_damage_taken, ` +
    `AVG(damage_per_networth_share) as avg_damage_per_networth_share ` +
    `FROM ( ` +
    `  SELECT hero_damage, kills, gold_per_min, xp_per_min, tower_damage, stuns, ` +
    `    hero_healing, deaths, last_hits, camps_stacked, duration, damage_taken_sum, ` +
    `    damage_per_networth_share, ` +
    `    (CASE ` +
    `      WHEN is_roaming THEN 'Support' ` +
    `      WHEN lane_role = 2 THEN 'Mid' ` +
    `      WHEN lane_role = 1 AND gpm_rank <= 3 THEN 'Carry' ` +
    `      WHEN lane_role = 1 THEN 'Support' ` +
    `      WHEN lane_role = 3 AND gpm_rank <= 3 THEN 'Offlane' ` +
    `      WHEN lane_role = 3 THEN 'Support' ` +
    `      ELSE NULL END) as bucket ` +
    `  FROM ( ` +
    `    SELECT pm.hero_id, pm.hero_damage, pm.kills, pm.gold_per_min, pm.xp_per_min, ` +
    `      pm.tower_damage, pm.stuns, pm.hero_healing, pm.deaths, pm.last_hits, ` +
    `      pm.camps_stacked, m.duration, pm.lane_role, pm.is_roaming, ` +
    `      (SELECT SUM(value::numeric) FROM json_each_text(pm.damage_taken)) as damage_taken_sum, ` +
    `      (pm.hero_damage::float / NULLIF(pm.net_worth::float / NULLIF(( ` +
    `        SELECT SUM(pm2.net_worth) FROM player_matches pm2 ` +
    `        WHERE pm2.match_id = pm.match_id AND (pm2.player_slot < 128) = (pm.player_slot < 128) ` +
    `      ), 0), 0)) as damage_per_networth_share, ` +
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
      const buckets: BucketAgg[] = [];
      let totalGames = 0;
      for (const r of rows) {
        const games = Number(r.games);
        if (games < MIN_GAMES) continue;
        totalGames += games;
        const totalMinutes = Number(r.total_duration ?? 0) / 60;
        const perMin = (total: any) =>
          total != null && totalMinutes > 0 ? Math.round((Number(total) / totalMinutes) * 1000) / 1000 : null;
        const totalDeaths = Number(r.total_deaths ?? 0);
        buckets.push({
          position: r.bucket as Position,
          games,
          damagePerMin: perMin(r.total_damage),
          killsPerMin: perMin(r.total_kills),
          avgGpm: r.avg_gpm != null ? Math.round(Number(r.avg_gpm) * 10) / 10 : null,
          avgXpm: r.avg_xpm != null ? Math.round(Number(r.avg_xpm) * 10) / 10 : null,
          towerDamagePerMin: perMin(r.total_tower_damage),
          stunsPerMin: perMin(r.total_stuns),
          healingPerMin: perMin(r.total_healing),
          damageTakenPerDeath:
            r.total_damage_taken != null && totalDeaths > 0
              ? Math.round(Number(r.total_damage_taken) / totalDeaths)
              : null,
          deathsPerMin: perMin(r.total_deaths),
          lastHitsPerMin: perMin(r.total_last_hits),
          campsStackedPerMin: perMin(r.total_camps_stacked),
          avgDamagePerNetworthShare:
            r.avg_damage_per_networth_share != null ? Math.round(Number(r.avg_damage_per_networth_share)) : null,
        });
      }
      // Order buckets consistently and only keep the hero if at least one
      // bucket cleared MIN_GAMES.
      if (buckets.length > 0) {
        buckets.sort((a, b) => POSITIONS.indexOf(a.position) - POSITIONS.indexOf(b.position));
        results.push({ heroId: hero.id, name: hero.name, totalGames, buckets });
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
