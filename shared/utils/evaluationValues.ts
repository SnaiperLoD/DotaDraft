import type { Hero, HeroEvaluationValues, PresumedPosition } from '../types/hero';
import { bestGuessPosition } from './heroPosition';

// Single access point for a hero's evaluation_values, role-aware
// (Blueprint/12-next-session-priorities.md item 6). Every consumer that
// currently reads `hero.evaluation_values` directly for a role-aware context
// (analyzers, Battle Engine, UI breakdown cards) should go through this
// instead, so the no_info fallback behavior lives in one place rather than
// being reimplemented ad hoc at each call site.
//
// - role explicitly given: look it up in evaluation_values_by_role.
// - role omitted (no draft/role-assignment context yet — hero pool browsing,
//   percentile reference population, synergy pairing): use the hero's own
//   natural role via bestGuessPosition(), same fallback shape already used
//   elsewhere for "one answer needed, no explicit role available".
// - the resolved role is `no_info` (not enough real per-role data — see
//   RoleNoInfo's comment in shared/types/hero.ts): falls back to the
//   hero-level aggregate (`evaluation_values`), UNCHANGED behavior from
//   before this axis-per-role work existed. This is a deliberate placeholder,
//   not a final fallback policy — which heroes/roles need something smarter
//   than "just use the aggregate" is still an open, explicitly deferred
//   decision (see conversation/Blueprint note), not decided here.
export function resolveEvaluationValues(hero: Hero, role?: PresumedPosition | null): HeroEvaluationValues {
  const targetRole = role ?? bestGuessPosition(hero);
  const entry = hero.evaluation_values_by_role?.[targetRole];
  if (entry && !('no_info' in entry)) return entry;
  return hero.evaluation_values;
}

// True when real per-role data exists for this hero/role (i.e. resolving it
// would NOT fall back to the aggregate). Lets a caller distinguish "this
// number reflects the assigned role" from "this is the hero's overall
// average" without duplicating the no_info check inline.
export function hasRoleEvaluationData(hero: Hero, role: PresumedPosition): boolean {
  const entry = hero.evaluation_values_by_role?.[role];
  return !!entry && !('no_info' in entry);
}
