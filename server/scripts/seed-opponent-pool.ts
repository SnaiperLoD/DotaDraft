import { PrismaClient as LocalPrismaClient } from '@prisma/client';
import { PrismaClient as PoolPrismaClient, type Prisma } from '../generated/pool-client';

// Seeds the Opponent Pool's "pro" tier from the matches imported in
// Milestone 3 (winning side only — the known-strong compositions), per
// Blueprint/06-battle-engine.md. Player-submitted drafts are added
// separately via POST /opponent-pool/commit as people play.
// Idempotent: uses a deterministic id (`pro-<matchId>`) so re-running after
// a fresh fetch-pro-matches + seed just updates existing rows.
async function main() {
  const local = new LocalPrismaClient();
  const pool = new PoolPrismaClient();

  const matches = await local.proMatch.findMany();
  console.log(`Seeding ${matches.length} pro matches into the Opponent Pool (winning side only)...`);

  // Local ProMatch is itself a full snapshot (seed.ts prunes it on every
  // run) — mirror that here so a re-curated import (e.g. switching from
  // recency-based to tier1-based selection) doesn't leave orphaned 'pro'
  // rows behind in the pool forever.
  const currentIds = new Set(matches.map((m) => `pro-${m.id}`));
  const existingProRows = await pool.pooledDraft.findMany({ where: { source: 'pro' }, select: { id: true } });
  const staleIds = existingProRows.map((r) => r.id).filter((id) => !currentIds.has(id));
  if (staleIds.length > 0) {
    await pool.pooledDraft.deleteMany({ where: { id: { in: staleIds } } });
    console.log(`Removed ${staleIds.length} stale 'pro' rows no longer in the local snapshot.`);
  }

  for (const match of matches) {
    const heroIds = JSON.parse(match.radiantWin ? match.radiantHeroIds : match.direHeroIds) as number[];
    const teamName = match.radiantWin ? match.radiantName : match.direName;
    const heroRolesRaw = match.radiantWin ? match.radiantHeroRoles : match.direHeroRoles;
    // null for matches imported before role-fit reached the pro tier (see
    // Blueprint/10-tech-debt-backlog.md) — re-run fetch-pro-matches-tier1 +
    // seed to backfill.
    const heroRoles = (heroRolesRaw ? JSON.parse(heroRolesRaw) : null) as Prisma.InputJsonValue;

    await pool.pooledDraft.upsert({
      where: { id: `pro-${match.id}` },
      update: { heroIds, teamName, leagueName: match.leagueName, heroRoles },
      create: {
        id: `pro-${match.id}`,
        source: 'pro',
        submitterToken: null,
        heroIds,
        teamName,
        leagueName: match.leagueName,
        heroRoles,
      },
    });
  }

  console.log('Done.');
  await seedLegacyPlayerRows(pool);
  await local.$disconnect();
  await pool.$disconnect();
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
