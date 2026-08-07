// ⚠️ GOTCHA (rediscovered 2026-08-06, see Blueprint/11-operational-notes.md):
// battle-resolution.ts reads server/data/axis-weights.json into a top-level
// `const` ONCE at module import time — this script imports battle-resolution
// statically above, so by the time main() runs, realWinRateWeight is already
// baked in for the whole process. There is no way to toggle it between runs
// from inside this script. To get a non-circular read (real winRate isn't
// fed back into the score as a multiplier), the file must be patched to
// `realWinRateWeight: 0` BEFORE this script is invoked, and restored after —
// e.g.:
//   cp data/axis-weights.json data/axis-weights.json.bak
//   node -e "const fs=require('fs');const w=JSON.parse(fs.readFileSync('data/axis-weights.json'));w.realWinRateWeight=0;fs.writeFileSync('data/axis-weights.json',JSON.stringify(w,null,2)+'\n')"
//   npx ts-node scripts/simulate-self-play.ts
//   cp data/axis-weights.json.bak data/axis-weights.json && rm data/axis-weights.json.bak
// Forgetting this makes every r-value in the output circular/inflated (real
// winRate directly multiplies into the score) — this exact mistake was made
// once already on the first 300k×10-seed run this script's driver was built
// for, silently producing r≈0.42 instead of the honest ≈0.19-0.21.
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
import { roleAwareAxisValue } from '../src/common/role-fit';
import { HeroMetaService } from '../src/hero-meta/hero-meta.service';
import { ROLES, hasRoleEvaluationData } from 'shared';
import type { Hero, PresumedPosition } from 'shared';

// Test 3 (per the calibration session plan) — internal self-consistency
// check, NOT a real-world validity check like calibrate-battle-engine.ts.
// Draws random 5v5 lineups from the full 127-hero pool many times and grades
// the model against *itself* (does a hero's raw strength track how often
// their side comes out favored?) to surface formula artifacts at the outcome
// level, not just the individual-axis level `check-axis-distribution.ts`
// already covers. Real OpenDota `winRate` is attached per hero as an
// external anchor — if a hero's in-system favored-rate diverges sharply from
// their real winRate, that's a stronger signal than divergence found purely
// inside our own simulation.
//
// Reuses assessBattle() (the same deterministic core resolveBattle() calls
// in production) rather than reimplementing the diff/tier/direction math —
// same reasoning as calibrate-battle-engine.ts: don't grade a copy of the
// logic, grade what's actually shipped.
//
// Seeded + multi-run driver (2026-08-06, requested after the manual-power-
// overrides investigation exposed real run-to-run noise — a same-code rerun
// swung r by up to 0.15 and individual heroes' favoredRate by 2-3pp).
// `runSimulation()` is the reusable core; `main()` drives it across several
// fixed seeds and TWO role-assignment modes:
//   - 'blended' (the original behavior): each hero's role draw is weighted
//     by their real presumed_positions share, with leftover probability mass
//     spread uniformly across all 5 roles — so a hero occasionally gets
//     assigned a role they rarely/never really play (the miscast-fallback
//     scenario common/role-fit.ts's supportMiscastMultiplier and the no_info
//     fallback in roleAwareAxisValue exist to handle).
//   - 'strict': role draw weighted ONLY by roles where the hero has real
//     per-role evaluation_values_by_role data (hasRoleEvaluationData) — no
//     leftover mass on no_info roles at all. Isolates "is the per-role
//     CALIBRATION itself accurate" from "does the miscast/fallback handling
//     hold up" — those were being tested together in every 'blended' run.
const HEROES_PATH = path.join(__dirname, '..', 'data', 'heroes.json');
const HERO_META_PATH = path.join(__dirname, '..', 'data', 'hero-meta.json');
const OUTPUT_DIR = path.join(__dirname, '..', 'data');

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
// arguments blows the V8 call-stack limit.
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

