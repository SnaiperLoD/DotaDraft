import * as fs from 'fs';
import * as path from 'path';
import {
  assessBattle,
  DEFAULT_DIFF_INPUTS,
  type BattlePick,
  type ConfidenceTier,
  type DiffInputCoeffs,
} from '../src/battle/battle-resolution';
import { HeroMetaService } from '../src/hero-meta/hero-meta.service';
import type { Hero } from 'shared';

// Second-pass sweep: hold K/synergy/matchup at the winning values from
// sweep-battle-diff-inputs.ts and search confidence-tier |diff| thresholds.
const HEROES_PATH = path.join(__dirname, '..', 'data', 'heroes.json');
const HERO_META_PATH = path.join(__dirname, '..', 'data', 'hero-meta.json');
const PRO_MATCHES_PATH = path.join(__dirname, '..', 'data', 'pro-matches.json');
const DIFF_INPUTS_PATH = path.join(__dirname, '..', 'data', 'battle-diff-inputs.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'battle-diff-threshold-sweep.json');

interface PooledHeroRole {
  heroId: number;
  role: string;
}

interface ProMatch {
  matchId: string;
  radiantWin: boolean;
  radiantHeroIds: number[];
  direHeroIds: number[];
  radiantHeroRoles: PooledHeroRole[];
  direHeroRoles: PooledHeroRole[];
  startTime: string;
}

interface TierStats {
  n: number;
  favoredCorrect: number;
}

interface GradeResult {
  even: number;
  graded: number;
  overallHitRate: number;
  tiers: Record<ConfidenceTier, { n: number; hitRate: number | null }>;
  monotonic: boolean;
}

const MODERATE = [0.3, 0.4, 0.5, 0.65, 0.8];
const HIGH = [0.9, 1.1, 1.3, 1.5, 1.8, 2.2];
const MIN_TIER_N = 15;
const SHRINKAGE_K = 20;

function buildPicks(heroIds: number[], roles: PooledHeroRole[], heroById: Map<number, Hero>): BattlePick[] {
  const roleByHeroId = new Map(roles.map((r) => [r.heroId, r.role]));
  return heroIds.map((id) => {
    const hero = heroById.get(id);
    if (!hero) throw new Error(`Unknown heroId ${id}`);
    return { hero, assignedRole: roleByHeroId.get(id) ?? null };
  });
}

function grade(
  matches: ProMatch[],
  heroById: Map<number, Hero>,
  lookup: HeroMetaService,
  coeffs: DiffInputCoeffs,
): GradeResult {
  const tiers: Record<ConfidenceTier, TierStats> = {
    Low: { n: 0, favoredCorrect: 0 },
    Moderate: { n: 0, favoredCorrect: 0 },
    High: { n: 0, favoredCorrect: 0 },
  };
  let even = 0;

  for (const match of matches) {
    let teamA: BattlePick[];
    let teamB: BattlePick[];
    try {
      teamA = buildPicks(match.radiantHeroIds, match.radiantHeroRoles ?? [], heroById);
      teamB = buildPicks(match.direHeroIds, match.direHeroRoles ?? [], heroById);
    } catch {
      continue;
    }

    const assessment = assessBattle(teamA, teamB, lookup, coeffs);
    if (assessment.advantageDirection === 'Even') {
      even++;
      continue;
    }

    const actualWinner: 'A' | 'B' = match.radiantWin ? 'A' : 'B';
    const bucket = tiers[assessment.confidenceTier];
    bucket.n++;
    if (assessment.advantageDirection === actualWinner) bucket.favoredCorrect++;
  }

  const graded = tiers.Low.n + tiers.Moderate.n + tiers.High.n;
  const correct = tiers.Low.favoredCorrect + tiers.Moderate.favoredCorrect + tiers.High.favoredCorrect;
  const hitRate = (t: TierStats) => (t.n === 0 ? null : t.favoredCorrect / t.n);
  const low = hitRate(tiers.Low);
  const mod = hitRate(tiers.Moderate);
  const high = hitRate(tiers.High);
  const comparable =
    tiers.Low.n >= MIN_TIER_N &&
    tiers.Moderate.n >= MIN_TIER_N &&
    tiers.High.n >= MIN_TIER_N &&
    low !== null &&
    mod !== null &&
    high !== null;
  const monotonic = comparable && low! <= mod! + 1e-9 && mod! <= high! + 1e-9;

  return {
    even,
    graded,
    overallHitRate: graded === 0 ? 0 : correct / graded,
    tiers: {
      Low: { n: tiers.Low.n, hitRate: low },
      Moderate: { n: tiers.Moderate.n, hitRate: mod },
      High: { n: tiers.High.n, hitRate: high },
    },
    monotonic,
  };
}

function fmtPct(v: number | null | undefined): string {
  return v == null ? 'n/a' : `${(v * 100).toFixed(1)}%`;
}

function main() {
  const heroes: Hero[] = JSON.parse(fs.readFileSync(HEROES_PATH, 'utf-8'));
  const { heroes: rawMetaEntries } = JSON.parse(fs.readFileSync(HERO_META_PATH, 'utf-8')) as {
    heroes: { heroId: number; positions: { position: string; share: number }[] }[];
  };
  const positionsById = new Map(rawMetaEntries.map((e) => [e.heroId, e.positions]));
  for (const h of heroes) h.presumed_positions = (positionsById.get(h.id) ?? []) as Hero['presumed_positions'];
  const heroById = new Map(heroes.map((h) => [h.id, h]));

  const { matches }: { matches: ProMatch[] } = JSON.parse(fs.readFileSync(PRO_MATCHES_PATH, 'utf-8'));
  const from2022 = matches.filter((m) => m.startTime >= '2022-01-01');
  const lookup = HeroMetaService.forCalibration(SHRINKAGE_K);

  type Row = {
    moderateAbsDiff: number;
    highAbsDiff: number;
    recent2022: GradeResult;
  };

  const rows: Row[] = [];
  for (const moderateAbsDiff of MODERATE) {
    for (const highAbsDiff of HIGH) {
      if (highAbsDiff <= moderateAbsDiff) continue;
      const coeffs: DiffInputCoeffs = {
        synergyCoeff: DEFAULT_DIFF_INPUTS.synergyCoeff,
        matchupCoeff: DEFAULT_DIFF_INPUTS.matchupCoeff,
        moderateAbsDiff,
        highAbsDiff,
      };
      rows.push({
        moderateAbsDiff,
        highAbsDiff,
        recent2022: grade(from2022, heroById, lookup, coeffs),
      });
    }
  }

  const eligible = rows.filter((r) => r.recent2022.monotonic);
  const pool = (eligible.length > 0 ? eligible : rows).slice().sort((a, b) => {
    // Prefer higher High-tier accuracy, then overall, then more High samples.
    const ah = a.recent2022.tiers.High.hitRate ?? 0;
    const bh = b.recent2022.tiers.High.hitRate ?? 0;
    if (Math.abs(bh - ah) > 1e-9) return bh - ah;
    if (Math.abs(b.recent2022.overallHitRate - a.recent2022.overallHitRate) > 1e-9) {
      return b.recent2022.overallHitRate - a.recent2022.overallHitRate;
    }
    return b.recent2022.tiers.High.n - a.recent2022.tiers.High.n;
  });

  const baseline = rows.find((r) => r.moderateAbsDiff === 0.5 && r.highAbsDiff === 1.5)!;
  const best = pool[0];

  console.log(`Threshold sweep on 2022+ (n=${from2022.length}). Eligible monotonic: ${eligible.length}/${rows.length}\n`);
  console.log('=== Baseline (0.5 / 1.5) ===');
  const g0 = baseline.recent2022;
  console.log(
    `  overall ${fmtPct(g0.overallHitRate)}  Low ${fmtPct(g0.tiers.Low.hitRate)}(n=${g0.tiers.Low.n})  ` +
      `Mod ${fmtPct(g0.tiers.Moderate.hitRate)}(n=${g0.tiers.Moderate.n})  High ${fmtPct(g0.tiers.High.hitRate)}(n=${g0.tiers.High.n}) mono=${g0.monotonic}`,
  );

  console.log('\n=== Best (prefer High accuracy, then overall) ===');
  console.log(`  moderateAbsDiff=${best.moderateAbsDiff} highAbsDiff=${best.highAbsDiff}`);
  const g1 = best.recent2022;
  console.log(
    `  overall ${fmtPct(g1.overallHitRate)}  Low ${fmtPct(g1.tiers.Low.hitRate)}(n=${g1.tiers.Low.n})  ` +
      `Mod ${fmtPct(g1.tiers.Moderate.hitRate)}(n=${g1.tiers.Moderate.n})  High ${fmtPct(g1.tiers.High.hitRate)}(n=${g1.tiers.High.n}) mono=${g1.monotonic}`,
  );

  console.log('\nTop 8:');
  for (const r of pool.slice(0, 8)) {
    const g = r.recent2022;
    console.log(
      `  mod=${r.moderateAbsDiff} high=${r.highAbsDiff}  hit=${fmtPct(g.overallHitRate)} ` +
        `L/M/H=${fmtPct(g.tiers.Low.hitRate)}/${fmtPct(g.tiers.Moderate.hitRate)}/${fmtPct(g.tiers.High.hitRate)} ` +
        `(n ${g.tiers.Low.n}/${g.tiers.Moderate.n}/${g.tiers.High.n}) mono=${g.monotonic}`,
    );
  }

  fs.writeFileSync(
    OUTPUT_PATH,
    JSON.stringify({ generatedAt: new Date().toISOString(), baseline, best, top8: pool.slice(0, 8), rows }, null, 2),
  );
  console.log(`\nWrote ${OUTPUT_PATH}`);

  if (process.argv.includes('--apply')) {
    const current = JSON.parse(fs.readFileSync(DIFF_INPUTS_PATH, 'utf-8')) as Record<string, number>;
    const next = {
      ...current,
      moderateAbsDiff: best.moderateAbsDiff,
      highAbsDiff: best.highAbsDiff,
    };
    fs.writeFileSync(DIFF_INPUTS_PATH, JSON.stringify(next, null, 2) + '\n');
    console.log(`\n--apply: wrote ${DIFF_INPUTS_PATH}`);
    console.log(JSON.stringify(next, null, 2));
  }
}

main();
