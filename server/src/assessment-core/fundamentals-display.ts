import type { HeroEvaluationValues } from 'shared';

type Axis = keyof HeroEvaluationValues;

/** Pure Fundamentals target picker — same tiers as blessingEffectsFor. */
export function fundamentalsTargetAxes(
  rawAxisAverages: Partial<Record<Axis, number>>,
  carrierCount: number,
): Axis[] {
  if (carrierCount < 2) return [];
  const ranked = (Object.entries(rawAxisAverages) as [Axis, number][]).sort((a, b) => a[1] - b[1]);
  const axisCount = carrierCount >= 4 ? 4 : carrierCount === 3 ? 2 : 1;
  return ranked.slice(0, axisCount).map(([axis]) => axis);
}

function joinAxisLabels(labels: string[]): string {
  if (labels.length === 0) return '';
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
}

/** Eval Active Combos copy — axis labels come from AXIS_LABEL, not raw keys. */
export function formatFundamentalsDescription(axisLabels: string[], carrierCount: number): string {
  if (carrierCount < 2) {
    return "Boosts the team's weakest axis once 2+ Fundamentals heroes are drafted.";
  }
  if (axisLabels.length === 0) {
    return "Boosts the team's weakest axis (or axes) — strength scales with how many Fundamentals heroes are drafted.";
  }
  if (axisLabels.length === 1) {
    return `Boosts this draft's weakest axis: ${axisLabels[0]}.`;
  }
  return `Boosts this draft's weakest axes: ${joinAxisLabels(axisLabels)}.`;
}
