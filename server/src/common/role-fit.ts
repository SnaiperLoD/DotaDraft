import type { Hero, HeroEvaluationValues, PresumedPosition } from 'shared';
import { hasRoleEvaluationData, resolveEvaluationValues } from 'shared';

// EXPERIMENTAL integration with Hero.evaluation_values_by_role (Blueprint/
// 12-next-session-priorities.md item 6, 2026-08-06): roleAwareAxisValue()
// below is the regression-test wiring requested by the user — real per-role
// data replaces the heuristic boost/dampen ONLY for (hero, role) pairs with
// enough match data (hasRoleEvaluationData); everything else (the 308/508
// no_info pairs) keeps going through the EXACT old mechanism (roleFitValue on
// the aggregate) as a temporary fallback, unchanged. This was deliberately
// NOT done the moment evaluation_values_by_role existed — BOOST_WEIGHT/
// DAMPEN_WEIGHT/UTILITY_BREADTH_GATE/SUPPORT_MISCAST_THRESHOLD below are all
// tuned against aggregate-based behavior (see comments throughout this file
// for the specific heroes each was calibrated against), and blindly stacking
// real per-role data with the SAME heuristic boost risked double-counting the
// role-fit effect. Whether that risk is real (and whether real data alone
// beats the heuristic) is exactly what the self-play regression this wiring
// enables is meant to answer — see simulate-self-play.ts's Bonus-3 r-value
// and per-hero favoredRate/realWinRate table, before vs after this function
// existed (self-play-simulation-output-BEFORE-nocrutch.json is the pre-change
// snapshot). Not yet a settled "this is definitely better" — a live
// experiment result to read alongside the regression, not proof on its own.

// Role-fit modifier (Blueprint/10-tech-debt-backlog.md, "Оценка героя не
// учитывает назначенную роль"): when a hero is assigned a role, axes that
// role cares about get a boost IF the hero is already strong on them — this
// rewards good fits, it doesn't rescue a bad one.
//
// Lives in common/, not evaluation/, because both Evaluation Engine
// (axis.analyzer.ts) and Battle Engine (battle-resolution.ts) use it —
// they stay independent of each other (Core Rules Separation) by both
// depending on this neutral module instead of one depending on the other.
//
// The role -> axes map and BOOST_WEIGHT below are a manual heuristic, not a
// statistically fitted result. Two rounds of real data were tried
// (Blueprint/10-tech-debt-backlog.md has the full account): lane_role/
// is_roaming position buckets (research-role-fit-data.ts) couldn't even
// represent Support as a natural role, and per-match GPM-rank position
// buckets (research-role-fit-gpm-rank.ts) covered all 5 roles but produced
// correlations between each role's candidate axes and real win-rate delta
// that were all statistically indistinguishable from zero at the available
// sample size (n=17-37 per role, |r|<0.2 throughout). The map below matches
// the direction those weak correlations pointed in (Carry/Hard Support
// positive, Mid/Offlane/Soft Support slightly negative but not
// significant) — treated as "not contradicted strongly enough to abandon",
// same honesty category as the hand-authored hero tags.
// `initiating` (Blueprint/09-hero-knowledge-base.md) was calibrated but
// left unmapped here until this session — Offlane is the candidate the
// backlog itself flagged (10-tech-debt-backlog.md, "Будущая ось
// Initiating") as the most "initiator" slot of the five, so it's added
// there rather than split across roles without any data to justify a
// different split. Re-derives the theoretical max-contribution finding
// below (still ~0.13, unchanged) since adding one more touched axis
// alongside one more total axis (10→11) keeps the same ratio.
const ROLE_AXES: Record<string, string[]> = {
  Carry: ['scaling', 'burst'],
  Mid: ['tempo', 'burst'],
  Offlane: ['durability', 'control', 'initiating'],
  'Hard Support': ['saving', 'map_control'],
  'Soft Support': ['saving', 'control'],
};

const BASELINE = 5;
// 0.15 -> 0.3 (Blueprint/10-tech-debt-backlog.md): raised so a hero playing
// their real position — especially Support, whose axes (saving/control/
// map_control) tend to score lower than Carry/Mid's on average — gets a
// meaningfully bigger reward for fit, not a token one. Still proportional
// to how far above baseline the hero already is, so it can't rescue a bad
// fit, only amplify a real one.
const BOOST_WEIGHT = 0.3;

// Symmetric complement to ROLE_AXES/BOOST_WEIGHT above, added 2026-07-26
// (Blueprint/10-tech-debt-backlog.md, dampened caster-support cluster):
// axes a role isn't expected to contribute on get their below-baseline
// weakness partially forgiven, not amplified into a bonus. Narrowly scoped
// to durability/objectives for Hard/Soft Support — Variant A's late-phase
// weight restore (fixing Phantom Lancer) started weighting those two axes
// heavily enough that pure-caster supports' structurally-correct near-zero
// tankiness/push presence (not a flaw — they were never supposed to be
// tanky or push towers) started reading as a real weakness. Not applied to
// Carry/Mid/Offlane/other axis combos — those haven't been shown to have
// this problem, and widening the map without evidence would be scope creep
// beyond the diagnosed issue.
const IRRELEVANT_AXIS_DAMPEN: Record<string, string[]> = {
  'Hard Support': ['durability', 'objectives'],
  'Soft Support': ['durability', 'objectives'],
};
const DAMPEN_WEIGHT = 0.3;

