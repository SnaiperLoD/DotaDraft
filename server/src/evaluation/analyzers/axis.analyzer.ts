import type { HeroEvaluationValues } from 'shared';
import type { Analyzer, DraftPick } from '../analyzer.interface';
import { AXIS_NARRATIVE, scoreBracket } from '../score-narrative';
import { roleFitValue } from '../role-fit';

type AxisKey = keyof HeroEvaluationValues;

export function createAxisAnalyzer(key: AxisKey, label: string): Analyzer {
  return {
    key,
    label,
    analyze(picks: DraftPick[]) {
      if (picks.length === 0) {
        return { score: null, explanation: ['No heroes to analyze.'] };
      }

      const values = picks.map((p) => {
        const raw = p.hero.evaluation_values[key];
        const value = roleFitValue(key, p.assignedRole, raw);
        return { hero: p.hero, value, assignedRole: p.assignedRole, boosted: value > raw };
      });
      const average = values.reduce((sum, v) => sum + v.value, 0) / values.length;
      const score = Math.round(average * 10) / 10;

      const top = [...values].sort((a, b) => b.value - a.value).slice(0, 2);
      const explanation = [
        `Team average ${label.toLowerCase()}: ${score}/10.`,
        `Strongest contributors: ${top.map((v) => `${v.hero.name} (${v.value})`).join(', ')}.`,
        AXIS_NARRATIVE[key][scoreBracket(score)],
      ];

      const boosted = values.filter((v) => v.boosted);
      if (boosted.length > 0) {
        explanation.push(
          `${boosted.map((v) => `${v.hero.name} (${v.assignedRole})`).join(', ')} ` +
            `${boosted.length === 1 ? 'gets' : 'get'} a role-fit bonus here.`,
        );
      }

      return { score, explanation };
    },
  };
}
