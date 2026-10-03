import type { Hero } from 'shared';

// Shutdown (Blueprint/10-tech-debt-backlog.md, "Shutdown-механика на этапе
// Battle", by direct user request 2026-08-06): a hero whose real matchup
// share is below "as expected" against EVERY hero on the opposing draft — not
// just weak against one of them — is flagged SHUTDOWN. Deliberately strict
// (all 5 matchups must clear the bar at once, not "on average" or "3 of 5")
// so this stays a rare, dramatic state, not a routine soft-counter read.
//
// Local structural interface instead of importing battle-resolution.ts's
// MatchupLookup — that file imports FROM common/ already (role-fit,
// hard-carry, utility-stacking), so importing back would be circular.
// HeroMetaService already satisfies this shape.
interface ShutdownLookup {
  getMatchupWinRate(heroId: number, opponentHeroId: number): number | null;
}

// 0 since 2026-10-03 (was 0.015 on raw pro rates vs the hero's own winRate).
// Frequency-matched on 20.6k seeded drafts: the old rule flagged 3.70% of hero
// slots, margin 0 flags 3.17%. An exact match would need a NEGATIVE margin
// (flagging pairs slightly above expected), so 0 is the floor
// (Blueprint/06-battle-engine.md, "Pair data").
export const SHUTDOWN_WINRATE_MARGIN = 0;
export const SHUTDOWN_POWER_PENALTY = 0.9; // -10%, applied as a personal power multiplier

// True when every one of the 5 opponents' matchup share against this hero
// sits at least SHUTDOWN_WINRATE_MARGIN below 0.5 (i.e. at or below 0.5). hero-meta pairs are CLEANED
// STRATZ shares (2026-10-03, Blueprint/06-battle-engine.md "Pair data"): the
// logit-additive expectation from both heroes' own win rates is removed, so
// 0.5 already means "this hero's usual level against an opponent of that
// strength". Comparing with the hero's own winRate (the pre-2026-10-03 rule,
// written for raw pro pair win rates) would count hero strength twice.
// Confidence: reuses HeroMetaService.getMatchupWinRate() as-is — it shrinks
// thin-sample matchups toward 0.5 (SHRINKAGE_K=20). A matchup with zero games
// returns null and disqualifies the hero for THIS opponent — missing data
// reads as "can't tell", so a hero with any unknown matchup in the lineup can
// never be flagged.
export function isShutdown(hero: Hero, opponents: Hero[], lookup: ShutdownLookup): boolean {
  if (opponents.length === 0) return false;
  return opponents.every((opponent) => {
    const matchupWinRate = lookup.getMatchupWinRate(hero.id, opponent.id);
    if (matchupWinRate === null) return false;
    return matchupWinRate <= 0.5 - SHUTDOWN_WINRATE_MARGIN;
  });
}

export function shutdownHeroes(team: Hero[], opponents: Hero[], lookup: ShutdownLookup): Hero[] {
  return team.filter((hero) => isShutdown(hero, opponents, lookup));
}

// Personal power multiplier map, same shape as manual-power-overrides.ts's
// manualPowerHeroMultipliers() and Custom Tags' heroPowerMultiplier — plugs
// directly into the existing mergeTagEffects()/axisAverage() pipeline in
// battle-resolution.ts without a new mechanism.
export function shutdownHeroMultipliers(shutdown: Hero[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const hero of shutdown) map.set(hero.id, SHUTDOWN_POWER_PENALTY);
  return map;
}
