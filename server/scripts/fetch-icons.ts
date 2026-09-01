import * as fs from 'fs';
import * as path from 'path';

// One-time asset fetch: pulls hero icons (small, used in the picked-heroes
// strip) and full portrait art (used on draft/role-assignment cards) from the
// OpenDota/Steam CDN, storing them locally so the app runs offline afterwards
// (Blueprint/01-core-rules.md Data Rule). The portrait URL is derived from the
// already-verified `icon` path rather than guessed, since hero internal slugs
// are irregular (e.g. Ring Master -> "ringmaster", not "ring_master").
const HEROES_PATH = path.join(__dirname, '..', 'data', 'heroes.json');
const CLIENT_PUBLIC = path.join(__dirname, '..', '..', 'client', 'public');
const ICONS_DIR = path.join(CLIENT_PUBLIC, 'icons');
const PORTRAITS_DIR = path.join(CLIENT_PUBLIC, 'portraits');
const SPLASH_DIR = path.join(CLIENT_PUBLIC, 'heroes');
const CONSTANTS_URL = 'https://api.opendota.com/api/constants/heroes';
const CDN_BASE = 'https://cdn.cloudflare.steamstatic.com';

interface RawHero {
  id: number;
  name: string;
}

interface OpenDotaHeroConstant {
  id: number;
  icon: string;
  localized_name: string;
}

async function downloadTo(url: string, outPath: string): Promise<boolean> {
  const res = await fetch(url);
  if (!res.ok) return false;
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outPath, buffer);
  return true;
}

async function main() {
  const heroes: RawHero[] = JSON.parse(fs.readFileSync(HEROES_PATH, 'utf-8'));

  console.log(`Fetching hero constants from ${CONSTANTS_URL}...`);
  const res = await fetch(CONSTANTS_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch hero constants: ${res.status}`);
  }
  const constants: Record<string, OpenDotaHeroConstant> = await res.json();

  fs.mkdirSync(ICONS_DIR, { recursive: true });
  fs.mkdirSync(PORTRAITS_DIR, { recursive: true });
  fs.mkdirSync(SPLASH_DIR, { recursive: true });

  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const hero of heroes) {
    const iconOut = path.join(ICONS_DIR, `${hero.id}.png`);
    const portraitOut = path.join(PORTRAITS_DIR, `${hero.id}.png`);
    const splashOut = path.join(SPLASH_DIR, `${hero.id}.png`);

    const constant = constants[String(hero.id)];
    if (!constant) {
      console.warn(`No OpenDota constant for hero id ${hero.id} (${hero.name}), skipping.`);
      failed++;
      continue;
    }

    const iconPath = constant.icon.replace(/\?$/, '');
    const portraitPath = iconPath.replace('/icons/', '/crops/');
    const splashPath = iconPath.replace('/heroes/icons/', '/heroes/');

    if (!fs.existsSync(iconOut)) {
      const ok = await downloadTo(`${CDN_BASE}${iconPath}`, iconOut);
      if (ok) downloaded++;
      else {
        console.warn(`Failed to download icon for ${hero.name}`);
        failed++;
      }
    } else {
      skipped++;
    }

    if (!fs.existsSync(portraitOut)) {
      const ok = await downloadTo(`${CDN_BASE}${portraitPath}`, portraitOut);
      if (ok) downloaded++;
      else {
        console.warn(`Failed to download portrait for ${hero.name} (${portraitPath})`);
        failed++;
      }
    } else {
      skipped++;
    }

    if (!fs.existsSync(splashOut)) {
      const ok = await downloadTo(`${CDN_BASE}${splashPath}`, splashOut);
      if (ok) downloaded++;
      else {
        console.warn(`Failed to download splash for ${hero.name} (${splashPath})`);
        failed++;
      }
    } else {
      skipped++;
    }
  }

  console.log(`Done. Downloaded: ${downloaded}, already present: ${skipped}, failed: ${failed}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
