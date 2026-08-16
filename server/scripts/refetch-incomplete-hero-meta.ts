import * as fs from 'fs';
import * as path from 'path';

// Re-fetches only hero-meta entries that came back incomplete from a full
// fetch-hero-meta run (empty positions and/or synergy/matchups — usually
// OpenDota 429s mid-batch). Auto-detects targets from the current file
// rather than a hardcoded name list. After healing pair-data gaps, still
// run `npx ts-node scripts/recompute-presumed-positions.ts` so positions
// become the hybrid GPM+lane set the app expects (fetch alone writes
// pure-GPM stubs that the hybrid script replaces).
const HEROES_PATH = path.join(__dirname, '..', 'data', 'heroes.json');
const META_PATH = path.join(__dirname, '..', 'data', 'hero-meta.json');
const EXPLORER_URL = 'https://api.opendota.com/api/explorer';

type Position = 'Carry' | 'Mid' | 'Offlane' | 'Support';

const GPM_RANK_TO_POSITION: Record<number, Position> = {
  1: 'Carry',
  2: 'Mid',
  3: 'Offlane',
  4: 'Support',
  5: 'Support',
};

function classifyPositions(rows: { gpm_rank: number; cnt: number }[]): { position: Position; share: number }[] {
  const buckets: Record<Position, number> = { Carry: 0, Mid: 0, Offlane: 0, Support: 0 };
  let total = 0;
  for (const row of rows) {
    const bucket = GPM_RANK_TO_POSITION[row.gpm_rank];
    if (!bucket) continue;
    buckets[bucket] += row.cnt;
    total += row.cnt;
  }
  if (total === 0) return [];
  return (Object.entries(buckets) as [Position, number][])
    .map(([position, cnt]) => ({ position, share: cnt / total }))
    .filter((p) => p.share >= 0.25)
    .sort((a, b) => b.share - a.share);
}

interface RawHero {
  id: number;
  name: string;
}

interface HeroMetaEntry {
  heroId: number;
  positions: { position: string; share: number }[];
  winRate: number | null;
  synergy: { allyHeroId: number; games: number; wins: number }[];
  matchups: { opponentHeroId: number; games: number; wins: number }[];
  benchmarks: unknown;
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
      const msg = (err as Error).message ?? String(err);
      if (attempt === retries) {
        console.warn(`    failed after ${retries + 1} attempt(s): ${msg}`);
        return null;
      }
      const rateLimited = /\b429\b/.test(msg);
      await sleep(rateLimited ? 5000 * (attempt + 1) : 1500 * (attempt + 1));
    }
  }
  return null;
}

function isIncomplete(entry: HeroMetaEntry): boolean {
  // Empty positions is the same class of failure as empty synergy/matchups:
  // fetch-hero-meta left a stub after a 429/timeout (or never ran the hybrid
  // recompute). Treating it as incomplete so this script heals the tooltip
  // "нет данных о реальных позициях" case, not only pair-data gaps.
  return !entry.positions?.length || !entry.synergy?.length || !entry.matchups?.length;
}

