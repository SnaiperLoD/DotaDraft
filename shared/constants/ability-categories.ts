// 5 evaluation axes have per-ability hand-tagged data (see
// Blueprint/09-hero-knowledge-base.md's ability-tagging pipeline —
// server/data/ability-tagging.csv → hero-abilities.json). damage_mitigation
// (-> durability) added 2026-08-03, a much smaller first pass (18 abilities)
// than the other 4 categories — see Blueprint/10-tech-debt-backlog.md.
// Every other axis (teamfight, tempo, scaling, burst, map_control,
// objectives, skirmish_rate, camp_stacking) is built from real per-minute
// match stats, not per-ability tags, so there is no "which ability
// contributed" data to drill into for them.
export const ABILITY_CATEGORY_FOR_AXIS = {
  control: 'control_strength',
  mobility: 'mobility',
  saving: 'saving',
  initiating: 'initiating',
  durability: 'damage_mitigation',
} as const;

export type AbilityTaggedAxis = keyof typeof ABILITY_CATEGORY_FOR_AXIS;
export type AbilityCategory = (typeof ABILITY_CATEGORY_FOR_AXIS)[AbilityTaggedAxis];

export function isAbilityTaggedAxis(axis: string): axis is AbilityTaggedAxis {
  return axis in ABILITY_CATEGORY_FOR_AXIS;
}
