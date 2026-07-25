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
}
