import type { Hero } from 'shared';

export interface AnalyzerOutput {
  score: number | null;
  explanation: string[];
}

// A drafted hero plus the role it was assigned in RoleAssignment (null
// before roles are assigned, or for a Battle Engine opponent side that
// doesn't carry role data). Analyzers that don't care about role can just
// map to picks.map((p) => p.hero) as their first line.
export interface DraftPick {
  hero: Hero;
  assignedRole: string | null;
}

export interface Analyzer {
  key: string;
  label: string;
  analyze(picks: DraftPick[]): AnalyzerOutput;
}
