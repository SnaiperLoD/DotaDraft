export interface AnalyzerResult {
  key: string;
  label: string;
  score: number | null;
  // 0-100 rank against 10000 random 5-hero teams scored the same way — null
  // for non-axis analyzers (Synergy, Counter, Pro Similarity).
  percentile: number | null;
  explanation: string[];
  // OpenDota match link for the specific pro match this result is drawn
  // from — currently only Pro Similarity Analyzer sets it. See
  // Blueprint/10-tech-debt-backlog.md, "Ссылка на исходный матч для
  // про-пиков".
  matchUrl?: string | null;
  // heroId of the single highest-value hero on this axis (axis analyzers
  // only — undefined/null for Synergy/Counter/Pro Similarity, which aren't
  // per-hero axis scores). Powers the top-contributor ability highlight in
  // EvaluationPanel — see Blueprint/10-tech-debt-backlog.md, "Хайлайт
  // топ-контрибьюторов по оси".
  topContributorHeroId?: number | null;
}

export interface EvaluationSummary {
  strengths: string[];
  weaknesses: string[];
  // A short synthesized paragraph describing how a real game would likely
  // play out with this draft (win condition, game length, what to lean on
  // and what to cover for) — distinct from strengths/weaknesses, which are
  // per-axis fragments.
  gameplan: string;
}

// Named draft shape for Evaluation UI (Blueprint/10 §archetypes). Id only —
// labels are client i18n (`evaluation.archetype.*`). Display-only; no Battle math.
export type DraftArchetypeId =
  | 'four_plus_one'
  | 'split_push'
  | 'push'
  | 'deathball'
  | 'scaling'
  | 'balance';

export interface DraftArchetype {
  id: DraftArchetypeId;
}

export interface EvaluationResult {
  draftId: string;
  totalScore: number;
  breakdown: AnalyzerResult[];
  summary: EvaluationSummary;
  // Custom Tags active for this draft (shared/customTags.ts's
  // activeCustomTagsForTeam) — always-visible tags plus revealable ones
  // whose reveal condition the team's own composition already clears.
  // Public flavour tags plus revealable-hidden tags whose team-composition
  // gate was reached during drafting. Permanently hidden tags stay out.
  customTags: { name: string; rarity: string; description: string }[];
  // Legacy field — camp_stacking muted (no UI). Always null.
  campStackingNote: string | null;
  // Internal/backward-compatible diagnostic only; the client deliberately
  // does not disclose hidden calibration tags in Evaluation.
  hiddenCalibrationApplied: boolean;
  // Dominant draft shape from axis percentiles + role structure.
  // Optional for older History snapshots saved before this field existed.
  archetype?: DraftArchetype;
}
