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
}

async function seed() {
  const prisma = new PrismaClient();
  const filePath = path.join(__dirname, '..', 'data', 'heroes.json');
  const raw: RawHero[] = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

  for (const hero of raw) {
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
      },
    });
  }

  // eslint-disable-next-line no-console
  console.log(`Seeded ${raw.length} heroes.`);
  await prisma.$disconnect();
}

seed().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
