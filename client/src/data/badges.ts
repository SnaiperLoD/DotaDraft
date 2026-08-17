import type { Hero } from 'shared';

// Badges — draft-composition-level bonuses, distinct from Custom Tags
// (data/customTags.ts, which are per-hero and shown DURING drafting).
// Badges look at the whole picked team's pattern (not a specific named
// hero) and only show up once on the final Evaluation screen. Detection
// here is client-side, computed straight from the drafted heroes'
// evaluation_values/presumed_positions — same "demo/placeholder, invent
// the numbers" posture as Custom Tags: not wired into battle-resolution.ts
// math yet, purely a recap/flavor display for now. See
// Blueprint/10-tech-debt-backlog.md.
//
// Display name/description live in client i18n (`badges.<id>.*`) so RU/EN
// stay consistent — this module only returns stable ids + trigger counts.

export interface ActiveBadge {
  id: string;
  triggerCount: number;
}

const AXIS_THRESHOLD = 6;

function heroesWithAxisAtLeast(heroes: Hero[], axis: string, min: number): Hero[] {
  return heroes.filter((h) => (h.evaluation_values as unknown as Record<string, number>)[axis] >= min);
}

export function detectBadges(heroes: Hero[]): ActiveBadge[] {
  const active: ActiveBadge[] = [];

  const control = heroesWithAxisAtLeast(heroes, 'control', AXIS_THRESHOLD);
  if (control.length >= 3) active.push({ id: 'chainLock', triggerCount: control.length });

  const wall = heroes.filter(
    (h) => h.evaluation_values.durability >= AXIS_THRESHOLD && h.evaluation_values.saving >= 5,
  );
  if (wall.length >= 3) active.push({ id: 'ironWall', triggerCount: wall.length });

  const storm = heroes.filter(
    (h) => h.evaluation_values.tempo >= AXIS_THRESHOLD && h.evaluation_values.skirmish_rate >= AXIS_THRESHOLD,
  );
  if (storm.length >= 3) active.push({ id: 'tempoStorm', triggerCount: storm.length });

  const dedicatedCarries = heroes.filter((h) => {
    const top = h.presumed_positions?.[0];
    return top?.position === 'Carry' && top.share > 0.5;
  });
  if (dedicatedCarries.length === 1) active.push({ id: 'oneTrueKing', triggerCount: 1 });

  const vision = heroesWithAxisAtLeast(heroes, 'map_control', AXIS_THRESHOLD);
  if (vision.length >= 3) active.push({ id: 'visionWeb', triggerCount: vision.length });

  if (heroes.length === 5 && heroes.every((h) => h.attack_type === 'Melee'))
    active.push({ id: 'allMelee', triggerCount: 5 });
  if (heroes.length === 5 && heroes.every((h) => h.attack_type === 'Ranged'))
    active.push({ id: 'allRanged', triggerCount: 5 });

  return active;
}
