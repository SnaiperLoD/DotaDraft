import { PrismaClient as LocalPrismaClient } from '@prisma/client';
import { PrismaClient as PoolPrismaClient, type Prisma } from '../generated/pool-client';
import {
  isInternationalLeague,
  pooledProLoseId,
  pooledProWinId,
} from '../src/opponent-pool/pooled-pro-id';

// Seeds the Opponent Pool's "pro" tier from local ProMatch rows.
// Winner lineup: `pro-<matchId>` (Battle's known-strong compositions).
// TI loser lineup: `pro-<matchId>-lose` so TI Run can fight teams that
// dropped a series. Player commits go through POST /opponent-pool/commit.
async function main() {
  const local = new LocalPrismaClient();
  const pool = new PoolPrismaClient();

  const matches = await local.proMatch.findMany();
  const tiMatches = matches.filter((m) => isInternationalLeague(m.leagueName));
  console.log(
    `Seeding ${matches.length} winning pro drafts and ${tiMatches.length} TI losing drafts into the Opponent Pool...`,
  );

  const currentIds = new Set<string>();
  for (const match of matches) {
    currentIds.add(pooledProWinId(match.id));
    if (isInternationalLeague(match.leagueName)) currentIds.add(pooledProLoseId(match.id));
  }
  const existingProRows = await pool.pooledDraft.findMany({ where: { source: 'pro' }, select: { id: true } });
  const staleIds = existingProRows.map((r) => r.id).filter((id) => !currentIds.has(id));
  if (staleIds.length > 0) {
    await pool.pooledDraft.deleteMany({ where: { id: { in: staleIds } } });
    console.log(`Removed ${staleIds.length} stale 'pro' rows no longer in the local snapshot.`);
  }

  for (const match of matches) {
    await upsertSide(pool, pooledProWinId(match.id), match, true);
    if (isInternationalLeague(match.leagueName)) {
      await upsertSide(pool, pooledProLoseId(match.id), match, false);
    }
  }

  console.log('Done.');
  await seedLegacyPlayerRows(pool);
  await local.$disconnect();
  await pool.$disconnect();
}

async function upsertSide(
  pool: PoolPrismaClient,
  id: string,
  match: {
    id: string;
    radiantWin: boolean;
    radiantName: string | null;
    direName: string | null;
    leagueName: string | null;
    radiantHeroIds: string;
    direHeroIds: string;
    radiantHeroRoles: string | null;
    direHeroRoles: string | null;
  },
  winner: boolean,
) {
  const radiant = winner ? match.radiantWin : !match.radiantWin;
  const heroIds = JSON.parse(radiant ? match.radiantHeroIds : match.direHeroIds) as number[];
  const teamName = radiant ? match.radiantName : match.direName;
  const heroRolesRaw = radiant ? match.radiantHeroRoles : match.direHeroRoles;
  const heroRoles = (heroRolesRaw ? JSON.parse(heroRolesRaw) : null) as Prisma.InputJsonValue;
  if (!teamName) return;

  await pool.pooledDraft.upsert({
    where: { id },
    update: { heroIds, teamName, leagueName: match.leagueName, heroRoles },
    create: {
      id,
      source: 'pro',
      submitterToken: null,
      heroIds,
      teamName,
      leagueName: match.leagueName,
      heroRoles,
    },
  });
}

async function seedLegacyPlayerRows(pool: PoolPrismaClient) {
  const { loadLegacySnapshot, upsertLegacyPlayerDrafts } = await import('./backfill-legacy-player-pool');
  const drafts = loadLegacySnapshot();
  if (drafts.length === 0) {
    console.log('No legacy-player-pool.json snapshot — skip host-archive player rows.');
    return;
  }
  const { written } = await upsertLegacyPlayerDrafts(pool, drafts);
  console.log(`Upserted ${written} legacy host-archive player drafts.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
