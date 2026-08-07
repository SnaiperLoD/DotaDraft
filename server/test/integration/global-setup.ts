import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { TEST_DATABASE_URL, TEST_DB_PATH } from './test-db-env';

// Runs once before the whole integration suite (Jest globalSetup runs in the
// main process, before test-file workers fork, so DATABASE_URL set here is
// inherited by them). Pushes the real schema and seeds the real hero
// dataset into a throwaway SQLite file — integration tests should exercise
// the same data shape the app actually ships, not a hand-rolled fixture.
export default async function globalSetup(): Promise<void> {
  for (const suffix of ['', '-journal']) {
    const file = TEST_DB_PATH + suffix;
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }

  execSync('npx prisma db push --skip-generate --schema=prisma/schema.prisma', {
    cwd: path.resolve(__dirname, '../..'),
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'inherit',
  });

  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient({ datasourceUrl: TEST_DATABASE_URL });

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

  const heroesPath = path.resolve(__dirname, '../../data/heroes.json');
  const raw: RawHero[] = JSON.parse(fs.readFileSync(heroesPath, 'utf-8'));

  for (const hero of raw) {
    await prisma.hero.create({
      data: {
        id: hero.id,
        name: hero.name,
        primaryAttribute: hero.primary_attribute,
        attackType: hero.attack_type,
        roles: JSON.stringify(hero.roles),
        tags: JSON.stringify(hero.tags),
        synergyTags: JSON.stringify(hero.synergy_tags),
        counterTags: JSON.stringify(hero.counter_tags),
        evaluationValues: JSON.stringify(hero.evaluation_values),
        evaluationValuesByRole: JSON.stringify(hero.evaluation_values_by_role ?? {}),
        presumedPositions: '[]',
      },
    });
  }

  await prisma.$disconnect();
}
