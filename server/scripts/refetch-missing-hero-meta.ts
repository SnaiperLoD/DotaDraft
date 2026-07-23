import * as fs from 'fs';
import * as path from 'path';

// Scoped re-fetch for the 29 heroes whose hero-meta.json entry came back
// with empty synergy/matchups/benchmarks from the original fetch-hero-meta
// run (positions/winRate for these heroes are fine — only the three
// per-hero network calls beyond that came back empty, likely a transient
// OpenDota hiccup during that run, not a code bug: same fetch logic,
// same call shape as fetch-hero-meta.ts, just re-run for fewer heroes so
// it isn't a full 127-hero re-fetch for a 29-hero gap). Merges into the
// existing hero-meta.json, replacing only these 29 entries.
const HEROES_PATH = path.join(__dirname, '..', 'data', 'heroes.json');
const META_PATH = path.join(__dirname, '..', 'data', 'hero-meta.json');
const EXPLORER_URL = 'https://api.opendota.com/api/explorer';

const MISSING_HERO_NAMES = [
  'Lina', 'Lion', 'Wraith King', 'Death Prophet', 'Phantom Assassin', 'Pugna',
  'Templar Assassin', 'Viper', 'Luna', 'Dragon Knight', 'Dazzle', 'Clockwerk',
  'Spectre', 'Ancient Apparition', 'Doom', 'Ursa', 'Spirit Breaker', 'Gyrocopter',
  'Alchemist', 'Invoker', 'Silencer', 'Outworld Destroyer', 'Lycan', 'Slark',
  'Medusa', 'Phoenix', 'Oracle', 'Winter Wyvern', 'Largo',
];

interface RawHero {
  id: number;
  name: string;
}

interface HeroMetaEntry {
  heroId: number;
  positions: { position: string; share: number }[];
  winRate: number | null;
  synergy: { allyHeroId: number; games: number; wins: number }[];
  matchups: { opponentHeroId: number; games: number; wins: number }[];
  benchmarks: unknown;
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

async function withRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === retries) {
        console.warn(`    failed after ${retries + 1} attempt(s): ${(err as Error).message}`);
        return null;
      }
      await sleep(1500);
    }
  }
  return null;
}

async function main() {
  const heroes: RawHero[] = JSON.parse(fs.readFileSync(HEROES_PATH, 'utf-8'));
  const targets = heroes.filter((h) => MISSING_HERO_NAMES.includes(h.name));
  if (targets.length !== MISSING_HERO_NAMES.length) {
    const found = new Set(targets.map((t) => t.name));
    console.warn('Name mismatch, missing:', MISSING_HERO_NAMES.filter((n) => !found.has(n)));
  }

  const existing: { generatedAt: string; recentMatchIdThreshold: number; heroes: HeroMetaEntry[] } =
    JSON.parse(fs.readFileSync(META_PATH, 'utf-8'));
  const threshold = existing.recentMatchIdThreshold;

  const updated = new Map(existing.heroes.map((h) => [h.heroId, h]));

  for (const [index, hero] of targets.entries()) {
    console.log(`[${index + 1}/${targets.length}] ${hero.name} (id ${hero.id})`);

    const synergyRows = await withRetry(() =>
      explorerQuery(
        `SELECT b.hero_id as ally_hero_id, COUNT(*) as games, SUM(CASE WHEN (a.player_slot < 128) = m.radiant_win THEN 1 ELSE 0 END) as wins FROM player_matches a JOIN player_matches b ON a.match_id = b.match_id AND ((a.player_slot < 128) = (b.player_slot < 128)) AND a.hero_id != b.hero_id JOIN matches m ON a.match_id = m.match_id WHERE a.hero_id = ${hero.id} AND a.match_id > ${threshold} GROUP BY b.hero_id ORDER BY games DESC LIMIT 15`,
      ),
    );
    const synergy = (synergyRows ?? [])
      .map((r) => ({ allyHeroId: Number(r.ally_hero_id), games: Number(r.games), wins: Number(r.wins) }))
      .filter((r) => r.games >= 5);

    await sleep(400);

    const matchupsRes = await withRetry(async () => {
      const res = await fetch(`https://api.opendota.com/api/heroes/${hero.id}/matchups`);
      if (!res.ok) throw new Error(`matchups HTTP ${res.status}`);
      return res.json();
    });
    const matchups = ((matchupsRes as any[]) ?? []).map((m) => ({
      opponentHeroId: m.hero_id,
      games: m.games_played,
      wins: m.wins,
    }));

    await sleep(400);

    const benchmarksRes = await withRetry(async () => {
      const res = await fetch(`https://api.opendota.com/api/benchmarks?hero_id=${hero.id}`);
      if (!res.ok) throw new Error(`benchmarks HTTP ${res.status}`);
      return res.json();
    });
    const benchmarks = benchmarksRes?.result ?? null;

    const prior = updated.get(hero.id);
    updated.set(hero.id, {
      heroId: hero.id,
      positions: prior?.positions ?? [],
      winRate: prior?.winRate ?? null,
      synergy,
      matchups,
      benchmarks,
    });

    const benchmarkKeys = benchmarks ? Object.keys(benchmarks as object).length : 0;
    console.log(`  synergy=${synergy.length} matchups=${matchups.length} benchmarkStats=${benchmarkKeys}`);

    await sleep(300);
  }

  const output = {
    generatedAt: existing.generatedAt,
    recentMatchIdThreshold: threshold,
    heroes: heroes.map((h) => updated.get(h.id)!),
  };

  fs.writeFileSync(META_PATH, JSON.stringify(output, null, 2));
  console.log(`\nDone. Updated ${targets.length} hero-meta entries in ${META_PATH}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
