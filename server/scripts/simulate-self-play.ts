import * as fs from 'fs';
import * as path from 'path';
import {
  assessBattle,
  bestSynergyPair,
  bestMatchupEdge,
  axisAverage,
  AXES,
  AXIS_LABEL,
  type BattlePick,
  type AdvantageDirection,
  type ConfidenceTier,
} from '../src/battle/battle-resolution';
import { roleFitValue } from '../src/common/role-fit';
import { HeroMetaService } from '../src/hero-meta/hero-meta.service';
import { ROLES } from 'shared';
import type { Hero } from 'shared';

// Test 3 (per the calibration session plan) — internal self-consistency
// check, NOT a real-world validity check like calibrate-battle-engine.ts.
// Draws random 5v5 lineups from the full 127-hero pool many times and grades
// the model against *itself* (does a hero's raw strength track how often
// their side comes out favored?) to surface formula artifacts (like the
// already-known Meepo control/durability inflation) at the outcome level,
// not just the individual-axis level `check-axis-distribution.ts` already
// covers. Real OpenDota `winRate` is attached per hero as an external
// anchor — if a hero's in-system favored-rate diverges sharply from their
// real winRate, that's a stronger signal than divergence found purely
// inside our own simulation.
//
// Reuses assessBattle() (the same deterministic core resolveBattle() calls
// in production) rather than reimplementing the diff/tier/direction math —
// same reasoning as calibrate-battle-engine.ts: don't grade a copy of the
// logic, grade what's actually shipped.
const HEROES_PATH = path.join(__dirname, '..', 'data', 'heroes.json');
const HERO_META_PATH = path.join(__dirname, '..', 'data', 'hero-meta.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'self-play-simulation-output.json');

const N_MATCHES = 100000;
const TEAM_SIZE = 5;
// Arbitrary, not calibrated — MIN_GAMES=10 (hero-meta.service.ts) is the
// floor for a pair to be used *at all*; this just splits "used" pairs into
// thin vs comparatively sturdier backing for the bonus-4 breakdown below.
const THIN_DATA_GAMES_THRESHOLD = 20;
const EXTREME_CASES_TO_KEEP = 20;
const LEADERBOARD_SIZE = 15;

interface RawHeroMetaEntry {
  heroId: number;
  positions: { position: string; share: number }[];
  winRate: number | null;
  synergy: { allyHeroId: number; games: number; wins: number }[];
  matchups: { opponentHeroId: number; games: number; wins: number }[];
}

// ---------- stats helpers (same math as check-axis-distribution.ts) ----------

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
// Loop-based, not Math.min/max(...xs) — spreading 200k+ elements as call
// arguments blows the V8 call-stack limit (hit at N_MATCHES=100000).
function arrMin(xs: number[]): number {
  return xs.reduce((a, b) => (b < a ? b : a), xs[0]);
}
function arrMax(xs: number[]): number {
  return xs.reduce((a, b) => (b > a ? b : a), xs[0]);
}
function stdev(xs: number[], m: number): number {
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}
function skewness(xs: number[], m: number, sd: number): number {
  if (sd === 0) return 0;
  return mean(xs.map((x) => ((x - m) / sd) ** 3));
}
function excessKurtosis(xs: number[], m: number, sd: number): number {
  if (sd === 0) return 0;
  return mean(xs.map((x) => ((x - m) / sd) ** 4)) - 3;
}
function pearson(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 2) return null;
  const mx = mean(xs);
  const my = mean(ys);
  const sx = stdev(xs, mx);
  const sy = stdev(ys, my);
  if (sx === 0 || sy === 0) return null;
  let cov = 0;
  for (let i = 0; i < xs.length; i++) cov += (xs[i] - mx) * (ys[i] - my);
  cov /= xs.length;
  return cov / (sx * sy);
}

