import * as fs from 'fs';
import * as path from 'path';
import {
  assessBattle,
  ADVANTAGE_THRESHOLD,
  type BattlePick,
  type ConfidenceTier,
  type DiffInputCoeffs,
} from '../src/battle/battle-resolution';
import { HeroMetaService } from '../src/hero-meta/hero-meta.service';
import type { Hero } from 'shared';

// Sweeps shrinkageK / synergyCoeff / matchupCoeff against real pro-match
// outcomes (same assessBattle path as production). Primary target set is
// matches from 2022+ — hero-meta.json is a recent public snapshot, so
// 2012–2019 TI playoffs are reported but not used to pick winners.
const HEROES_PATH = path.join(__dirname, '..', 'data', 'heroes.json');
const HERO_META_PATH = path.join(__dirname, '..', 'data', 'hero-meta.json');
const PRO_MATCHES_PATH = path.join(__dirname, '..', 'data', 'pro-matches.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'battle-diff-input-sweep.json');
const DIFF_INPUTS_PATH = path.join(__dirname, '..', 'data', 'battle-diff-inputs.json');

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
  leagueName: string | null;
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
  highEnough: boolean;
}

const SHRINKAGE_KS = [10, 20, 40, 80];
const SYNERGY_COEFFS = [0, 1, 2, 3];
const MATCHUP_COEFFS = [0, 1.5, 3, 4.5];
// Keep production thresholds fixed for this sweep — isolate the three
// |diff|-inflating inputs we set out to calibrate first.
const MODERATE_ABS_DIFF = 0.5;
const HIGH_ABS_DIFF = 1.5;
const MIN_TIER_N = 15;

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
  const comparable = [low, mod, high].every((v, i, arr) => {
    if (v === null) return false;
    const tierN = [tiers.Low.n, tiers.Moderate.n, tiers.High.n][i];
    return tierN >= MIN_TIER_N;
  });
  const monotonic =
    comparable && low !== null && mod !== null && high !== null && low <= mod + 1e-9 && mod <= high + 1e-9;

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
    highEnough: tiers.High.n >= MIN_TIER_N,
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
  const all = matches;
  const from2022 = matches.filter((m) => m.startTime >= '2022-01-01');
  const from2024 = matches.filter((m) => m.startTime >= '2024-01-01');

  console.log(
    `Loaded ${all.length} pro matches (2022+: ${from2022.length}, 2024+: ${from2024.length}). ` +
      `Grid ${SHRINKAGE_KS.length}×${SYNERGY_COEFFS.length}×${MATCHUP_COEFFS.length} = ` +
      `${SHRINKAGE_KS.length * SYNERGY_COEFFS.length * MATCHUP_COEFFS.length} configs.\n`,
  );

  type Row = {
    shrinkageK: number;
    synergyCoeff: number;
    matchupCoeff: number;
    recent2022: GradeResult;
    recent2024: GradeResult;
    all: GradeResult;
  };

  const rows: Row[] = [];
  let i = 0;
  const total = SHRINKAGE_KS.length * SYNERGY_COEFFS.length * MATCHUP_COEFFS.length;

  for (const shrinkageK of SHRINKAGE_KS) {
    const lookup = HeroMetaService.forCalibration(shrinkageK);
    for (const synergyCoeff of SYNERGY_COEFFS) {
      for (const matchupCoeff of MATCHUP_COEFFS) {
        i++;
        const coeffs: DiffInputCoeffs = {
          synergyCoeff,
          matchupCoeff,
          moderateAbsDiff: MODERATE_ABS_DIFF,
          highAbsDiff: HIGH_ABS_DIFF,
        };
        const row: Row = {
          shrinkageK,
          synergyCoeff,
          matchupCoeff,
          recent2022: grade(from2022, heroById, lookup, coeffs),
          recent2024: grade(from2024, heroById, lookup, coeffs),
          all: grade(all, heroById, lookup, coeffs),
        };
        rows.push(row);
        if (i % 16 === 0 || i === total) {
          console.log(`  … ${i}/${total}`);
        }
      }
    }
  }

  // Primary pick: maximize 2022+ overall hit-rate among monotonic configs
  // with enough High samples. Fall back to best overall if none qualify.
  const eligible = rows.filter((r) => r.recent2022.monotonic && r.recent2022.highEnough);
  const pool = eligible.length > 0 ? eligible : rows;
  pool.sort((a, b) => b.recent2022.overallHitRate - a.recent2022.overallHitRate);
  const best = pool[0];

  const baseline = rows.find(
    (r) => r.shrinkageK === 20 && r.synergyCoeff === 2 && r.matchupCoeff === 3,
  )!;

  console.log('\n=== Baseline (K=20, syn=2, mu=3) ===');
  for (const [label, g] of [
    ['2022+', baseline.recent2022],
    ['2024+', baseline.recent2024],
    ['all', baseline.all],
  ] as const) {
    console.log(
      `  ${label}: overall ${fmtPct(g.overallHitRate)}  Low ${fmtPct(g.tiers.Low.hitRate)}(n=${g.tiers.Low.n})  ` +
        `Mod ${fmtPct(g.tiers.Moderate.hitRate)}(n=${g.tiers.Moderate.n})  High ${fmtPct(g.tiers.High.hitRate)}(n=${g.tiers.High.n})  ` +
        `mono=${g.monotonic} even=${g.even}`,
    );
  }

  console.log(
    `\n=== Best on 2022+ ${eligible.length > 0 ? '(monotonic + High n≥15)' : '(no monotonic candidate — best overall)'} ===`,
  );
  console.log(`  K=${best.shrinkageK} synergyCoeff=${best.synergyCoeff} matchupCoeff=${best.matchupCoeff}`);
  for (const [label, g] of [
    ['2022+', best.recent2022],
    ['2024+', best.recent2024],
    ['all', best.all],
  ] as const) {
    console.log(
      `  ${label}: overall ${fmtPct(g.overallHitRate)}  Low ${fmtPct(g.tiers.Low.hitRate)}(n=${g.tiers.Low.n})  ` +
        `Mod ${fmtPct(g.tiers.Moderate.hitRate)}(n=${g.tiers.Moderate.n})  High ${fmtPct(g.tiers.High.hitRate)}(n=${g.tiers.High.n})  ` +
        `mono=${g.monotonic} even=${g.even}`,
    );
  }

  const top5 = pool.slice(0, 5).map((r) => ({
    shrinkageK: r.shrinkageK,
    synergyCoeff: r.synergyCoeff,
    matchupCoeff: r.matchupCoeff,
    hit2022: r.recent2022.overallHitRate,
    mono2022: r.recent2022.monotonic,
    tiers2022: r.recent2022.tiers,
  }));
  console.log('\nTop 5 (by 2022+ hit-rate):');
  for (const t of top5) {
    console.log(
      `  K=${t.shrinkageK} syn=${t.synergyCoeff} mu=${t.matchupCoeff}  ` +
        `hit=${fmtPct(t.hit2022)} mono=${t.mono2022} ` +
        `L/M/H=${fmtPct(t.tiers2022.Low.hitRate)}/${fmtPct(t.tiers2022.Moderate.hitRate)}/${fmtPct(t.tiers2022.High.hitRate)} ` +
        `(n ${t.tiers2022.Low.n}/${t.tiers2022.Moderate.n}/${t.tiers2022.High.n})`,
    );
  }

  // Silence unused-threshold warning — documented as fixed for this pass.
  void ADVANTAGE_THRESHOLD;

  fs.writeFileSync(
    OUTPUT_PATH,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        primarySet: 'startTime >= 2022-01-01',
        fixedThresholds: { moderateAbsDiff: MODERATE_ABS_DIFF, highAbsDiff: HIGH_ABS_DIFF },
        baseline,
        best,
        top5,
        eligibleCount: eligible.length,
        rows,
      },
      null,
      2,
    ),
  );
  console.log(`\nWrote full sweep to ${OUTPUT_PATH}`);

  const apply = process.argv.includes('--apply');
  if (apply) {
    const next = {
      shrinkageK: best.shrinkageK,
      synergyCoeff: best.synergyCoeff,
      matchupCoeff: best.matchupCoeff,
      moderateAbsDiff: MODERATE_ABS_DIFF,
      highAbsDiff: HIGH_ABS_DIFF,
    };
    fs.writeFileSync(DIFF_INPUTS_PATH, JSON.stringify(next, null, 2) + '\n');
    console.log(`\n--apply: wrote ${DIFF_INPUTS_PATH}`);
    console.log(JSON.stringify(next, null, 2));
  } else {
    console.log('\nRe-run with --apply to write the best config into battle-diff-inputs.json');
  }
}

main();
