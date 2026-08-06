import * as fs from 'fs';
import * as path from 'path';

// Follow-up probe for the per-match role-detection classifier (Blueprint/
// 12-next-session-priorities.md item 6): does ranking by CUMULATIVE GOLD AT
// THE 15-MINUTE MARK (laning-stage economy) separate Carry/Mid/Offlane/Support
// more cleanly than ranking by final-game gold_per_min (research-role-fit-
// gpm-rank.ts), which is already documented to flip Carry<->Mid for ~1/3 of
// the roster (recompute-presumed-positions.ts header) because it reflects who
// scaled/snowballed by game-end, not who was drafted into which lane.
//
// Same window-function-over-a-scoped-subquery pattern as research-role-fit-
// gpm-rank.ts and research-lane-tempo-data.ts (gold_t[16] = cumulative gold
// at minute 15, 1-indexed with index 1 = minute 0 — confirmed convention from
// research-lane-tempo-data.ts). Output is directly comparable to the existing
// research-role-fit-gpm-output.json (same RankRow shape, same RANK_TO_ROLE
// mapping) so a hero-level agreement check against real lane_role data
// (research-role-fit-output.json, the trusted source for Carry/Mid/Offlane
// per the user's own instruction) can run without refetching anything else.
const HEROES_PATH = path.join(__dirname, '..', 'data', 'heroes.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'research-role-fit-gpm15-output.json');
const GPM_FULLGAME_PATH = path.join(__dirname, '..', 'data', 'research-role-fit-gpm-output.json');
const LANE_PATH = path.join(__dirname, '..', 'data', 'research-role-fit-output.json');
const EXPLORER_URL = 'https://api.opendota.com/api/explorer';
const RECENT_WINDOW = 150_000_000;
const MIN_GAMES = 15;

const RANK_TO_ROLE: Record<number, string> = {
  1: 'Carry',
  2: 'Mid',
  3: 'Offlane',
  4: 'Soft Support',
  5: 'Hard Support',
};

type CorePosition = 'Carry' | 'Mid' | 'Offlane';
const CORE_POSITIONS: CorePosition[] = ['Carry', 'Mid', 'Offlane'];

interface RawHero {
  id: number;
  name: string;
}

interface RoleRow {
  heroId: number;
  name: string;
  role: string;
  games: number;
  wins: number;
  winRate: number;
  share: number;
}

interface LaneRow {
  heroId: number;
  name: string;
  position: string;
  games: number;
  wins: number;
  winRate: number;
  share: number;
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
  const allHeroes: RawHero[] = JSON.parse(fs.readFileSync(HEROES_PATH, 'utf-8'));

  const existing: RoleRow[] = fs.existsSync(OUTPUT_PATH)
    ? (JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf-8')) as RoleRow[])
    : [];
  const doneHeroIds = new Set(existing.map((r) => r.heroId));
  const heroes = allHeroes.filter((h) => !doneHeroIds.has(h.id));
  if (existing.length > 0) {
    console.log(`Resuming: ${doneHeroIds.size}/${allHeroes.length} heroes already in ${OUTPUT_PATH}.`);
  }

  const maxRows = await explorerQuery('SELECT match_id FROM matches ORDER BY match_id DESC LIMIT 1');
  const maxMatchId = Number(maxRows[0]?.match_id ?? 8_900_000_000);
  const threshold = maxMatchId - RECENT_WINDOW;

  const results: RoleRow[] = [...existing];

  for (const [index, hero] of heroes.entries()) {
    process.stdout.write(`[${index + 1}/${heroes.length}] ${hero.name}...\r`);

    const rows = await withRetry(() =>
      explorerQuery(
        `SELECT rank15, COUNT(*) as cnt, SUM(win) as wins ` +
          `FROM ( ` +
          `  SELECT pm.match_id, pm.hero_id, pm.player_slot, ` +
          `    (CASE WHEN (pm.player_slot < 128) = m.radiant_win THEN 1 ELSE 0 END) as win, ` +
          `    RANK() OVER (PARTITION BY pm.match_id, (pm.player_slot < 128) ORDER BY pm.gold_t[16] DESC) as rank15 ` +
          `  FROM player_matches pm ` +
          `  JOIN matches m ON pm.match_id = m.match_id ` +
          `  WHERE pm.match_id IN (SELECT match_id FROM player_matches WHERE hero_id = ${hero.id} AND match_id > ${threshold}) ` +
          `    AND array_length(pm.gold_t, 1) >= 16 ` +
          `) sub ` +
          `WHERE hero_id = ${hero.id} ` +
          `GROUP BY rank15`,
      ),
    );

    if (rows) {
      let total = 0;
      const byRank = new Map<number, { games: number; wins: number }>();
      rows.forEach((r) => {
        const rank = Number(r.rank15);
        if (rank < 1 || rank > 5) return;
        const cnt = Number(r.cnt);
        byRank.set(rank, { games: cnt, wins: Number(r.wins ?? 0) });
        total += cnt;
      });

      if (total > 0) {
        for (const [rank, { games, wins }] of byRank) {
          if (games >= MIN_GAMES) {
            results.push({
              heroId: hero.id,
              name: hero.name,
              role: RANK_TO_ROLE[rank],
              games,
              wins,
              winRate: Math.round((wins / games) * 1000) / 1000,
              share: Math.round((games / total) * 1000) / 1000,
            });
          }
        }
      }
    }

    await sleep(400);
  }

  console.log(`\n\nComputed ${results.length} (hero, role) rows (min ${MIN_GAMES} games each).\n`);
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2));

  // --- Agreement check: does 15-min gold rank pick the same dominant
  // Carry/Mid/Offlane identity as real lane_role data (trusted source), and
  // does it agree MORE or LESS often than final-game GPM rank does?
  if (!fs.existsSync(LANE_PATH) || !fs.existsSync(GPM_FULLGAME_PATH)) {
    console.log('Lane or full-game GPM reference file missing — skipping agreement comparison.');
    return;
  }
  const laneRows: LaneRow[] = JSON.parse(fs.readFileSync(LANE_PATH, 'utf-8'));
  const fullGameRows: RoleRow[] = JSON.parse(fs.readFileSync(GPM_FULLGAME_PATH, 'utf-8'));

  const dominantCore = (
    rows: { position?: string; role?: string; share: number; games: number }[],
    key: 'position' | 'role',
  ): { position: string; share: number; games: number } | null => {
    const core = rows.filter((r) => CORE_POSITIONS.includes(((r as any)[key] as CorePosition)));
    if (core.length === 0) return null;
    const top = [...core].sort((a, b) => b.share - a.share)[0];
    return { position: (top as any)[key] as string, share: top.share, games: top.games };
  };

  const laneByHero = new Map<number, LaneRow[]>();
  laneRows.forEach((r) => {
    if (!laneByHero.has(r.heroId)) laneByHero.set(r.heroId, []);
    laneByHero.get(r.heroId)!.push(r);
  });
  const fullGameByHero = new Map<number, RoleRow[]>();
  fullGameRows.forEach((r) => {
    if (!fullGameByHero.has(r.heroId)) fullGameByHero.set(r.heroId, []);
    fullGameByHero.get(r.heroId)!.push(r);
  });
  const gpm15ByHero = new Map<number, RoleRow[]>();
  results.forEach((r) => {
    if (!gpm15ByHero.has(r.heroId)) gpm15ByHero.set(r.heroId, []);
    gpm15ByHero.get(r.heroId)!.push(r);
  });

  let comparable = 0;
  let fullGameAgrees = 0;
  let gpm15Agrees = 0;
  const disagreements: { name: string; lane: string; fullGame: string | null; gpm15: string | null }[] = [];

  for (const hero of allHeroes) {
    const laneDominant = dominantCore(laneByHero.get(hero.id) ?? [], 'position');
    if (!laneDominant) continue; // no real lane-core data to compare against
    const fullGameDominant = dominantCore(fullGameByHero.get(hero.id) ?? [], 'role');
    const gpm15Dominant = dominantCore(gpm15ByHero.get(hero.id) ?? [], 'role');
    if (!fullGameDominant && !gpm15Dominant) continue;

    comparable++;
    const lanePos = laneDominant.position as string;
    const fgAgrees = fullGameDominant?.position === lanePos;
    const g15Agrees = gpm15Dominant?.position === lanePos;
    if (fgAgrees) fullGameAgrees++;
    if (g15Agrees) gpm15Agrees++;

    if (fgAgrees !== g15Agrees) {
      disagreements.push({
        name: hero.name,
        lane: lanePos,
        fullGame: fullGameDominant?.position ?? null,
        gpm15: gpm15Dominant?.position ?? null,
      });
    }
  }

  console.log(`\n=== AGREEMENT WITH REAL LANE DATA (dominant Carry/Mid/Offlane identity) ===`);
  console.log(`Heroes comparable: ${comparable}`);
  console.log(`Final-game GPM-rank agrees with lane: ${fullGameAgrees}/${comparable} (${((fullGameAgrees / comparable) * 100).toFixed(1)}%)`);
  console.log(`15-min gold-rank agrees with lane:    ${gpm15Agrees}/${comparable} (${((gpm15Agrees / comparable) * 100).toFixed(1)}%)`);
  console.log(`\nHeroes where the two GPM methods disagree with each other (one matches lane, one doesn't):`);
  disagreements.forEach((d) =>
    console.log(`  ${d.name.padEnd(20)} lane=${d.lane.padEnd(8)} fullGameGPM=${(d.fullGame ?? '-').padEnd(8)} gpm15=${d.gpm15 ?? '-'}`),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
