import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DraftService } from '../draft/draft.service';
import { synergyAnalyzer } from './analyzers/synergy.analyzer';
import { counterAnalyzer } from './analyzers/counter.analyzer';
import { createAxisAnalyzer } from './analyzers/axis.analyzer';
import { proSimilarityAnalyzer } from './analyzers/pro-similarity.analyzer';
import type { Analyzer } from './analyzer.interface';
import type { EvaluationResult, AnalyzerResult } from 'shared';

// Order matches Blueprint/05-evaluation-engine.md's Output breakdown list.
const ANALYZERS: Analyzer[] = [
  synergyAnalyzer,
  counterAnalyzer,
  createAxisAnalyzer('teamfight', 'Teamfight'),
  createAxisAnalyzer('tempo', 'Tempo'),
  createAxisAnalyzer('scaling', 'Scaling'),
  createAxisAnalyzer('mobility', 'Mobility'),
  createAxisAnalyzer('vision', 'Vision'),
  createAxisAnalyzer('objectives', 'Objectives'),
  proSimilarityAnalyzer,
];

// Initial Weights from Blueprint/05-evaluation-engine.md. `counter` is deliberately
// absent: the blueprint's weight list omits it, so it's shown as an informational
// breakdown item only and doesn't affect Total Score.
const WEIGHTS: Record<string, number> = {
  synergy: 0.3,
  teamfight: 0.2,
  tempo: 0.15,
  scaling: 0.1,
  objectives: 0.1,
  mobility: 0.05,
  vision: 0.05,
  proSimilarity: 0.05,
};

@Injectable()
export class EvaluationService {
  constructor(private readonly draftService: DraftService) {}

  async evaluate(draftId: string): Promise<EvaluationResult> {
    const draft = await this.draftService.getById(draftId);
    if (!draft) throw new NotFoundException('Draft not found');
    if (draft.heroes.length < 5) {
      throw new BadRequestException('Draft must have all 5 heroes picked before evaluation');
    }

    const heroes = draft.heroes.map((dh) => dh.hero);
    const breakdown: AnalyzerResult[] = ANALYZERS.map((analyzer) => {
      const result = analyzer.analyze(heroes);
      return {
        key: analyzer.key,
        label: analyzer.label,
        score: result.score,
        explanation: result.explanation,
      };
    });

    const totalScore = this.weightedTotal(breakdown);

    return { draftId, totalScore, breakdown };
  }

  private weightedTotal(breakdown: AnalyzerResult[]): number {
    const weighable = breakdown.filter((b) => b.key in WEIGHTS);
    const available = weighable.filter((b) => b.score !== null);
    const availableWeight = available.reduce((sum, b) => sum + WEIGHTS[b.key], 0);

    if (availableWeight === 0) return 0;

    // Redistribute weight from unavailable analyzers (e.g. Pro Similarity before
    // Milestone 3) proportionally across the ones that did produce a score.
    const total = available.reduce(
      (sum, b) => sum + (b.score as number) * (WEIGHTS[b.key] / availableWeight),
      0,
    );

    return Math.round(total * 10) / 10;
  }
}
