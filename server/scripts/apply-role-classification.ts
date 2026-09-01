import * as fs from 'fs';
import * as path from 'path';

// Applies the validated per-match role classifier (Blueprint/12-next-session-
// priorities.md item 6 — research-role-classification-final.ts) as the new
// canonical source for hero-meta.json's `positions`, superseding
// recompute-presumed-positions.ts's two-source hybrid (GPM-rank for Support
// share + separately-fetched lane_role/is_roaming bucketing for Carry/Mid/
// Offlane ratio, blended by renormalization).
//
// Why this replaces it: the old hybrid's Carry/Mid/Offlane ratio came from
// research-role-fit-output.json's bucketOf(), which only overrides to Support
// via is_roaming — a STATIC safe/off-lane support (never roams) still landed
// in the Carry/Offlane lane bucket, contaminating the ratio. The new method
// computes lane_role + is_roaming + per-match team-relative GPM-rank in ONE
// joint query and classifies each match directly (is_roaming -> Support;
// lane_role=2 -> Mid; lane_role=1/3 -> Carry/Offlane only if GPM-rank is
// top-3 on the team, else Support) — the GPM-rank check catches static
// supports the old method's is_roaming-only check missed.
//
// Validated on the full roster before applying (see conversation): 33/508
// (hero, position) pairs shifted by >=0.15 share, and every shift traced to
// either a known real secondary role the old method showed as flat 0% (Zeus/
// Snapfire/Keeper of the Light/Dragon Knight/Tiny/Templar Assassin Mid,
// Earthshaker/Abaddon/Omniknight Support) or a fix to a known contamination
// case (Elder Titan Carry->Support, Riki/Broodmother Carry->0). No shift
// looked like a spurious regression.
const INPUT_PATH = path.join(__dirname, '..', 'data', 'research-role-classification-final-output.json');
const HERO_META_PATH = path.join(__dirname, '..', 'data', 'hero-meta.json');
const SHARE_THRESHOLD = 0.25;

// Templar Assassin Mid is a real second role in pro (~21.6%) but sits
// under SHARE_THRESHOLD. Nick 2026-09-01: one-hero overlay, do not lower
// the global 0.25 gate.
const POSITION_OVERRIDES: Record<number, { position: Position; share: number }[]> = {
  46: [
    { position: 'Carry', share: 0.759 },
    { position: 'Mid', share: 0.216 },
  ],
};

type Position = 'Carry' | 'Mid' | 'Offlane' | 'Support';

interface PositionRow {
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

function main() {
  const rows: PositionRow[] = JSON.parse(fs.readFileSync(INPUT_PATH, 'utf-8'));
  const meta: { heroes: HeroMetaEntry[] } = JSON.parse(fs.readFileSync(HERO_META_PATH, 'utf-8'));

  const byHero = new Map<number, PositionRow[]>();
  rows.forEach((r) => {
    if (!byHero.has(r.heroId)) byHero.set(r.heroId, []);
    byHero.get(r.heroId)!.push(r);
  });

  let updated = 0;
  let noData = 0;

  for (const hero of meta.heroes) {
    const heroRows = byHero.get(hero.heroId);
    if (!heroRows || heroRows.length === 0) {
      noData++; // leave existing positions untouched, same fallback as recompute-presumed-positions.ts
      continue;
    }

    hero.positions = heroRows
      .filter((r) => r.share >= SHARE_THRESHOLD)
      .sort((a, b) => b.share - a.share)
      .map((r) => ({ position: r.position, share: Math.round(r.share * 1000) / 1000 }));
    const override = POSITION_OVERRIDES[hero.heroId];
    if (override) hero.positions = override;
    updated++;
  }

  fs.writeFileSync(HERO_META_PATH, JSON.stringify(meta, null, 2) + '\n');
  console.log(`Applied new per-match role classification to ${updated} heroes.`);
  if (noData > 0) {
    console.warn(`  ${noData} heroes had no data in ${path.basename(INPUT_PATH)} — left untouched.`);
  }
}

main();
