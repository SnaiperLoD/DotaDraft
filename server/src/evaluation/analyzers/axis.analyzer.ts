import type { Hero, HeroEvaluationValues } from 'shared';
import type { Analyzer } from '../analyzer.interface';

type AxisKey = keyof HeroEvaluationValues;

export function createAxisAnalyzer(key: AxisKey, label: string): Analyzer {
  return {
    key,
    label,
    analyze(heroes: Hero[]) {
      if (heroes.length === 0) {
        return { score: null, explanation: ['No heroes to analyze.'] };
      }

      const values = heroes.map((h) => ({ hero: h, value: h.evaluation_values[key] }));
      const average = values.reduce((sum, v) => sum + v.value, 0) / values.length;
      const score = Math.round(average * 10) / 10;

      const top = [...values].sort((a, b) => b.value - a.value).slice(0, 2);
      const explanation = [
        `Team average ${label.toLowerCase()}: ${score}/10.`,
        `Strongest contributors: ${top.map((v) => `${v.hero.name} (${v.value})`).join(', ')}.`,
      ];

      return { score, explanation };
    },
  };
}
