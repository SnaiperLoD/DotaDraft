import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

interface RawHero {
  id: number;
  name: string;
  primary_attribute: string;
  attack_type: string;
  roles: string[];
  tags: string[];
  synergy_tags: string[];
  counter_tags: string[];
  evaluation_values: Record<string, number>;
  evaluation_values_by_role?: Record<string, unknown>;
}

interface HeroMetaEntry {
  heroId: number;
  positions: { position: string; share: number }[];
}

interface PooledHeroRole {
  heroId: number;
  role: string;
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

function loadPositionsByHeroId(): Map<number, HeroMetaEntry['positions']> {
  const metaPath = path.join(__dirname, '..', 'data', 'hero-meta.json');
  if (!fs.existsSync(metaPath)) return new Map();

  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as { heroes: HeroMetaEntry[] };
  return new Map(meta.heroes.map((h) => [h.heroId, h.positions]));
}

async function seedProMatches(prisma: PrismaClient) {
  const matchesPath = path.join(__dirname, '..', 'data', 'pro-matches.json');
  if (!fs.existsSync(matchesPath)) {
    console.log(
      'No pro-matches.json found, skipping pro match seed (run `npm run fetch-pro-matches` first).',
    );
    return;
  }

  const { matches } = JSON.parse(fs.readFileSync(matchesPath, 'utf-8')) as { matches: StoredProMatch[] };

  // pro-matches.json is a full snapshot (see fetch-pro-matches*.ts), not an
  // incremental feed — drop any previously-seeded match that's no longer in
  // it (e.g. left over from a non-tier1 import before this one) rather than
  // silently accumulating stale rows forever.
  const currentIds = matches.map((m) => m.matchId);
  const { count: deletedCount } = await prisma.proMatch.deleteMany({ where: { id: { notIn: currentIds } } });
  if (deletedCount > 0) console.log(`Removed ${deletedCount} stale pro matches no longer in the snapshot.`);

  for (const match of matches) {
    await prisma.proMatch.upsert({
      where: { id: match.matchId },
      update: {
        radiantName: match.radiantName,
        direName: match.direName,
        leagueName: match.leagueName,
        radiantWin: match.radiantWin,
        radiantHeroIds: JSON.stringify(match.radiantHeroIds),
        direHeroIds: JSON.stringify(match.direHeroIds),
        radiantHeroRoles: match.radiantHeroRoles ? JSON.stringify(match.radiantHeroRoles) : null,
        direHeroRoles: match.direHeroRoles ? JSON.stringify(match.direHeroRoles) : null,
        startTime: new Date(match.startTime),
      },
      create: {
        id: match.matchId,
        radiantName: match.radiantName,
        direName: match.direName,
        leagueName: match.leagueName,
        radiantWin: match.radiantWin,
        radiantHeroIds: JSON.stringify(match.radiantHeroIds),
        direHeroIds: JSON.stringify(match.direHeroIds),
        radiantHeroRoles: match.radiantHeroRoles ? JSON.stringify(match.radiantHeroRoles) : null,
        direHeroRoles: match.direHeroRoles ? JSON.stringify(match.direHeroRoles) : null,
        startTime: new Date(match.startTime),
      },
    });
  }

  console.log(`Seeded ${matches.length} pro matches.`);
}

async function seed() {
  const prisma = new PrismaClient();
  const filePath = path.join(__dirname, '..', 'data', 'heroes.json');
  const raw: RawHero[] = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const positionsByHeroId = loadPositionsByHeroId();

  for (const hero of raw) {
    const presumedPositions = JSON.stringify(positionsByHeroId.get(hero.id) ?? []);
    const evaluationValuesByRole = JSON.stringify(hero.evaluation_values_by_role ?? {});

    await prisma.hero.upsert({
      where: { id: hero.id },
      update: {
        name: hero.name,
        primaryAttribute: hero.primary_attribute,
        attackType: hero.attack_type,
        roles: JSON.stringify(hero.roles),
        tags: JSON.stringify(hero.tags),
        synergyTags: JSON.stringify(hero.synergy_tags),
        counterTags: JSON.stringify(hero.counter_tags),
        evaluationValues: JSON.stringify(hero.evaluation_values),
        evaluationValuesByRole,
        presumedPositions,
      },
      create: {
        id: hero.id,
        name: hero.name,
        primaryAttribute: hero.primary_attribute,
        attackType: hero.attack_type,
        roles: JSON.stringify(hero.roles),
        tags: JSON.stringify(hero.tags),
        synergyTags: JSON.stringify(hero.synergy_tags),
        counterTags: JSON.stringify(hero.counter_tags),
        evaluationValues: JSON.stringify(hero.evaluation_values),
        evaluationValuesByRole,
        presumedPositions,
      },
    });
  }

  console.log(`Seeded ${raw.length} heroes.`);

  await seedProMatches(prisma);

  await prisma.$disconnect();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
