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

export interface EvaluationResult {
  draftId: string;
  totalScore: number;
  breakdown: AnalyzerResult[];
  summary: EvaluationSummary;
  // Custom Tags active for this draft (shared/customTags.ts's
  // activeCustomTagsForTeam) — always-visible tags plus revealable ones
  // whose reveal condition the team's own composition already clears.
  // Evaluation-Engine-only display; doesn't move totalScore (Custom Tags
  // stay a Battle Engine mechanic, see Core Rules Separation).
  customTags: { name: string; rarity: string; description: string }[];
  // camp_stacking's axis card was removed from `breakdown` (2026-08-06, by
  // user request — see Blueprint/10-tech-debt-backlog.md) in favor of a
  // single note, present only when the team's camp_stacking percentile
  // clears 70 — null otherwise, including whenever it's just unremarkable.
  campStackingNote: string | null;
}
