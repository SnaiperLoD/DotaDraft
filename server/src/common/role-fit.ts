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

// Boosts a hero's own axis value when assignedRole is relevant to axisKey
// AND the hero already scores above the population baseline (5) on it.
// Proportional to how far above baseline they already are, so it amplifies
// an existing strength rather than adding a flat bonus regardless of fit.
export function roleFitValue(axisKey: string, assignedRole: string | null, rawValue: number): number {
  if (!assignedRole) return rawValue;
  const axes = ROLE_AXES[assignedRole];
  if (!axes || !axes.includes(axisKey)) return rawValue;
  if (rawValue <= BASELINE) return rawValue;
  return Math.min(10, Math.round((rawValue + BOOST_WEIGHT * (rawValue - BASELINE)) * 10) / 10);
}

export function isRoleFitAxis(axisKey: string, assignedRole: string | null): boolean {
  if (!assignedRole) return false;
  return ROLE_AXES[assignedRole]?.includes(axisKey) ?? false;
}
