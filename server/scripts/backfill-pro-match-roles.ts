import * as fs from 'fs';
import * as path from 'path';

// Backfills radiantHeroRoles/direHeroRoles onto the existing pro-matches.json
// snapshot (Blueprint/10-tech-debt-backlog.md, "Role-fit in Battle Engine" —
// user explicitly asked for pro-match compositions to carry role data too,
// same as player drafts). Re-fetches only /api/matches/{id} per already-
// selected match (not the team-discovery phase in fetch-pro-matches-tier1.ts)
// so the curated 100-match set stays exactly as-is; only adds role data.
//
// Same GPM-rank convention as research-role-fit-gpm-rank.ts and
// fetch-hero-meta.ts's classifyPositions: rank by gold_per_min within each
// side (radiant/dire) of the SAME match — 1=highest GPM ... 5=lowest GPM
// maps to Carry/Mid/Offlane/Soft Support/Hard Support.
const DATA_PATH = path.join(__dirname, '..', 'data', 'pro-matches.json');

const RANK_TO_ROLE: Record<number, string> = {
  1: 'Carry',
  2: 'Mid',
  3: 'Offlane',
  4: 'Soft Support',
  5: 'Hard Support',
};

interface PooledHeroRole {
  heroId: number;
  role: string;
  // Blueprint/10-tech-debt-backlog.md, "Имена про-игроков под портретами
  // героев в Battle" — same /api/matches/{id} response this script already
  // fetches for gold_per_min, personaname/name just weren't extracted
  // before. null when a pro player has hidden their profile (personaname
  // AND name both absent) rather than a fetch failure.
  playerName?: string | null;
}

interface StoredProMatch {
  matchId: string;
  radiantName: string | null;
  direName: string | null;
  leagueName: string | null;
  radiantWin: boolean;
  radiantHeroIds: number[];
  direHeroIds: number[];
  radiantHeroRoles?: PooledHeroRole[];
  direHeroRoles?: PooledHeroRole[];
  startTime: string;
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

function rolesForSide(
  players: { hero_id: number; gold_per_min: number; personaname?: string | null; name?: string | null }[],
): PooledHeroRole[] {
  return [...players]
    .sort((a, b) => b.gold_per_min - a.gold_per_min)
    .map((p, i) => ({
      heroId: p.hero_id,
      role: RANK_TO_ROLE[i + 1],
      playerName: p.personaname ?? p.name ?? null,
    }));
}

async function main() {
  const { generatedAt, matches } = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8')) as {
    generatedAt: string;
    matches: StoredProMatch[];
  };

  for (const [index, match] of matches.entries()) {
    console.log(`[${index + 1}/${matches.length}] match ${match.matchId}`);

    const detail = await withRetry(async () => {
      const res = await fetch(`https://api.opendota.com/api/matches/${match.matchId}`);
      if (!res.ok) throw new Error(`matches HTTP ${res.status}`);
      return (await res.json()) as {
        players: {
          hero_id: number;
          player_slot: number;
          gold_per_min: number;
          personaname?: string | null;
          name?: string | null;
        }[];
      };
    });

    if (!detail || !Array.isArray(detail.players) || detail.players.length !== 10) {
      console.warn('  incomplete match detail, skipping (keeping match without roles)');
      await sleep(300);
      continue;
    }

    const radiantPlayers = detail.players.filter((p) => p.player_slot < 128);
    const direPlayers = detail.players.filter((p) => p.player_slot >= 128);

    if (radiantPlayers.length !== 5 || direPlayers.length !== 5) {
      console.warn('  unexpected team sizes, skipping (keeping match without roles)');
      await sleep(300);
      continue;
    }

    match.radiantHeroRoles = rolesForSide(radiantPlayers);
    match.direHeroRoles = rolesForSide(direPlayers);

    await sleep(300);
  }

  fs.writeFileSync(DATA_PATH, JSON.stringify({ generatedAt, matches }, null, 2));
  const withRoles = matches.filter((m) => m.radiantHeroRoles && m.direHeroRoles).length;
  console.log(`\nDone. ${withRoles}/${matches.length} matches now have role data.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
