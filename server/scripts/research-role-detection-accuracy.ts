import * as fs from 'fs';
import * as path from 'path';

// Pre-check for Blueprint/12-next-session-priorities.md item 6 full pipeline
// (per-role axis recomputation). Before fetching per-role match data for
// every hero, checks how reliably we can label an INDIVIDUAL match's player
// as Carry/Mid/Offlane/Support (the 4-bucket PresumedPosition type, same as
// shared/types/hero.ts) rather than a hero-level aggregate.
//
// recompute-presumed-positions.ts already established the best HERO-LEVEL
// hybrid: Support share from GPM-rank (lane_role/is_roaming alone can't
// distinguish a static safe-lane support from the carry standing in the same
// lane), Carry/Mid/Offlane ratio from real lane_role data (GPM-rank alone
// flips Carry<->Mid for a chunk of the roster). This script applies the same
// hybrid idea PER MATCH instead of per hero-aggregate:
//   is_roaming = true                          -> Support
//   lane_role = 2 (mid lane)                   -> Mid
//   lane_role = 1 (safe lane), gpm_rank <= 3    -> Carry
//   lane_role = 1 (safe lane), gpm_rank > 3     -> Support (static safe-lane support)
//   lane_role = 3 (off lane),  gpm_rank <= 3    -> Offlane
//   lane_role = 3 (off lane),  gpm_rank > 3     -> Support (static off-lane support)
//   lane_role = null/other                      -> unknown
// gpm_rank is the player's team-relative gold_per_min rank (1=highest ... 5=lowest),
// same RANK() window used by research-role-fit-gpm-rank.ts. Using it only for a
// coarse top-3-vs-bottom-2 cut (not to order Carry vs Mid vs Offlane against each
// other) sidesteps the exact failure mode already documented for GPM-rank
// (Carry<->Mid confusion) — lane_role alone supplies the Carry/Mid/Offlane identity,
// GPM-rank only decides "core or support" within a lane.
//
// Accuracy proxy (no hand-labeled ground truth available): for each match side
// (5 players), a correct classification should yield exactly {Carry:1, Mid:1,
// Offlane:1, Support:2}. Reports how often that happens, plus lane_role/is_roaming
// null-rate (data coverage), as the basis for deciding whether to trust this
// per-match label for the full per-role pipeline.
const EXPLORER_URL = 'https://api.opendota.com/api/explorer';
const HEROES_PATH = path.join(__dirname, '..', 'data', 'heroes.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'research-role-detection-accuracy-output.json');

interface RawHero {
  id: number;
  name: string;
}

interface PlayerRow {
  match_id: string;
  player_slot: number;
  hero_id: number;
  lane_role: number | null;
  is_roaming: boolean | null;
  gold_per_min: number;
}

type Role = 'Carry' | 'Mid' | 'Offlane' | 'Support' | 'Unknown';

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

function classify(laneRole: number | null, isRoaming: boolean | null, gpmRank: number): Role {
  if (isRoaming) return 'Support';
  if (laneRole === 2) return 'Mid';
  if (laneRole === 1) return gpmRank <= 3 ? 'Carry' : 'Support';
  if (laneRole === 3) return gpmRank <= 3 ? 'Offlane' : 'Support';
  return 'Unknown';
}

async function main() {
  const maxRows = await explorerQuery('SELECT match_id FROM matches ORDER BY match_id DESC LIMIT 1');
  const maxMatchId = Number(maxRows[0]?.match_id ?? 8_900_000_000);

  // Narrow, recent, contiguous match_id band (not filtered by hero) so the
  // sample spans all heroes/roles at once. Start 1M below the max to avoid
  // the very newest matches, which may still be un-parsed for lane_role.
  const end = maxMatchId - 1_000_000;
  let bandSize = 150_000;
  let rows: PlayerRow[] | null = null;

  // Widen the band if too few matches landed in it, so the sample is big
  // enough to be meaningful without ever pulling more than ~20k player-rows.
  for (let attempt = 0; attempt < 4; attempt++) {
    const start = end - bandSize;
    console.log(`Fetching player_matches for match_id in [${start}, ${end}] (band=${bandSize})...`);
    rows = (await withRetry(() =>
      explorerQuery(
        `SELECT pm.match_id, pm.player_slot, pm.hero_id, pm.lane_role, pm.is_roaming, pm.gold_per_min ` +
          `FROM player_matches pm ` +
          `WHERE pm.match_id BETWEEN ${start} AND ${end}`,
      ),
    )) as PlayerRow[] | null;

    const matchCount = rows ? new Set(rows.map((r) => r.match_id)).size : 0;
    console.log(`  -> ${rows?.length ?? 0} player-rows across ${matchCount} matches.`);
    if (matchCount >= 800) break;
    bandSize *= 3;
  }

  if (!rows || rows.length === 0) {
    console.error('No data fetched — aborting.');
    process.exit(1);
  }

  const heroes: RawHero[] = JSON.parse(fs.readFileSync(HEROES_PATH, 'utf-8'));
  const heroNameById = new Map(heroes.map((h) => [h.id, h.name]));

  // Group by (match_id, side) to compute GPM rank and apply the classifier.
  const bySide = new Map<string, PlayerRow[]>();
  for (const r of rows) {
    const side = Number(r.player_slot) < 128 ? 'R' : 'D';
    const key = `${r.match_id}_${side}`;
    if (!bySide.has(key)) bySide.set(key, []);
    bySide.get(key)!.push(r);
  }

  let totalPlayers = 0;
  let laneRoleNull = 0;
  let isRoamingNull = 0;
  let incompleteSides = 0; // sides with != 5 players (parse gaps)
  let completeSides = 0;
  let cleanSides = 0; // exactly {Carry:1, Mid:1, Offlane:1, Support:2}
  let unknownAny = 0; // complete sides with at least 1 Unknown

  const distributionCounts = new Map<string, number>();
  const heroRoleCounts = new Map<number, Record<Role, number>>();
  const sampleRows: { match_id: string; side: string; roles: string[] }[] = [];

  for (const [key, players] of bySide) {
    totalPlayers += players.length;
    laneRoleNull += players.filter((p) => p.lane_role === null || p.lane_role === undefined).length;
    isRoamingNull += players.filter((p) => p.is_roaming === null || p.is_roaming === undefined).length;

    if (players.length !== 5) {
      incompleteSides++;
      continue;
    }
    completeSides++;

    const ranked = [...players].sort((a, b) => Number(b.gold_per_min) - Number(a.gold_per_min));
    const roles: Role[] = ranked.map((p, i) =>
      classify(p.lane_role === null || p.lane_role === undefined ? null : Number(p.lane_role), p.is_roaming, i + 1),
    );

    ranked.forEach((p, i) => {
      const role = roles[i];
      if (!heroRoleCounts.has(p.hero_id)) {
        heroRoleCounts.set(p.hero_id, { Carry: 0, Mid: 0, Offlane: 0, Support: 0, Unknown: 0 });
      }
      heroRoleCounts.get(p.hero_id)![role]++;
    });

    if (roles.includes('Unknown')) unknownAny++;

    const counts: Record<Role, number> = { Carry: 0, Mid: 0, Offlane: 0, Support: 0, Unknown: 0 };
    roles.forEach((r) => counts[r]++);
    const isClean = counts.Carry === 1 && counts.Mid === 1 && counts.Offlane === 1 && counts.Support === 2;
    if (isClean) cleanSides++;

    const sig = `C${counts.Carry}M${counts.Mid}O${counts.Offlane}S${counts.Support}U${counts.Unknown}`;
    distributionCounts.set(sig, (distributionCounts.get(sig) ?? 0) + 1);

    if (sampleRows.length < 15) {
      sampleRows.push({
        match_id: key.split('_')[0],
        side: key.endsWith('R') ? 'Radiant' : 'Dire',
        roles: ranked.map((p, i) => `${heroNameById.get(p.hero_id) ?? p.hero_id}=${roles[i]}`),
      });
    }
  }

  const report = {
    matchesSampled: new Set(rows.map((r) => r.match_id)).size,
    totalPlayers,
    laneRoleNullRate: Math.round((laneRoleNull / totalPlayers) * 1000) / 1000,
    isRoamingNullRate: Math.round((isRoamingNull / totalPlayers) * 1000) / 1000,
    completeSides,
    incompleteSides,
    cleanSidesRate: Math.round((cleanSides / completeSides) * 1000) / 1000,
    unknownAnyRate: Math.round((unknownAny / completeSides) * 1000) / 1000,
    distributionCounts: Object.fromEntries(
      [...distributionCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20),
    ),
    sampleRows,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(report, null, 2));

  console.log(`\n=== ROLE-DETECTION ACCURACY (proxy: clean 1/1/1/2 split per team side) ===\n`);
  console.log(`Matches sampled: ${report.matchesSampled}`);
  console.log(`Complete sides (5 players, both is_roaming+lane_role present): ${completeSides}`);
  console.log(`Incomplete sides (parse gaps, <5 players in query result): ${incompleteSides}`);
  console.log(`lane_role null rate (all players): ${(report.laneRoleNullRate * 100).toFixed(1)}%`);
  console.log(`is_roaming null rate (all players): ${(report.isRoamingNullRate * 100).toFixed(1)}%`);
  console.log(`Clean 1 Carry/1 Mid/1 Offlane/2 Support sides: ${(report.cleanSidesRate * 100).toFixed(1)}%`);
  console.log(`Sides with >=1 Unknown-role player: ${(report.unknownAnyRate * 100).toFixed(1)}%`);
  console.log(`\nTop role-count-signature distribution (C=Carry M=Mid O=Offlane S=Support U=Unknown):`);
  for (const [sig, count] of Object.entries(report.distributionCounts)) {
    console.log(`  ${sig}: ${count} (${((count / completeSides) * 100).toFixed(1)}%)`);
  }
  console.log(`\nSample classified sides:`);
  sampleRows.forEach((s) => console.log(`  [${s.match_id} ${s.side}] ${s.roles.join(', ')}`));

  console.log(`\n=== A FEW WELL-KNOWN HEROES: role distribution from this sample ===`);
  const spotCheckNames = [
    'Anti-Mage',
    'Crystal Maiden',
    'Invoker',
    'Pudge',
    'Lich',
    'Phantom Assassin',
    'Io',
    'Arc Warden',
  ];
  for (const name of spotCheckNames) {
    const hero = heroes.find((h) => h.name === name);
    if (!hero) continue;
    const counts = heroRoleCounts.get(hero.id);
    if (!counts) {
      console.log(`  ${name.padEnd(18)} — no games in this sample`);
      continue;
    }
    const total = Object.values(counts).reduce((s, v) => s + v, 0);
    const parts = (Object.keys(counts) as Role[])
      .filter((r) => counts[r] > 0)
      .map((r) => `${r}=${((counts[r] / total) * 100).toFixed(0)}%`)
      .join(' ');
    console.log(`  ${name.padEnd(18)} n=${total}  ${parts}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
