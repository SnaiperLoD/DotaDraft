import type { HeroEvaluationValues, LocalizedLine } from 'shared';
import type { GamePhase } from '../common/axis-weights-config';
import type { DraftPick } from './team-pick';

export type { TeamPick, BattlePick, DraftPick } from './team-pick';

export interface AnalyzerOutput {
  score: number | null;
  // Where this score ranks (0-100) against unique Ancient+Divine 5-hero
  // drafts from OpenDota scored the same way
  // (server/data/axis-percentile-distributions.json,
  // src/assessment-core/axis-percentiles.ts) — null for analyzers that aren't
  // axis-based (Synergy, Counter, Pro Similarity have no such population).
  percentile: number | null;
  explanation: LocalizedLine[];
  // OpenDota match link for the specific pro match an analyzer's result is
  // drawn from (currently only Pro Similarity Analyzer sets this — see
  // Blueprint/10-tech-debt-backlog.md, "Ссылка на исходный матч для
  // про-пиков"). Optional so every other analyzer's object literal is
  // unaffected.
  matchUrl?: string | null;
  // See shared/types/evaluation.ts's AnalyzerResult.topContributorHeroId —
  // same field, propagated as-is through evaluation.service.ts's breakdown
  // mapping.
  topContributorHeroId?: number | null;
}

export interface Analyzer {
  key: string;
  label: string;
  analyze(picks: DraftPick[]): AnalyzerOutput;
}

// Type-only shape consumed by axisAverage(). Magnitudes and blessingEffectsFor
// stay in battle/custom-tags.ts.
export interface CustomTagEffects {
  heroPowerMultiplier: Map<number, number>;
  axisMultiplier: Partial<Record<keyof HeroEvaluationValues, number>>;
  heroAxisMultiplier: Map<number, Partial<Record<keyof HeroEvaluationValues, number>>>;
  phaseHeroPowerMultiplier: Map<GamePhase, Map<number, number>>;
}
