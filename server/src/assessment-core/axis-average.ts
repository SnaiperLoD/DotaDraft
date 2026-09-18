import type { HeroEvaluationValues } from 'shared';
import { roleAwareAxisValue, supportMiscastMultiplier, coreMiscastMultiplier } from '../common/role-fit';
import { utilityStackBreadth } from '../common/utility-stacking';
import type { GamePhase } from '../common/axis-weights-config';
import type { CustomTagEffects } from './analyzer-types';
import type { TeamPick } from './team-pick';

// Role-fit-adjusted: a pick's contribution to the axis average is boosted
// per common/role-fit.ts if their assigned role cares about this axis and
// they're already strong on it. assignedRole is null for opponent sides
// without stored role data (see TeamPick) — roleFitValue no-ops on null.
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
  team: TeamPick[],
  axis: keyof HeroEvaluationValues,
  tagEffects?: CustomTagEffects,
  phase?: GamePhase,
): number {
  const raw =
    team.reduce((sum, p) => {
      const base =
        roleAwareAxisValue(axis, p.hero, p.assignedRole, utilityStackBreadth(p.hero)) *
        supportMiscastMultiplier(p.hero, p.assignedRole) *
        coreMiscastMultiplier(p.hero, p.assignedRole);
      const heroMult = tagEffects?.heroPowerMultiplier.get(p.hero.id) ?? 1;
      const heroAxisMult = tagEffects?.heroAxisMultiplier.get(p.hero.id)?.[axis] ?? 1;
      const phaseHeroMult = (phase && tagEffects?.phaseHeroPowerMultiplier.get(phase)?.get(p.hero.id)) ?? 1;
      return sum + base * heroMult * heroAxisMult * phaseHeroMult;
    }, 0) / team.length;
  const axisMult = tagEffects?.axisMultiplier[axis] ?? 1;
  return raw * axisMult;
}
