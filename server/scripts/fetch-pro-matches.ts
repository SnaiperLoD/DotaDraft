import * as fs from 'fs';
import * as path from 'path';

// One-time snapshot fetch of ~20-25 recent professional matches from OpenDota,
// per Blueprint/07-development-plan.md Milestone 3 (reduced from an earlier
// 100-match target — this is bootstrap/calibration data, not a standalone
// deliverable). Stored locally so the app keeps working offline afterward
// (Data Rule). Re-run manually to refresh.
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'pro-matches.json');
const TARGET_COUNT = 25;
const MIN_DURATION_SECONDS = 600; // drops remakes/no-contest matches

interface RawProMatch {
  match_id: number;
  duration: number;
  start_time: number;
  radiant_name: string | null;
  dire_name: string | null;
  leagueid: number;
  radiant_win: boolean;
}

interface RawLeague {
  leagueid: number;
  name: string;
}

interface RawMatchDetail {
  radiant_win: boolean;
  players: { hero_id: number; player_slot: number }[];
}

interface StoredProMatch {
  matchId: string;
  radiantName: string | null;
  direName: string | null;
  leagueName: string | null;
  radiantWin: boolean;
  radiantHeroIds: number[];
  direHeroIds: number[];
  startTime: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(fn: () => Promise<T>, retries = 1): Promise<T | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === retries) {
        console.warn(`    failed after ${retries + 1} attempt(s): ${(err as Error).message}`);
        return null;
      }
      await sleep(1000);
    }
  }
  return null;
}

async function main() {
  console.log('Fetching recent professional matches...');
  const proMatchesRes = await fetch('https://api.opendota.com/api/proMatches');
  if (!proMatchesRes.ok) throw new Error(`proMatches HTTP ${proMatchesRes.status}`);
  const proMatches: RawProMatch[] = await proMatchesRes.json();

  const selected = proMatches.filter((m) => m.duration >= MIN_DURATION_SECONDS).slice(0, TARGET_COUNT);
  console.log(`Selected ${selected.length} matches (min duration ${MIN_DURATION_SECONDS}s).`);

  console.log('Fetching league names...');
  const leaguesRes = await fetch('https://api.opendota.com/api/leagues');
  const leagues: RawLeague[] = leaguesRes.ok ? await leaguesRes.json() : [];
  const leagueNameById = new Map(leagues.map((l) => [l.leagueid, l.name]));

  const results: StoredProMatch[] = [];

  for (const [index, match] of selected.entries()) {
    console.log(`[${index + 1}/${selected.length}] match ${match.match_id}`);

    const detail = await withRetry(async () => {
      const res = await fetch(`https://api.opendota.com/api/matches/${match.match_id}`);
      if (!res.ok) throw new Error(`matches HTTP ${res.status}`);
      return (await res.json()) as RawMatchDetail;
    });

    if (!detail || !Array.isArray(detail.players) || detail.players.length !== 10) {
      console.warn('  incomplete match detail, skipping');
      await sleep(300);
      continue;
    }

    const radiantHeroIds = detail.players.filter((p) => p.player_slot < 128).map((p) => p.hero_id);
    const direHeroIds = detail.players.filter((p) => p.player_slot >= 128).map((p) => p.hero_id);

    if (radiantHeroIds.length !== 5 || direHeroIds.length !== 5) {
      console.warn('  unexpected team sizes, skipping');
      await sleep(300);
      continue;
    }

    results.push({
      matchId: String(match.match_id),
      radiantName: match.radiant_name,
      direName: match.dire_name,
      leagueName: leagueNameById.get(match.leagueid) ?? null,
      radiantWin: detail.radiant_win,
      radiantHeroIds,
      direHeroIds,
      startTime: new Date(match.start_time * 1000).toISOString(),
    });

    await sleep(300);
  }

  const output = { generatedAt: new Date().toISOString(), matches: results };
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`Done. Wrote ${results.length} pro matches to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
