import * as fs from 'fs';
import * as path from 'path';
import type { Hero, HeroEvaluationValues } from 'shared';
import { roleAwareAxisValue, supportMiscastMultiplier } from '../common/role-fit';
import { hardCarryAxisMultipliers, isHardCarry } from '../common/hard-carry';
import { utilityStackAxisMultipliers, utilityStackBreadth } from '../common/utility-stacking';
import { manualPowerMultiplier } from '../common/manual-power-overrides';
import { shutdownHeroes, shutdownHeroMultipliers } from '../common/shutdown';
import {
  type CustomTagEffects,
  blessingEffectsFor,
  curseEffectsOnOpponent,
  mergeTagEffects,
  emptyTagEffects,
  highSkillHeroesOn,
  mechanicalHeroesOn,
  HIGH_SKILL_UPSET_SHIFT,
  isTagDisabled,
} from './custom-tags';

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
  winningHighlights: string[];
  // Real-winRate rows from the CALLING player's (teamA) perspective, win or
  // lose — best synergy pairs on your own team, and your best / worst
  // individual matchups into this opponent's heroes. Empty when no real
  // matchup data covers the heroes in play (e.g. tests' noData lookup).
  bestPairs: { heroA: string; heroB: string; winRate: number }[];
  bestMatchups: { hero: string; vs: string; winRate: number }[];
  worstMatchups: { hero: string; vs: string; winRate: number }[];
  // Shutdown (common/shutdown.ts) — hero ids on EITHER side flagged this
  // battle, for the client to mark on portraits regardless of which side
  // they're rendering. shutdownNotes are separate narrative lines (not
  // folded into `explanation`), one per shutdown hero, phrased from the
  // calling player's own perspective ("Your X" vs "Opponent's X").
  shutdownHeroIds: number[];
  shutdownNotes: string[];
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
  'skirmish_rate',
  'camp_stacking',
];

