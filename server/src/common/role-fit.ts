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
// Third round, 2026-08-06 (Blueprint/12-next-session-priorities.md item 6
// follow-up) — superseded the two prior attempts described below. Uses
// evaluation_values_by_role's real per-role axis values (only exist post-
// anchoring/zscore-fix, hence why this wasn't tried until now) correlated
// against REAL per-role win rate minus each hero's overall win rate
// (research-role-classification-final-output.json vs hero-meta.json),
// restricted to heroes with real data in >=2 roles — a pure specialist's
// delta is close to 0 by construction (their one role IS ~their overall
// average), which was diluting the signal on a first pass before this
// restriction. n=25-38 per role, a real jump from the prior attempt's
// n=17-37 at |r|<0.2: |r| here ranges 0.32-0.63 for the axes kept below.
// Only positive-correlation axes are usable — roleFitValue only boosts (a
// negative-correlation axis has no "reward being low" mechanism, that would
// be new scope). Several axes flip sign or drop out entirely vs the old map
// (scaling/burst come out NEGATIVE almost everywhere, durability negative
// for Offlane, saving barely positive for Support at r=0.14) — kept for the
// record below since a future investigation might explain why, but not
// carried into ROLE_AXES since the boost mechanism can't use a negative
// signal anyway. `initiating` and `control` recur as strong positive
// predictors for 3 of 4 roles; `tempo` dominates Support (r=0.63, by far
// the single strongest finding of this pass) displacing saving/control from
// the old map entirely. Hard/Soft Support get the same axes — the 4-way
// classifier (research-role-classification-final.ts) never distinguished
// them, same reason roleAwareAxisValue's role-mapping collapses both to
// PresumedPosition's single 'Support'.
//
// Old (2 rounds, both retired): lane_role/is_roaming position buckets
// (research-role-fit-data.ts) couldn't even represent Support as a natural
// role; per-match GPM-rank position buckets (research-role-fit-gpm-rank.ts)
// covered all 5 roles but produced correlations indistinguishable from zero
// at n=17-37, |r|<0.2 throughout — the map built from that pass is the one
// this replaces.
const ROLE_AXES: Record<string, string[]> = {
  // `control` removed from Carry 2026-08-13 (direct user call): a carry
  // shouldn't earn a role-fit reward on control — it's not what the role is
  // for, regardless of the weak positive correlation the round-3 research
  // found. Kept for Mid, which is a genuine control/initiation role. The
  // broader role-fit-bonus rework is backlog item 9.
  Carry: ['initiating'],
  // `tempo` added to Mid 2026-08-13 (session-2 role-fit revision, backlog item
  // 9): the recomputed round-3 correlation (restricted to heroes with real
  // per-role data in >=2 roles, n=38) puts tempo at r=+0.211 for Mid — a
  // moderate but genuine positive predictor of a mid overperforming, and tempo
  // is a fully-weighted axis in both engines (unlike map_control, see Carry).
  Mid: ['initiating', 'control', 'tempo'],
  Offlane: ['map_control', 'initiating', 'mobility'],
  // `saving` re-added to both supports 2026-08-13 (direct user call): saving
  // allies is core to what a support does, so it should be rewarded here — and
  // conversely it is deliberately NOT on Carry/Mid, which must not earn a
  // role-fit bonus for it. (Round-3 research had dropped saving at r=0.14; the
  // user's role intent overrides that weak signal.)
  'Hard Support': ['tempo', 'camp_stacking', 'mobility', 'map_control', 'saving'],
  // Soft Support (position 4) diverges from Hard Support: the roaming pos-4
  // additionally earns a role-fit bonus for resource_efficiency (more
  // farm-hungry than a pos-5). Note the real-per-role-data path
  // (roleAwareAxisValue) still collapses both supports to the single 'Support'
  // bucket — this divergence only affects the heuristic fallback for no_info
  // heroes.
  //
  // `skirmish_rate` REMOVED 2026-08-13 (session-2 role-fit revision, backlog
  // item 9): the recomputed round-3 correlation put skirmish_rate at r=-0.202
  // for Support — it predicts UNDERperformance, and roleFitValue only ever
  // boosts, so rewarding it pushed the wrong way. `resource_efficiency` kept by
  // explicit user call despite its own near-zero r=-0.001; it's near-neutral
  // and, being outside Battle's AXES and unweighted in Evaluation's total, its
  // boost is cosmetic (moves only the breakdown card value, not any score).
  'Soft Support': ['tempo', 'camp_stacking', 'mobility', 'map_control', 'saving', 'resource_efficiency'],
};

const BASELINE = 5;
// 0.15 -> 0.3 (Blueprint/10-tech-debt-backlog.md): raised so a hero playing
// their real position — especially Support, whose axes (saving/control/
// map_control) tend to score lower than Carry/Mid's on average — gets a
// meaningfully bigger reward for fit, not a token one. Still proportional
// to how far above baseline the hero already is, so it can't rescue a bad
// fit, only amplify a real one.
const BOOST_WEIGHT = 0.3;

