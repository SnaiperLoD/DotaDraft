import * as fs from 'fs';
import * as path from 'path';

// Second-round check for the per-match role classifier (Blueprint/12-next-
// session-priorities.md item 6). Tests the user's proposed refinement: keep
// final-game GPM-rank for the core/support cut (already confirmed better than
// 15-minute gold-rank in research-role-fit-gpm15-rank.ts), but assign the
// SPECIFIC core identity (Carry/Mid/Offlane) from the lane the player stood
// in, not from GPM-rank ordering among cores. Same classify() rule as
// research-role-detection-accuracy.ts, just run system-wide per hero (that
// script only checked a 44-match cross-hero sample for internal consistency;
// this one produces real per-hero role shares, at the scale the actual
// per-role fetch pipeline will need).
//
// Also directly addresses a contamination gap in the CURRENT stored
// hero-meta.json positions (recompute-presumed-positions.ts): that method's
// Carry/Mid/Offlane ratio comes from research-role-fit-output.json's pure
// lane_role+is_roaming bucketing, which folds a STATIC safe/off-lane support
// (is_roaming=false, so bucketOf() calls them Carry/Offlane) into the core
// bucket — is_roaming only catches supports who actively roam. Using GPM-rank
// as the core/support cut PER MATCH (this script) doesn't have that gap: a
// static safe-lane support with bottom-2 team GPM is correctly cut to Support
// regardless of whether they roamed.
//
// One combined query per hero (scoped to that hero's own matches, same
// pattern as research-role-fit-gpm-rank.ts / research-role-fit-data.ts):
// GROUP BY (lane_role, is_roaming, gpm_rank) instead of fetching lane and GPM
// separately, so the classifier can be applied to the actual joint
// distribution rather than two independent margins.
const HEROES_PATH = path.join(__dirname, '..', 'data', 'heroes.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'research-role-classification-final-output.json');
const HERO_META_PATH = path.join(__dirname, '..', 'data', 'hero-meta.json');
const EXPLORER_URL = 'https://api.opendota.com/api/explorer';
const MIN_GAMES = 15;

// Window bound at the CURRENT patch's start (not a fixed match_id span) —
// confirmed via OpenDota's /constants/patch (7.41, released 2026-03-24) that
// the previously hardcoded 150M-match_id window already covered all but the
// first ~month of the current patch; widening further would start pulling in
// patch 7.40 and earlier (different hero balance/reworks), which would dilute
// the "current meta" signal this whole calibration is grounded in. Computed
// dynamically each run instead of hardcoded so this stays correct across
// future patches without manual updates.
async function getPatchStartMatchId(explorerQuery: (sql: string) => Promise<any[]>): Promise<number> {
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

type Position = 'Carry' | 'Mid' | 'Offlane' | 'Support';
const POSITIONS: Position[] = ['Carry', 'Mid', 'Offlane', 'Support'];

interface RawHero {
  id: number;
  name: string;
}

interface ComboRow {
  lane_role: number | null;
  is_roaming: boolean | null;
  gpm_rank: number;
  cnt: string;
  wins: string;
}

interface PositionRow {
  heroId: number;
  name: string;
  position: Position;
  games: number;
  wins: number;
  winRate: number;
  share: number;
}

interface HeroMetaEntry {
  heroId: number;
  positions: { position: Position; share: number }[];
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

function classify(laneRole: number | null, isRoaming: boolean | null, gpmRank: number): Position | null {
  if (isRoaming) return 'Support';
  if (laneRole === 2) return 'Mid';
  if (laneRole === 1) return gpmRank <= 3 ? 'Carry' : 'Support';
  if (laneRole === 3) return gpmRank <= 3 ? 'Offlane' : 'Support';
  return null;
}

async function main() {
  const allHeroes: RawHero[] = JSON.parse(fs.readFileSync(HEROES_PATH, 'utf-8'));

  const existing: PositionRow[] = fs.existsSync(OUTPUT_PATH)
    ? (JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf-8')) as PositionRow[])
    : [];
  const doneHeroIds = new Set(existing.map((r) => r.heroId));
  const heroes = allHeroes.filter((h) => !doneHeroIds.has(h.id));
  if (existing.length > 0) {
    console.log(`Resuming: ${doneHeroIds.size}/${allHeroes.length} heroes already in ${OUTPUT_PATH}.`);
  }

  const threshold = await getPatchStartMatchId(explorerQuery);

  const results: PositionRow[] = [...existing];

  for (const [index, hero] of heroes.entries()) {
    process.stdout.write(`[${index + 1}/${heroes.length}] ${hero.name}...\r`);

    const rows = (await withRetry(() =>
      explorerQuery(
        `SELECT lane_role, is_roaming, gpm_rank, COUNT(*) as cnt, ` +
          `SUM(win) as wins ` +
          `FROM ( ` +
          `  SELECT pm.match_id, pm.hero_id, pm.lane_role, pm.is_roaming, ` +
          `    (CASE WHEN (pm.player_slot < 128) = m.radiant_win THEN 1 ELSE 0 END) as win, ` +
          `    RANK() OVER (PARTITION BY pm.match_id, (pm.player_slot < 128) ORDER BY pm.gold_per_min DESC) as gpm_rank ` +
          `  FROM player_matches pm JOIN matches m ON pm.match_id = m.match_id ` +
          `  WHERE pm.match_id IN (SELECT match_id FROM player_matches WHERE hero_id = ${hero.id} AND match_id > ${threshold}) ` +
          `) sub ` +
          `WHERE hero_id = ${hero.id} ` +
          `GROUP BY lane_role, is_roaming, gpm_rank`,
      ),
    )) as ComboRow[] | null;

    if (rows) {
      const buckets: Record<Position, { games: number; wins: number }> = {
        Carry: { games: 0, wins: 0 },
        Mid: { games: 0, wins: 0 },
        Offlane: { games: 0, wins: 0 },
        Support: { games: 0, wins: 0 },
      };
      let total = 0;

      for (const row of rows) {
        const laneRole = row.lane_role === null ? null : Number(row.lane_role);
        const gpmRank = Number(row.gpm_rank);
        const bucket = classify(laneRole, row.is_roaming, gpmRank);
        if (!bucket) continue;
        const cnt = Number(row.cnt);
        buckets[bucket].games += cnt;
        buckets[bucket].wins += Number(row.wins ?? 0);
        total += cnt;
      }

      if (total > 0) {
        POSITIONS.forEach((position) => {
          const b = buckets[position];
          if (b.games >= MIN_GAMES) {
            results.push({
              heroId: hero.id,
              name: hero.name,
              position,
              games: b.games,
              wins: b.wins,
              winRate: Math.round((b.wins / b.games) * 1000) / 1000,
              share: Math.round((b.games / total) * 1000) / 1000,
            });
          }
        });
      }
    }

    await sleep(450);
  }

  console.log(`\n\nComputed ${results.length} (hero, position) rows (min ${MIN_GAMES} games each).\n`);
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2));

  // --- Compare against currently-stored hero-meta.json positions ---
  if (!fs.existsSync(HERO_META_PATH)) {
    console.log('hero-meta.json missing — skipping comparison against currently-stored positions.');
    return;
  }
  const meta: { heroes: HeroMetaEntry[] } = JSON.parse(fs.readFileSync(HERO_META_PATH, 'utf-8'));
  const storedByHero = new Map(meta.heroes.map((h) => [h.heroId, h.positions]));

  const newByHero = new Map<number, PositionRow[]>();
  results.forEach((r) => {
    if (!newByHero.has(r.heroId)) newByHero.set(r.heroId, []);
    newByHero.get(r.heroId)!.push(r);
  });

  const diffs: { name: string; position: Position; oldShare: number; newShare: number; delta: number }[] = [];
  for (const hero of allHeroes) {
    const stored = storedByHero.get(hero.id) ?? [];
    const fresh = newByHero.get(hero.id) ?? [];
    for (const position of POSITIONS) {
      const oldShare = stored.find((p) => p.position === position)?.share ?? 0;
      const newShare = fresh.find((r) => r.position === position)?.share ?? 0;
      const delta = newShare - oldShare;
      if (Math.abs(delta) >= 0.15) {
        diffs.push({ name: hero.name, position, oldShare, newShare, delta: Math.round(delta * 1000) / 1000 });
      }
    }
  }
  diffs.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  console.log(`=== BIGGEST DIVERGENCES vs currently-stored hero-meta.json positions (|delta| >= 0.15) ===`);
  console.log(`(new method: GPM-rank core/support cut per match, lane_role gives core identity)\n`);
  diffs.slice(0, 30).forEach((d) =>
    console.log(
      `  ${d.name.padEnd(20)} ${d.position.padEnd(8)} old=${d.oldShare.toFixed(2)}  new=${d.newShare.toFixed(2)}  delta=${d.delta > 0 ? '+' : ''}${d.delta}`,
    ),
  );
  console.log(`\nTotal (hero, position) pairs with |delta| >= 0.15: ${diffs.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
