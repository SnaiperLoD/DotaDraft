import * as fs from 'fs';
import * as path from 'path';

// One-time asset fetch: pulls ability icons from the OpenDota/Steam CDN for
// future use in Draft/Battle UI (Blueprint/10-tech-debt-backlog.md), mirrors
// fetch-icons.ts's pattern for hero portraits — stored locally so the app
// runs offline afterwards (Data Rule). Reads iconUrl/abilityKey from
// hero-abilities.json (already populated by generate-hero-abilities-skeleton.ts),
// not a fresh API call, to stay in sync with whatever abilities that script
// last saw.
const HERO_ABILITIES_PATH = path.join(__dirname, '..', 'data', 'hero-abilities.json');
const CLIENT_PUBLIC = path.join(__dirname, '..', '..', 'client', 'public');
const ICONS_DIR = path.join(CLIENT_PUBLIC, 'ability-icons');
const CONSTANTS_URL = 'https://api.opendota.com/api/constants/abilities';
const CDN_BASE = 'https://cdn.cloudflare.steamstatic.com';

interface AbilityRecord {
  abilityKey: string;
  iconUrl: string | null;
}

interface HeroAbilitiesFile {
  abilities: AbilityRecord[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function downloadTo(url: string, outPath: string, retries = 3): Promise<boolean> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) return false;
      const buffer = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(outPath, buffer);
      return true;
    } catch (err) {
      if (attempt === retries) {
        console.warn(`  network error after ${retries + 1} attempt(s): ${(err as Error).message}`);
        return false;
      }
      await sleep(1500);
    }
  }
  return false;
}

async function main() {
  const heroAbilities: HeroAbilitiesFile[] = JSON.parse(fs.readFileSync(HERO_ABILITIES_PATH, 'utf-8'));

  console.log(`Fetching ability constants from ${CONSTANTS_URL}...`);
  const res = await fetch(CONSTANTS_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch ability constants: ${res.status}`);
  }
  const abilityConstants: Record<string, { img?: string }> = await res.json();

  fs.mkdirSync(ICONS_DIR, { recursive: true });

  const abilityKeys = new Set<string>();
  for (const hero of heroAbilities) {
    for (const ability of hero.abilities) {
      if (ability.iconUrl) abilityKeys.add(ability.abilityKey);
    }
  }

  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const key of abilityKeys) {
    const out = path.join(ICONS_DIR, `${key}.png`);
    if (fs.existsSync(out)) {
      skipped++;
      continue;
    }

    const imgPath = abilityConstants[key]?.img;
    if (!imgPath) {
      console.warn(`No img path for ${key}, skipping.`);
      failed++;
      continue;
    }

    const ok = await downloadTo(`${CDN_BASE}${imgPath}`, out);
    if (ok) downloaded++;
    else {
      console.warn(`Failed to download icon for ${key}`);
      failed++;
    }
  }

  console.log(`Done. Downloaded: ${downloaded}, already present: ${skipped}, failed: ${failed}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
