import {
  isShutdown,
  shutdownHeroes,
  shutdownHeroMultipliers,
  SHUTDOWN_WINRATE_MARGIN,
  SHUTDOWN_POWER_PENALTY,
} from './shutdown';
import type { Hero } from 'shared';

function makeHero(id: number, name = `Hero ${id}`): Hero {
  return { id, name } as Hero;
}

function lookupFrom(winRates: Record<number, number>, matchups: Record<string, number | null>) {
  return {
    getWinRate: (heroId: number) => winRates[heroId] ?? null,
    getMatchupWinRate: (heroId: number, opponentId: number) => {
      const key = `${heroId}:${opponentId}`;
      return key in matchups ? matchups[key] : null;
    },
  };
}

describe('isShutdown', () => {
  it('uses margin 0 on cleaned shares (frequency-matched, 2026-10-03)', () => {
    expect(SHUTDOWN_WINRATE_MARGIN).toBe(0);
  });

  const hero = makeHero(1);
  const opponents = [makeHero(2), makeHero(3), makeHero(4), makeHero(5), makeHero(6)];

  it('flags a hero whose matchup winRate against all 5 opponents clears the margin', () => {
    const lookup = lookupFrom({ 1: 0.5 }, { '1:2': 0.48, '1:3': 0.47, '1:4': 0.4, '1:5': 0.3, '1:6': 0.45 });
    expect(isShutdown(hero, opponents, lookup)).toBe(true);
  });

  it('does not flag when even one opponent falls short of the margin', () => {
    const lookup = lookupFrom(
      { 1: 0.5 },
      { '1:2': 0.48, '1:3': 0.47, '1:4': 0.4, '1:5': 0.3, '1:6': 0.501 }, // 0.501 > 0.5 - margin
    );
    expect(isShutdown(hero, opponents, lookup)).toBe(false);
  });

  it('does not flag exactly at the margin boundary (requires strictly clearing it)', () => {
    const ownWinRate = 0.5;
    const lookup = lookupFrom(
      { 1: ownWinRate },
      {
        '1:2': ownWinRate - SHUTDOWN_WINRATE_MARGIN,
        '1:3': ownWinRate - SHUTDOWN_WINRATE_MARGIN,
        '1:4': ownWinRate - SHUTDOWN_WINRATE_MARGIN,
        '1:5': ownWinRate - SHUTDOWN_WINRATE_MARGIN,
        '1:6': ownWinRate - SHUTDOWN_WINRATE_MARGIN,
      },
    );
    // <= is used in isShutdown, so exactly-at-margin DOES qualify
    expect(isShutdown(hero, opponents, lookup)).toBe(true);
  });

  it('disqualifies the hero when any single opponent matchup is missing (null)', () => {
    const lookup = lookupFrom(
      { 1: 0.5 },
      { '1:2': 0.48, '1:3': 0.47, '1:4': 0.4, '1:5': 0.3 }, // 1:6 missing -> null
    );
    expect(isShutdown(hero, opponents, lookup)).toBe(false);
  });

  it('compares cleaned pair shares with 0.5, not with the hero own winRate', () => {
    // hero-meta pairs are cleaned STRATZ shares (2026-10-03): hero strength is
    // already removed, so a strong hero (56%) slightly above expected everywhere
    // is NOT shut down, while a weak hero (44%) slightly below expected in every
    // matchup IS.
    const strong = lookupFrom(
      { 1: 0.56 },
      { '1:2': 0.501, '1:3': 0.501, '1:4': 0.501, '1:5': 0.501, '1:6': 0.501 },
    );
    expect(isShutdown(hero, opponents, strong)).toBe(false);
    const weak = lookupFrom(
      { 1: 0.44 },
      { '1:2': 0.499, '1:3': 0.499, '1:4': 0.499, '1:5': 0.499, '1:6': 0.499 },
    );
    expect(isShutdown(hero, opponents, weak)).toBe(true);
  });

  it('does not need the hero own winRate on record', () => {
    const lookup = lookupFrom({}, { '1:2': 0.1, '1:3': 0.1, '1:4': 0.1, '1:5': 0.1, '1:6': 0.1 });
    expect(isShutdown(hero, opponents, lookup)).toBe(true);
  });

  it('returns false for an empty opponent list', () => {
    const lookup = lookupFrom({ 1: 0.5 }, {});
    expect(isShutdown(hero, [], lookup)).toBe(false);
  });
});

describe('shutdownHeroes', () => {
  it('filters a team down to only the shutdown heroes', () => {
    const shutHero = makeHero(1);
    const fineHero = makeHero(2);
    const opponents = [makeHero(10), makeHero(11), makeHero(12), makeHero(13), makeHero(14)];
    const lookup = lookupFrom(
      { 1: 0.5, 2: 0.5 },
      {
        '1:10': 0.4,
        '1:11': 0.4,
        '1:12': 0.4,
        '1:13': 0.4,
        '1:14': 0.4,
        '2:10': 0.55,
        '2:11': 0.55,
        '2:12': 0.55,
        '2:13': 0.55,
        '2:14': 0.55,
      },
    );
    expect(shutdownHeroes([shutHero, fineHero], opponents, lookup)).toEqual([shutHero]);
  });
});

describe('shutdownHeroMultipliers', () => {
  it('maps every shutdown hero id to the personal power penalty', () => {
    const map = shutdownHeroMultipliers([makeHero(7), makeHero(9)]);
    expect(map.get(7)).toBe(SHUTDOWN_POWER_PENALTY);
    expect(map.get(9)).toBe(SHUTDOWN_POWER_PENALTY);
    expect(map.size).toBe(2);
  });
});
