import { PrismaClient as LocalPrismaClient } from '@prisma/client';
import { PrismaClient as PoolPrismaClient } from '../generated/pool-client';

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

  for (const match of matches) {
    const heroIds = JSON.parse(match.radiantWin ? match.radiantHeroIds : match.direHeroIds) as number[];
    const teamName = match.radiantWin ? match.radiantName : match.direName;

    await pool.pooledDraft.upsert({
      where: { id: `pro-${match.id}` },
      update: { heroIds, teamName, leagueName: match.leagueName },
      create: {
        id: `pro-${match.id}`,
        source: 'pro',
        submitterToken: null,
        heroIds,
        teamName,
        leagueName: match.leagueName,
      },
    });
  }

  console.log('Done.');
  await local.$disconnect();
  await pool.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
