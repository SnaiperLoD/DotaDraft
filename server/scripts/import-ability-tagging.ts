import * as fs from 'fs';
import * as path from 'path';

// Reads server/data/ability-tagging.csv (edited by hand in a spreadsheet)
// back into hero-abilities.json's categoryScores. Blank cells are left
// untouched (not treated as "clear this score") — re-running after only
// partially tagging a category is safe. See export-ability-tagging.ts.
const HERO_ABILITIES_PATH = path.join(__dirname, '..', 'data', 'hero-abilities.json');
const INPUT_PATH = path.join(__dirname, '..', 'data', 'ability-tagging.csv');

const CATEGORIES = ['mobility', 'saving', 'initiating', 'control_strength', 'damage_mitigation'] as const;

interface AbilityRecord {
  abilityKey: string;
  categoryScores: Record<string, number>;
  [key: string]: unknown;
}

interface HeroAbilitiesFile {
  heroId: number;
  heroName: string;
  abilities: AbilityRecord[];
}

// Minimal RFC4180-ish CSV line parser: handles quoted fields containing
// commas and escaped ("") quotes. Good enough for the well-formed output
// Excel/Sheets produces — not a general-purpose CSV library.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c === '\r') {
      // skip, \n handles the line break
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function main() {
  if (!fs.existsSync(INPUT_PATH)) {
    console.error(`${INPUT_PATH} not found. Run "npm run export-ability-tagging" first.`);
    process.exit(1);
  }

  const heroes: HeroAbilitiesFile[] = JSON.parse(fs.readFileSync(HERO_ABILITIES_PATH, 'utf-8'));
  const abilityByKey = new Map<string, AbilityRecord>();
  for (const hero of heroes) {
    for (const ability of hero.abilities) {
      abilityByKey.set(ability.abilityKey, ability);
    }
  }

  const csv = fs.readFileSync(INPUT_PATH, 'utf-8');
  const [header, ...dataRows] = parseCsv(csv).filter((r) => r.length > 1 || r[0] !== '');
  const colIndex = new Map(header.map((name, i) => [name, i]));
  const abilityKeyCol = colIndex.get('abilityKey');
  if (abilityKeyCol === undefined) {
    console.error('CSV is missing an "abilityKey" column — is this the right file?');
    process.exit(1);
  }

  const counts: Record<string, number> = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  let notFound = 0;
  let invalid = 0;

  for (const row of dataRows) {
    const abilityKey = row[abilityKeyCol];
    if (!abilityKey) continue;
    const ability = abilityByKey.get(abilityKey);
    if (!ability) {
      notFound++;
      console.warn(`  unknown abilityKey "${abilityKey}" (row skipped — ability may have been removed upstream)`);
      continue;
    }

    for (const cat of CATEGORIES) {
      const col = colIndex.get(cat);
      if (col === undefined) continue;
      const raw = (row[col] ?? '').trim();
      if (raw === '') continue; // blank = still untagged, don't touch existing value

      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0 || value > 10) {
        invalid++;
        console.warn(`  invalid ${cat} value "${raw}" for ${abilityKey} (must be 0-10, skipped)`);
        continue;
      }
      ability.categoryScores[cat] = Math.round(value * 10) / 10;
      counts[cat]++;
    }
  }

  fs.writeFileSync(HERO_ABILITIES_PATH, JSON.stringify(heroes, null, 2) + '\n');

  console.log(`Imported into ${HERO_ABILITIES_PATH}:`);
  CATEGORIES.forEach((cat) => console.log(`  ${cat}: ${counts[cat]} scores set`));
  if (notFound > 0) console.warn(`  ${notFound} rows had an unrecognized abilityKey (skipped).`);
  if (invalid > 0) console.warn(`  ${invalid} cells had an out-of-range/non-numeric value (skipped).`);
}

main();
