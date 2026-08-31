import * as fs from 'fs';
import * as path from 'path';
import type { PooledHeroRole } from 'shared';
import {
  fetchProPlayerNameMap,
  matchHasResolvedIdentities,
  opendotaUrl,
  pooledRolesForSide,
  type OpenDotaMatchPlayerRow,
} from './opendota-pro-identity';

// Backfills radiantHeroRoles/direHeroRoles onto the existing pro-matches.json
// snapshot (Blueprint/10-tech-debt-backlog.md, "Role-fit in Battle Engine").
// Names resolve via OpenDota proPlayers[account_id] — same path as
// backfill-pro-player-names.ts. Prefer that script if you only need identity
// overlay on rows that already have roles.
const DATA_PATH = path.join(__dirname, '..', 'data', 'pro-matches.json');

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
      await sleep(1500);
    }
  }
  return null;
}

async function main() {
  const { generatedAt, matches } = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8')) as {
    generatedAt: string;
    matches: StoredProMatch[];
  };

  console.log(`Loading OpenDota proPlayers map...`);
  const proNameByAccountId = await fetchProPlayerNameMap();
  console.log(`  ${proNameByAccountId.size} curated account_id → name rows`);

  for (const [index, match] of matches.entries()) {
    if (
      match.radiantHeroRoles?.length === 5 &&
      match.direHeroRoles?.length === 5 &&
      matchHasResolvedIdentities(match)
    ) {
      if ((index + 1) % 50 === 0) {
        console.log(`[${index + 1}/${matches.length}] already resolved through ${match.matchId}`);
      }
      continue;
    }

    console.log(`[${index + 1}/${matches.length}] match ${match.matchId}`);

    const detail = await withRetry(async () => {
      const res = await fetch(opendotaUrl(`matches/${match.matchId}`));
      if (!res.ok) throw new Error(`matches HTTP ${res.status}`);
      return (await res.json()) as {
        players: (OpenDotaMatchPlayerRow & { player_slot: number; gold_per_min: number })[];
      };
    });

    if (!detail || !Array.isArray(detail.players) || detail.players.length !== 10) {
      console.warn('  incomplete match detail, skipping (keeping match without roles)');
      await sleep(300);
      continue;
    }

    const radiantPlayers = detail.players.filter((p) => p.player_slot < 128);
    const direPlayers = detail.players.filter((p) => p.player_slot >= 128);

    if (radiantPlayers.length !== 5 || direPlayers.length !== 5) {
      console.warn('  unexpected team sizes, skipping (keeping match without roles)');
      await sleep(300);
      continue;
    }

    const radiantHeroRoles = pooledRolesForSide(radiantPlayers, proNameByAccountId);
    const direHeroRoles = pooledRolesForSide(direPlayers, proNameByAccountId);
    if (radiantHeroRoles && direHeroRoles) {
      match.radiantHeroRoles = radiantHeroRoles;
      match.direHeroRoles = direHeroRoles;
    }

    await sleep(300);
  }

  fs.writeFileSync(DATA_PATH, JSON.stringify({ generatedAt, matches }, null, 2));
  const withRoles = matches.filter((m) => m.radiantHeroRoles && m.direHeroRoles).length;
  console.log(`\nDone. ${withRoles}/${matches.length} matches now have role data.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
