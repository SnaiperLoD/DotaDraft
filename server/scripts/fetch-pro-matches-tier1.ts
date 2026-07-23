import * as fs from 'fs';
import * as path from 'path';

// Curated tier1 import — replaces the "most recent 25 matches regardless of
// tier" approach (tracked as tech debt in Blueprint/10-tech-debt-backlog.md)
// with matches specifically between top-20 teams per Liquipedia's Dota 2
// rankings (https://liquipedia.net/dota2/Portal:Rankings, cross-checked via
// two independent fetches — the page only renders ranks 1-20 without
// interactive pagination a static fetch can't trigger, so 20 is what's
// available, not a rounding choice). team_ids resolved via OpenDota
// /api/teams (some needed fuzzy matching: Liquipedia's "PARIVISION" is
// OpenDota's "PVISION", "BetBoom Team" is "BB Team", "1w Team" is "1w").
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'pro-matches.json');
const TARGET_COUNT = 100;
const MIN_DURATION_SECONDS = 600;

const TIER1_TEAMS: { id: number; name: string }[] = [
  { id: 9824702, name: 'PVISION' },
  { id: 9823272, name: 'Team Yandex' },
  { id: 9247354, name: 'Team Falcons' },
  { id: 9467224, name: 'Aurora Gaming' },
  { id: 9131584, name: 'BB Team' },
  { id: 15, name: 'LGD Gaming' },
  { id: 7119388, name: 'Team Spirit' },
  { id: 2163, name: 'Team Liquid' },
  { id: 8291895, name: 'Tundra Esports' },
  { id: 36, name: 'Natus Vincere' },
  { id: 8261500, name: 'Xtreme Gaming' },
  { id: 7554697, name: 'Nigma Galaxy' },
  { id: 2586976, name: 'OG' },
  { id: 9338413, name: 'MOUZ' },
  { id: 10020555, name: 'PlayTime' },
  { id: 726228, name: 'Vici Gaming' },
  { id: 9964962, name: 'GamerLegion' },
  { id: 9828897, name: 'REKONIX' },
  { id: 10182357, name: '1w' },
  { id: 2576071, name: 'Yellow Submarine' },
];

interface TeamMatchRow {
  match_id: number;
  radiant_win: boolean;
  duration: number;
  start_time: number;
  league_name: string | null;
  radiant: boolean;
  opposing_team_id: number;
  opposing_team_name: string | null;
}

interface CandidateMatch {
  matchId: number;
  radiantWin: boolean;
  duration: number;
  startTime: number;
  leagueName: string | null;
  radiantName: string;
  direName: string;
}

interface PooledHeroRole {
  heroId: number;
  role: string;
}

interface StoredProMatch {
  matchId: string;
  radiantName: string | null;
  direName: string | null;
  leagueName: string | null;
  radiantWin: boolean;
  radiantHeroIds: number[];
  direHeroIds: number[];
  radiantHeroRoles: PooledHeroRole[];
  direHeroRoles: PooledHeroRole[];
  startTime: string;
}

// Same GPM-rank convention as research-role-fit-gpm-rank.ts and
// fetch-hero-meta.ts's classifyPositions: rank by gold_per_min within each
// side of the same match, 1=highest ... 5=lowest.
const RANK_TO_ROLE: Record<number, string> = {
  1: 'Carry',
  2: 'Mid',
  3: 'Offlane',
  4: 'Soft Support',
  5: 'Hard Support',
};

function rolesForSide(players: { hero_id: number; gold_per_min: number }[]): PooledHeroRole[] {
  return [...players]
    .sort((a, b) => b.gold_per_min - a.gold_per_min)
    .map((p, i) => ({ heroId: p.hero_id, role: RANK_TO_ROLE[i + 1] }));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T | null> {
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
  const tier1Ids = new Set(TIER1_TEAMS.map((t) => t.id));
  const candidates = new Map<number, CandidateMatch>();

  for (const [index, team] of TIER1_TEAMS.entries()) {
    console.log(`[${index + 1}/${TIER1_TEAMS.length}] Fetching matches for ${team.name}...`);

    const rows = await withRetry(async () => {
      const res = await fetch(`https://api.opendota.com/api/teams/${team.id}/matches`);
      if (!res.ok) throw new Error(`teams/matches HTTP ${res.status}`);
      return (await res.json()) as TeamMatchRow[];
    });

    if (!rows) continue;

    for (const row of rows) {
      if (!tier1Ids.has(row.opposing_team_id)) continue; // tier1 vs tier1 only
      if (row.duration < MIN_DURATION_SECONDS) continue;
      if (candidates.has(row.match_id)) continue; // already added from the other team's list

      const opposingName = row.opposing_team_name ?? `team_${row.opposing_team_id}`;
      candidates.set(row.match_id, {
        matchId: row.match_id,
        radiantWin: row.radiant_win,
        duration: row.duration,
        startTime: row.start_time,
        leagueName: row.league_name,
        radiantName: row.radiant ? team.name : opposingName,
        direName: row.radiant ? opposingName : team.name,
      });
    }

    await sleep(300);
  }

  console.log(`\nFound ${candidates.size} tier1-vs-tier1 matches total.`);

  const selected = [...candidates.values()].sort((a, b) => b.startTime - a.startTime).slice(0, TARGET_COUNT);
  console.log(`Selected ${selected.length} most recent (target ${TARGET_COUNT}).`);

  const results: StoredProMatch[] = [];

  for (const [index, match] of selected.entries()) {
    console.log(
      `[${index + 1}/${selected.length}] match ${match.matchId} (${match.radiantName} vs ${match.direName})`,
    );

    const detail = await withRetry(async () => {
      const res = await fetch(`https://api.opendota.com/api/matches/${match.matchId}`);
      if (!res.ok) throw new Error(`matches HTTP ${res.status}`);
      return (await res.json()) as {
        players: { hero_id: number; player_slot: number; gold_per_min: number }[];
      };
    });

    if (!detail || !Array.isArray(detail.players) || detail.players.length !== 10) {
      console.warn('  incomplete match detail, skipping');
      await sleep(300);
      continue;
    }

    const radiantPlayers = detail.players.filter((p) => p.player_slot < 128);
    const direPlayers = detail.players.filter((p) => p.player_slot >= 128);

    if (radiantPlayers.length !== 5 || direPlayers.length !== 5) {
      console.warn('  unexpected team sizes, skipping');
      await sleep(300);
      continue;
    }

    results.push({
      matchId: String(match.matchId),
      radiantName: match.radiantName,
      direName: match.direName,
      leagueName: match.leagueName,
      radiantWin: match.radiantWin,
      radiantHeroIds: radiantPlayers.map((p) => p.hero_id),
      direHeroIds: direPlayers.map((p) => p.hero_id),
      radiantHeroRoles: rolesForSide(radiantPlayers),
      direHeroRoles: rolesForSide(direPlayers),
      startTime: new Date(match.startTime * 1000).toISOString(),
    });

    await sleep(300);
  }

  const output = { generatedAt: new Date().toISOString(), matches: results };
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`\nDone. Wrote ${results.length} tier1 pro matches to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