function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Weighted role assignment (self-play outlier investigation,
// Blueprint/10-tech-debt-backlog.md "control-support cluster") — replaces
// uniform shuffle(ROLES) for team role draws below. Uniform assignment gave
// every hero a 1-in-5 chance at the role their role-fit axes actually
// reward (common/role-fit.ts) regardless of how they're really played,
// understating role-fit's effect for heroes with a strongly skewed real
// position (e.g. Phantom Lancer 57.9% Carry, most Support-role casters
// ~100% Support) — they'd only get their role-fit boost 20% of the time in
// this measurement, not the ~60-100% real drafts would assign them.
// hero-meta.json's `positions` only has 4 buckets (no Hard/Soft Support
// split) — Support share is split evenly between them. Leftover
// probability mass (shares rarely sum to 1) is spread uniformly across all
// 5 roles as smoothing; heroes with no positions data get pure uniform
// weights (identical to the old shuffle(ROLES) behavior for them).
function roleWeights(positions: { position: string; share: number }[]): Record<string, number> {
  const w: Record<string, number> = { Carry: 0, Mid: 0, Offlane: 0, 'Soft Support': 0, 'Hard Support': 0 };
  let allocated = 0;
  for (const p of positions) {
    if (p.position === 'Carry') { w.Carry += p.share; allocated += p.share; }
    else if (p.position === 'Mid') { w.Mid += p.share; allocated += p.share; }
    else if (p.position === 'Offlane') { w.Offlane += p.share; allocated += p.share; }
    else if (p.position === 'Support') { w['Soft Support'] += p.share / 2; w['Hard Support'] += p.share / 2; allocated += p.share; }
  }
  const leftover = Math.max(0, 1 - allocated);
  for (const role of ROLES) w[role] += leftover / ROLES.length;
  return w;
}

// Assigns 5 distinct roles to 5 heroes, biased by each hero's roleWeights:
// shuffle hero order, then each hero in turn picks a role via weighted
// random choice restricted to roles not yet taken (renormalized) — a
// weighted-without-replacement draw, not an exact optimal assignment, but
// close enough for a measurement tool and keeps the "5 distinct roles per
// team" invariant real drafts have.
function assignWeightedRoles(heroes: Hero[], weightsById: Map<number, Record<string, number>>): string[] {
  const order = shuffle(heroes.map((_, i) => i));
  const rolesLeft = [...ROLES] as string[];
  const assigned: string[] = new Array(heroes.length);
  for (const idx of order) {
    const w = weightsById.get(heroes[idx].id) ?? Object.fromEntries(ROLES.map((r) => [r, 1]));
    const weights = rolesLeft.map((r) => Math.max(0.001, w[r] ?? 0.001));
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = Math.random() * total;
    let pick = rolesLeft.length - 1;
    for (let i = 0; i < weights.length; i++) {
      roll -= weights[i];
      if (roll <= 0) { pick = i; break; }
    }
    assigned[idx] = rolesLeft[pick];
    rolesLeft.splice(pick, 1);
  }
  return assigned;
}

function heroContribution(hero: Hero, role: string | null): number {
  return AXES.reduce((sum, axis) => sum + roleFitValue(axis, role, hero.evaluation_values[axis]), 0) / AXES.length;
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join(' + ');
}

// ---------- games-count lookup (for bonus-4: thin vs strong data) ----------

function buildGamesLookup(entries: RawHeroMetaEntry[]) {
  const synergyGames = new Map<string, number>();
  const matchupGames = new Map<string, number>();
  for (const e of entries) {
    for (const s of e.synergy) synergyGames.set(`${e.heroId}-${s.allyHeroId}`, s.games);
    for (const m of e.matchups) matchupGames.set(`${e.heroId}-${m.opponentHeroId}`, m.games);
  }
  return { synergyGames, matchupGames };
}

function synergyGamesForTeam(heroIds: number[], synergyGames: Map<string, number>): number[] {
  const games: number[] = [];
  for (let i = 0; i < heroIds.length; i++) {
    for (let j = i + 1; j < heroIds.length; j++) {
      const g = synergyGames.get(`${heroIds[i]}-${heroIds[j]}`) ?? synergyGames.get(`${heroIds[j]}-${heroIds[i]}`);
      if (g !== undefined && g >= 10) games.push(g);
    }
  }
  return games;
}

function matchupGamesForTeams(teamIds: number[], opponentIds: number[], matchupGames: Map<string, number>): number[] {
  const games: number[] = [];
  for (const a of teamIds) {
    for (const b of opponentIds) {
      const g = matchupGames.get(`${a}-${b}`);
      if (g !== undefined && g >= 10) games.push(g);
    }
  }
  return games;
}

// ---------- global (non-match-dependent) coverage stat, bonus-5 ----------

function computeGlobalPairCoverage(heroes: Hero[], entries: RawHeroMetaEntry[]) {
  const byId = new Map(entries.map((e) => [e.heroId, e]));
  let totalPairs = 0;
  let synergyCovered = 0;
  let matchupCoveredEitherDirection = 0;
  for (let i = 0; i < heroes.length; i++) {
    for (let j = i + 1; j < heroes.length; j++) {
      totalPairs++;
      const a = heroes[i].id;
      const b = heroes[j].id;
      const sAB = byId.get(a)?.synergy.find((s) => s.allyHeroId === b);
      const sBA = byId.get(b)?.synergy.find((s) => s.allyHeroId === a);
      if ((sAB && sAB.games >= 10) || (sBA && sBA.games >= 10)) synergyCovered++;
      const mAB = byId.get(a)?.matchups.find((m) => m.opponentHeroId === b);
      const mBA = byId.get(b)?.matchups.find((m) => m.opponentHeroId === a);
      if ((mAB && mAB.games >= 10) || (mBA && mBA.games >= 10)) matchupCoveredEitherDirection++;
    }
  }
  return { totalPairs, synergyCovered, matchupCoveredEitherDirection };
}

// ---------- per-hero tracking ----------

interface HeroStats {
  heroId: number;
  name: string;
  appearances: number;
  favoredCount: number;
  evenCount: number;
  contributionSum: number;
  realWinRate: number | null;
}

interface MatchRecord {
  diff: number;
  advantageDirection: AdvantageDirection;
  confidenceTier: ConfidenceTier;
  topAxis: string;
  teamANames: string[];
  teamARoles: string[];
  teamBNames: string[];
  teamBRoles: string[];
}

function main() {
  const heroes: Hero[] = JSON.parse(fs.readFileSync(HEROES_PATH, 'utf-8'));
  const { heroes: rawMetaEntries }: { heroes: RawHeroMetaEntry[] } = JSON.parse(
    fs.readFileSync(HERO_META_PATH, 'utf-8'),
  );
  // heroes.json itself doesn't carry presumed_positions (only merged in at
  // seed time, see seed.ts) — this script builds Hero objects straight from
  // that file, so it has to do the same merge here for isHardCarry() in
  // battle-resolution.ts to see real position data instead of silently
  // treating every hero as having none.
  const positionsById = new Map(rawMetaEntries.map((e) => [e.heroId, e.positions]));
  for (const h of heroes) h.presumed_positions = (positionsById.get(h.id) ?? []) as Hero['presumed_positions'];
  const roleWeightsById = new Map(heroes.map((h) => [h.id, roleWeights(positionsById.get(h.id) ?? [])]));

  const heroMeta = new HeroMetaService();
  const { synergyGames, matchupGames } = buildGamesLookup(rawMetaEntries);
  const winRateById = new Map(rawMetaEntries.map((e) => [e.heroId, e.winRate]));

  const heroStats = new Map<number, HeroStats>(
    heroes.map((h) => [
      h.id,
      { heroId: h.id, name: h.name, appearances: 0, favoredCount: 0, evenCount: 0, contributionSum: 0, realWinRate: winRateById.get(h.id) ?? null },
    ]),
  );

  // Q1
  const axisTeamSamples: Record<string, number[]> = Object.fromEntries(AXES.map((a) => [a, [] as number[]]));
  // Q2
  const axisAbsDeltaSum: Record<string, number> = Object.fromEntries(AXES.map((a) => [a, 0]));
  const axisTopDriverCount: Record<string, number> = Object.fromEntries(AXES.map((a) => [a, 0]));
  // Q3
  let directionFlips = 0;
  let nonZeroSynergyMatches = 0;
  let nonZeroMatchupMatches = 0;
  const synergyMagnitudes: number[] = [];
  const matchupMagnitudes: number[] = [];
  // bonus-4: thin vs strong backing data
  const backingGamesVsDistortion: { avgGames: number; distortion: number }[] = [];
  // bonus-1: diff distribution / tier population
  const diffs: number[] = [];
  const tierCounts: Record<ConfidenceTier, number> = { Low: 0, Moderate: 0, High: 0 };
  let evenMatches = 0;
  // bonus-2: role-fit swing
  let roleFitFlips = 0;
  // Q4
  const matchRecords: MatchRecord[] = [];
  const synergyLeaderboard = new Map<string, { heroA: string; heroB: string; winRate: number; count: number }>();
  const matchupLeaderboard = new Map<string, { hero: string; vs: string; winRate: number; count: number }>();

  for (let i = 0; i < N_MATCHES; i++) {
    const drawn = shuffle(heroes).slice(0, TEAM_SIZE * 2);
    const heroesA = drawn.slice(0, TEAM_SIZE);
    const heroesB = drawn.slice(TEAM_SIZE);

    const rolesA = assignWeightedRoles(heroesA, roleWeightsById);
    const rolesB = assignWeightedRoles(heroesB, roleWeightsById);
    const teamA: BattlePick[] = heroesA.map((h, idx) => ({ hero: h, assignedRole: rolesA[idx] }));
    const teamB: BattlePick[] = heroesB.map((h, idx) => ({ hero: h, assignedRole: rolesB[idx] }));
    const teamANoRole: BattlePick[] = heroesA.map((h) => ({ hero: h, assignedRole: null }));
    const teamBNoRole: BattlePick[] = heroesB.map((h) => ({ hero: h, assignedRole: null }));

    const assessment = assessBattle(teamA, teamB, heroMeta);
    const assessmentNoRole = assessBattle(teamANoRole, teamBNoRole, heroMeta);

    // Q1
    for (const axis of AXES) {
      axisTeamSamples[axis].push(axisAverage(teamA, axis));
      axisTeamSamples[axis].push(axisAverage(teamB, axis));
    }

    // Q2
    for (const d of assessment.axisDeltas) axisAbsDeltaSum[d.axis] += Math.abs(d.delta);
    axisTopDriverCount[assessment.axisDeltas[0].axis]++;

    // Q3
    const flipped = assessment.advantageDirection !== assessment.rawAdvantageDirection;
    if (flipped) directionFlips++;
    if (assessment.synergyBonusA !== 0 || assessment.synergyBonusB !== 0) nonZeroSynergyMatches++;
    if (assessment.edgeA !== 0) nonZeroMatchupMatches++;
    if (assessment.synergyBonusA !== 0) synergyMagnitudes.push(Math.abs(assessment.synergyBonusA));
    if (assessment.synergyBonusB !== 0) synergyMagnitudes.push(Math.abs(assessment.synergyBonusB));
    if (assessment.edgeA !== 0) matchupMagnitudes.push(Math.abs(assessment.edgeA));

    // bonus-4
    const backingGames = [
      ...synergyGamesForTeam(heroesA.map((h) => h.id), synergyGames),
      ...synergyGamesForTeam(heroesB.map((h) => h.id), synergyGames),
      ...matchupGamesForTeams(heroesA.map((h) => h.id), heroesB.map((h) => h.id), matchupGames),
    ];
    if (backingGames.length > 0) {
      backingGamesVsDistortion.push({
        avgGames: mean(backingGames),
        distortion: Math.abs(assessment.diff - assessment.rawDiff),
      });
    }

    // bonus-1
    diffs.push(assessment.diff);
    if (assessment.advantageDirection === 'Even') evenMatches++;
    else tierCounts[assessment.confidenceTier]++;

    // bonus-2
    if (assessment.advantageDirection !== assessmentNoRole.advantageDirection) roleFitFlips++;

    // per-hero
    for (const p of teamA) {
      const stats = heroStats.get(p.hero.id)!;
      stats.appearances++;
      stats.contributionSum += heroContribution(p.hero, p.assignedRole);
      if (assessment.advantageDirection === 'Even') stats.evenCount++;
      else if (assessment.advantageDirection === 'A') stats.favoredCount++;
    }
    for (const p of teamB) {
      const stats = heroStats.get(p.hero.id)!;
      stats.appearances++;
      stats.contributionSum += heroContribution(p.hero, p.assignedRole);
      if (assessment.advantageDirection === 'Even') stats.evenCount++;
      else if (assessment.advantageDirection === 'B') stats.favoredCount++;
    }

    // Q4: record + leaderboards
    matchRecords.push({
      diff: assessment.diff,
      advantageDirection: assessment.advantageDirection,
      confidenceTier: assessment.confidenceTier,
      topAxis: assessment.axisDeltas[0].axis,
      teamANames: heroesA.map((h) => h.name),
      teamARoles: rolesA,
      teamBNames: heroesB.map((h) => h.name),
      teamBRoles: rolesB,
    });

    for (const team of [heroesA, heroesB]) {
      const best = bestSynergyPair(team, heroMeta);
      if (best) {
        const k = pairKey(best.heroA, best.heroB);
        const existing = synergyLeaderboard.get(k);
        if (existing) existing.count++;
        else synergyLeaderboard.set(k, { ...best, count: 1 });
      }
    }
    for (const [team, opponent] of [
      [heroesA, heroesB],
      [heroesB, heroesA],
    ] as const) {
      const best = bestMatchupEdge(team, opponent, heroMeta);
      if (best) {
        const k = `${best.hero} vs ${best.vs}`;
        const existing = matchupLeaderboard.get(k);
        if (existing) existing.count++;
        else matchupLeaderboard.set(k, { ...best, count: 1 });
      }
    }
  }

  // ================= REPORT =================

  console.log(`Self-play simulation: ${N_MATCHES} matches, ${N_MATCHES * 2} team-samples.\n`);

  console.log('=== Q1: average per-axis draft result (role-fit applied, n=' + N_MATCHES * 2 + ' teams) ===');
  console.log('  axis            mean   sd    min   max');
  for (const axis of AXES) {
    const xs = axisTeamSamples[axis];
    const m = mean(xs);
    const sd = stdev(xs, m);
    console.log(
      `  ${AXIS_LABEL[axis].padEnd(16)}${m.toFixed(2).padStart(5)} ${sd.toFixed(2).padStart(5)} ${arrMin(xs).toFixed(2).padStart(5)} ${arrMax(xs).toFixed(2).padStart(5)}`,
    );
  }

  console.log('\n=== Q2: axis influence on the decision (n=' + N_MATCHES + ' matches) ===');
  console.log('  axis            avg |delta|   times it was the #1 driver   %');
  for (const axis of AXES) {
    const avgAbsDelta = axisAbsDeltaSum[axis] / N_MATCHES;
    const topCount = axisTopDriverCount[axis];
    console.log(
      `  ${AXIS_LABEL[axis].padEnd(16)}${avgAbsDelta.toFixed(3).padStart(8)}${' '.repeat(20)}${String(topCount).padStart(5)}   ${((topCount / N_MATCHES) * 100).toFixed(1)}%`,
    );
  }
  console.log(
    '  (formal weight is equal for all 11 axes in overallPower — an axis far below the average #1-driver share is under-weighted in practice, not just on paper)',
  );

  console.log('\n=== Q3: how much do synergy/counters actually move the decision? ===');
  console.log(`  direction flips (raw overallPower-only vs final, incl. synergy+matchup multipliers): ${directionFlips}/${N_MATCHES} (${((directionFlips / N_MATCHES) * 100).toFixed(1)}%)`);
  console.log(`  matches with any non-zero synergy signal: ${nonZeroSynergyMatches}/${N_MATCHES} (${((nonZeroSynergyMatches / N_MATCHES) * 100).toFixed(1)}%)`);
  console.log(`  matches with any non-zero matchup signal: ${nonZeroMatchupMatches}/${N_MATCHES} (${((nonZeroMatchupMatches / N_MATCHES) * 100).toFixed(1)}%)`);
  console.log(`  avg |synergyBonus| when non-zero: ${synergyMagnitudes.length ? mean(synergyMagnitudes).toFixed(4) : 'n/a'} (n=${synergyMagnitudes.length})`);
  console.log(`  avg |matchupEdge| when non-zero: ${matchupMagnitudes.length ? mean(matchupMagnitudes).toFixed(4) : 'n/a'} (n=${matchupMagnitudes.length})`);

  console.log('\n=== Bonus-4: does thinner backing data correlate with bigger distortion? (Test-2 hypothesis) ===');
  const bgGames = backingGamesVsDistortion.map((r) => r.avgGames);
  const bgDist = backingGamesVsDistortion.map((r) => r.distortion);
  const r = pearson(bgGames, bgDist);
  console.log(`  n=${backingGamesVsDistortion.length} matches with any qualifying (>=10 games) synergy/matchup data`);
  console.log(`  Pearson r (avg backing games vs |diff shift from raw|): ${r === null ? 'n/a' : r.toFixed(3)} (negative = thinner data -> bigger distortion, as hypothesized)`);
  const thin = backingGamesVsDistortion.filter((r2) => r2.avgGames < THIN_DATA_GAMES_THRESHOLD);
  const strong = backingGamesVsDistortion.filter((r2) => r2.avgGames >= THIN_DATA_GAMES_THRESHOLD);
  console.log(
    `  thin (<${THIN_DATA_GAMES_THRESHOLD} games avg), n=${thin.length}: avg distortion=${thin.length ? mean(thin.map((x) => x.distortion)).toFixed(4) : 'n/a'}`,
  );
  console.log(
    `  strong (>=${THIN_DATA_GAMES_THRESHOLD} games avg), n=${strong.length}: avg distortion=${strong.length ? mean(strong.map((x) => x.distortion)).toFixed(4) : 'n/a'}`,
  );

  console.log('\n=== Bonus-1: diff distribution & tier population on unbiased random drafts ===');
  const dm = mean(diffs);
  const dsd = stdev(diffs, dm);
  console.log(`  mean=${dm.toFixed(3)} sd=${dsd.toFixed(3)} skew=${skewness(diffs, dm, dsd).toFixed(2)} exKurt=${excessKurtosis(diffs, dm, dsd).toFixed(2)}`);
  console.log(`  Even: ${evenMatches} (${((evenMatches / N_MATCHES) * 100).toFixed(1)}%)`);
  (['Low', 'Moderate', 'High'] as ConfidenceTier[]).forEach((t) => {
    console.log(`  ${t}: ${tierCounts[t]} (${((tierCounts[t] / N_MATCHES) * 100).toFixed(1)}%)`);
  });

  console.log('\n=== Bonus-2: role-fit swing rate ===');
  console.log(`  advantageDirection changed with vs without roles: ${roleFitFlips}/${N_MATCHES} (${((roleFitFlips / N_MATCHES) * 100).toFixed(2)}%)`);

  console.log('\n=== Bonus-3 & real winRate: correlations ===');
  const heroArray = [...heroStats.values()];
  const favoredRates = heroArray.map((h) => (h.appearances - h.evenCount === 0 ? 0.5 : h.favoredCount / (h.appearances - h.evenCount)));
  const avgContribution = heroArray.map((h) => h.contributionSum / h.appearances);
  const realWinRates = heroArray.map((h) => h.realWinRate ?? 0.5);
  console.log(`  raw strength (avg axis contribution) vs favored-rate: r=${(pearson(avgContribution, favoredRates) ?? NaN).toFixed(3)}`);
  console.log(`  favored-rate vs real OpenDota winRate: r=${(pearson(favoredRates, realWinRates) ?? NaN).toFixed(3)}`);

  console.log('\n=== Bonus-5: hero-meta.json pair coverage (global, not match-sampled) ===');
  const coverage = computeGlobalPairCoverage(heroes, rawMetaEntries);
  console.log(`  total hero pairs: ${coverage.totalPairs}`);
  console.log(`  with synergy data (>=10 games): ${coverage.synergyCovered} (${((coverage.synergyCovered / coverage.totalPairs) * 100).toFixed(1)}%)`);
  console.log(`  with matchup data (>=10 games): ${coverage.matchupCoveredEitherDirection} (${((coverage.matchupCoveredEitherDirection / coverage.totalPairs) * 100).toFixed(1)}%)`);

  console.log(`\n=== Q4: top ${EXTREME_CASES_TO_KEEP} most lopsided matches (by |diff|) ===`);
  const extremes = [...matchRecords].sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)).slice(0, EXTREME_CASES_TO_KEEP);
  for (const m of extremes) {
    console.log(
      `  diff=${m.diff.toFixed(2)} [${m.confidenceTier}/${m.advantageDirection}] top axis: ${m.topAxis}\n    A: ${m.teamANames.map((n, i) => `${n} (${m.teamARoles[i]})`).join(', ')}\n    B: ${m.teamBNames.map((n, i) => `${n} (${m.teamBRoles[i]})`).join(', ')}`,
    );
  }

  console.log(`\n=== Q4: top ${LEADERBOARD_SIZE} synergy pairs (by real winRate, min count 3) ===`);
  const topSynergy = [...synergyLeaderboard.values()]
    .filter((p) => p.count >= 3)
    .sort((a, b) => b.winRate - a.winRate)
    .slice(0, LEADERBOARD_SIZE);
  for (const p of topSynergy) {
    console.log(`  ${p.heroA} + ${p.heroB}: winRate=${(p.winRate * 100).toFixed(1)}% (best-pair-in-team ${p.count}x)`);
  }

  console.log(`\n=== Q4: top ${LEADERBOARD_SIZE} matchup edges (by real winRate, min count 3) ===`);
  const topMatchup = [...matchupLeaderboard.values()]
    .filter((p) => p.count >= 3)
    .sort((a, b) => b.winRate - a.winRate)
    .slice(0, LEADERBOARD_SIZE);
  for (const p of topMatchup) {
    console.log(`  ${p.hero} vs ${p.vs}: winRate=${(p.winRate * 100).toFixed(1)}% (best-edge-in-matchup ${p.count}x)`);
  }

  // ================= JSON dump for further inspection =================
  const heroTable = heroArray
    .map((h, i) => ({
      heroId: h.heroId,
      name: h.name,
      appearances: h.appearances,
      favoredRate: favoredRates[i],
      avgContribution: avgContribution[i],
      realWinRate: h.realWinRate,
      divergenceFromReal: h.realWinRate === null ? null : favoredRates[i] - h.realWinRate,
    }))
    .sort((a, b) => (b.divergenceFromReal ?? 0) - (a.divergenceFromReal ?? 0));

  fs.writeFileSync(
    OUTPUT_PATH,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        nMatches: N_MATCHES,
        heroTable,
        extremeCases: extremes,
        topSynergyPairs: topSynergy,
        topMatchupEdges: topMatchup,
      },
      null,
      2,
    ),
  );
  console.log(`\nFull per-hero table + extremes + leaderboards written to ${OUTPUT_PATH}`);

  console.log('\n=== Heroes with largest favoredRate vs real winRate divergence (candidates for review) ===');
  for (const h of heroTable.slice(0, 10)) {
    console.log(
      `  ${h.name}: favoredRate=${(h.favoredRate * 100).toFixed(1)}% real=${h.realWinRate === null ? 'n/a' : (h.realWinRate * 100).toFixed(1) + '%'} divergence=${h.divergenceFromReal === null ? 'n/a' : ((h.divergenceFromReal ?? 0) * 100).toFixed(1) + 'pp'}`,
    );
  }
}

main();
