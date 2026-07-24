import * as fs from 'fs';
import * as path from 'path';
import { resolveBattle, WIN_WEIGHT_BY_TIER, type BattlePick, type ConfidenceTier } from '../src/battle/battle-resolution';
import { HeroMetaService } from '../src/hero-meta/hero-meta.service';
import type { Hero } from 'shared';

// Milestone 6 (Blueprint/07-development-plan.md): "matches predicted 'High
// confidence' should win noticeably more often than 'Low confidence' ones,
// and the resolved Win/Lose rate at each tier should roughly track the
// tier's real-world win rate."
//
// Deliberately does NOT grade resolveBattle() on its randomized
// resolvedOutcome as the primary metric — that's an intentional coin flip
// (Upsets rule, Blueprint/06-battle-engine.md: even "High confidence"
// should lose sometimes), so even a perfectly calibrated High-tier
// prediction is only "right" 72% of the time by design. The real question
// is whether the deterministic assessment (advantageDirection +
// confidenceTier), computed before that coin flip, actually tracks reality.
// resolvedOutcome is still reported, as a secondary/game-feel sanity check.
const HEROES_PATH = path.join(__dirname, '..', 'data', 'heroes.json');
const HERO_META_PATH = path.join(__dirname, '..', 'data', 'hero-meta.json');
const PRO_MATCHES_PATH = path.join(__dirname, '..', 'data', 'pro-matches.json');

interface ProMatchHeroRole {
  heroId: number;
  role: string;
}

interface ProMatch {
  matchId: string;
  radiantName: string;
  direName: string;
  leagueName: string;
  radiantWin: boolean;
  radiantHeroIds: number[];
  direHeroIds: number[];
  radiantHeroRoles: ProMatchHeroRole[];
  direHeroRoles: ProMatchHeroRole[];
}

function buildPicks(heroIds: number[], roles: ProMatchHeroRole[], heroById: Map<number, Hero>): BattlePick[] {
  const roleByHeroId = new Map(roles.map((r) => [r.heroId, r.role]));
  return heroIds.map((id) => {
    const hero = heroById.get(id);
    if (!hero) throw new Error(`Unknown heroId ${id} in pro-matches.json — heroes.json out of date?`);
    return { hero, assignedRole: roleByHeroId.get(id) ?? null };
  });
}

interface TierBucket {
  n: number;
  favoredCorrect: number; // advantageDirection actually won (n/a for Even)
  resolvedCorrect: number; // resolvedOutcome (post coin-flip) actually won
}

function emptyBucket(): TierBucket {
  return { n: 0, favoredCorrect: 0, resolvedCorrect: 0 };
}

