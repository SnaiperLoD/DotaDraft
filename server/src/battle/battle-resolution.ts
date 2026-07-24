import * as fs from 'fs';
import * as path from 'path';
import type { Hero, HeroEvaluationValues } from 'shared';
import { roleFitValue } from '../common/role-fit';
import { hardCarryPenalty, isHardCarry } from '../common/hard-carry';

export interface MatchupLookup {
  getMatchupWinRate(heroId: number, opponentHeroId: number): number | null;
  getSynergyWinRate(heroId: number, allyHeroId: number): number | null;
  getWinRate(heroId: number): number | null;
}

// A team member plus the role they were assigned — assignedRole is null
// when no role data is available (legacy Opponent Pool rows committed
// before roles were stored there; see Blueprint/10-tech-debt-backlog.md).
// roleFitValue() already treats null as "no boost", so this degrades
// gracefully rather than erroring.
export interface BattlePick {
  hero: Hero;
  assignedRole: string | null;
}

export type ConfidenceTier = 'Low' | 'Moderate' | 'High';
export type AdvantageDirection = 'A' | 'B' | 'Even';
export type ResolvedOutcome = 'Win' | 'Lose';

export interface BattleResult {
  resolvedOutcome: ResolvedOutcome;
  advantageDirection: AdvantageDirection;
  confidenceTier: ConfidenceTier;
  advantages: string[];
  disadvantages: string[];
  explanation: string[];
}

export const AXES: (keyof HeroEvaluationValues)[] = [
  'teamfight',
  'tempo',
  'scaling',
  'mobility',
  'objectives',
  'control',
  'durability',
  'burst',
  'map_control',
  'saving',
  'initiating',
];

