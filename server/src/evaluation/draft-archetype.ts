// Named draft archetype for Evaluation — display label only (no Battle math).
// First-match-wins rules using axis percentiles + hero tags / dedicated Carry.
import type { AnalyzerResult, DraftArchetype, Hero } from 'shared';

function pct(breakdown: AnalyzerResult[], key: string): number | null {
  const row = breakdown.find((b) => b.key === key);
  return row?.percentile ?? null;
}

function tagCount(heroes: Hero[], tag: string): number {
  return heroes.filter((h) => (h.tags ?? []).includes(tag)).length;
}

function dedicatedCarryCount(heroes: Hero[]): number {
  return heroes.filter((h) => {
    const top = h.presumed_positions?.[0];
    return top?.position === 'Carry' && top.share > 0.5;
  }).length;
}

/**
 * Classify a 5-hero draft. Thresholds are starting guesses (Blueprint §3);
 * tweak after sniffing real drafts — not calibration coefficients for Battle.
 */
export function classifyDraftArchetype(heroes: Hero[], breakdown: AnalyzerResult[]): DraftArchetype {
  const mobility = pct(breakdown, 'mobility');
  const objectives = pct(breakdown, 'objectives');
  const tempo = pct(breakdown, 'tempo');
  const scaling = pct(breakdown, 'scaling');
  const teamfight = pct(breakdown, 'teamfight');
  const durability = pct(breakdown, 'durability');
  const initiating = pct(breakdown, 'initiating');

  const splitTags = tagCount(heroes, 'split_push');
  const deathballTags = tagCount(heroes, 'deathball');
  const lateTags = tagCount(heroes, 'late_game_scaling');

  // 4+1 — exactly one dedicated Carry (same signal as One True King badge).
  if (dedicatedCarryCount(heroes) === 1) {
    return { id: 'four_plus_one' };
  }

  // Split-push — move + (objectives or split/illusion identity).
  if (mobility != null && mobility >= 70 && ((objectives != null && objectives >= 55) || splitTags >= 1)) {
    return { id: 'split_push' };
  }

  // Push / siege — objectives spike, tempo not lagging scaling.
  if (objectives != null && objectives >= 70 && tempo != null && scaling != null && tempo >= scaling - 5) {
    return { id: 'push' };
  }

  // Tempo — wants the game over early; not a siege (that's Push above) and
  // not a late scaler. Same 70 / 55 spike-vs-soft gates as scaling, mirrored.
  if (tempo != null && tempo >= 70 && (scaling == null || scaling < 55)) {
    return { id: 'tempo' };
  }

  // Deathball — group fight, not mobile.
  if (
    teamfight != null &&
    teamfight >= 70 &&
    (durability == null || durability >= 50 || (initiating != null && initiating >= 55)) &&
    (mobility == null || mobility < 70) &&
    (deathballTags >= 1 || lateTags < 3)
  ) {
    return { id: 'deathball' };
  }

  // Late scaling — high scaling, soft tempo.
  if (scaling != null && scaling >= 70 && (tempo == null || tempo < 55)) {
    return { id: 'scaling' };
  }

  return { id: 'balance' };
}
