import type { Hero } from 'shared';

// Unified team member + assigned role. `assignedRole` is null before
// RoleAssignment, for legacy Opponent Pool rows, or a Battle opponent side
// without stored role data. roleFitValue() already treats null as "no boost".
// Analyzers that don't care about role can map to picks.map((p) => p.hero).
export interface TeamPick {
  hero: Hero;
  assignedRole: string | null;
}

export type BattlePick = TeamPick;
export type DraftPick = TeamPick;