// Win-weight bands per Blueprint/06-battle-engine.md Resolution — the
// favored side's win probability at each Confidence Tier. Deliberately
// never near 0/1: even a High-confidence favorite should lose sometimes
// (Upsets rule), or the tier system is just a disguised deterministic
// outcome.
export const WIN_WEIGHT_BY_TIER: Record<ConfidenceTier, number> = {
  High: 0.72,
  Moderate: 0.62,
  Low: 0.53,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// Adjusts an axis's influence on the decision, independent of its displayed
// 0-10 value (axisAverage() below stays raw/undiscounted — this only
// affects how much the axis counts toward overallPower and the
// advantages/disadvantages/topAxisDelta selection). Externalized to
// server/data/axis-weights.json (loaded once, at module load, same pattern
// HeroMetaService uses for hero-meta.json) rather than hardcoded, since
// these get retuned frequently as calibration scripts turn up new findings
// — see Blueprint/10-tech-debt-backlog.md for the reasoning behind each
// current entry (map_control/tempo/durability/objectives) and the real
// winRate blend below.
interface AxisWeightsConfig {
  axisWeights: Partial<Record<keyof HeroEvaluationValues, number>>;
  // Strength of the real-winRate multiplier below — 0 disables it entirely
  // (explicit stub, Blueprint/10-tech-debt-backlog.md: flagged as a
  // hard-to-calibrate parameter, deferred rather than risk overtuning it
  // blind). The 30%-of-result ceiling (REAL_WIN_RATE_CAP below) is a fixed
  // architectural breakpoint, NOT controlled by this weight — raising this
  // past 0 later only changes how fast real winRate edge approaches that
  // ceiling, never how far past it.
  realWinRateWeight: number;
}

const AXIS_WEIGHTS_PATH = path.join(__dirname, '..', '..', 'data', 'axis-weights.json');
const axisWeightsConfig: AxisWeightsConfig = JSON.parse(fs.readFileSync(AXIS_WEIGHTS_PATH, 'utf-8'));

function axisWeight(axis: keyof HeroEvaluationValues): number {
  return axisWeightsConfig.axisWeights[axis] ?? 1;
}

// Breakpoint (Blueprint/10-tech-debt-backlog.md): real OpenDota winRate must
// never account for more than 30% of a team's power, in either direction —
// a hard cap independent of realWinRateWeight, so raising that weight later
// can never accidentally let real winRate dominate/replace the axis-based
// assessment. Mirrors synergyBonus/matchupEdge's clamp(0.3, 1.7) shape
// (±70% there vs ±30% here — deliberately a tighter leash, since unlike
// synergy/matchup this is a single per-hero stat, not drawn from this
// specific matchup's own data).
const REAL_WIN_RATE_CAP = 0.3;

// Average of (winRate - 0.5) across the team's heroes with known real
// winRate — distinct from evaluation_values (built from performance-per-
// minute stats that can stay high even in losing games), this is literally
// each hero's real win/loss record (hero-meta.json's `winRate`).
function realWinRateEdge(team: Hero[], lookup: MatchupLookup): number {
  const edges = team
    .map((h) => lookup.getWinRate(h.id))
    .filter((wr): wr is number => wr !== null)
    .map((wr) => wr - 0.5);
  return edges.length === 0 ? 0 : edges.reduce((s, d) => s + d, 0) / edges.length;
}

// Role-fit-adjusted: a pick's contribution to the axis average is boosted
// per common/role-fit.ts if their assigned role cares about this axis and
// they're already strong on it. assignedRole is null for opponent sides
// without stored role data (see BattlePick) — roleFitValue no-ops on null.
// Deliberately NOT axis-weighted — this is the informational "team average
// on this axis" value (e.g. Evaluation Engine breakdown rows), which should
// stay the true value even for a temporarily-discounted axis.
export function axisAverage(team: BattlePick[], axis: keyof HeroEvaluationValues): number {
  return (
    team.reduce((sum, p) => sum + roleFitValue(axis, p.assignedRole, p.hero.evaluation_values[axis]), 0) /
    team.length
  );
}

function overallPower(team: BattlePick[]): number {
  const axisWeightedSum = AXES.reduce((sum, axis) => sum + axisAverage(team, axis) * axisWeight(axis), 0);
  const axisTotalWeight = AXES.reduce((sum, axis) => sum + axisWeight(axis), 0);
  return axisWeightedSum / axisTotalWeight;
}

// Average of (winRate - 0.5) across all valid matchup pairs — positive means
// team's heroes generally win their individual matchups against opponent's.
function matchupEdge(team: Hero[], opponent: Hero[], lookup: MatchupLookup): number {
  const deltas: number[] = [];
  for (const a of team) {
    for (const b of opponent) {
      const wr = lookup.getMatchupWinRate(a.id, b.id);
      if (wr !== null) deltas.push(wr - 0.5);
    }
  }
  return deltas.length === 0 ? 0 : deltas.reduce((s, d) => s + d, 0) / deltas.length;
}

function synergyBonus(team: Hero[], lookup: MatchupLookup): number {
  const deltas: number[] = [];
  for (let i = 0; i < team.length; i++) {
    for (let j = i + 1; j < team.length; j++) {
      const wr = lookup.getSynergyWinRate(team[i].id, team[j].id);
      if (wr !== null) deltas.push(wr - 0.5);
    }
  }
  return deltas.length === 0 ? 0 : deltas.reduce((s, d) => s + d, 0) / deltas.length;
}

export function bestSynergyPair(
  team: Hero[],
  lookup: MatchupLookup,
): { heroA: string; heroB: string; winRate: number } | null {
  let best: { heroA: string; heroB: string; winRate: number } | null = null;
  for (let i = 0; i < team.length; i++) {
    for (let j = i + 1; j < team.length; j++) {
      const wr = lookup.getSynergyWinRate(team[i].id, team[j].id);
      if (wr !== null && (!best || wr > best.winRate)) {
        best = { heroA: team[i].name, heroB: team[j].name, winRate: wr };
      }
    }
  }
  return best;
}

export function bestMatchupEdge(
  team: Hero[],
  opponent: Hero[],
  lookup: MatchupLookup,
): { hero: string; vs: string; winRate: number } | null {
  let best: { hero: string; vs: string; winRate: number } | null = null;
  for (const h of team) {
    for (const o of opponent) {
      const wr = lookup.getMatchupWinRate(h.id, o.id);
      if (wr !== null && (!best || wr > best.winRate)) {
        best = { hero: h.name, vs: o.name, winRate: wr };
      }
    }
  }
  return best;
}

export const AXIS_LABEL: Record<keyof HeroEvaluationValues, string> = {
  teamfight: 'teamfight',
  tempo: 'tempo',
  scaling: 'late-game scaling',
  mobility: 'mobility',
  objectives: 'objective pressure',
  control: 'control',
  durability: 'durability',
  burst: 'burst damage',
  map_control: 'map control',
  saving: 'ally saving power',
  initiating: 'initiation potential',
};

function describeAxis(axis: keyof HeroEvaluationValues, favorsA: boolean): string {
  return `${favorsA ? 'an edge in' : 'a deficit in'} ${AXIS_LABEL[axis]}`;
}

interface ExplanationContext {
  advantageDirection: AdvantageDirection;
  confidenceTier: ConfidenceTier;
  resolvedOutcome: ResolvedOutcome;
  teamA: Hero[];
  teamB: Hero[];
  lookup: MatchupLookup;
  topAxisDelta: { axis: keyof HeroEvaluationValues; delta: number };
}

function buildExplanation(ctx: ExplanationContext): string[] {
  const { advantageDirection, confidenceTier, resolvedOutcome, teamA, teamB, lookup, topAxisDelta } = ctx;

  if (advantageDirection === 'Even') {
    return [
      `This is a close matchup with no clear favorite (${confidenceTier} confidence) — ${describeAxis(topAxisDelta.axis, topAxisDelta.delta > 0)} for your draft was the closest thing to an edge.`,
      resolvedOutcome === 'Win'
        ? 'Your draft came out on top in what was essentially a coin flip.'
        : 'Your draft came up just short in what was essentially a coin flip.',
    ];
  }

  const favoredIsA = advantageDirection === 'A';
  const userWon = resolvedOutcome === 'Win';
  const isUpset = favoredIsA ? !userWon : userWon;

  const favoredLabel = favoredIsA ? 'Your draft' : "Opponent's draft";
  const underdogTeam = favoredIsA ? teamB : teamA;
  const favoredTeam = favoredIsA ? teamA : teamB;

  const axisFavorsFavoredSide = favoredIsA === topAxisDelta.delta > 0;
  const baseLine = `${favoredLabel} leaned ahead overall (${confidenceTier} confidence), with ${describeAxis(topAxisDelta.axis, axisFavorsFavoredSide)} standing out.`;

  if (!isUpset) {
    const closingLine = favoredIsA
      ? userWon
        ? 'That advantage held up.'
        : 'That advantage should have held up — this loss runs against the grain.'
      : userWon
        ? "The opponent's edge should have held up — this win runs against the grain."
        : 'That edge held up here.';
    return [baseLine, closingLine];
  }

  // Upset: the underdog won. Cite real, specific advantages the underdog
  // draft actually had — never "the model was wrong" (Upsets rule).
  const synergy = bestSynergyPair(underdogTeam, lookup);
  const matchup = bestMatchupEdge(underdogTeam, favoredTeam, lookup);
  const reasons: string[] = [];
  if (matchup) {
    reasons.push(`${matchup.hero}'s strong individual matchup into ${matchup.vs}`);
  }
  if (synergy) {
    reasons.push(`the ${synergy.heroA} + ${synergy.heroB} combination`);
  }

  const underdogLabel = favoredIsA ? "opponent's draft" : 'your draft';
  const upsetLine =
    reasons.length > 0
      ? `But ${underdogLabel} had real advantages of its own — ${reasons.join(' and ')} — that made this upset plausible.`
      : `But every draft has some edge even in a losing matchup, and here it was enough for ${underdogLabel} to pull off the upset.`;

  return [baseLine, upsetLine];
}

// Magnitude `diff` (post synergy/matchup multipliers) must clear before a
// side counts as favored at all — below this, it's 'Even'.
export const ADVANTAGE_THRESHOLD = 0.15;

export interface BattleAssessment {
  powerA: number;
  powerB: number;
  diff: number;
  confidenceTier: ConfidenceTier;
  advantageDirection: AdvantageDirection;
  // Matchup/synergy inputs, exposed for calibration scripts that want to
  // measure how much they actually move the classification (see
  // Blueprint/10-tech-debt-backlog.md, "Battle Engine Confidence Tier").
  edgeA: number;
  synergyBonusA: number;
  synergyBonusB: number;
  winRateEdgeA: number;
  winRateEdgeB: number;
  hardCarryCountA: number;
  hardCarryCountB: number;
  // What advantageDirection would be from overallPower alone, with no
  // synergy/matchup/real-winRate/hard-carry multipliers applied — the
  // counterfactual used to measure how often those multipliers actually
  // change the outcome.
  rawDiff: number;
  rawAdvantageDirection: AdvantageDirection;
  axisDeltas: { axis: keyof HeroEvaluationValues; delta: number }[];
}

// Deterministic half of resolveBattle — everything computed before the
// random win/lose draw. Exported so calibration scripts (e.g.
// calibrate-battle-engine.ts, simulate-self-play.ts) can grade the model's
// actual assessment against real outcomes without duplicating this logic,
// same as resolveBattle() itself does for the live Battle Mode.
export function assessBattle(
  teamA: BattlePick[],
  teamB: BattlePick[],
  lookup: MatchupLookup,
): BattleAssessment {
  const heroesA = teamA.map((p) => p.hero);
  const heroesB = teamB.map((p) => p.hero);
  const edgeA = matchupEdge(heroesA, heroesB, lookup);
  const synergyBonusA = synergyBonus(heroesA, lookup);
  const synergyBonusB = synergyBonus(heroesB, lookup);
  const winRateEdgeA = realWinRateEdge(heroesA, lookup);
  const winRateEdgeB = realWinRateEdge(heroesB, lookup);
  const hardCarryCountA = heroesA.filter(isHardCarry).length;
  const hardCarryCountB = heroesB.filter(isHardCarry).length;

  const rawPowerA = overallPower(teamA);
  const rawPowerB = overallPower(teamB);
  const rawDiff = rawPowerA - rawPowerB;
  const rawAdvantageDirection: AdvantageDirection =
    rawDiff > ADVANTAGE_THRESHOLD ? 'A' : rawDiff < -ADVANTAGE_THRESHOLD ? 'B' : 'Even';

  // Non-Linearity Rule: synergy, matchup edge, and real winRate each modify
  // their team's *own* effective power multiplicatively (amplify/dampen),
  // rather than being added as flat bonus points on top of a linear total.
  // Applying the matchup multiplier per-side (not to the already-combined
  // diff) means a strong counter matchup can still swing an otherwise-even
  // matchup, instead of only ever scaling an existing advantage.
  const powerA =
    rawPowerA *
    clamp(1 + synergyBonusA * 2, 0.3, 1.7) *
    clamp(1 + edgeA * 3, 0.3, 1.7) *
    clamp(1 + winRateEdgeA * axisWeightsConfig.realWinRateWeight, 1 - REAL_WIN_RATE_CAP, 1 + REAL_WIN_RATE_CAP) *
    (1 - hardCarryPenalty(heroesA));
  const powerB =
    rawPowerB *
    clamp(1 + synergyBonusB * 2, 0.3, 1.7) *
    clamp(1 - edgeA * 3, 0.3, 1.7) *
    clamp(1 + winRateEdgeB * axisWeightsConfig.realWinRateWeight, 1 - REAL_WIN_RATE_CAP, 1 + REAL_WIN_RATE_CAP) *
    (1 - hardCarryPenalty(heroesB));

  const diff = powerA - powerB;

  const confidenceTier: ConfidenceTier =
    Math.abs(diff) > 1.5 ? 'High' : Math.abs(diff) > 0.5 ? 'Moderate' : 'Low';
  const advantageDirection: AdvantageDirection =
    diff > ADVANTAGE_THRESHOLD ? 'A' : diff < -ADVANTAGE_THRESHOLD ? 'B' : 'Even';

  // Weighted the same as overallPower — a discounted axis (see AXIS_WEIGHT)
  // should be proportionally less likely to drive advantages/disadvantages
  // or the headline explanation, not just the aggregate score.
  const axisDeltas = AXES.map((axis) => ({
    axis,
    delta: (axisAverage(teamA, axis) - axisAverage(teamB, axis)) * axisWeight(axis),
  })).sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));

  return {
    powerA,
    powerB,
    diff,
    confidenceTier,
    advantageDirection,
    edgeA,
    synergyBonusA,
    synergyBonusB,
    winRateEdgeA,
    winRateEdgeB,
    hardCarryCountA,
    hardCarryCountB,
    rawDiff,
    rawAdvantageDirection,
    axisDeltas,
  };
}

