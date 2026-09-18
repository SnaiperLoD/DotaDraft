import type { LocalizedLine } from './i18n';

export interface AnalyzerResult {
  key: string;
  label: string;
  score: number | null;
  // 0-100 rank against unique Ancient+Divine 5-hero drafts from OpenDota
  // scored the same way — null for non-axis analyzers (Synergy, Counter,
  // Pro Similarity).
  percentile: number | null;
  // I18nLine for new payloads; plain English strings for History snapshots.
  explanation: LocalizedLine[];
  // OpenDota match link for the specific pro match this result is drawn
  // from — currently only Pro Similarity Analyzer sets it. See
  // Blueprint/10-tech-debt-backlog.md, "Ссылка на исходный матч для
  // про-пиков".
  matchUrl?: string | null;
  // heroId of the single highest-value hero on this axis (axis analyzers
  // only). Null when that hero sits in the bottom 35% of the full roster on
  // this axis — display floor, not a weight change (playtest 2026-08-19).
  topContributorHeroId?: number | null;
}

export interface EvaluationSummary {
  strengths: LocalizedLine[];
  weaknesses: LocalizedLine[];
  // Win-condition + lean-on / cover-for beats (I18nLine[]). Legacy History
  // may still store a single English paragraph string.
  gameplan: LocalizedLine[] | string;
}

// Named draft shape for Evaluation UI (Blueprint/10 §archetypes). Id only —
// labels are client i18n (`evaluation.archetype.*`). Display-only; no Battle math.
export type DraftArchetypeId =
  'four_plus_one' | 'split_push' | 'push' | 'tempo' | 'deathball' | 'scaling' | 'balance';

export interface DraftArchetype {
  id: DraftArchetypeId;
}

export interface EvaluationCustomTag {
  name: string;
  rarity: string;
  // English fallback (History snapshots / older clients). UI prefers i18n
  // catalogs + fundamentalsAxes keys when present.
  description: string;
  // Axis keys The Fundamentals is boosting this draft. Client localizes
  // via axes.*; History without this field still parses `description`.
  fundamentalsAxes?: string[];
}

export interface EvaluationResult {
  // Payload schema version — absent on History rows saved before v1.
  schemaVersion?: number;
  draftId: string;
  totalScore: number;
  breakdown: AnalyzerResult[];
  summary: EvaluationSummary;
  // Custom Tags active for this draft (shared/customTags.ts's
  // activeCustomTagsForTeam) — always-visible tags plus revealable ones
  // whose reveal condition the team's own composition already clears.
  // Public flavour tags plus revealable-hidden tags whose team-composition
  // gate was reached during drafting. Permanently hidden tags stay out.
  customTags: EvaluationCustomTag[];
  // Legacy field — camp_stacking muted (no UI). Always null.
  campStackingNote: string | null;
  // Internal/backward-compatible diagnostic only; the client deliberately
  // does not disclose hidden calibration tags in Evaluation.
  hiddenCalibrationApplied: boolean;
  // Dominant draft shape from axis percentiles + role structure.
  // Optional for older History snapshots saved before this field existed.
  archetype?: DraftArchetype;
}