// Win-weight bands per Blueprint/06-battle-engine.md Resolution — the
// favored side's win probability at each Confidence Tier. Moderate/Low
// deliberately stay short of 1/0 (even a real favorite should lose
// sometimes at those tiers — Upsets rule). High is DELIBERATELY 1
// (fully deterministic) as of this revision: a High-confidence pick should
// not lose to bare random variance — the old 0.72 let a "sure thing" lose
// ~28% of the time, which read as the model just being wrong, not as a
// meaningful upset. The only way to beat a High-confidence favorite now is
// an explained mechanic that shifts pWinA away from 1 — currently only
// High Skill (custom-tags.ts) does this, in resolveBattle() below — so a
// High-tier upset always has a specific, named cause, never bare chance.
export const WIN_WEIGHT_BY_TIER: Record<ConfidenceTier, number> = {
  High: 1,
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
// Game-phase-aware resolution (self-play outlier investigation,
// Blueprint/10-tech-debt-backlog.md "Layer 2"): a single flat weighted
// average across all 13 axes structurally underrates heroes whose win
// condition is timing-gated (split-push/late-scaling carries look weak on
// every early/clash-relevant axis even when correctly calibrated, because
// their real strategy is to avoid early clashes). Validated directly
// against real duration-bucketed winRate (server/data/research-tempo-v3-output.json,
// wrShort/wrMid/wrLong) before building this: Phantom Lancer wrShort=25.9%
// -> wrLong=50.9%, Medusa wrShort=11.1% -> wrLong=47.1% — the opposite
// pattern from Treant Protector (wrShort=68.3% -> wrLong=52.7%). A single
// "right now" snapshot can't represent a hero who is a completely
// different matchup depending on how long the game runs.
export type GamePhase = 'early' | 'mid' | 'late';
const PHASES: GamePhase[] = ['early', 'mid', 'late'];

interface AxisWeightsConfig {
  axisWeights: Partial<Record<keyof HeroEvaluationValues, number>>;
  // Per-phase overrides. Falls back to axisWeights (the "mid" baseline —
  // this project's existing calibrated weights, unchanged) for any axis not
  // listed for that phase. "mid" itself has no entry: it *is* axisWeights.
  // Hand-authored from domain reasoning + the wrShort/wrMid/wrLong pattern
  // above, same "manual heuristic, documented as such" honesty category as
  // role-fit's ROLE_AXES (common/role-fit.ts) — not statistically fitted.
  // map_control stays 0 in every phase (unrelated, pre-existing decision:
  // vision_ability_tier data quality, not phase relevance).
  phaseWeights?: Partial<Record<GamePhase, Partial<Record<keyof HeroEvaluationValues, number>>>>;
  // Fixed assumption, NOT measured from our own data yet — approximates
  // published average Dota 2 match-length distribution (most games land
  // 25-40min). A real duration histogram (one more Explorer query, same
  // pattern as research-tempo-metric-v3.ts) would let this be replaced with
  // a measured value; flagged in Blueprint/10-tech-debt-backlog.md.
  phaseDistribution?: Record<GamePhase, number>;
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

const DEFAULT_PHASE_DISTRIBUTION: Record<GamePhase, number> = { early: 1 / 3, mid: 1 / 3, late: 1 / 3 };
const phaseDistribution: Record<GamePhase, number> = axisWeightsConfig.phaseDistribution ?? DEFAULT_PHASE_DISTRIBUTION;

function axisWeight(axis: keyof HeroEvaluationValues): number {
  return axisWeightsConfig.axisWeights[axis] ?? 1;
}

// Phase-specific weight for an axis, falling back to the base (mid) weight
// when that phase has no override for it.
function axisWeightForPhase(axis: keyof HeroEvaluationValues, phase: GamePhase): number {
  return axisWeightsConfig.phaseWeights?.[phase]?.[axis] ?? axisWeight(axis);
}

// Blend of an axis's weight across the 3 phases, by phaseDistribution — the
// single number that axisDeltas (advantages/disadvantages narrative) uses,
// so "how much did this axis matter" reflects the same phase blend as the
// score itself. Safe to collapse into one linear blend here (unlike
// overallPower below) because axisDeltas has no per-axis normalization step.
function blendedAxisWeight(axis: keyof HeroEvaluationValues): number {
  return PHASES.reduce((sum, phase) => sum + axisWeightForPhase(axis, phase) * phaseDistribution[phase], 0);
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
// tagEffects optional and defaults to a no-op — every pre-existing caller
// (simulate-self-play.ts's Q1 tracking, etc.) keeps working unchanged.
// heroPowerMultiplier/heroAxisMultiplier are applied per-pick before the
// team sum (Custom Tags that single out named heroes, either on every axis
// or one specific axis); axisMultiplier is applied to the whole team's
// average for that axis after summing (Custom Tags that target an axis,
// not a hero) — see custom-tags.ts for which tags use which. `phase` is
// optional and only matters for phaseHeroPowerMultiplier (The Button's
// late-game-only boost) — omitted, that dimension is a no-op, matching
// every pre-existing caller that doesn't pass a phase at all.
export function axisAverage(
  team: BattlePick[],
  axis: keyof HeroEvaluationValues,
  tagEffects?: CustomTagEffects,
  phase?: GamePhase,
): number {
  const raw =
    team.reduce((sum, p) => {
      const base =
        roleAwareAxisValue(axis, p.hero, p.assignedRole, utilityStackBreadth(p.hero)) *
        supportMiscastMultiplier(p.hero, p.assignedRole);
      const heroMult = tagEffects?.heroPowerMultiplier.get(p.hero.id) ?? 1;
      const heroAxisMult = tagEffects?.heroAxisMultiplier.get(p.hero.id)?.[axis] ?? 1;
      const phaseHeroMult = (phase && tagEffects?.phaseHeroPowerMultiplier.get(phase)?.get(p.hero.id)) ?? 1;
      return sum + base * heroMult * heroAxisMult * phaseHeroMult;
    }, 0) / team.length;
  const axisMult = tagEffects?.axisMultiplier[axis] ?? 1;
  return raw * axisMult;
}

function overallPowerForPhase(team: BattlePick[], phase: GamePhase, tagEffects?: CustomTagEffects): number {
  const axisWeightedSum = AXES.reduce(
    (sum, axis) => sum + axisAverage(team, axis, tagEffects, phase) * axisWeightForPhase(axis, phase),
    0,
  );
  const axisTotalWeight = AXES.reduce((sum, axis) => sum + axisWeightForPhase(axis, phase), 0);
  return axisWeightedSum / axisTotalWeight;
}

// Each phase's overallPower is its own correctly-normalized weighted
// average (own denominator) — blending the 3 resulting scores by
// phaseDistribution is NOT the same as blending the weights first and
// computing one average, since each phase's total weight differs. This is
// the actual (not approximated) phase-blended team power.
function blendedOverallPower(team: BattlePick[], tagEffects?: CustomTagEffects): number {
  return PHASES.reduce((sum, phase) => sum + overallPowerForPhase(team, phase, tagEffects) * phaseDistribution[phase], 0);
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

// Blueprint/10-tech-debt-backlog.md, "Комментарии по конкретным успешным
// матчапам в результатах боя" — the same real matchup/synergy data that
// bestMatchupEdge/bestSynergyPair use for upset explanations, generalized
// to top-N and surfaced for EVERY battle result, not just upsets. Kept
// separate from bestMatchupEdge/bestSynergyPair (which intentionally return
// the single best pair even below 50%, for the underdog's "least-bad"
// option in an upset) — these two only collect genuinely advantageous
// (winRate > 0.5) pairs, since the point here is "what actually worked",
// not "the closest thing to an edge available."
function topMatchupEdges(
  team: Hero[],
  opponent: Hero[],
  lookup: MatchupLookup,
  limit: number,
): { hero: string; vs: string; winRate: number }[] {
  const edges: { hero: string; vs: string; winRate: number }[] = [];
  for (const h of team) {
    for (const o of opponent) {
      const wr = lookup.getMatchupWinRate(h.id, o.id);
      if (wr !== null && wr > 0.5) edges.push({ hero: h.name, vs: o.name, winRate: wr });
    }
  }
  return edges.sort((a, b) => b.winRate - a.winRate).slice(0, limit);
}

function topSynergyPairs(
  team: Hero[],
  lookup: MatchupLookup,
  limit: number,
): { heroA: string; heroB: string; winRate: number }[] {
  const pairs: { heroA: string; heroB: string; winRate: number }[] = [];
  for (let i = 0; i < team.length; i++) {
    for (let j = i + 1; j < team.length; j++) {
      const wr = lookup.getSynergyWinRate(team[i].id, team[j].id);
      if (wr !== null && wr > 0.5) pairs.push({ heroA: team[i].name, heroB: team[j].name, winRate: wr });
    }
  }
  return pairs.sort((a, b) => b.winRate - a.winRate).slice(0, limit);
}

// Your team's WORST individual matchups into the opponent's heroes — the
// mirror of topMatchupEdges, kept below 0.5 and sorted ascending (most
// lopsided losing lane first). Surfaced to the client with the raw winRate so
// a player can see which of their heroes is walking into a bad matchup
// against THIS specific opponent draft (user request).
function worstMatchupEdges(
  team: Hero[],
  opponent: Hero[],
  lookup: MatchupLookup,
  limit: number,
): { hero: string; vs: string; winRate: number }[] {
  const edges: { hero: string; vs: string; winRate: number }[] = [];
  for (const h of team) {
    for (const o of opponent) {
      const wr = lookup.getMatchupWinRate(h.id, o.id);
      if (wr !== null && wr < 0.5) edges.push({ hero: h.name, vs: o.name, winRate: wr });
    }
  }
  return edges.sort((a, b) => a.winRate - b.winRate).slice(0, limit);
}

// Combines both sources into one ranked top-N (by real winRate) for the
// side that actually won this battle — narrative sentences only, no raw
// percentage surfaced to the client, same "no false precision" convention
// as the rest of this file's explanation text (Accuracy Ceiling Rule,
// Blueprint/06-battle-engine.md).
function winningHighlights(
  team: Hero[],
  opponent: Hero[],
  lookup: MatchupLookup,
  perspectiveLabel: string,
  limit = 3,
): string[] {
  const matchups = topMatchupEdges(team, opponent, lookup, limit).map((m) => ({
    text: `${m.hero}'s matchup into ${m.vs} worked in ${perspectiveLabel}'s favor.`,
    winRate: m.winRate,
  }));
  const synergies = topSynergyPairs(team, lookup, limit).map((s) => ({
    text: `The ${s.heroA} + ${s.heroB} combination gave ${perspectiveLabel} a real, data-backed edge.`,
    winRate: s.winRate,
  }));
  return [...matchups, ...synergies]
    .sort((a, b) => b.winRate - a.winRate)
    .slice(0, limit)
    .map((h) => h.text);
}

export const AXIS_LABEL: Record<keyof HeroEvaluationValues, string> = {
  // "damage output", not "teamfight" — see score-narrative.ts's
  // AXIS_NARRATIVE.teamfight comment (label-only rename, key unchanged).
  teamfight: 'damage output',
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
  skirmish_rate: 'skirmish rate',
  camp_stacking: 'camp stacking',
  // Not in AXES below (Evaluation Engine-only axis, see
  // calibrate-evaluation-values.ts) — describeAxis() never actually gets
  // called with this key today. Entry exists only because AXIS_LABEL's
  // type is total over HeroEvaluationValues.
  resource_efficiency: 'resource efficiency',
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
  // Full ranked list (not just the top one) — an upset explanation is
  // richer when it can point to whichever axis the underdog *did* lead on,
  // even inside an overall-losing matchup, not just the single biggest
  // swing factor.
  axisDeltas: { axis: keyof HeroEvaluationValues; delta: number }[];
  // The specific High Skill hero whose variance caused THIS outcome (not
  // just present on the roster — actually flipped the result, see
  // resolveBattle's highSkillSwing check), if any. Takes priority as the
  // lead reason in an upset explanation: a named, mechanical cause beats a
  // generic "every draft has some edge" line every time.
  highSkillSwingHero: Hero | null;
}

function buildExplanation(ctx: ExplanationContext): string[] {
  const { advantageDirection, confidenceTier, resolvedOutcome, teamA, teamB, lookup, topAxisDelta, axisDeltas, highSkillSwingHero } = ctx;

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

  // Upset: the underdog won. At High confidence this is now IMPOSSIBLE
  // through bare variance (WIN_WEIGHT_BY_TIER.High=1) — it only happens
  // through an explained mechanic (High Skill), so highSkillSwingHero is
  // near-guaranteed to be set here when confidenceTier is High. At
  // Moderate/Low it may still be plain tier variance, so the explanation
  // builds every available real reason, not just one.
  const underdogLabel = favoredIsA ? "opponent's draft" : 'your draft';
  const sentences: string[] = [];

  if (highSkillSwingHero) {
    sentences.push(
      `${highSkillSwingHero.name}'s own play was the deciding swing here — real match data shows outcomes around this hero carry more variance than the stat sheet alone suggests, and this game landed on the wrong side of it for the favorite.`,
    );
  }

  const synergy = bestSynergyPair(underdogTeam, lookup);
  const matchup = bestMatchupEdge(underdogTeam, favoredTeam, lookup);
  // The underdog's own strongest axis, restricted to axes where they
  // actually led — even a draft that loses on the overall picture usually
  // wins at least one real category, and citing it grounds the upset in
  // something concrete rather than "the model was wrong."
  const underdogBestAxis = [...axisDeltas]
    .filter((d) => (favoredIsA ? d.delta < 0 : d.delta > 0))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];

  const dataReasons: string[] = [];
  if (matchup) dataReasons.push(`${matchup.hero}'s individual matchup into ${matchup.vs} favored ${underdogLabel} directly`);
  if (synergy) dataReasons.push(`the ${synergy.heroA} + ${synergy.heroB} combination gave ${underdogLabel} a real, data-backed edge`);
  if (underdogBestAxis) {
    dataReasons.push(`${underdogLabel} actually led in ${AXIS_LABEL[underdogBestAxis.axis]} despite trailing on the overall picture`);
  }

  if (dataReasons.length > 0) {
    const lead = sentences.length > 0 ? 'On top of that, ' : 'But ';
    sentences.push(`${lead}${underdogLabel} had real advantages of its own — ${dataReasons.join('; ')} — enough to make this upset plausible even against a stronger overall draft.`);
  } else if (sentences.length === 0) {
    sentences.push(
      `Every draft carries some risk even in a clear matchup, and at ${confidenceTier} confidence the odds still had to break exactly right for ${underdogLabel} — this time they did.`,
    );
  }

  return [baseLine, ...sentences];
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
  // Shutdown (common/shutdown.ts) — heroes on each side uniformly countered
  // by all 5 opponents (every real matchup winRate at least 1.5pp below
  // their own overall winRate). Rare by design.
  shutdownHeroesA: Hero[];
  shutdownHeroesB: Hero[];
}

// Per-hero final power multiplier (manual-power-overrides.ts) — every axis
// equally, unlike utilityStackHeroAxisMultipliers below (which only touches
// the 6 utility axes). Same map shape as CustomTagEffects.heroPowerMultiplier
// expects directly, so no per-hero loop/filter needed here.
function manualPowerHeroMultipliers(heroes: Hero[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const hero of heroes) {
    const mult = manualPowerMultiplier(hero);
    if (mult !== 1) map.set(hero.id, mult);
  }
  return map;
}

// Per-hero (not per-team, unlike hardCarryAxisMultipliers) — utility-axis
// stacking is a property of each hero's own kit, so every hero on the team
// is checked independently against their own evaluation_values.
function utilityStackHeroAxisMultipliers(
  heroes: Hero[],
): Map<number, Partial<Record<keyof HeroEvaluationValues, number>>> {
  const map = new Map<number, Partial<Record<keyof HeroEvaluationValues, number>>>();
  for (const hero of heroes) {
    const multipliers = utilityStackAxisMultipliers(hero);
    if (Object.keys(multipliers).length > 0) map.set(hero.id, multipliers);
  }
  return map;
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

  const rawPowerA = blendedOverallPower(teamA);
  const rawPowerB = blendedOverallPower(teamB);
  const rawDiff = rawPowerA - rawPowerB;
  const rawAdvantageDirection: AdvantageDirection =
    rawDiff > ADVANTAGE_THRESHOLD ? 'A' : rawDiff < -ADVANTAGE_THRESHOLD ? 'B' : 'Even';

  // Custom Tags (custom-tags.ts, Blueprint/10-tech-debt-backlog.md) — a
  // team's own "blessing" tags buff itself; a team's "curse" tags debuff
  // the OPPONENT. Kept OUT of rawPower/rawDiff above (same treatment as
  // synergy/matchup/hardCarry below) so that counterfactual stays "what the
  // pure axis model alone says," uncontaminated by hand-authored combos.
  // rawAxisAverages (no tag effects) is what The Fundamentals ranks its
  // "weakest axis" against — using the post-tag average would let its own
  // boost change which axis it targets mid-calculation.
  const rawAxisAveragesA = Object.fromEntries(
    AXES.map((axis) => [axis, axisAverage(teamA, axis)]),
  ) as Partial<Record<keyof HeroEvaluationValues, number>>;
  const rawAxisAveragesB = Object.fromEntries(
    AXES.map((axis) => [axis, axisAverage(teamB, axis)]),
  ) as Partial<Record<keyof HeroEvaluationValues, number>>;
  // Shutdown (common/shutdown.ts) — computed before tagEffects so its
  // personal power penalty can merge into the same heroPowerMultiplier map
  // as manual-power-overrides.ts below, one mechanism, not two.
  const shutdownHeroesA = shutdownHeroes(heroesA, heroesB, lookup);
  const shutdownHeroesB = shutdownHeroes(heroesB, heroesA, lookup);

  // Hard-carry stacking (common/hard-carry.ts) folded into the same
  // per-axis-multiplier mechanism as Custom Tags, rather than the flat
  // whole-power scalar this used to be — scaling is deliberately exempt
  // from the penalty (and gets its own +10% boost instead), which isn't
  // expressible as a single scalar applied to the already-blended power.
  const tagEffectsA = mergeTagEffects(
    blessingEffectsFor(heroesA, rawAxisAveragesA, rawAxisAveragesB),
    curseEffectsOnOpponent(heroesB, heroesA),
    { ...emptyTagEffects(), axisMultiplier: hardCarryAxisMultipliers(heroesA) },
    { ...emptyTagEffects(), heroAxisMultiplier: utilityStackHeroAxisMultipliers(heroesA) },
    { ...emptyTagEffects(), heroPowerMultiplier: manualPowerHeroMultipliers(heroesA) },
    { ...emptyTagEffects(), heroPowerMultiplier: shutdownHeroMultipliers(shutdownHeroesA) },
  );
  const tagEffectsB = mergeTagEffects(
    blessingEffectsFor(heroesB, rawAxisAveragesB, rawAxisAveragesA),
    curseEffectsOnOpponent(heroesA, heroesB),
    { ...emptyTagEffects(), axisMultiplier: hardCarryAxisMultipliers(heroesB) },
    { ...emptyTagEffects(), heroAxisMultiplier: utilityStackHeroAxisMultipliers(heroesB) },
    { ...emptyTagEffects(), heroPowerMultiplier: manualPowerHeroMultipliers(heroesB) },
    { ...emptyTagEffects(), heroPowerMultiplier: shutdownHeroMultipliers(shutdownHeroesB) },
  );
  const taggedPowerA = blendedOverallPower(teamA, tagEffectsA);
  const taggedPowerB = blendedOverallPower(teamB, tagEffectsB);

  // Non-Linearity Rule: synergy, matchup edge, and real winRate each modify
  // their team's *own* effective power multiplicatively (amplify/dampen),
  // rather than being added as flat bonus points on top of a linear total.
  // Applying the matchup multiplier per-side (not to the already-combined
  // diff) means a strong counter matchup can still swing an otherwise-even
  // matchup, instead of only ever scaling an existing advantage.
  const powerA =
    taggedPowerA *
    clamp(1 + synergyBonusA * 2, 0.3, 1.7) *
    clamp(1 + edgeA * 3, 0.3, 1.7) *
    clamp(1 + winRateEdgeA * axisWeightsConfig.realWinRateWeight, 1 - REAL_WIN_RATE_CAP, 1 + REAL_WIN_RATE_CAP);
  const powerB =
    taggedPowerB *
    clamp(1 + synergyBonusB * 2, 0.3, 1.7) *
    clamp(1 - edgeA * 3, 0.3, 1.7) *
    clamp(1 + winRateEdgeB * axisWeightsConfig.realWinRateWeight, 1 - REAL_WIN_RATE_CAP, 1 + REAL_WIN_RATE_CAP);

  const diff = powerA - powerB;

  const confidenceTier: ConfidenceTier =
    Math.abs(diff) > 1.5 ? 'High' : Math.abs(diff) > 0.5 ? 'Moderate' : 'Low';
  const advantageDirection: AdvantageDirection =
    diff > ADVANTAGE_THRESHOLD ? 'A' : diff < -ADVANTAGE_THRESHOLD ? 'B' : 'Even';

  // Weighted the same (phase-blended) as overallPower — a discounted axis
  // should be proportionally less likely to drive advantages/disadvantages
  // or the headline explanation, not just the aggregate score. Tag-adjusted
  // (tagEffectsA/B), same reasoning as taggedPowerA/B above.
  const axisDeltas = AXES.map((axis) => ({
    axis,
    delta: (axisAverage(teamA, axis, tagEffectsA) - axisAverage(teamB, axis, tagEffectsB)) * blendedAxisWeight(axis),
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
    shutdownHeroesA,
    shutdownHeroesB,
  };
}

// Pulls a probability toward 0.5 by `amount`, never overshooting past it —
// "this team's own predicted result gets less certain," which reads as a
// better chance to win when they were the underdog and a worse chance when
// they were the favorite, from the exact same operation (High Skill).
function pullTowardCoinflip(p: number, amount: number): number {
  if (p > 0.5) return Math.max(0.5, p - amount);
  if (p < 0.5) return Math.min(0.5, p + amount);
  return p;
}

export function resolveBattle(
  teamA: BattlePick[],
  teamB: BattlePick[],
  lookup: MatchupLookup,
  random: () => number = Math.random,
): BattleResult {
  const heroesA = teamA.map((p) => p.hero);
  const heroesB = teamB.map((p) => p.hero);
  const { confidenceTier, advantageDirection, axisDeltas, shutdownHeroesA, shutdownHeroesB } = assessBattle(
    teamA,
    teamB,
    lookup,
  );

  // Shutdown notes — phrased from the calling player's own perspective
  // (teamA is always "your draft," see BattleService.fight()), independent
  // of advantageDirection/resolvedOutcome: a hero can be countered out of
  // the game on the winning side too, worth surfacing either way.
  const shutdownNotes = [
    ...shutdownHeroesA.map(
      (h) => `Your ${h.name} is being SHUT DOWN — every hero on the opposing draft has historically beaten them (-10% power).`,
    ),
    ...shutdownHeroesB.map(
      (h) => `Opponent's ${h.name} is being SHUT DOWN — every hero on your draft has historically beaten them (-10% power).`,
    ),
  ];
  const shutdownHeroIds = [...shutdownHeroesA, ...shutdownHeroesB].map((h) => h.id);

  const favorWeight = WIN_WEIGHT_BY_TIER[confidenceTier];
  const basePWinA = advantageDirection === 'A' ? favorWeight : advantageDirection === 'B' ? 1 - favorWeight : 0.5;

  // High Skill (custom-tags.ts) — each team's own presence of a High Skill
  // hero pulls THAT team's predicted result toward a coinflip, independent
  // of the other team's. Doesn't touch diff/confidenceTier/advantageDirection
  // (those stay the "true" assessment) — only the final win roll.
  const highSkillDisabled = isTagDisabled('High Skill');
  const highSkillA = highSkillDisabled ? [] : highSkillHeroesOn(heroesA);
  const highSkillB = highSkillDisabled ? [] : highSkillHeroesOn(heroesB);
  // Mechanical ("machines don't tilt", custom-tags.ts): a Mechanical hero on
  // EITHER side removes High Skill's upset variance entirely — the steady
  // execution keeps the result on its assessed rails. On the shared pWinA
  // variable, protecting either team's certainty means applying no coinflip
  // pull at all (every pull moves pWinA toward 0.5, i.e. away from whichever
  // team it favours), so one flag gates both sources. Disabled-aware via the
  // empty set mechanicalHeroesOn returns when the tag is off.
  const mechanicalPresent =
    !isTagDisabled('Mechanical') &&
    (mechanicalHeroesOn(heroesA).length > 0 || mechanicalHeroesOn(heroesB).length > 0);
  // Pulling pWinA toward 0.5 represents "this team's own result gets less
  // certain" for EITHER side: team A's own uncertainty pulls pWinA toward
  // 0.5 directly; team B's does too, since pWinB = 1-pWinA and pulling
  // pWinB toward 0.5 is the same operation on pWinA (the function is
  // symmetric around 0.5). Both conditions can fire and stack.
  let pWinA = basePWinA;
  if (!mechanicalPresent) {
    if (highSkillA.length > 0) pWinA = pullTowardCoinflip(pWinA, HIGH_SKILL_UPSET_SHIFT);
    if (highSkillB.length > 0) pWinA = pullTowardCoinflip(pWinA, HIGH_SKILL_UPSET_SHIFT);
  }

  const roll = random();
  const resolvedOutcome: ResolvedOutcome = roll < pWinA ? 'Win' : 'Lose';
  // Same roll against the un-shifted probability — did High Skill actually
  // change the binary outcome, or just nudge a number that didn't matter
  // this time? Only worth narrating when it flipped the result.
  const baselineOutcome: ResolvedOutcome = roll < basePWinA ? 'Win' : 'Lose';
  const highSkillSwing = resolvedOutcome !== baselineOutcome;

  const advantages = axisDeltas
    .filter((d) => d.delta > 0.3)
    .slice(0, 2)
    .map((d) => `Your draft has ${describeAxis(d.axis, true)}.`);
  const disadvantages = axisDeltas
    .filter((d) => d.delta < -0.3)
    .slice(0, 2)
    .map((d) => `Your draft has ${describeAxis(d.axis, false)}.`);

  // Which hero to credit when High Skill's shift actually produced an
  // upset (underdog won) — only computed when that's really what happened,
  // so buildExplanation gets a clean signal instead of a "near miss that
  // didn't change anything" case to filter out itself. Prefers the
  // underdog's own High Skill hero (their variance is what saved them);
  // falls back to the favorite's (whose own unpredictability let the
  // underdog through) if the underdog has none tagged.
  let highSkillSwingHero: Hero | null = null;
  if (highSkillSwing && advantageDirection !== 'Even') {
    const favoredIsA = advantageDirection === 'A';
    const favoriteWon = favoredIsA ? resolvedOutcome === 'Win' : resolvedOutcome === 'Lose';
    if (!favoriteWon) {
      const underdogHeroes = favoredIsA ? highSkillB : highSkillA;
      const favoriteHeroes = favoredIsA ? highSkillA : highSkillB;
      highSkillSwingHero = underdogHeroes[0] ?? favoriteHeroes[0] ?? null;
    }
  }

  const explanation = buildExplanation({
    advantageDirection,
    confidenceTier,
    resolvedOutcome,
    teamA: heroesA,
    teamB: heroesB,
    lookup,
    topAxisDelta: axisDeltas[0],
    axisDeltas,
    highSkillSwingHero,
  });

  const winnerIsA = resolvedOutcome === 'Win';
  const highlights = winningHighlights(
    winnerIsA ? heroesA : heroesB,
    winnerIsA ? heroesB : heroesA,
    lookup,
    winnerIsA ? 'your draft' : 'the opponent',
  );

  // Always from YOUR draft's (teamA) perspective, independent of who won:
  // your strongest real synergy pairs, and your best / worst individual
  // matchups into this specific opponent's heroes.
  const bestPairs = topSynergyPairs(heroesA, lookup, 3);
  const bestMatchups = topMatchupEdges(heroesA, heroesB, lookup, 3);
  const worstMatchups = worstMatchupEdges(heroesA, heroesB, lookup, 3);

  return {
    resolvedOutcome,
    advantageDirection,
    confidenceTier,
    advantages,
    disadvantages,
    explanation,
    winningHighlights: highlights,
    bestPairs,
    bestMatchups,
    worstMatchups,
    shutdownHeroIds,
    shutdownNotes,
  };
}
