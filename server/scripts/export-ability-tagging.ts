import * as fs from 'fs';
import * as path from 'path';

// Exports hero-abilities.json to a CSV for manual tagging in a spreadsheet
// (Excel/Google Sheets) instead of hand-editing 788 JSON records directly.
// Round-trips with import-ability-tagging.ts. See
// Blueprint/10-tech-debt-backlog.md, "hero-abilities.json".
const HERO_ABILITIES_PATH = path.join(__dirname, '..', 'data', 'hero-abilities.json');
const CANDIDATES_PATH = path.join(__dirname, '..', 'data', 'ability-category-candidates.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'ability-tagging.csv');

// Categories currently tracked. Extend this list (and the matching column
// pair below) when Initiating is ready to be tagged too.
const CATEGORIES = ['mobility', 'saving'] as const;

interface AbilityRecord {
  abilityKey: string;
  abilityName: string;
  description: string;
  behavior?: string | string[] | null;
  cooldown?: string[] | null;
  manaCost?: string[] | null;
  categoryScores: Record<string, number>;
}

interface HeroAbilitiesFile {
  heroId: number;
  heroName: string;
  abilities: AbilityRecord[];
}

interface CandidateEntry {
  abilityKey: string;
}

function csvField(value: string | number | null | undefined): string {
  const str = value === null || value === undefined ? '' : String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function joinArray(value: string[] | null | undefined): string {
  return Array.isArray(value) ? value.join('/') : '';
}

function main() {
  const heroes: HeroAbilitiesFile[] = JSON.parse(fs.readFileSync(HERO_ABILITIES_PATH, 'utf-8'));
  const candidates: Record<string, CandidateEntry[]> = fs.existsSync(CANDIDATES_PATH)
    ? JSON.parse(fs.readFileSync(CANDIDATES_PATH, 'utf-8'))
    : {};
  const candidateKeysByCategory = new Map<string, Set<string>>(
    CATEGORIES.map((cat) => [cat, new Set((candidates[cat] ?? []).map((c) => c.abilityKey))]),
  );

  const header = [
    'heroId',
    'heroName',
    'abilityKey',
    'abilityName',
    'description',
    'behavior',
    'cooldown',
    'manaCost',
    ...CATEGORIES.flatMap((cat) => [`${cat}_candidate`, cat]),
  ];

  const rows: string[] = [header.join(',')];
  let abilityCount = 0;

  for (const hero of heroes) {
    for (const ability of hero.abilities) {
      abilityCount++;
      const row = [
        String(hero.heroId),
        hero.heroName,
        ability.abilityKey,
        ability.abilityName,
        ability.description,
        Array.isArray(ability.behavior) ? ability.behavior.join('/') : (ability.behavior ?? ''),
        joinArray(ability.cooldown),
        joinArray(ability.manaCost),
        ...CATEGORIES.flatMap((cat) => [
          candidateKeysByCategory.get(cat)?.has(ability.abilityKey) ? 'TRUE' : '',
          ability.categoryScores[cat] !== undefined ? String(ability.categoryScores[cat]) : '',
        ]),
      ];
      rows.push(row.map(csvField).join(','));
    }
  }

  fs.writeFileSync(OUTPUT_PATH, rows.join('\n') + '\n', 'utf-8');
  console.log(`Wrote ${abilityCount} abilities to ${OUTPUT_PATH}.`);
  console.log(`Columns to fill by hand: ${CATEGORIES.join(', ')} (0-10, leave blank if untagged).`);
  console.log(`*_candidate columns are TRUE for the keyword-filter's suggestions (server/scripts/suggest-ability-categories.ts) — a starting point, not the full list.`);
}

main();
