import * as fs from 'fs';
import * as path from 'path';

// Purchase-rate research for the "control item" families the user ranked
// (Scythe of Vyse -> Hurricane Pike). Same purchase_log pattern already
// used for Blink/BoT in research-tempo-mobility-data.ts, extended to
// multiple item families in one query per hero. Output is a supporting
// signal for curating control-item weights by hand — NOT wired into the
// control axis blend yet (see server/data/control-item-families.json for
// the family/weight map, and the conversation this came from).
//
// De-dup rule per family per match: each family is a list of "tiers"
// ordered by actual upgrade hierarchy (most-upgraded first), not by
// control-weight — a hero who bought the upgrade item in a match no
// longer "has" the base item underneath it, so only the tier they
// actually ended the match owning counts, never both.
const HEROES_PATH = path.join(__dirname, '..', 'data', 'heroes.json');
const FAMILIES_PATH = path.join(__dirname, '..', 'data', 'control-item-families.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'research-control-items-output.json');
const EXPLORER_URL = 'https://api.opendota.com/api/explorer';
const RECENT_WINDOW = 150_000_000;
const MIN_GAMES = 15;

interface RawHero {
  id: number;
  name: string;
}

interface FamilyTier {
  key: string;
  label: string;
  weight?: number;
}

interface Family {
  weight: number | null;
  tiers: FamilyTier[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function explorerQuery(sql: string): Promise<any[]> {
  const res = await fetch(`${EXPLORER_URL}?sql=${encodeURIComponent(sql)}`);
  if (!res.ok) throw new Error(`Explorer HTTP ${res.status}`);
  const json = await res.json();
  if (json.err) throw new Error(`Explorer error: ${json.err}`);
  return json.rows ?? [];
}

async function withRetry<T>(fn: () => Promise<T>, retries = 4): Promise<T | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === retries) {
        console.warn(`    failed after ${retries + 1} attempt(s): ${(err as Error).message}`);
        return null;
      }
      await sleep(2500);
    }
  }
  return null;
}

async function main() {
  const heroes: RawHero[] = JSON.parse(fs.readFileSync(HEROES_PATH, 'utf-8'));
  const families: Record<string, Family> = JSON.parse(fs.readFileSync(FAMILIES_PATH, 'utf-8'));
  const familyNames = Object.keys(families);

  // Every distinct item key across all families, for the inner per-match
  // BOOL_OR flags.
  const allItemKeys = [...new Set(familyNames.flatMap((f) => families[f].tiers.map((t) => t.key)))];
  const flagName = (key: string) => `has_${key.replace(/[^a-z0-9]/gi, '_')}`;

  const innerFlags = allItemKeys
    .map((key) => `BOOL_OR(p->>'key' = '${key}') as ${flagName(key)}`)
    .join(', ');

  // Inner query: per match, which tier (if any) of each family applies.
  // Tiers are ordered most-upgraded first in control-item-families.json,
  // so the first matching WHEN wins — a match where both the base and
  // upgrade were bought counts only the upgrade.
  const familySelects = familyNames
    .map((family) => {
      const tiers = families[family].tiers;
      const caseExpr = tiers.map((t) => `WHEN ${flagName(t.key)} THEN '${t.key}'`).join(' ');
      return `CASE ${caseExpr} ELSE NULL END as family_${family}`;
    })
    .join(', ');

  // Outer query: count matches where the family resolved to any tier.
  const outerCases = familyNames
    .map((family) => `SUM(CASE WHEN family_${family} IS NOT NULL THEN 1 ELSE 0 END) as ${family}_games`)
    .join(', ');

  const results: Record<string, unknown>[] = [];

  console.log('Fetching current match_id ceiling...');
  const maxRows = await explorerQuery('SELECT match_id FROM matches ORDER BY match_id DESC LIMIT 1');
  const maxMatchId = Number(maxRows[0]?.match_id ?? 8_900_000_000);
  const threshold = maxMatchId - RECENT_WINDOW;

  for (const [index, hero] of heroes.entries()) {
    process.stdout.write(`[${index + 1}/${heroes.length}] ${hero.name}...\r`);

    const rows = await withRetry(() =>
      explorerQuery(
        `SELECT ${outerCases}, ` +
          `(SELECT COUNT(*) FROM player_matches pmg WHERE pmg.hero_id = ${hero.id} AND pmg.match_id > ${threshold}) as games ` +
          `FROM (` +
          `  SELECT pm.match_id, ${familySelects} ` +
          `  FROM (SELECT match_id, ${innerFlags} FROM player_matches pm, unnest(pm.purchase_log) p ` +
          `    WHERE pm.hero_id = ${hero.id} AND pm.match_id > ${threshold} GROUP BY match_id) pm` +
          `) matches`,
      ),
    );

    const row = rows?.[0];
    const games = row ? Number(row.games) : 0;
    if (row && games >= MIN_GAMES) {
      const entry: Record<string, unknown> = { heroId: hero.id, name: hero.name, games };
      for (const family of familyNames) {
        const familyGames = Number(row[`${family}_games`] ?? 0);
        entry[`${family}Games`] = familyGames;
        entry[`${family}Rate`] = Math.round((familyGames / games) * 1000) / 1000;
      }
      results.push(entry);
    }

    await sleep(500);
  }

  console.log(`\n\nComputed for ${results.length}/${heroes.length} heroes (min ${MIN_GAMES} games).\n`);

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2));

  for (const family of familyNames) {
    const sorted = [...results].sort(
      (a, b) => (b[`${family}Rate`] as number) - (a[`${family}Rate`] as number),
    );
    console.log(`=== TOP 8 — ${family} ===`);
    sorted
      .slice(0, 8)
      .forEach((r) =>
        console.log(
          `  ${(r.name as string).padEnd(20)} ${((r[`${family}Rate`] as number) * 100).toFixed(1)}%, n=${r.games as number}`,
        ),
      );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
