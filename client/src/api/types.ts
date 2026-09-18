import type { HeroEvaluationValues } from 'shared';
export type { DraftHeroView, DraftStateView } from 'shared';

export interface TiFormHero {
  heroId: number;
  heroName: string;
  games: number;
  wins: number;
  losses: number;
  winRate: number;
}

export interface TiFormResponse {
  leagueName: string | null;
  matchCount: number;
  heroes: TiFormHero[];
}

// Testing-only (DebugMatrixPage). Mirrors server/src/dev/dev.service.ts —
// hand-synced rather than moved into `shared`, because nothing in the shipped
// product consumes these and putting them in shared would imply they're part
// of the real contract.
export interface HeroDebugRow {
  heroId: number;
  name: string;
  primaryAttribute: string;
  axes: HeroEvaluationValues;
  tags: { name: string; hidden: boolean }[];
  realWinRate: number | null;
  // Keyed by dataset key (see `datasets` below): noTags / tags / tagsBlend.
  ourWinRate: Record<string, number | null>;
  divergence: Record<string, number | null>;
}

export interface DebugDatasetInfo {
  key: string;
  label: string;
  path: string;
  present: boolean;
  generatedAt: string | null;
  config: Record<string, unknown> | null;
}

export interface HeroDebugMatrix {
  rows: HeroDebugRow[];
  datasets: DebugDatasetInfo[];
}
