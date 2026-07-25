import type { HeroEvaluationValues } from 'shared';
import type { Analyzer, DraftPick } from '../analyzer.interface';
import { AXIS_NARRATIVE, percentileBracket, type NarrativeContext } from '../score-narrative';
import { percentileFor } from '../axis-percentiles';
import { roleFitValue } from '../../common/role-fit';
import { hardCarryPenalty, hardCarryAxisMultipliers, isHardCarry } from '../../common/hard-carry';
import { utilityStackAxisMultipliers } from '../../common/utility-stacking';

type AxisKey = keyof HeroEvaluationValues;

export function createAxisAnalyzer(key: AxisKey, label: string): Analyzer {
  return {
    key,
    label,
    analyze(picks: DraftPick[]) {
      if (picks.length === 0) {
        return { score: null, percentile: null, explanation: ['No heroes to analyze.'] };
      }

      const values = picks.map((p) => {
        const raw = p.hero.evaluation_values[key];
        const roleFitAdjusted = roleFitValue(key, p.assignedRole, raw);
        // Same utility-stacking discount as Battle Engine's overallPower
        // (common/utility-stacking.ts) — per-hero, not per-team like
        // hard-carry below, since it's a property of each hero's own kit
        // (control/initiating/mobility/saving/skirmish_rate/map_control
        // all high at once). Returns 1 for every axis outside that set, so
        // this is a no-op for the other 7 axes.
        const utilityMult = utilityStackAxisMultipliers(p.hero)[key] ?? 1;
        const value = Math.round(roleFitAdjusted * utilityMult * 10) / 10;
        return {
          hero: p.hero,
          value,
          assignedRole: p.assignedRole,
          boosted: roleFitAdjusted > raw,
          utilityDiscounted: utilityMult < 1,
        };
      });
      const average = values.reduce((sum, v) => sum + v.value, 0) / values.length;

      // Same hard-carry stacking treatment as Battle Engine's overallPower
      // (common/hard-carry.ts) — applied per-axis here since Evaluation
      // Engine has no single "sum of axes" the way Battle Engine's
      // overallPower is one. Doesn't touch Synergy/Counter/Pro Similarity,
      // which aren't axis-based. scaling is exempt from the penalty (and
      // gets its own boost instead) — hardCarryAxisMultipliers already
      // encodes that per-axis split, this analyzer just needs to read it
      // for its own `key` rather than applying the flat penalty to every
      // axis uniformly.
      const penalty = hardCarryPenalty(picks.map((p) => p.hero));
      const multiplier = hardCarryAxisMultipliers(picks.map((p) => p.hero))[key] ?? 1;
      const score = Math.round(average * multiplier * 10) / 10;

      // Where this score ranks against 10000 random 5-hero teams scored the
      // same way (axis-percentiles.ts) — drives both the bracket ("above/
      // below average") and the narrative sentence itself, replacing the
      // old fixed 0-10 score cutoff (Blueprint/10-tech-debt-backlog.md,
      // "Percentile-based Evaluation").
      const percentile = percentileFor(key, score);
      const bracket = percentileBracket(percentile ?? 50);

      const top = [...values].sort((a, b) => b.value - a.value).slice(0, 2);
      const ctx: NarrativeContext = {
        percentile: percentile ?? 50,
        bracket,
        top: top.map((v) => ({ name: v.hero.name, value: v.value })),
      };
      const explanation = [
        `Team average ${label.toLowerCase()}: ${score}/10.`,
        `Strongest contributors: ${top.map((v) => `${v.hero.name} (${v.value})`).join(', ')}.`,
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
          key === 'scaling'
            ? `This draft stacks ${hardCarryCount} hard-carry (Carry/Mid-dominant) heroes — built for a long game, so a ${Math.round((multiplier - 1) * 100)}% boost is applied here instead of the usual stacking penalty.`
            : `This draft stacks ${hardCarryCount} hard-carry (Carry/Mid-dominant) heroes, diluting focus — a ${Math.round(penalty * 100)}% penalty is applied here.`,
        );
      }

      const utilityDiscounted = values.filter((v) => v.utilityDiscounted);
      if (utilityDiscounted.length > 0) {
        explanation.push(
          `${utilityDiscounted.map((v) => v.hero.name).join(', ')} ` +
            `${utilityDiscounted.length === 1 ? 'stacks' : 'stack'} several overlapping utility strengths at once — ` +
            `${utilityDiscounted.length === 1 ? 'its' : 'their'} contribution here is discounted rather than counted at full value.`,
        );
      }

      // Narrative always comes last — buildSummary() (evaluation.service.ts)
      // relies on the final explanation line being the human-readable
      // narrative sentence, not a numeric role-fit/hard-carry aside.
      explanation.push(AXIS_NARRATIVE[key][bracket](ctx));

      return { score, percentile, explanation };
    },
  };
}
