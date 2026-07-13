export interface AnalyzerResult {
  key: string;
  label: string;
  score: number | null;
  explanation: string[];
}

export interface EvaluationSummary {
  strengths: string[];
  weaknesses: string[];
}

export interface EvaluationResult {
  draftId: string;
  totalScore: number;
  breakdown: AnalyzerResult[];
  summary: EvaluationSummary;
}