// Gate found necessary after the first calibration pass: presumed_positions
// is 100% Support for BOTH the underperforming pure-caster cluster this was
// built for (Silencer/Lich/Disruptor) AND the already-overperforming
// utility-stacking cluster (Treant Protector/Chen/Io, common/utility-
// stacking.ts) — both share near-zero durability/objectives, just for
// opposite reasons (one needs the forgiveness, the other is already ahead
// on control/initiating/mobility/skirmish_rate/map_control and doesn't).
// Ungated, the dampen made Treant Protector's overperformance WORSE
// (+18.9pp -> +20.3/+21.5pp across two calibration runs) while barely
// moving the actual target (Silencer). Reusing utility-stacking's own
// utilityStackFreeCount(2) as the cutoff — a hero already past that
// breadth is, by definition, the OTHER cluster, not this one.
const UTILITY_BREADTH_GATE = 2;

// Boosts a hero's own axis value when assignedRole is relevant to axisKey
// AND the hero already scores above the population baseline (5) on it.
// Proportional to how far above baseline they already are, so it amplifies
// an existing strength rather than adding a flat bonus regardless of fit.
// Symmetrically, dampens (partially forgives) a below-baseline value on an
// axis the role isn't expected to care about (IRRELEVANT_AXIS_DAMPEN) —
// same proportional shape, opposite direction and a separate, narrower map
// — but only for heroes NOT already past UTILITY_BREADTH_GATE on the
// utility-stacking axes (see above); callers pass that breadth in since
// computing it here would require importing a Hero object, not just the
// single axis value this function otherwise only needs.
export function roleFitValue(
  axisKey: string,
  assignedRole: string | null,
  rawValue: number,
  utilityStackBreadth = 0,
): number {
  if (!assignedRole) return rawValue;
  const boostAxes = ROLE_AXES[assignedRole];
  if (boostAxes?.includes(axisKey)) {
    if (rawValue <= BASELINE) return rawValue;
    return Math.min(10, Math.round((rawValue + BOOST_WEIGHT * (rawValue - BASELINE)) * 10) / 10);
  }
  const dampenAxes = IRRELEVANT_AXIS_DAMPEN[assignedRole];
  if (dampenAxes?.includes(axisKey) && rawValue < BASELINE && utilityStackBreadth <= UTILITY_BREADTH_GATE) {
    return Math.round((rawValue + DAMPEN_WEIGHT * (BASELINE - rawValue)) * 10) / 10;
  }
  return rawValue;
}

export function isRoleFitAxis(axisKey: string, assignedRole: string | null): boolean {
  if (!assignedRole) return false;
  return ROLE_AXES[assignedRole]?.includes(axisKey) ?? false;
}

// Support-miscast penalty (Blueprint/10-tech-debt-backlog.md, 2026-08-06, by
// direct user request): a hero who essentially never plays Support in real
// games (presumed_positions' Support share below SUPPORT_MISCAST_THRESHOLD)
// but gets assigned Hard/Soft Support anyway takes a flat penalty across
// EVERY stat, not just the axes ROLE_AXES cares about — unlike the
// boost/dampen above, this isn't about rewarding or forgiving a specific
// axis, it's "the model doesn't know how to play this hero out of position
// at all." Personal (per-hero), not team-wide, unlike hard-carry stacking.
const SUPPORT_MISCAST_THRESHOLD = 0.05;
const SUPPORT_MISCAST_PENALTY = 0.9; // -10%

export function supportMiscastMultiplier(hero: Hero, assignedRole: string | null): number {
  if (assignedRole !== 'Hard Support' && assignedRole !== 'Soft Support') return 1;
  // Optional chaining: heroes.json-only Hero objects (scripts that bypass
  // HeroService/SQLite) don't carry presumed_positions — see the identical
  // comment in common/hard-carry.ts's isHardCarry().
  const supportShare = hero.presumed_positions?.find((p) => p.position === 'Support')?.share ?? 0;
  return supportShare < SUPPORT_MISCAST_THRESHOLD ? SUPPORT_MISCAST_PENALTY : 1;
}

// Battle Engine's 5-way assignedRole ('Hard Support'/'Soft Support' split)
// down to the 4-way PresumedPosition evaluation_values_by_role is keyed by
// (research-role-classification-final.ts never distinguished the two —
// GPM-rank's own bottom-2 split was already shown unreliable for that
// specific distinction, same class of problem as Carry/Mid). Both support
// roles read the same 'Support' per-role data.
function mapAssignedRoleToPresumedPosition(assignedRole: string | null): PresumedPosition | null {
  if (assignedRole === 'Carry' || assignedRole === 'Mid' || assignedRole === 'Offlane') return assignedRole;
  if (assignedRole === 'Hard Support' || assignedRole === 'Soft Support') return 'Support';
  return null;
}

// The experimental entry point (see the file-header comment above): returns
// the axis value a pick should contribute, preferring real per-role data over
// the heuristic boost/dampen when it exists for this (hero, role).
export function roleAwareAxisValue(
  axisKey: keyof HeroEvaluationValues,
  hero: Hero,
  assignedRole: string | null,
  utilityStackBreadth = 0,
): number {
  const position = mapAssignedRoleToPresumedPosition(assignedRole);
  if (position && hasRoleEvaluationData(hero, position)) {
    return resolveEvaluationValues(hero, position)[axisKey];
  }
  // Old mechanism, unchanged — temporary fallback for no_info (hero, role)
  // pairs per the user's explicit instruction.
  return roleFitValue(axisKey, assignedRole, hero.evaluation_values[axisKey], utilityStackBreadth);
}
