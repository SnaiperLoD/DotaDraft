import * as fs from 'fs';
import * as path from 'path';

// Replaces hero-meta.json's `positions` with a HYBRID of two real-data
// sources, each used for what it's actually good at (Blueprint/10-tech-debt-
// backlog.md, "GPM-rank классификация Mid/Carry — подтверждено, системный
// паттерн"):
//   - Support share comes from GPM-rank (research-role-fit-gpm-rank.ts) —
//     this is what GPM-rank replaced lane_role/is_roaming FOR in the first
//     place (the old method couldn't tell a hard support standing static in
//     the safe lane from the actual carry in that lane).
//   - Carry/Mid/Offlane shares come from real lane_role data
//     (research-role-fit-data.ts) instead of GPM-rank — GPM-rank measures
//     farm priority, not lane, and a system-wide comparison found 11/127
//     heroes with an outright Carry<->Mid flip and 42/127 with a spurious
//     phantom core position (Arc Warden 100% "Carry" by GPM-rank despite
//     playing Mid 84% of the time by real lane; Drow Ranger 26% "Mid" by
//     GPM-rank despite 0% by real lane).
//
// The two signals are combined by renormalizing: lane_role's own Carry
// bucket also isn't trustworthy on its own (is_roaming only catches heroes
// who ACTIVELY roam, not ones standing static in the safe lane playing
// support — the exact problem GPM-rank was introduced to fix) — so lane
// data is used ONLY for the relative Carry:Mid:Offlane ratio AMONG THOSE
// THREE, and that ratio is scaled to fill the (1 - supportShare) remainder
// after GPM-rank's Support share is taken out. A hero GPM-rank already
// calls ~100% Support (Crystal Maiden, Lich, ...) ends up ~100% Support
// here too, regardless of what lane_role's Carry bucket says about them.
const HERO_META_PATH = path.join(__dirname, '..', 'data', 'hero-meta.json');
const GPM_PATH = path.join(__dirname, '..', 'data', 'research-role-fit-gpm-output.json');
const LANE_PATH = path.join(__dirname, '..', 'data', 'research-role-fit-output.json');
const SHARE_THRESHOLD = 0.25;

// Templar Assassin Mid: see apply-role-classification.ts. Keep the same
// overlay so this script doesn't wipe the one-hero exception.
const POSITION_OVERRIDES: Record<number, { position: Position; share: number }[]> = {
  46: [
    { position: 'Carry', share: 0.759 },
    { position: 'Mid', share: 0.216 },
  ],
};

type Position = 'Carry' | 'Mid' | 'Offlane' | 'Support';
type CorePosition = 'Carry' | 'Mid' | 'Offlane';

interface GpmRow {
  heroId: number;
  name: string;
  role: 'Carry' | 'Mid' | 'Offlane' | 'Soft Support' | 'Hard Support';
  games: number;
  wins: number;
  winRate: number;
  share: number;
}

interface LaneRow {
  heroId: number;
  name: string;
  position: Position;
  games: number;
  wins: number;
  winRate: number;
  share: number;
}

interface HeroMetaEntry {
  heroId: number;
  positions: { position: Position; share: number }[];
  [key: string]: unknown;
}

const GPM_ROLE_TO_BUCKET: Record<GpmRow['role'], Position> = {
  Carry: 'Carry',
  Mid: 'Mid',
  Offlane: 'Offlane',
  'Soft Support': 'Support',
  'Hard Support': 'Support',
};

const CORE_POSITIONS: CorePosition[] = ['Carry', 'Mid', 'Offlane'];

function main() {
  const gpmRows: GpmRow[] = JSON.parse(fs.readFileSync(GPM_PATH, 'utf-8'));
  const laneRows: LaneRow[] = JSON.parse(fs.readFileSync(LANE_PATH, 'utf-8'));
  const meta: { heroes: HeroMetaEntry[] } = JSON.parse(fs.readFileSync(HERO_META_PATH, 'utf-8'));

  const gpmByHero = new Map<number, GpmRow[]>();
  for (const row of gpmRows) {
    if (!gpmByHero.has(row.heroId)) gpmByHero.set(row.heroId, []);
    gpmByHero.get(row.heroId)!.push(row);
  }

  const laneByHero = new Map<number, LaneRow[]>();
  for (const row of laneRows) {
    if (!laneByHero.has(row.heroId)) laneByHero.set(row.heroId, []);
    laneByHero.get(row.heroId)!.push(row);
  }

  let updated = 0;
  let noGpmData = 0;
  let noLaneData = 0;

  for (const hero of meta.heroes) {
    const gRows = gpmByHero.get(hero.heroId);
    if (!gRows || gRows.length === 0) {
      noGpmData++;
      continue;
    }

    const gpmGames: Record<Position, number> = { Carry: 0, Mid: 0, Offlane: 0, Support: 0 };
    let gpmTotal = 0;
    for (const row of gRows) {
      gpmGames[GPM_ROLE_TO_BUCKET[row.role]] += row.games;
      gpmTotal += row.games;
    }
    const supportShare = gpmTotal > 0 ? gpmGames.Support / gpmTotal : 0;

    const lRows = (laneByHero.get(hero.heroId) ?? []).filter((r) => CORE_POSITIONS.includes(r.position as CorePosition));
    const laneCoreTotal = lRows.reduce((sum, r) => sum + r.games, 0);

    const positions: { position: Position; share: number }[] = [
      { position: 'Support', share: supportShare },
    ];

    if (laneCoreTotal > 0) {
      const remainder = 1 - supportShare;
      for (const pos of CORE_POSITIONS) {
        const laneGames = lRows.find((r) => r.position === pos)?.games ?? 0;
        positions.push({ position: pos, share: (laneGames / laneCoreTotal) * remainder });
      }
    } else {
      // No real lane data for this hero's core games — fall back to
      // GPM-rank's own Carry/Mid/Offlane split rather than leaving them at
      // 0 (better than nothing, same as the old pure-GPM behavior).
      noLaneData++;
      for (const pos of CORE_POSITIONS) {
        positions.push({ position: pos, share: gpmTotal > 0 ? gpmGames[pos] / gpmTotal : 0 });
      }
    }

    hero.positions = positions
      .map((p) => ({ position: p.position, share: Math.round(p.share * 1000) / 1000 }))
      .filter((p) => p.share >= SHARE_THRESHOLD)
      .sort((a, b) => b.share - a.share);
    const override = POSITION_OVERRIDES[hero.heroId];
    if (override) hero.positions = override;
    updated++;
  }

  fs.writeFileSync(HERO_META_PATH, JSON.stringify(meta, null, 2) + '\n');
  console.log(`Recomputed positions for ${updated} heroes (Support from GPM-rank, Carry/Mid/Offlane from real lane data).`);
  if (noGpmData > 0) {
    console.warn(`  ${noGpmData} heroes had no GPM-rank data at all — left untouched.`);
  }
  if (noLaneData > 0) {
    console.warn(`  ${noLaneData} heroes had no real lane data — fell back to GPM-rank's own Carry/Mid/Offlane split for them.`);
  }
}

main();
