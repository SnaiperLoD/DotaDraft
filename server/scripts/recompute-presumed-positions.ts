import * as fs from 'fs';
import * as path from 'path';

// Replaces hero-meta.json's `positions` (lane_role/is_roaming-based,
// classifyPositions() in fetch-hero-meta.ts) with the GPM-rank-based
// classification from research-role-fit-gpm-rank.ts, already fetched last
// session (server/data/research-role-fit-gpm-output.json). The old method
// couldn't tell a hard support standing static in the safe lane from the
// actual carry in that lane — Chen/Venomancer/Jakiro (and likely others)
// came back "mostly Carry" as a result, which used to be a quiet
// calibration footnote but became a visibly wrong role-tint color once the
// UI redesign made presumed_positions load-bearing for hero card colors.
//
// GPM rank gives 5 roles (Carry/Mid/Offlane/Soft Support/Hard Support);
// this collapses Soft+Hard Support into the single "Support" bucket
// presumed_positions/heroRoleColor.ts expects, using the same >=25% share
// threshold and sort order as the original classifyPositions().
const HERO_META_PATH = path.join(__dirname, '..', 'data', 'hero-meta.json');
const GPM_PATH = path.join(__dirname, '..', 'data', 'research-role-fit-gpm-output.json');
const SHARE_THRESHOLD = 0.25;

type Position = 'Carry' | 'Mid' | 'Offlane' | 'Support';

interface GpmRow {
  heroId: number;
  name: string;
  role: 'Carry' | 'Mid' | 'Offlane' | 'Soft Support' | 'Hard Support';
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

const ROLE_TO_BUCKET: Record<GpmRow['role'], Position> = {
  Carry: 'Carry',
  Mid: 'Mid',
  Offlane: 'Offlane',
  'Soft Support': 'Support',
  'Hard Support': 'Support',
};

function main() {
  const gpmRows: GpmRow[] = JSON.parse(fs.readFileSync(GPM_PATH, 'utf-8'));
  const meta: { heroes: HeroMetaEntry[] } = JSON.parse(fs.readFileSync(HERO_META_PATH, 'utf-8'));

  const rowsByHero = new Map<number, GpmRow[]>();
  for (const row of gpmRows) {
    if (!rowsByHero.has(row.heroId)) rowsByHero.set(row.heroId, []);
    rowsByHero.get(row.heroId)!.push(row);
  }

  let updated = 0;
  let noData = 0;

  for (const hero of meta.heroes) {
    const rows = rowsByHero.get(hero.heroId);
    if (!rows || rows.length === 0) {
      noData++;
      continue;
    }

    const bucketGames: Record<Position, number> = { Carry: 0, Mid: 0, Offlane: 0, Support: 0 };
    let total = 0;
    for (const row of rows) {
      bucketGames[ROLE_TO_BUCKET[row.role]] += row.games;
      total += row.games;
    }

    hero.positions = (Object.entries(bucketGames) as [Position, number][])
      .map(([position, games]) => ({ position, share: Math.round((games / total) * 1000) / 1000 }))
      .filter((p) => p.share >= SHARE_THRESHOLD)
      .sort((a, b) => b.share - a.share);
    updated++;
  }

  fs.writeFileSync(HERO_META_PATH, JSON.stringify(meta, null, 2) + '\n');
  console.log(`Recomputed positions for ${updated} heroes from GPM-rank data.`);
  if (noData > 0) {
    console.warn(`  ${noData} heroes had no GPM-rank data — left on the old lane_role/is_roaming positions.`);
  }
}

main();