export function resolveBattle(
  teamA: BattlePick[],
  teamB: BattlePick[],
  lookup: MatchupLookup,
  random: () => number = Math.random,
): BattleResult {
  const heroesA = teamA.map((p) => p.hero);
  const heroesB = teamB.map((p) => p.hero);
  const { diff, confidenceTier, advantageDirection, axisDeltas } = assessBattle(teamA, teamB, lookup);

  const favorWeight = WIN_WEIGHT_BY_TIER[confidenceTier];
  const pWinA = advantageDirection === 'A' ? favorWeight : advantageDirection === 'B' ? 1 - favorWeight : 0.5;
  const resolvedOutcome: ResolvedOutcome = random() < pWinA ? 'Win' : 'Lose';

  const advantages = axisDeltas
    .filter((d) => d.delta > 0.3)
    .slice(0, 2)
    .map((d) => `Your draft has ${describeAxis(d.axis, true)}.`);
  const disadvantages = axisDeltas
    .filter((d) => d.delta < -0.3)
    .slice(0, 2)
    .map((d) => `Your draft has ${describeAxis(d.axis, false)}.`);

  const explanation = buildExplanation({
    advantageDirection,
    confidenceTier,
    resolvedOutcome,
    teamA: heroesA,
    teamB: heroesB,
    lookup,
    topAxisDelta: axisDeltas[0],
  });

  return { resolvedOutcome, advantageDirection, confidenceTier, advantages, disadvantages, explanation };
}
