import * as fs from 'fs';
import * as path from 'path';
import {
  fetchProPlayerNameMap,
  matchHasResolvedIdentities,
  opendotaJson,
  pooledRolesForSide,
  trimTeamName,
  type OpenDotaMatchPlayerRow,
} from './opendota-pro-identity';
import type { PooledHeroRole } from 'shared';

// Re-fetch OpenDota /matches/{id} for snapshot rows that still lack a
// Steam account_id → official handle mapping, then overlay
// /api/proPlayers names. Fuzzy Liquipedia string match is deliberately
// not used: OpenDota already stores that mapping by account_id.
const DATA_PATH = path.join(__dirname, '..', 'data', 'pro-matches.json');
const REQUEST_GAP_MS = 800;
const CHECKPOINT_EVERY = 10;

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
  radiant_name?: string | null;
  dire_name?: string | null;
  radiant_team?: { name?: string | null } | null;
  dire_team?: { name?: string | null } | null;
  players: (OpenDotaMatchPlayerRow & { player_slot: number })[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      await sleep(rateLimited ? 20000 * (attempt + 1) : 1500 * (attempt + 1));
    }
  }
  return null;
}

function writeSnapshot(generatedAt: string, matches: StoredProMatch[]): void {
  fs.writeFileSync(DATA_PATH, JSON.stringify({ generatedAt, matches }, null, 2));
}

async function main() {
  const { generatedAt, matches } = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8')) as {
    generatedAt: string;
    matches: StoredProMatch[];
  };

  console.log(`Loading OpenDota proPlayers map...`);
  const proNameByAccountId = await fetchProPlayerNameMap();
  console.log(`  ${proNameByAccountId.size} curated account_id → name rows`);

  const dirty = matches.filter((m) => !matchHasResolvedIdentities(m));
  console.log(`Snapshot ${matches.length} matches; ${dirty.length} need identity backfill.`);

  let updated = 0;
  let skipped = 0;
  let fetched = 0;

  for (const [index, match] of dirty.entries()) {
    console.log(`[${index + 1}/${dirty.length}] match ${match.matchId}`);

    const detail = await withRetry(async () => {
      return opendotaJson<MatchDetail>(`matches/${match.matchId}`);
    });
    fetched++;

    if (!detail || !Array.isArray(detail.players) || detail.players.length !== 10) {
      console.warn('  incomplete match detail, skipping');
      skipped++;
      await sleep(30000);
      continue;
    }

    const radiantPlayers = detail.players.filter((p) => p.player_slot < 128);
    const direPlayers = detail.players.filter((p) => p.player_slot >= 128);
    if (radiantPlayers.length !== 5 || direPlayers.length !== 5) {
      console.warn('  unexpected team sizes, skipping');
      skipped++;
      await sleep(REQUEST_GAP_MS);
      continue;
    }

    const radiantHeroRoles = pooledRolesForSide(radiantPlayers, proNameByAccountId, { requireGpm: true });
    const direHeroRoles = pooledRolesForSide(direPlayers, proNameByAccountId, { requireGpm: true });
    if (!radiantHeroRoles || !direHeroRoles) {
      console.warn('  missing gold_per_min, skipping');
      skipped++;
      await sleep(REQUEST_GAP_MS);
      continue;
    }

    match.radiantHeroRoles = radiantHeroRoles;
    match.direHeroRoles = direHeroRoles;
    match.radiantHeroIds = radiantPlayers.map((p) => p.hero_id);
    match.direHeroIds = direPlayers.map((p) => p.hero_id);
    match.radiantName =
      trimTeamName(detail.radiant_name ?? detail.radiant_team?.name) ?? match.radiantName;
    match.direName = trimTeamName(detail.dire_name ?? detail.dire_team?.name) ?? match.direName;
    updated++;

    if (updated % CHECKPOINT_EVERY === 0) {
      writeSnapshot(generatedAt, matches);
      console.log(`  checkpoint — ${updated} updated, ${skipped} skipped`);
    }

    await sleep(REQUEST_GAP_MS);
  }

  writeSnapshot(new Date().toISOString(), matches);
  const resolved = matches.filter((m) => matchHasResolvedIdentities(m)).length;
  const namedRoles = matches.flatMap((m) => [...(m.radiantHeroRoles ?? []), ...(m.direHeroRoles ?? [])]);
  const withName = namedRoles.filter((r) => r.playerName).length;
  console.log(`\nDone. fetched ${fetched}, updated ${updated}, skipped ${skipped}`);
  console.log(`  matches with full account_id identities: ${resolved}/${matches.length}`);
  console.log(`  role slots with a playerName: ${withName}/${namedRoles.length}`);
  console.log(`  wrote ${DATA_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
