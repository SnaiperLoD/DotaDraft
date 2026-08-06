// Turns a set of heroes' raw benchmark values (e.g. median hero_damage_per_min
// across all 127 heroes) into comparable 0-10 axis scores. Rank-based rather
// than min-max: a hero's score reflects what fraction of the hero population
// it outperforms, so one or two extreme outlier heroes (e.g. a hero with
// absurd tower_damage) don't compress everyone else's score toward the
// bottom of the scale the way min-max normalization would.
export function percentileRankScale(values: (number | null)[]): (number | null)[] {
  const present = values
    .map((value, index) => ({ value, index }))
    .filter((entry): entry is { value: number; index: number } => entry.value !== null)
    .sort((a, b) => a.value - b.value);

  const scoreByIndex = new Map<number, number>();
  present.forEach(({ index }, rank) => {
    const score = present.length > 1 ? (rank / (present.length - 1)) * 10 : 5;
    scoreByIndex.set(index, Math.round(score * 10) / 10);
  });

  return values.map((_, index) => scoreByIndex.get(index) ?? null);
}

// Same rank-based idea as percentileRankScale, but ranks each hero only
// against others sharing its group label instead of the whole population.
// Built for skirmish_rate's inverted last_hits_per_min component
// (Blueprint/10-tech-debt-backlog.md, "skirmish_rate систематически
// завышает Support") — a Support's near-zero CS is a structural feature of
// the role, not a skill signal, so ranking it against the whole population
// (dominated by Carry/Mid) reads "doesn't farm" as "extreme" for every
// Support regardless of how that Support actually plays. Ranking within
// position groups instead means a Support only scores high here by farming
// more than OTHER Supports typically do, not just by being a Support.
// null/no-group heroes fall back to a shared bucket (ranked only against
// each other, not against the whole population either) — rare in practice
// (heroes with no real position data at all).
export function percentileRankScaleByGroup(
  values: (number | null)[],
  groups: (string | null)[],
): (number | null)[] {
  const indicesByGroup = new Map<string, number[]>();
  values.forEach((_, index) => {
    const key = groups[index] ?? '__ungrouped__';
    (indicesByGroup.get(key) ?? indicesByGroup.set(key, []).get(key)!).push(index);
  });

  const result = new Array<number | null>(values.length).fill(null);
  for (const indices of indicesByGroup.values()) {
    const groupScores = percentileRankScale(indices.map((i) => values[i]));
    indices.forEach((i, j) => {
      result[i] = groupScores[j];
    });
  }
  return result;
}

// Two-step version of percentileRankScaleByGroup (Blueprint/12-next-session-
// priorities.md item 6, role-conditional axis values): plain within-group
// ranking always centers a group's mean at ~5 by construction, regardless of
// how that group's raw values actually sit relative to the whole population.
// For role-split axes this erases real, useful cross-role signal — e.g. a
// Support's damage/min genuinely sits near the bottom of the WHOLE roster
// (rank ~1/10 globally), but ranking Supports only against each other alone
// pushes even a middling Support toward ~5/10, which reads as "average
// damage" to any downstream consumer that doesn't know the score came from a
// role-restricted comparison. Confirmed by self-play regression: swapping to
// plain percentileRankScaleByGroup measurably WORSENED the model's
// favoredRate-vs-real-winRate correlation (0.085 -> 0.032, no-crutch test).
//
// Fix: rank within the group for relative order (who's the better/worse
// Support), then rescale that 0-10 rank onto the [min, max] GLOBAL
// (whole-population) score actually occupied by that group's own members —
// so a Support's ceiling stays capped near wherever the best real-data
// Support actually lands globally (rarely near 10, since even a
// damage-heavy Support rarely out-damages a core), not reset to a fresh 10.
export function anchoredGroupScale(values: (number | null)[], groups: (string | null)[]): (number | null)[] {
  const globalScores = percentileRankScale(values);
  const groupScores = percentileRankScaleByGroup(values, groups);

  const ranges = new Map<string, { min: number; max: number }>();
  values.forEach((_, index) => {
    const g = globalScores[index];
    if (g === null) return;
    const key = groups[index] ?? '__ungrouped__';
    const r = ranges.get(key) ?? { min: Infinity, max: -Infinity };
    r.min = Math.min(r.min, g);
    r.max = Math.max(r.max, g);
    ranges.set(key, r);
  });

  return values.map((_, index) => {
    const groupScore = groupScores[index];
    if (groupScore === null) return null;
    const key = groups[index] ?? '__ungrouped__';
    const range = ranges.get(key);
    if (!range) return groupScore;
    const span = range.max - range.min;
    if (span === 0) return range.min;
    return Math.round((range.min + (groupScore / 10) * span) * 10) / 10;
  });
}

export function medianBenchmarkValue(
  percentiles: { percentile: number; value: number }[] | null | undefined,
): number | null {
  if (!percentiles) return null;
  const p50 = percentiles.find((p) => p.percentile === 0.5);
  return p50 ? p50.value : null;
}

// Scores values around a 0-10 midpoint of 5, but — unlike percentileRankScale
// — amplifies the *distance* from average rather than just rank order. A
// hero barely below the mean stays close to 5; a hero far below it (e.g.
// Crystal Maiden's move_speed) gets pushed hard toward 0. `exponent` > 1
// controls how aggressively the tails get amplified relative to the middle
// of the pack — this is the "low weight, growing toward extreme cases"
// behavior requested for base move_speed in Map Control.
export function zScoreExtremityScale(values: (number | null)[], exponent: number): (number | null)[] {
  const present = values.filter((v): v is number => v !== null);
  if (present.length < 2) return values.map((v) => (v === null ? null : 5));

  const mean = present.reduce((sum, v) => sum + v, 0) / present.length;
  const variance = present.reduce((sum, v) => sum + (v - mean) ** 2, 0) / present.length;
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) return values.map((v) => (v === null ? null : 5));

  const adjusted = (v: number) => {
    const z = (v - mean) / stdDev;
    return Math.sign(z) * Math.abs(z) ** exponent;
  };
  const maxAdjusted = Math.max(...present.map((v) => Math.abs(adjusted(v))));
  if (maxAdjusted === 0) return values.map((v) => (v === null ? null : 5));

  return values.map((v) => {
    if (v === null) return null;
    const score = 5 + (adjusted(v) / maxAdjusted) * 5;
    return Math.round(Math.max(0, Math.min(10, score)) * 10) / 10;
  });
}

// Weighted average of 0-10 sub-scores, skipping any that are null (missing
// data) and renormalizing weight across whatever's present — same
// redistribute-missing-weight pattern EvaluationService.weightedTotal uses,
// so a hero missing one input (e.g. no ward data) doesn't get an
// artificially low composite just because one piece is absent.
export function weightedBlend(parts: { value: number | null; weight: number }[]): number | null {
  const present = parts.filter((p): p is { value: number; weight: number } => p.value !== null);
  const totalWeight = present.reduce((sum, p) => sum + p.weight, 0);
  if (totalWeight === 0) return null;
  const sum = present.reduce((s, p) => s + p.value * p.weight, 0);
  return Math.round((sum / totalWeight) * 10) / 10;
}