function main() {
  const heroes: Hero[] = JSON.parse(fs.readFileSync(HEROES_PATH, 'utf-8'));
  // heroes.json doesn't carry presumed_positions (only merged in at seed
  // time, see seed.ts) — merge it here too, so isHardCarry() in
  // battle-resolution.ts sees real position data instead of none.
  const { heroes: rawMetaEntries } = JSON.parse(fs.readFileSync(HERO_META_PATH, 'utf-8')) as {
    heroes: { heroId: number; positions: { position: string; share: number }[] }[];
  };
  const positionsById = new Map(rawMetaEntries.map((e) => [e.heroId, e.positions]));
  for (const h of heroes) h.presumed_positions = (positionsById.get(h.id) ?? []) as Hero['presumed_positions'];
  const heroById = new Map(heroes.map((h) => [h.id, h]));

  const { matches }: { matches: ProMatch[] } = JSON.parse(fs.readFileSync(PRO_MATCHES_PATH, 'utf-8'));
  const heroMeta = new HeroMetaService();

  const tierBuckets: Record<ConfidenceTier, TierBucket> = {
    Low: emptyBucket(),
    Moderate: emptyBucket(),
    High: emptyBucket(),
  };
  const evenBucket = { n: 0, radiantWon: 0 };
  let skipped = 0;

  for (const match of matches) {
    let teamA: BattlePick[];
    let teamB: BattlePick[];
    try {
      teamA = buildPicks(match.radiantHeroIds, match.radiantHeroRoles, heroById);
      teamB = buildPicks(match.direHeroIds, match.direHeroRoles, heroById);
    } catch {
      skipped++;
      continue;
    }

    const result = resolveBattle(teamA, teamB, heroMeta);
    const actualWinner: 'A' | 'B' = match.radiantWin ? 'A' : 'B';
    const resolvedWinner: 'A' | 'B' = result.resolvedOutcome === 'Win' ? 'A' : 'B';

    if (result.advantageDirection === 'Even') {
      evenBucket.n++;
      if (match.radiantWin) evenBucket.radiantWon++;
      continue;
    }

    const bucket = tierBuckets[result.confidenceTier];
    bucket.n++;
    if (result.advantageDirection === actualWinner) bucket.favoredCorrect++;
    if (resolvedWinner === actualWinner) bucket.resolvedCorrect++;
  }

  const graded = matches.length - skipped - evenBucket.n;
  console.log(`Pro matches graded: ${graded}/${matches.length} (${skipped} skipped — unknown hero, ${evenBucket.n} Even)\n`);

  console.log('=== Even (no favorite) — should be close to 50/50, not a systematic bias ===');
  const evenWinRate = evenBucket.n === 0 ? null : evenBucket.radiantWon / evenBucket.n;
  console.log(
    `  n=${evenBucket.n}  radiant winrate=${evenWinRate === null ? 'n/a' : (evenWinRate * 100).toFixed(1) + '%'}\n`,
  );

  console.log('=== Confidence tier calibration: does the favored side actually win more as tier rises? ===');
  console.log(
    '  tier       n   favored-side actual winrate   target win-weight   delta   resolvedOutcome hit-rate',
  );
  (['Low', 'Moderate', 'High'] as ConfidenceTier[]).forEach((tier) => {
    const b = tierBuckets[tier];
    const actual = b.n === 0 ? null : b.favoredCorrect / b.n;
    const target = WIN_WEIGHT_BY_TIER[tier];
    const delta = actual === null ? null : actual - target;
    const resolvedRate = b.n === 0 ? null : b.resolvedCorrect / b.n;
    console.log(
      `  ${tier.padEnd(10)} ${String(b.n).padEnd(3)} ${
        actual === null ? 'n/a'.padEnd(28) : (actual * 100).toFixed(1).padEnd(4) + '%'.padEnd(24)
      } ${(target * 100).toFixed(0).padEnd(19)}% ${
        delta === null ? 'n/a' : (delta >= 0 ? '+' : '') + (delta * 100).toFixed(1) + 'pp'
      }      ${resolvedRate === null ? 'n/a' : (resolvedRate * 100).toFixed(1) + '%'}`,
    );
  });

  const gradedTiers = (['Low', 'Moderate', 'High'] as ConfidenceTier[]).map((t) => tierBuckets[t]);
  const totalN = gradedTiers.reduce((s, b) => s + b.n, 0);
  const totalFavoredCorrect = gradedTiers.reduce((s, b) => s + b.favoredCorrect, 0);
  const totalResolvedCorrect = gradedTiers.reduce((s, b) => s + b.resolvedCorrect, 0);
  console.log('\n=== Overall (excluding Even) ===');
  console.log(`  n=${totalN}`);
  console.log(
    `  advantageDirection hit-rate (primary calibration metric): ${((totalFavoredCorrect / totalN) * 100).toFixed(1)}%`,
  );
  console.log(
    `  resolvedOutcome hit-rate (secondary, includes the intentional coin flip): ${((totalResolvedCorrect / totalN) * 100).toFixed(1)}%`,
  );

  console.log(
    '\nCaveat: n=100 total, split across 4 buckets (Even + 3 tiers) — per-tier samples are small enough that ' +
      'individual tier deltas can be noisy. Read the overall hit-rate and the Low->High trend direction as the ' +
      'primary signal, not any single tier in isolation.',
  );
}

main();
