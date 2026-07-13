import * as fs from 'fs';
import * as path from 'path';

// One-time scaffold for the future manual ability-tagging system (see
// Blueprint/10-tech-debt-backlog.md, "Будущая ось Initiating" / "Оценить
// наличие данных по силе способностей..."). Generates the empty structure
// only — categoryScores is filled in by hand later, e.g.
// { "mobility": 8 } for Anti-Mage's Blink. Safe to re-run: preserves any
// categoryScores already filled in for abilities that still exist.
const HEROES_PATH = path.join(__dirname, '..', 'data', 'heroes.json');
const HERO_CONSTANTS_PATH = path.join(__dirname, '..', 'data', 'hero-constants.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'hero-abilities.json');

interface RawHero {
  id: number;
  name: string;
}

interface HeroConstant {
  id: number;
  name: string; // internal npc_dota_hero_* name
}

interface HeroAbilitiesEntry {
  abilities: string[];
}

interface AbilityConstant {
  dname?: string;
  desc?: string;
}

interface AbilityRecord {
  abilityKey: string;
  abilityName: string;
  description: string;
  categoryScores: Record<string, number>;
}

interface HeroAbilitiesFile {
  heroId: number;
  heroName: string;
  abilities: AbilityRecord[];
}

// Non-ability entries that show up in the hero_abilities "abilities" list.
const SKIP_KEYS = new Set(['generic_hidden']);

async function main() {
  const heroes: RawHero[] = JSON.parse(fs.readFileSync(HEROES_PATH, 'utf-8'));
  const constantsRaw: Record<string, HeroConstant> = JSON.parse(
    fs.readFileSync(HERO_CONSTANTS_PATH, 'utf-8'),
  );
  const internalNameByHeroId = new Map(Object.values(constantsRaw).map((c) => [c.id, c.name]));

  console.log('Fetching hero_abilities and abilities constants...');
  const [heroAbilitiesRes, abilitiesRes] = await Promise.all([
    fetch('https://api.opendota.com/api/constants/hero_abilities'),
    fetch('https://api.opendota.com/api/constants/abilities'),
  ]);
  const heroAbilities: Record<string, HeroAbilitiesEntry> = await heroAbilitiesRes.json();
  const abilityConstants: Record<string, AbilityConstant> = await abilitiesRes.json();

  const existing: HeroAbilitiesFile[] = fs.existsSync(OUTPUT_PATH)
    ? JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf-8'))
    : [];
  const existingScoresByKey = new Map<string, Record<string, number>>();
  for (const entry of existing) {
    for (const ability of entry.abilities) {
      existingScoresByKey.set(`${entry.heroId}:${ability.abilityKey}`, ability.categoryScores);
    }
  }

  const result: HeroAbilitiesFile[] = [];
  let missingHeroes = 0;

  for (const hero of heroes) {
    const internalName = internalNameByHeroId.get(hero.id);
    const entry = internalName ? heroAbilities[internalName] : undefined;
    if (!entry) {
      missingHeroes++;
      result.push({ heroId: hero.id, heroName: hero.name, abilities: [] });
      continue;
    }

    const abilities: AbilityRecord[] = entry.abilities
      .filter((key) => !SKIP_KEYS.has(key))
      .map((key) => {
        const constant = abilityConstants[key];
        return {
          abilityKey: key,
          abilityName: constant?.dname ?? key,
          description: constant?.desc ?? '',
          categoryScores: existingScoresByKey.get(`${hero.id}:${key}`) ?? {},
        };
      });

    result.push({ heroId: hero.id, heroName: hero.name, abilities });
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2) + '\n');
  console.log(`Wrote skeleton for ${result.length} heroes to ${OUTPUT_PATH}.`);
  if (missingHeroes > 0)
    console.warn(`  ${missingHeroes} heroes had no hero_abilities entry (left with empty abilities[]).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
