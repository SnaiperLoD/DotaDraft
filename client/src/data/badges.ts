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

export interface BadgeDefinition {
  id: string;
  name: string;
  description: string;
}

export interface ActiveBadge extends BadgeDefinition {
  triggerCount: number;
}

const AXIS_THRESHOLD = 6;

function heroesWithAxisAtLeast(heroes: Hero[], axis: string, min: number): Hero[] {
  return heroes.filter((h) => (h.evaluation_values as unknown as Record<string, number>)[axis] >= min);
}

const BADGES: Record<string, BadgeDefinition> = {
  chainLock: {
    id: 'chainLock',
    name: 'Chain Lock',
    description: '3+ heroes with strong control chain their disables — +8% to the team\'s control axis.',
  },
  ironWall: {
    id: 'ironWall',
    name: 'Iron Wall',
    description: "3+ heroes built to survive (durability + saving) — +10% effective survivability in extended fights.",
  },
  tempoStorm: {
    id: 'tempoStorm',
    name: 'Tempo Storm',
    description: '3+ heroes built around early aggression — +12% snowball potential in the first 15 minutes.',
  },
  oneTrueKing: {
    id: 'oneTrueKing',
    name: 'One True King',
    description: 'Exactly one dedicated Carry, four heroes built to enable them — +6% to the Carry\'s effective power.',
  },
  visionWeb: {
    id: 'visionWeb',
    name: 'Vision Web',
    description: '3+ heroes with strong map control — +7% map-wide vision advantage.',
  },
  // All-one-attack-type compositions. Effect numbers are provisional (same
  // display-only-for-now posture as every badge here) — flagged in the
  // backlog to measure which axes 5-melee / 5-ranged drafts actually sag on
  // and set the real values from that.
  allMelee: {
    id: 'allMelee',
    name: 'All Melee',
    description:
      'Five melee heroes — a frontline wall that trades reach for staying power: +5% durability, -5% skirmish rate, -5% scaling.',
  },
  allRanged: {
    id: 'allRanged',
    name: 'All Ranged',
    description:
      'Five ranged heroes — poke and kite instead of a frontline: +5% skirmish rate, +5% control, -10% durability, -5% map control.',
  },
};

export function detectBadges(heroes: Hero[]): ActiveBadge[] {
  const active: ActiveBadge[] = [];

  const control = heroesWithAxisAtLeast(heroes, 'control', AXIS_THRESHOLD);
  if (control.length >= 3) active.push({ ...BADGES.chainLock, triggerCount: control.length });

  const wall = heroes.filter(
    (h) => h.evaluation_values.durability >= AXIS_THRESHOLD && h.evaluation_values.saving >= 5,
  );
  if (wall.length >= 3) active.push({ ...BADGES.ironWall, triggerCount: wall.length });

  const storm = heroes.filter(
    (h) => h.evaluation_values.tempo >= AXIS_THRESHOLD && h.evaluation_values.skirmish_rate >= AXIS_THRESHOLD,
  );
  if (storm.length >= 3) active.push({ ...BADGES.tempoStorm, triggerCount: storm.length });

  const dedicatedCarries = heroes.filter((h) => {
    const top = h.presumed_positions?.[0];
    return top?.position === 'Carry' && top.share > 0.5;
  });
  if (dedicatedCarries.length === 1) active.push({ ...BADGES.oneTrueKing, triggerCount: 1 });

  const vision = heroesWithAxisAtLeast(heroes, 'map_control', AXIS_THRESHOLD);
  if (vision.length >= 3) active.push({ ...BADGES.visionWeb, triggerCount: vision.length });

  // A full team of one attack type — only on a complete 5-hero draft.
  if (heroes.length === 5 && heroes.every((h) => h.attack_type === 'Melee'))
    active.push({ ...BADGES.allMelee, triggerCount: 5 });
  if (heroes.length === 5 && heroes.every((h) => h.attack_type === 'Ranged'))
    active.push({ ...BADGES.allRanged, triggerCount: 5 });

  return active;
}
