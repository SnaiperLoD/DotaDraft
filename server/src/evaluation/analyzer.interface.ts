import type { Hero } from 'shared';

export interface AnalyzerOutput {
  score: number | null;
  explanation: string[];
}

export interface Analyzer {
  key: string;
  label: string;
  analyze(heroes: Hero[]): AnalyzerOutput;
}
