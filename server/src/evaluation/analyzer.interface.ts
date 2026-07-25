import type { Hero } from 'shared';

export interface AnalyzerOutput {
  score: number | null;
  // Where this score ranks (0-100) against 10000 random 5-hero teams
  // scored the same way (server/data/axis-percentile-distributions.json,
  // src/evaluation/axis-percentiles.ts) — null for analyzers that aren't
  // axis-based (Synergy, Counter, Pro Similarity have no such population).
  percentile: number | null;
  explanation: string[];
  // OpenDota match link for the specific pro match an analyzer's result is
  // drawn from (currently only Pro Similarity Analyzer sets this — see
  // Blueprint/10-tech-debt-backlog.md, "Ссылка на исходный матч для
  // про-пиков"). Optional so every other analyzer's object literal is
  // unaffected.
  matchUrl?: string | null;
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
