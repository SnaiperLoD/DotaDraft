import type { HeroEvaluationValues, LocalizedLine } from 'shared';
import { i18nLine } from 'shared';
import type { Analyzer, DraftPick } from '../analyzer.interface';
import { axisNarrativeBracket, type NarrativeContext, type AxisBracket } from '../score-narrative';
import { percentileFor } from '../axis-percentiles';
import { roleAwareAxisValue, supportMiscastMultiplier, coreMiscastMultiplier } from '../../common/role-fit';
import { hardCarryPenalty, hardCarryAxisMultipliers, isHardCarry } from '../../common/hard-carry';
import { utilityStackAxisMultipliers, utilityStackBreadth } from '../../common/utility-stacking';
import { calibrationMultipliersForTeam } from '../../common/calibration-tags';

type AxisKey = keyof HeroEvaluationValues;

function bodyBracket(bracket: AxisBracket): 'low' | 'mid' | 'high' {
  if (bracket === 'veryLow') return 'low';
  if (bracket === 'veryHigh') return 'high';
  return bracket;
}

/** Structured axis narrative — client concatenates lede + body via i18n. */
export function axisNarrativeLine(key: string, ctx: NarrativeContext): LocalizedLine {
  const pct =
    ctx.bracket === 'high' || ctx.bracket === 'veryHigh'
      ? String(Math.max(1, 100 - ctx.percentile))
      : String(Math.max(1, ctx.percentile));
  let carried = '';
  if (ctx.top.length === 1) carried = ctx.top[0].name;
  else if (ctx.top.length >= 2) carried = `${ctx.top[0].name}|${ctx.top[1].name}`;
  return i18nLine('eval.axis.narrative', {
    axis: key,
    bracket: ctx.bracket,
    bodyBracket: bodyBracket(ctx.bracket),
    pct,
    carried,
    carriedCount: String(ctx.top.length === 0 ? 0 : ctx.top.length === 1 ? 1 : 2),
  });
}

/** True when `value` sits in the bottom `cutoff` share of `pool` (CDF). */
export function isBottomPoolShare(value: number, pool: number[], cutoff = 0.35): boolean {
  if (pool.length === 0) return false;
  const atOrBelow = pool.filter((v) => v <= value).length;
  return atOrBelow / pool.length <= cutoff;
}

export function createAxisAnalyzer(key: AxisKey, label: string, poolValues: number[] = []): Analyzer {
  return {
    key,
    label,
    analyze(picks: DraftPick[]) {
      if (picks.length === 0) {
        return { score: null, percentile: null, explanation: [i18nLine('eval.axis.empty')] };
      }

      const calibrationByHero = calibrationMultipliersForTeam(picks.map((p) => p.hero));

      const values = picks.map((p) => {
        const raw = p.hero.evaluation_values[key];
        const roleFitAdjusted = roleAwareAxisValue(key, p.hero, p.assignedRole, utilityStackBreadth(p.hero));
        const utilityMult = utilityStackAxisMultipliers(p.hero)[key] ?? 1;
        const miscastMult =
          supportMiscastMultiplier(p.hero, p.assignedRole) * coreMiscastMultiplier(p.hero, p.assignedRole);
        const cal = calibrationByHero.get(p.hero.id);
        const calPower = cal?.power ?? 1;
        const calAxis = cal?.axis[key] ?? 1;
        const value = Math.round(roleFitAdjusted * utilityMult * miscastMult * calPower * calAxis * 10) / 10;
        return {
          hero: p.hero,
          value,
          assignedRole: p.assignedRole,
          boosted: roleFitAdjusted > raw,
        };
      });
      const average = values.reduce((sum, v) => sum + v.value, 0) / values.length;

      const penalty = hardCarryPenalty(picks.map((p) => p.hero));
      const multiplier = hardCarryAxisMultipliers(picks.map((p) => p.hero))[key] ?? 1;
      const score = Math.round(average * multiplier * 10) / 10;

      const percentile = percentileFor(key, score);
      const bracket = axisNarrativeBracket(percentile ?? 50);

      const top = [...values].sort((a, b) => b.value - a.value).slice(0, 2);
      const ctx: NarrativeContext = {
        percentile: percentile ?? 50,
        bracket,
        top: top.map((v) => ({ name: v.hero.name, value: v.value })),
      };
      const explanation: LocalizedLine[] = [
        i18nLine('eval.axis.teamAverage', { axis: key, score: String(score) }),
        i18nLine('eval.axis.contributors', {
          list: top.map((v) => `${v.hero.name} (${v.value})`).join(', '),
        }),
      ];

      const boosted = values.filter((v) => v.boosted);
      if (boosted.length > 0) {
        explanation.push(
          i18nLine('eval.axis.roleFit', {
            heroes: boosted.map((v) => `${v.hero.name}:${v.assignedRole ?? ''}`).join('|'),
            count: String(boosted.length),
          }),
        );
      }

      if (penalty > 0 && key === 'scaling') {
        const hardCarryCount = picks.filter((p) => isHardCarry(p.hero)).length;
        explanation.push(
          i18nLine('eval.axis.hardCarryScaling', {
            count: String(hardCarryCount),
            pct: String(Math.round((multiplier - 1) * 100)),
          }),
        );
      }

      explanation.push(axisNarrativeLine(key, ctx));

      const rawTop = top[0]?.hero.evaluation_values[key];
      const topContributorHeroId =
        top[0] && rawTop != null && !isBottomPoolShare(rawTop, poolValues) ? top[0].hero.id : null;

      return { score, percentile, explanation, topContributorHeroId };
    },
  };
}
