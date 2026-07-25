// Custom game tags — a hand-authored layer sitting ON TOP of the calibrated
// evaluation_values/axis-weights model, not a replacement for it. Explicitly
// not trying to track real winRate (unlike every other axis in this
// project) — the point is drafting depth/combo-hunting, kept in bounds only
// by two loose guardrails (not enforced here yet): overall draft
// win-vector direction should still roughly match reality, and no hero's
// system-average winRate should drift outside 40-60%. See
// Blueprint/10-tech-debt-backlog.md for the fuller writeup.
//
// Tag/hero data itself lives in shared/customTags.ts — the single source
// also used by server/src/battle/custom-tags.ts for actual battle math, so
// the badge shown here always matches what the battle resolver computed.

import { CUSTOM_TAG_DEFINITIONS, buildCustomTagsByHeroName } from 'shared';
import type { CustomTagDefinition, TagRarity } from 'shared';

export type { TagRarity };
export type CustomTag = CustomTagDefinition;

export const CUSTOM_TAGS_BY_HERO_NAME: Record<string, CustomTag[]> = buildCustomTagsByHeroName();

// Kept for anything that wants the flat list rather than the per-hero view.
export { CUSTOM_TAG_DEFINITIONS };

// Tags actually worth rendering on a card right now: always-visible ones,
// plus revealable ones whose synergy is currently active. Always-hidden
// tags (visible=false, revealable=false, e.g. Elder Titan's Agility
// Crusher) never appear here by construction.
//
// contextHeroNames: the roster to count teammates against — pass the
// hero's own name included in it. Callers differ in what that roster is:
// DraftLedger passes the full picked team (the hero is already in it);
// HeroPool passes [...pickedTeam, thisPoolHero] — a *hypothetical* reveal,
// so picking the hero that completes a combo shows it revealed before you
// commit to the pick, nudging toward collecting it (the whole point of
// Custom Tags per the original brief).
export function visibleTagsFor(heroName: string, contextHeroNames: string[]): CustomTag[] {
  const tags = CUSTOM_TAGS_BY_HERO_NAME[heroName] ?? [];
  return tags.filter((t) => {
    if (t.visible) return true;
    if (!t.revealable) return false;
    const count = contextHeroNames.filter((n) =>
      (CUSTOM_TAGS_BY_HERO_NAME[n] ?? []).some((x) => x.name === t.name),
    ).length;
    return count >= (t.minCountToReveal ?? 1);
  });
}