async function main() {
  const heroes: RawHero[] = JSON.parse(fs.readFileSync(HEROES_PATH, 'utf-8'));
  const nameById = new Map(heroes.map((h) => [h.id, h.name]));
  const existing: { generatedAt: string; recentMatchIdThreshold: number; heroes: HeroMetaEntry[] } =
    JSON.parse(fs.readFileSync(META_PATH, 'utf-8'));
  const threshold = existing.recentMatchIdThreshold;
  const updated = new Map(existing.heroes.map((h) => [h.heroId, h]));

  const targets = existing.heroes.filter(isIncomplete);
  console.log(`Incomplete entries: ${targets.length} (threshold match_id > ${threshold})`);
  if (targets.length === 0) return;

  // Brief pause so we aren't immediately rate-limited after the full fetch.
  await sleep(8000);

  for (const [index, prior] of targets.entries()) {
    const name = nameById.get(prior.heroId) ?? `hero_${prior.heroId}`;
    console.log(`[${index + 1}/${targets.length}] ${name} (id ${prior.heroId})`);

    let positions = prior.positions ?? [];
    if (!positions.length) {
      const posRows = await withRetry(() =>
        explorerQuery(
          `SELECT gpm_rank, COUNT(*) as cnt ` +
            `FROM ( ` +
            `  SELECT pm.match_id, pm.hero_id, ` +
            `    RANK() OVER (PARTITION BY pm.match_id, (pm.player_slot < 128) ORDER BY pm.gold_per_min DESC) as gpm_rank ` +
            `  FROM player_matches pm ` +
            `  WHERE pm.match_id IN (SELECT match_id FROM player_matches WHERE hero_id = ${prior.heroId} AND match_id > ${threshold}) ` +
            `) sub ` +
            `WHERE hero_id = ${prior.heroId} ` +
            `GROUP BY gpm_rank`,
        ),
      );
      positions = posRows
        ? classifyPositions(posRows.map((r) => ({ gpm_rank: Number(r.gpm_rank), cnt: Number(r.cnt) })))
        : [];
      console.log(`  positions=${positions.length || 'still empty'}`);
      await sleep(600);
    }

    let synergy = prior.synergy ?? [];
    if (!synergy.length) {
      const synergyRows = await withRetry(() =>
        explorerQuery(
          `SELECT b.hero_id as ally_hero_id, COUNT(*) as games, SUM(CASE WHEN (a.player_slot < 128) = m.radiant_win THEN 1 ELSE 0 END) as wins FROM player_matches a JOIN player_matches b ON a.match_id = b.match_id AND ((a.player_slot < 128) = (b.player_slot < 128)) AND a.hero_id != b.hero_id JOIN matches m ON a.match_id = m.match_id WHERE a.hero_id = ${prior.heroId} AND a.match_id > ${threshold} GROUP BY b.hero_id ORDER BY games DESC LIMIT 15`,
        ),
      );
      synergy = (synergyRows ?? [])
        .map((r) => ({ allyHeroId: Number(r.ally_hero_id), games: Number(r.games), wins: Number(r.wins) }))
        .filter((r) => r.games >= 5);
      await sleep(600);
    }

    let matchups = prior.matchups ?? [];
    if (!matchups.length) {
      const matchupsRes = await withRetry(async () => {
        const res = await fetch(`https://api.opendota.com/api/heroes/${prior.heroId}/matchups`);
        if (!res.ok) throw new Error(`matchups HTTP ${res.status}`);
        return res.json();
      });
      matchups = ((matchupsRes as any[]) ?? []).map((m: any) => ({
        opponentHeroId: m.hero_id,
        games: m.games_played,
        wins: m.wins,
      }));
      await sleep(600);
    }

    let benchmarks = prior.benchmarks;
    if (!benchmarks) {
      const benchmarksRes = await withRetry(async () => {
        const res = await fetch(`https://api.opendota.com/api/benchmarks?hero_id=${prior.heroId}`);
        if (!res.ok) throw new Error(`benchmarks HTTP ${res.status}`);
        return res.json();
      });
      benchmarks = benchmarksRes?.result ?? null;
      await sleep(400);
    }

    updated.set(prior.heroId, {
      heroId: prior.heroId,
      positions,
      winRate: prior.winRate ?? null,
      synergy,
      matchups,
      benchmarks,
    });

    console.log(`  synergy=${synergy.length} matchups=${matchups.length} positions=${positions.length}`);
    await sleep(500);
  }

  const stillBad = [...updated.values()].filter(isIncomplete).length;
  const output = {
    generatedAt: new Date().toISOString(),
    recentMatchIdThreshold: threshold,
    heroes: heroes.map((h) => updated.get(h.id)!),
  };
  fs.writeFileSync(META_PATH, JSON.stringify(output, null, 2));
  console.log(`\nDone. Still incomplete: ${stillBad}. Wrote ${META_PATH}`);
  console.log(
    'Next: npx ts-node scripts/recompute-presumed-positions.ts && npm run seed  (hybrid positions + SQLite)',
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
