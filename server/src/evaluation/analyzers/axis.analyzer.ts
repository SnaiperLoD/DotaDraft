import type { HeroEvaluationValues } from 'shared';
import type { Analyzer, DraftPick } from '../analyzer.interface';
import { AXIS_NARRATIVE, scoreBracket } from '../score-narrative';
import { roleFitValue } from '../../common/role-fit';
import { hardCarryPenalty, isHardCarry } from '../../common/hard-carry';

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

      // Same hard-carry stacking penalty as Battle Engine's overallPower
      // (common/hard-carry.ts) — applied per-axis here since Evaluation
      // Engine has no single "sum of axes" the way Battle Engine's
      // overallPower is one. Doesn't touch Synergy/Counter/Pro Similarity,
      // which aren't axis-based.
      const penalty = hardCarryPenalty(picks.map((p) => p.hero));
      const score = Math.round(average * (1 - penalty) * 10) / 10;

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

      if (penalty > 0) {
        const hardCarryCount = picks.filter((p) => isHardCarry(p.hero)).length;
        explanation.push(
          `This draft stacks ${hardCarryCount} hard-carry (Carry/Mid-dominant) heroes, diluting focus — a ${Math.round(penalty * 100)}% penalty is applied here.`,
        );
      }

      return { score, explanation };
    },
  };
}
