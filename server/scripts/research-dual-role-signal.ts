import * as fs from 'fs';
import * as path from 'path';

// Point-check for Blueprint/12-next-session-priorities.md item 6 (role-conditional
// axis values for dual-role heroes). NOT a full pipeline — just checks whether the
// raw match stats feeding evaluation_values (see calibrate-evaluation-values.ts
// header comment: hero_damage->teamfight, stuns->control, hero_healing->saving,
// kills->burst, gold_per_min->scaling, tower_damage->objectives) actually diverge
// enough between a hero's core games (GPM rank 1-3) and support games (GPM rank 4-5)
// to justify building the full per-role fetch/calibration pipeline. Same GPM-rank
// technique as research-role-fit-gpm-rank.ts.
//
// Hero selection: NOT the reputational examples from the original request
// (Windranger/Beastmaster/Batrider/Timbersaw) — instead the 10 heroes with the
// highest min(coreShare, supportShare) in the already-collected
// research-role-fit-gpm-output.json, i.e. objectively the most evenly split
// between core and support roles in real matches.
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'research-dual-role-signal-output.json');
const EXPLORER_URL = 'https://api.opendota.com/api/explorer';
const RECENT_WINDOW = 150_000_000;

const TARGET_HEROES: { id: number; name: string }[] = [
  { id: 128, name: 'Snapfire' },
  { id: 14, name: 'Pudge' },
  { id: 21, name: 'Windranger' },
  { id: 90, name: 'Keeper of the Light' },
  { id: 107, name: 'Earth Spirit' },
  { id: 22, name: 'Zeus' },
  { id: 65, name: 'Batrider' },
  { id: 85, name: 'Undying' },
  { id: 155, name: 'Largo' },
  { id: 20, name: 'Vengeful Spirit' },
];

interface BucketRow {
  bucket: 'core' | 'support';
  games: number;
  damagePerMin: number | null;
  stunsPerMin: number | null;
  healingPerMin: number | null;
  killsPerMin: number | null;
  avgGpm: number | null;
  towerDamagePerMin: number | null;
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
  const maxRows = await explorerQuery('SELECT match_id FROM matches ORDER BY match_id DESC LIMIT 1');
  const maxMatchId = Number(maxRows[0]?.match_id ?? 8_900_000_000);
  const threshold = maxMatchId - RECENT_WINDOW;

  const results: { heroId: number; name: string; buckets: BucketRow[] }[] = [];

  for (const [index, hero] of TARGET_HEROES.entries()) {
    process.stdout.write(`[${index + 1}/${TARGET_HEROES.length}] ${hero.name}...\n`);

    const rows = await withRetry(() =>
      explorerQuery(
        `SELECT bucket, COUNT(*) as games, ` +
          `SUM(hero_damage) as total_damage, SUM(stuns) as total_stuns, ` +
          `SUM(hero_healing) as total_healing, SUM(kills) as total_kills, ` +
          `AVG(gold_per_min) as avg_gpm, SUM(tower_damage) as total_tower_damage, ` +
          `SUM(duration) as total_duration ` +
          `FROM ( ` +
          `  SELECT hero_damage, stuns, hero_healing, kills, gold_per_min, tower_damage, duration, ` +
          `    (CASE WHEN gpm_rank <= 3 THEN 'core' ELSE 'support' END) as bucket ` +
          `  FROM ( ` +
          `    SELECT pm.hero_id, pm.hero_damage, pm.stuns, pm.hero_healing, pm.kills, pm.gold_per_min, ` +
          `      pm.tower_damage, m.duration, ` +
          `      RANK() OVER (PARTITION BY pm.match_id, (pm.player_slot < 128) ORDER BY pm.gold_per_min DESC) as gpm_rank ` +
          `    FROM player_matches pm JOIN matches m ON pm.match_id = m.match_id ` +
          `    WHERE pm.match_id IN (SELECT match_id FROM player_matches WHERE hero_id = ${hero.id} AND match_id > ${threshold}) ` +
          `  ) ranked ` +
          `  WHERE hero_id = ${hero.id} ` +
          `) filtered ` +
          `GROUP BY bucket`,
      ),
    );

    if (rows) {
      const buckets: BucketRow[] = rows.map((r) => {
        const games = Number(r.games);
        const totalMinutes = Number(r.total_duration ?? 0) / 60;
        const per = (total: any) =>
          total != null && totalMinutes > 0 ? Math.round((Number(total) / totalMinutes) * 1000) / 1000 : null;
        return {
          bucket: r.bucket,
          games,
          damagePerMin: per(r.total_damage),
          stunsPerMin: per(r.total_stuns),
          healingPerMin: per(r.total_healing),
          killsPerMin: per(r.total_kills),
          avgGpm: r.avg_gpm != null ? Math.round(Number(r.avg_gpm) * 10) / 10 : null,
          towerDamagePerMin: per(r.total_tower_damage),
        };
      });
      results.push({ heroId: hero.id, name: hero.name, buckets });
    }

    await sleep(500);
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2));
  console.log(`\nWrote ${results.length} heroes to ${OUTPUT_PATH}\n`);

  console.log('=== CORE vs SUPPORT raw-stat divergence ===\n');
  for (const r of results) {
    const core = r.buckets.find((b) => b.bucket === 'core');
    const support = r.buckets.find((b) => b.bucket === 'support');
    if (!core || !support) {
      console.log(`${r.name}: missing one bucket (core=${!!core}, support=${!!support}) — skipping\n`);
      continue;
    }
    const pctDiff = (a: number | null, b: number | null) =>
      a !== null && b !== null && b !== 0 ? Math.round(((a - b) / b) * 1000) / 10 : null;
    console.log(`${r.name} (core n=${core.games}, support n=${support.games})`);
    console.log(
      `  damage/min:  core=${core.damagePerMin}  support=${support.damagePerMin}  diff=${pctDiff(core.damagePerMin, support.damagePerMin)}%`,
    );
    console.log(
      `  stuns/min:   core=${core.stunsPerMin}  support=${support.stunsPerMin}  diff=${pctDiff(core.stunsPerMin, support.stunsPerMin)}%`,
    );
    console.log(
      `  healing/min: core=${core.healingPerMin}  support=${support.healingPerMin}  diff=${pctDiff(core.healingPerMin, support.healingPerMin)}%`,
    );
    console.log(
      `  kills/min:   core=${core.killsPerMin}  support=${support.killsPerMin}  diff=${pctDiff(core.killsPerMin, support.killsPerMin)}%`,
    );
    console.log(`  avg gpm:     core=${core.avgGpm}  support=${support.avgGpm}  diff=${pctDiff(core.avgGpm, support.avgGpm)}%`);
    console.log(
      `  tower dmg/min: core=${core.towerDamagePerMin}  support=${support.towerDamagePerMin}  diff=${pctDiff(core.towerDamagePerMin, support.towerDamagePerMin)}%\n`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
