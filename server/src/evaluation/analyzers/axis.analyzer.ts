import type { HeroEvaluationValues } from 'shared';
import type { Analyzer, DraftPick } from '../analyzer.interface';
import { AXIS_NARRATIVE, axisNarrativeBracket, type NarrativeContext } from '../score-narrative';
import { percentileFor } from '../axis-percentiles';
import { roleAwareAxisValue, supportMiscastMultiplier, coreMiscastMultiplier } from '../../common/role-fit';
import { hardCarryPenalty, hardCarryAxisMultipliers, isHardCarry } from '../../common/hard-carry';
import { utilityStackAxisMultipliers, utilityStackBreadth } from '../../common/utility-stacking';
import { calibrationMultipliersForTeam } from '../../common/calibration-tags';

type AxisKey = keyof HeroEvaluationValues;

export function createAxisAnalyzer(key: AxisKey, label: string): Analyzer {
  return {
    key,
    label,
    analyze(picks: DraftPick[]) {
      if (picks.length === 0) {
        return { score: null, percentile: null, explanation: ['No heroes to analyze.'] };
      }

      const calibrationByHero = calibrationMultipliersForTeam(picks.map((p) => p.hero));

      const values = picks.map((p) => {
        const raw = p.hero.evaluation_values[key];
        const roleFitAdjusted = roleAwareAxisValue(key, p.hero, p.assignedRole, utilityStackBreadth(p.hero));
        // Same utility-stacking discount as Battle Engine's overallPower
        // (common/utility-stacking.ts) — per-hero, not per-team like
        // hard-carry below, since it's a property of each hero's own kit
        // (control/initiating/mobility/saving/skirmish_rate/map_control
        // all high at once). Returns 1 for every axis outside that set, so
        // this is a no-op for the other 7 axes. The explanatory aside for
        // this used to be pushed onto every one of those 6 axes' own
        // explanation array — since a hero's discount is basically always
        // live on several of them at once, that meant the identical
        // sentence repeating verbatim across most of the breakdown grid.
        // Removed by user request (2026-08-06, Blueprint/10-tech-debt-backlog.md)
        // rather than relocated to a single note — low enough value to the
        // player to not be worth new note infrastructure just to say it
        // once. The discount itself still applies to `value` below.
        const utilityMult = utilityStackAxisMultipliers(p.hero)[key] ?? 1;
        // Miscast penalty (common/role-fit.ts) — flat -10% across every axis
        // when a hero who essentially never plays the assigned role family in
        // real games is slotted there: a non-support forced into Hard/Soft
        // Support, or (backlog item 1) a pure support forced into a core slot.
        // At most one fires — the two role families are disjoint — and both are
        // 1 (no-op) for a hero who genuinely plays the assigned role.
        const miscastMult =
          supportMiscastMultiplier(p.hero, p.assignedRole) * coreMiscastMultiplier(p.hero, p.assignedRole);
        // Always-hidden balance tags (Summoning Sickness / Tempo Monster /
        // Divided Attention / Mirage Tax / Paper Utility / Showstopper Tax /
        // False Immortal) — same magnitudes as Battle blessings, applied
        // here so Evaluation Total Score stays consistent with the model.
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
      // 5-value bracket (adds veryLow <10 / veryHigh >90) so extreme axes get a
      // more critical / more emphatic narrative — see score-narrative.ts.
      const bracket = axisNarrativeBracket(percentile ?? 50);

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

      // Scaling's boost aside is unique to this one card (scaling is the
      // only axis using this branch) so it's kept — the non-scaling
      // "penalty applied" aside used to run on every other axis whenever
      // penalty > 0 (hard-carry stacking hits ~11 of the 13 axes at once),
      // repeating the identical sentence across most of the breakdown grid
      // the same way the utility-stacking aside did. Removed by user
      // request (2026-08-06, Blueprint/10-tech-debt-backlog.md), same
      // treatment as that one — the penalty itself still applies to
      // `score` above regardless.
      if (penalty > 0 && key === 'scaling') {
        const hardCarryCount = picks.filter((p) => isHardCarry(p.hero)).length;
        explanation.push(
          `This draft stacks ${hardCarryCount} hard-carry (Carry/Mid-dominant) heroes — built for a long game, so a ${Math.round((multiplier - 1) * 100)}% boost is applied here instead of the usual stacking penalty.`,
        );
      }

      // Narrative always comes last — buildSummary() (evaluation.service.ts)
      // relies on the final explanation line being the human-readable
      // narrative sentence, not a numeric role-fit/hard-carry aside.
      explanation.push(AXIS_NARRATIVE[key][bracket](ctx));

      return { score, percentile, explanation, topContributorHeroId: top[0]?.hero.id ?? null };
    },
  };
}