// mulberry32 — small, fast, good-enough-for-this seeded PRNG. Deterministic
// per seed so a "same config, same seed" run is exactly reproducible, while
// different seeds give genuinely independent draws for the variance estimate
// this whole refactor exists for.
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Module-level so shuffle()/assignWeightedRoles() below don't need it threaded
// through every call site — reassigned per run in runSimulation().
let rng: () => number = Math.random;

function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 'blended' mode weights (original behavior, Blueprint/10-tech-debt-
// backlog.md "control-support cluster") — each hero's role draw weighted by
// real presumed_positions share; leftover probability mass (shares rarely
// sum to 1) spread uniformly across all 5 roles, so even a heavily-typed
// hero occasionally draws an off-role assignment. hero-meta.json's
// `positions` only has 4 buckets (no Hard/Soft Support split) — Support
// share is split evenly between them.
function blendedRoleWeights(positions: { position: string; share: number }[]): Record<string, number> {
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

// 'strict' mode weights (new, 2026-08-06) — only roles where the hero has
// real evaluation_values_by_role data get ANY weight; no leftover uniform
// mass on no_info roles. A hero with real data in only 1 role effectively
// always plays that role in this mode. Every hero in the current roster has
// real data in >=1 role (confirmed via research-role-threshold-coverage.json
// this session), so the all-zero fallback below is a safety net, not the
// expected path.
function strictRoleWeights(hero: Hero, positions: { position: string; share: number }[]): Record<string, number> {
  const w: Record<string, number> = { Carry: 0, Mid: 0, Offlane: 0, 'Soft Support': 0, 'Hard Support': 0 };
  for (const p of positions) {
    if (!hasRoleEvaluationData(hero, p.position as PresumedPosition)) continue;
    if (p.position === 'Carry') w.Carry += p.share;
    else if (p.position === 'Mid') w.Mid += p.share;
    else if (p.position === 'Offlane') w.Offlane += p.share;
    else if (p.position === 'Support') { w['Soft Support'] += p.share / 2; w['Hard Support'] += p.share / 2; }
  }
  const total = Object.values(w).reduce((a, b) => a + b, 0);
  if (total === 0) return Object.fromEntries(ROLES.map((r) => [r, 1])); // safety net, not expected to trigger
  for (const role of Object.keys(w)) w[role] = w[role] / total;
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
    let roll = rng() * total;
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
  return AXES.reduce((sum, axis) => sum + roleAwareAxisValue(axis, hero, role), 0) / AXES.length;
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

interface RoleStats {
  heroId: number;
  name: string;
  assignedRole: string;
  appearances: number;
  favoredCount: number;
  evenCount: number;
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

interface RunConfig {
  seed: number;
  nMatches: number;
  roleMode: 'blended' | 'strict';
  verbose: boolean;
  writeOutput: boolean;
  outputPath?: string;
}

interface RunResult {
  seed: number;
  roleMode: 'blended' | 'strict';
  nMatches: number;
  rContribFav: number | null;
  rFavReal: number | null;
  avgAbsDivergencePp: number;
  flaggedCount: number;
  heroTable: {
    heroId: number;
    name: string;
    appearances: number;
    favoredRate: number;
    avgContribution: number;
    realWinRate: number | null;
    divergenceFromReal: number | null;
  }[];
}

function runSimulation(config: RunConfig): RunResult {
  rng = mulberry32(config.seed);

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
  const roleWeightsById = new Map(
    heroes.map((h) => [
      h.id,
      config.roleMode === 'strict'
        ? strictRoleWeights(h, positionsById.get(h.id) ?? [])
        : blendedRoleWeights(positionsById.get(h.id) ?? []),
    ]),
  );

  const heroMeta = new HeroMetaService();
  const { synergyGames, matchupGames } = buildGamesLookup(rawMetaEntries);
  const winRateById = new Map(rawMetaEntries.map((e) => [e.heroId, e.winRate]));

  const heroStats = new Map<number, HeroStats>(
    heroes.map((h) => [
      h.id,
      { heroId: h.id, name: h.name, appearances: 0, favoredCount: 0, evenCount: 0, contributionSum: 0, realWinRate: winRateById.get(h.id) ?? null },
    ]),
  );
  const roleStats = new Map<string, RoleStats>();
  function trackRole(hero: Hero, assignedRole: string | null, favored: boolean, even: boolean) {
    if (!assignedRole) return;
    const key = `${hero.id}_${assignedRole}`;
    if (!roleStats.has(key)) {
      roleStats.set(key, { heroId: hero.id, name: hero.name, assignedRole, appearances: 0, favoredCount: 0, evenCount: 0 });
    }
    const s = roleStats.get(key)!;
    s.appearances++;
    if (even) s.evenCount++;
    else if (favored) s.favoredCount++;
  }

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

  const N_MATCHES = config.nMatches;

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
      const even = assessment.advantageDirection === 'Even';
      const favored = assessment.advantageDirection === 'A';
      if (even) stats.evenCount++;
      else if (favored) stats.favoredCount++;
      trackRole(p.hero, p.assignedRole, favored, even);
    }
    for (const p of teamB) {
      const stats = heroStats.get(p.hero.id)!;
      stats.appearances++;
      stats.contributionSum += heroContribution(p.hero, p.assignedRole);
      const even = assessment.advantageDirection === 'Even';
      const favored = assessment.advantageDirection === 'B';
      if (even) stats.evenCount++;
      else if (favored) stats.favoredCount++;
      trackRole(p.hero, p.assignedRole, favored, even);
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

  const heroArray = [...heroStats.values()];
  const favoredRates = heroArray.map((h) => (h.appearances - h.evenCount === 0 ? 0.5 : h.favoredCount / (h.appearances - h.evenCount)));
  const avgContribution = heroArray.map((h) => h.contributionSum / h.appearances);
  const realWinRates = heroArray.map((h) => h.realWinRate ?? 0.5);
  const rContribFav = pearson(avgContribution, favoredRates);
  const rFavReal = pearson(favoredRates, realWinRates);

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

  const withReal = heroTable.filter((h) => h.divergenceFromReal !== null);
  const avgAbsDivergencePp = mean(withReal.map((h) => Math.abs(h.divergenceFromReal as number))) * 100;
  const flaggedCount = withReal.filter((h) => Math.abs(h.divergenceFromReal as number) >= 0.1).length;

  if (config.verbose) {
    console.log(`\n########## roleMode=${config.roleMode} seed=${config.seed} nMatches=${N_MATCHES} ##########\n`);
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

    console.log('\n=== Q3: how much do synergy/counters actually move the decision? ===');
    console.log(`  direction flips (raw overallPower-only vs final): ${directionFlips}/${N_MATCHES} (${((directionFlips / N_MATCHES) * 100).toFixed(1)}%)`);
    console.log(`  matches with any non-zero synergy signal: ${nonZeroSynergyMatches}/${N_MATCHES} (${((nonZeroSynergyMatches / N_MATCHES) * 100).toFixed(1)}%)`);
    console.log(`  matches with any non-zero matchup signal: ${nonZeroMatchupMatches}/${N_MATCHES} (${((nonZeroMatchupMatches / N_MATCHES) * 100).toFixed(1)}%)`);
    console.log(`  avg |synergyBonus| when non-zero: ${synergyMagnitudes.length ? mean(synergyMagnitudes).toFixed(4) : 'n/a'} (n=${synergyMagnitudes.length})`);
    console.log(`  avg |matchupEdge| when non-zero: ${matchupMagnitudes.length ? mean(matchupMagnitudes).toFixed(4) : 'n/a'} (n=${matchupMagnitudes.length})`);

    console.log('\n=== Bonus-4: does thinner backing data correlate with bigger distortion? ===');
    const bgGames = backingGamesVsDistortion.map((r) => r.avgGames);
    const bgDist = backingGamesVsDistortion.map((r) => r.distortion);
    const rBacking = pearson(bgGames, bgDist);
    console.log(`  n=${backingGamesVsDistortion.length} matches with any qualifying (>=10 games) synergy/matchup data`);
    console.log(`  Pearson r (avg backing games vs |diff shift from raw|): ${rBacking === null ? 'n/a' : rBacking.toFixed(3)}`);
    const thin = backingGamesVsDistortion.filter((r2) => r2.avgGames < THIN_DATA_GAMES_THRESHOLD);
    const strong = backingGamesVsDistortion.filter((r2) => r2.avgGames >= THIN_DATA_GAMES_THRESHOLD);
    console.log(`  thin (<${THIN_DATA_GAMES_THRESHOLD} games avg), n=${thin.length}: avg distortion=${thin.length ? mean(thin.map((x) => x.distortion)).toFixed(4) : 'n/a'}`);
    console.log(`  strong (>=${THIN_DATA_GAMES_THRESHOLD} games avg), n=${strong.length}: avg distortion=${strong.length ? mean(strong.map((x) => x.distortion)).toFixed(4) : 'n/a'}`);

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
    console.log(`  raw strength (avg axis contribution) vs favored-rate: r=${(rContribFav ?? NaN).toFixed(3)}`);
    console.log(`  favored-rate vs real OpenDota winRate: r=${(rFavReal ?? NaN).toFixed(3)}`);

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
    const topSynergy = [...synergyLeaderboard.values()].filter((p) => p.count >= 3).sort((a, b) => b.winRate - a.winRate).slice(0, LEADERBOARD_SIZE);
    for (const p of topSynergy) console.log(`  ${p.heroA} + ${p.heroB}: winRate=${(p.winRate * 100).toFixed(1)}% (best-pair-in-team ${p.count}x)`);

    console.log(`\n=== Q4: top ${LEADERBOARD_SIZE} matchup edges (by real winRate, min count 3) ===`);
    const topMatchup = [...matchupLeaderboard.values()].filter((p) => p.count >= 3).sort((a, b) => b.winRate - a.winRate).slice(0, LEADERBOARD_SIZE);
    for (const p of topMatchup) console.log(`  ${p.hero} vs ${p.vs}: winRate=${(p.winRate * 100).toFixed(1)}% (best-edge-in-matchup ${p.count}x)`);

    console.log('\n=== Heroes with largest favoredRate vs real winRate divergence (candidates for review) ===');
    for (const h of heroTable.slice(0, 10)) {
      console.log(`  ${h.name}: favoredRate=${(h.favoredRate * 100).toFixed(1)}% real=${h.realWinRate === null ? 'n/a' : (h.realWinRate * 100).toFixed(1) + '%'} divergence=${h.divergenceFromReal === null ? 'n/a' : ((h.divergenceFromReal ?? 0) * 100).toFixed(1) + 'pp'}`);
    }

    // Carry/Mid-only heroes forced into Support with no real data — does the
    // OLD roleFitValue fallback (used when evaluation_values_by_role is
    // no_info) hold up? Only meaningful in 'blended' mode — 'strict' mode
    // never assigns a hero to a no_info role at all.
    if (config.roleMode === 'blended') {
      const thresholdPath = path.join(__dirname, '..', 'data', 'research-role-threshold-coverage.json');
      if (fs.existsSync(thresholdPath)) {
        interface ThresholdEntry {
          heroId: number;
          name: string;
          Carry: { pass: boolean };
          Mid: { pass: boolean };
          Support: { pass: boolean };
        }
        const thresholds: ThresholdEntry[] = JSON.parse(fs.readFileSync(thresholdPath, 'utf-8'));
        const carryMidNoSupport = thresholds.filter((t) => !t.Support.pass && (t.Carry.pass || t.Mid.pass));
        const targetIds = new Set(carryMidNoSupport.map((t) => t.heroId));

        const rows: { name: string; role: string; appearances: number; favoredRate: number; realWinRate: number | null }[] = [];
        for (const s of roleStats.values()) {
          if (!targetIds.has(s.heroId)) continue;
          if (s.assignedRole !== 'Hard Support' && s.assignedRole !== 'Soft Support') continue;
          const nonEven = s.appearances - s.evenCount;
          rows.push({
            name: s.name,
            role: s.assignedRole,
            appearances: s.appearances,
            favoredRate: nonEven === 0 ? 0.5 : s.favoredCount / nonEven,
            realWinRate: winRateById.get(s.heroId) ?? null,
          });
        }
        rows.sort((a, b) => b.favoredRate - a.favoredRate);
        console.log(`\n=== Carry/Mid-only heroes (no real Support data, n=${carryMidNoSupport.length}) forced into Hard/Soft Support ===`);
        const favRates = rows.map((r) => r.favoredRate);
        console.log(`  n=${rows.length} (hero,role) rows, avg favoredRate=${(mean(favRates) * 100).toFixed(1)}%`);
      }
    }
  }

  if (config.writeOutput) {
    const outputPath = config.outputPath ?? path.join(OUTPUT_DIR, `self-play-simulation-output.json`);
    fs.writeFileSync(
      outputPath,
      JSON.stringify({ generatedAt: new Date().toISOString(), seed: config.seed, roleMode: config.roleMode, nMatches: N_MATCHES, heroTable }, null, 2),
    );
    if (config.verbose) console.log(`\nFull per-hero table written to ${outputPath}`);
  }

  return {
    seed: config.seed,
    roleMode: config.roleMode,
    nMatches: N_MATCHES,
    rContribFav,
    rFavReal,
    avgAbsDivergencePp,
    flaggedCount,
    heroTable,
  };
}

// ---------- multi-seed driver ----------

const N_MATCHES = 300000;
const SEEDS = [1, 2, 3, 4, 5];

function main() {
  const results: RunResult[] = [];

  for (const roleMode of ['blended', 'strict'] as const) {
    console.log(`\n============================== roleMode: ${roleMode} ==============================`);
    for (const [i, seed] of SEEDS.entries()) {
      const res = runSimulation({
        seed,
        nMatches: N_MATCHES,
        roleMode,
        verbose: i === 0, // full report only for the first seed of each mode
        writeOutput: i === 0,
        outputPath: path.join(OUTPUT_DIR, `self-play-simulation-output-${roleMode}.json`),
      });
      results.push(res);
      console.log(
        `[${roleMode}] seed=${seed}  rFavReal=${res.rFavReal === null ? 'n/a' : res.rFavReal.toFixed(3)}  avgAbsDiv=${res.avgAbsDivergencePp.toFixed(2)}pp  flagged(>=10pp)=${res.flaggedCount}/127`,
      );
    }
  }

  console.log(`\n============================== SUMMARY (${SEEDS.length} seeds each, ${N_MATCHES} matches/run) ==============================`);
  for (const roleMode of ['blended', 'strict'] as const) {
    const subset = results.filter((r) => r.roleMode === roleMode);
    const rs = subset.map((r) => r.rFavReal).filter((v): v is number => v !== null);
    const divs = subset.map((r) => r.avgAbsDivergencePp);
    const flagged = subset.map((r) => r.flaggedCount);
    const rMean = mean(rs);
    console.log(`\n  ${roleMode}:`);
    console.log(`    r (favoredRate vs realWinRate): mean=${rMean.toFixed(3)} sd=${stdev(rs, rMean).toFixed(3)} min=${arrMin(rs).toFixed(3)} max=${arrMax(rs).toFixed(3)}`);
    console.log(`    avg |divergence|: mean=${mean(divs).toFixed(2)}pp min=${arrMin(divs).toFixed(2)}pp max=${arrMax(divs).toFixed(2)}pp`);
    console.log(`    flagged (>=10pp): mean=${mean(flagged).toFixed(1)} min=${arrMin(flagged)} max=${arrMax(flagged)}`);
  }

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'self-play-multiseed-summary.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), nMatchesPerRun: N_MATCHES, seeds: SEEDS, results }, null, 2),
  );
  console.log(`\nFull multi-seed results written to ${path.join(OUTPUT_DIR, 'self-play-multiseed-summary.json')}`);
}

main();
