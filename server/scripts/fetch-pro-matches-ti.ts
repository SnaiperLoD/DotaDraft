import * as fs from 'fs';
import * as path from 'path';

// Fetches every available OpenDota match from The International 2026 main
// event (leagueid 19719) and MERGES them into pro-matches.json — does not
// replace the existing curated tier1 snapshot. Winning sides then land in
// the Opponent Pool via `npm run seed` + `npm run seed-opponent-pool`.
//
// Re-runnable while TI is live: already-imported TI match ids are refreshed
// in place; non-TI matches are left untouched.
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'pro-matches.json');
const TI_LEAGUE_ID = 19719;
const TI_LEAGUE_NAME = 'The International 2026';
const MIN_DURATION_SECONDS = 600;

const RANK_TO_ROLE: Record<number, string> = {
  1: 'Carry',
  2: 'Mid',
  3: 'Offlane',
  4: 'Soft Support',
  5: 'Hard Support',
};

interface LeagueMatchRow {
  match_id: number;
  duration: number;
  start_time: number;
  radiant_win: boolean;
  radiant_name: string | null;
  dire_name: string | null;
}

interface PooledHeroRole {
  heroId: number;
  role: string;
  playerName?: string | null;
}

interface StoredProMatch {
  matchId: string;
  radiantName: string | null;
  direName: string | null;
  leagueName: string | null;
  radiantWin: boolean;
  radiantHeroIds: number[];
  direHeroIds: number[];
  radiantHeroRoles?: PooledHeroRole[];
  direHeroRoles?: PooledHeroRole[];
  startTime: string;
}

interface MatchDetail {
  match_id: number;
  radiant_win: boolean;
  start_time: number;
  duration: number;
  radiant_name?: string | null;
  dire_name?: string | null;
  radiant_team?: { name?: string | null } | null;
  dire_team?: { name?: string | null } | null;
  players: {
    hero_id: number;
    player_slot: number;
    gold_per_min: number;
    personaname?: string | null;
    name?: string | null;
  }[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === retries) {
        console.warn(`    failed after ${retries + 1} attempt(s): ${(err as Error).message}`);
        return null;
      }
      await sleep(1500 * (attempt + 1));
    }
  }
  return null;
}

function rolesForSide(
  players: { hero_id: number; gold_per_min: number; personaname?: string | null; name?: string | null }[],
): PooledHeroRole[] {
  return [...players]
    .sort((a, b) => b.gold_per_min - a.gold_per_min)
    .map((p, i) => ({
      heroId: p.hero_id,
      role: RANK_TO_ROLE[i + 1],
      playerName: p.name?.trim() || p.personaname?.trim() || null,
    }));
}

function loadExisting(): StoredProMatch[] {
  if (!fs.existsSync(OUTPUT_PATH)) return [];
  const parsed = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf-8')) as { matches?: StoredProMatch[] };
  return Array.isArray(parsed.matches) ? parsed.matches : [];
}

function hasCompleteRoles(m: StoredProMatch | undefined): boolean {
  return Boolean(
    m &&
      Array.isArray(m.radiantHeroRoles) &&
      m.radiantHeroRoles.length === 5 &&
      Array.isArray(m.direHeroRoles) &&
      m.direHeroRoles.length === 5 &&
      Array.isArray(m.radiantHeroIds) &&
      m.radiantHeroIds.length === 5 &&
      Array.isArray(m.direHeroIds) &&
      m.direHeroIds.length === 5,
  );
}

async function main() {
  console.log(`Fetching league ${TI_LEAGUE_ID} (${TI_LEAGUE_NAME}) match list...`);
  const rows = await withRetry(async () => {
    const res = await fetch(`https://api.opendota.com/api/leagues/${TI_LEAGUE_ID}/matches`);
    if (!res.ok) throw new Error(`leagues/matches HTTP ${res.status}`);
    return (await res.json()) as LeagueMatchRow[];
  });

  if (!rows) {
    throw new Error('Could not fetch TI league match list from OpenDota');
  }

  const candidates = rows
    .filter((r) => r.duration >= MIN_DURATION_SECONDS)
    .sort((a, b) => b.start_time - a.start_time);

  console.log(
    `OpenDota returned ${rows.length} matches; ${candidates.length} keep after duration >= ${MIN_DURATION_SECONDS}s.`,
  );

  const existing = loadExisting();
  const byId = new Map(existing.map((m) => [m.matchId, m]));
  let added = 0;
  let updated = 0;
  let skipped = 0;
  let reused = 0;

  for (const [index, row] of candidates.entries()) {
    const matchId = String(row.match_id);
    const existingRow = byId.get(matchId);
    if (hasCompleteRoles(existingRow) && existingRow!.leagueName === TI_LEAGUE_NAME) {
      reused++;
      if ((index + 1) % 25 === 0) {
        console.log(`[${index + 1}/${candidates.length}] reused cached details through ${matchId}`);
      }
      continue;
    }

    console.log(`[${index + 1}/${candidates.length}] match ${row.match_id}`);

    const detail = await withRetry(async () => {
      const res = await fetch(`https://api.opendota.com/api/matches/${row.match_id}`);
      if (!res.ok) throw new Error(`matches HTTP ${res.status}`);
      return (await res.json()) as MatchDetail;
    });

    if (!detail || !Array.isArray(detail.players) || detail.players.length !== 10) {
      console.warn('  incomplete match detail, skipping');
      skipped++;
      await sleep(300);
      continue;
    }

    const radiantPlayers = detail.players.filter((p) => p.player_slot < 128);
    const direPlayers = detail.players.filter((p) => p.player_slot >= 128);
    if (radiantPlayers.length !== 5 || direPlayers.length !== 5) {
      console.warn('  unexpected team sizes, skipping');
      skipped++;
      await sleep(300);
      continue;
    }

    const storedId = String(detail.match_id ?? row.match_id);
    const had = byId.has(storedId);
    const trimName = (v: string | null | undefined) => {
      const t = v?.trim();
      return t ? t : null;
    };
    const stored: StoredProMatch = {
      matchId: storedId,
      radiantName: trimName(
        detail.radiant_name ?? detail.radiant_team?.name ?? row.radiant_name,
      ),
      direName: trimName(detail.dire_name ?? detail.dire_team?.name ?? row.dire_name),
      leagueName: TI_LEAGUE_NAME,
      radiantWin: detail.radiant_win ?? row.radiant_win,
      radiantHeroIds: radiantPlayers.map((p) => p.hero_id),
      direHeroIds: direPlayers.map((p) => p.hero_id),
      radiantHeroRoles: rolesForSide(radiantPlayers),
      direHeroRoles: rolesForSide(direPlayers),
      startTime: new Date((detail.start_time ?? row.start_time) * 1000).toISOString(),
    };

    byId.set(storedId, stored);
    if (had) updated++;
    else added++;

    await sleep(300);
  }

  const matches = [...byId.values()].sort(
    (a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime(),
  );
  fs.writeFileSync(
    OUTPUT_PATH,
    JSON.stringify({ generatedAt: new Date().toISOString(), matches }, null, 2),
  );

  console.log(`\nDone.`);
  console.log(`  TI candidates kept: ${candidates.length}`);
  console.log(`  added: ${added}, updated: ${updated}, reused cached: ${reused}, skipped: ${skipped}`);
  console.log(`  pro-matches.json total: ${matches.length} (was ${existing.length})`);
  console.log(`  wrote ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
