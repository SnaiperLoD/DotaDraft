import type { Hero } from 'shared';

// Shutdown (Blueprint/10-tech-debt-backlog.md, "Shutdown-механика на этапе
// Battle", by direct user request 2026-08-06): a hero who is uniformly
// countered by EVERY hero on the opposing team — not just weak against one
// of them — is flagged SHUTDOWN. Deliberately strict (all 5 matchups must
// clear the bar at once, not "on average" or "3 of 5") so this stays a rare,
// dramatic state, not a routine soft-counter read.
//
// Local structural interface instead of importing battle-resolution.ts's
// MatchupLookup — that file imports FROM common/ already (role-fit,
// hard-carry, utility-stacking), so importing back would be circular.
// HeroMetaService already satisfies this shape.
interface ShutdownLookup {
  getMatchupWinRate(heroId: number, opponentHeroId: number): number | null;
  getWinRate(heroId: number): number | null;
}

export const SHUTDOWN_WINRATE_MARGIN = 0.015;
export const SHUTDOWN_POWER_PENALTY = 0.9; // -10%, applied as a personal power multiplier

// True when every one of the 5 opponents' real matchup winRate against this
// hero sits at least SHUTDOWN_WINRATE_MARGIN below the hero's own overall
// real winRate. Confidence: reuses HeroMetaService.getMatchupWinRate()
// as-is — it already shrinks thin-sample matchups toward the neutral 0.5
// prior (SHRINKAGE_K=20, hero-meta.service.ts), which replaced this
// project's old hard MIN_GAMES=10 cutoff a while back. A 2-3-game matchup
// can't spuriously trigger Shutdown on its own: shrinkage pulls it close to
// 0.5, nowhere near clearing the bar unless the hero's own winRate is
// already near 50%. A matchup with literally zero games returns null and
// disqualifies the hero for THIS opponent — missing data reads as "can't
// tell," not as "doesn't count against the all-5 requirement," so a hero
// with any unknown matchup in the lineup can never be flagged.
export function isShutdown(hero: Hero, opponents: Hero[], lookup: ShutdownLookup): boolean {
  if (opponents.length === 0) return false;
  const ownWinRate = lookup.getWinRate(hero.id);
  if (ownWinRate === null) return false;
  return opponents.every((opponent) => {
    const matchupWinRate = lookup.getMatchupWinRate(hero.id, opponent.id);
    if (matchupWinRate === null) return false;
    return matchupWinRate <= ownWinRate - SHUTDOWN_WINRATE_MARGIN;
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
