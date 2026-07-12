export interface AnalyzerResult {
  key: string;
  label: string;
  score: number | null;
  explanation: string[];
}

export interface EvaluationResult {
  draftId: string;
  totalScore: number;
  breakdown: AnalyzerResult[];
}