// Per-(role, axis) override of BOOST_WEIGHT — absent entries fall back to the
// global 0.3. Offlane's `initiating` is amplified above the default 2026-08-13
// (session-2 role-fit revision, direct user call): an offlaner's initiation
// should weigh more heavily in its role-fit than its other axes. This is an
// INTENT override that runs AGAINST the recomputed round-3 correlation, where
// initiating is actually the WEAKEST of Offlane's three kept axes (r=+0.148 vs
// map_control +0.425 / mobility +0.284) — eyeballed, not self-play calibrated
// (calibration debt, tracked in Blueprint/10). map_control was NOT added to
// Carry (inert — weight 0 everywhere) and camp_stacking was NOT added to
// Offlane (user chose to strengthen initiating instead), both by explicit call.
const ROLE_AXIS_BOOST_WEIGHT: Record<string, Record<string, number>> = {
  Offlane: { initiating: 0.5 },
};

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
    const weight = ROLE_AXIS_BOOST_WEIGHT[assignedRole]?.[axisKey] ?? BOOST_WEIGHT;
    return Math.min(10, Math.round((rawValue + weight * (rawValue - BASELINE)) * 10) / 10);
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

// Miscast penalty (Blueprint/10-tech-debt-backlog.md, 2026-08-06 support side,
// 2026-08-13 core side, both by direct user request): a hero who essentially
// never plays the assigned role FAMILY in real games takes a flat penalty
// across EVERY stat, not just the axes ROLE_AXES cares about — unlike the
// boost/dampen above, this isn't about rewarding or forgiving a specific axis,
// it's "the model doesn't know how to play this hero out of position at all."
// Personal (per-hero), not team-wide, unlike hard-carry stacking.
//
// Two symmetric directions, mutually exclusive by role (a role is either a
// support slot or a core slot, never both), so both multipliers can be applied
// together at a call site and at most one ever fires:
//   - supportMiscast: a hero with ~0 real Support history forced into Hard/Soft
//     Support. Keys on the single Support presumed_positions share.
//   - coreMiscast: a hero with ~0 real core history (Carry+Mid+Offlane share
//     summed) forced into Carry/Mid/Offlane. This is the fix for backlog item
//     1 — a "4 supports + 1 carry" draft, with three pure supports jammed into
//     core slots, previously took NO penalty for those three miscasts (only the
//     reverse was penalized), so it scored Elite. Keyed on the COMBINED core
//     share (not the specific assigned position) to mirror the support side's
//     coarse single-bucket test: a real offlaner slotted at Carry genuinely
//     plays cores and shouldn't be punished, only a hero who plays no core at
//     all. The presumed_positions data is cleanly bimodal here — 41 heroes at
//     exactly 0 core share, 86 at >=0.30, nothing between — so the threshold is
//     robust anywhere in (0.05, 0.30); 0.05 is chosen to mirror the support
//     threshold exactly.
//
// Both penalties are the same -10% for symmetry. NOT self-play calibrated (the
// user chose to ship the fix before measuring — calibration debt, tracked in
// Blueprint/10). A plausible follow-up hypothesis worth a future sweep: a pure
// support at Carry may be a worse miscast than a carry at Hard Support (no
// scaling/farm to fall back on), which would argue for a harsher CORE penalty
// than the SUPPORT one — left symmetric until measured.
const SUPPORT_MISCAST_THRESHOLD = 0.05;
const SUPPORT_MISCAST_PENALTY = 0.9; // -10%
const CORE_MISCAST_THRESHOLD = 0.05;
const CORE_MISCAST_PENALTY = 0.9; // -10%
const CORE_ROLES = ['Carry', 'Mid', 'Offlane'];

export function supportMiscastMultiplier(hero: Hero, assignedRole: string | null): number {
  if (assignedRole !== 'Hard Support' && assignedRole !== 'Soft Support') return 1;
  // Optional chaining: heroes.json-only Hero objects (scripts that bypass
  // HeroService/SQLite) don't carry presumed_positions — see the identical
  // comment in common/hard-carry.ts's isHardCarry().
  const supportShare = hero.presumed_positions?.find((p) => p.position === 'Support')?.share ?? 0;
  return supportShare < SUPPORT_MISCAST_THRESHOLD ? SUPPORT_MISCAST_PENALTY : 1;
}

export function coreMiscastMultiplier(hero: Hero, assignedRole: string | null): number {
  if (!CORE_ROLES.includes(assignedRole ?? '')) return 1;
  // Combined core share = every non-Support presumed position summed. Optional
  // chaining/`?? []` for the same heroes.json-only-Hero reason as above.
  const coreShare = (hero.presumed_positions ?? [])
    .filter((p) => p.position !== 'Support')
    .reduce((sum, p) => sum + p.share, 0);
  return coreShare < CORE_MISCAST_THRESHOLD ? CORE_MISCAST_PENALTY : 1;
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
