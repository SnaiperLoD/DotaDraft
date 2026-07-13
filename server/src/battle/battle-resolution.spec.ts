import { resolveBattle, type MatchupLookup } from './battle-resolution';
import type { Hero, HeroEvaluationValues } from 'shared';
import { makeHero, DEFAULT_EVALUATION_VALUES } from '../test-utils/hero-factory';

function hero(id: number, name: string, axisOverrides: Partial<HeroEvaluationValues> = {}): Hero {
  return makeHero({ id, name, evaluation_values: { ...DEFAULT_EVALUATION_VALUES, ...axisOverrides } });
}

const noData: MatchupLookup = {
  getMatchupWinRate: () => null,
  getSynergyWinRate: () => null,
};

function team(count: number, axisBoost: Partial<HeroEvaluationValues> = {}, startId = 1): Hero[] {
  return Array.from({ length: count }, (_, i) => hero(startId + i, `Hero${startId + i}`, axisBoost));
}

describe('resolveBattle', () => {
  it('is Even with no advantage when both teams are identical and no data exists', () => {
    const teamA = team(5);
    const teamB = team(5, {}, 6);
    const result = resolveBattle(teamA, teamB, noData, () => 0.4);
    expect(result.advantageDirection).toBe('Even');
    expect(result.confidenceTier).toBe('Low');
    expect(result.advantages).toEqual([]);
    expect(result.disadvantages).toEqual([]);
  });

  it('favors the objectively stronger team and resolves Win when the random draw favors them', () => {
    const strongTeam = team(5, { teamfight: 9, scaling: 9, burst: 9 });
    const weakTeam = team(5, {}, 6);
    // random() below the favorite's win-weight resolves in their favor.
    const result = resolveBattle(strongTeam, weakTeam, noData, () => 0.1);
    expect(result.advantageDirection).toBe('A');
    expect(result.confidenceTier).toBe('High');
    expect(result.resolvedOutcome).toBe('Win');
    expect(result.advantages.length).toBeGreaterThan(0);
  });

  it('produces an upset explanation (not "the model was wrong") when the underdog wins', () => {
    const strongTeam = team(5, { teamfight: 9, scaling: 9, burst: 9 });
    const weakTeam = team(5, {}, 6);
    // random() above the favorite's win-weight resolves against them (underdog win).
    const result = resolveBattle(strongTeam, weakTeam, noData, () => 0.99);
    expect(result.advantageDirection).toBe('A');
    expect(result.resolvedOutcome).toBe('Lose');
    const text = result.explanation.join(' ');
    expect(text.toLowerCase()).not.toContain('model was wrong');
    expect(text).toMatch(/upset|edge of its own|advantages of its own/i);
  });

  it('cites the underdog\'s real matchup/synergy edges in the upset explanation when data exists', () => {
    const strongTeam = team(5, { teamfight: 9, scaling: 9, burst: 9 });
    const weakTeam = team(5, {}, 6);
    const lookup: MatchupLookup = {
      getMatchupWinRate: (heroId, opponentHeroId) => (heroId === 6 && opponentHeroId === 1 ? 0.8 : null),
      getSynergyWinRate: (heroId, allyHeroId) =>
        (heroId === 6 && allyHeroId === 7) || (heroId === 7 && allyHeroId === 6) ? 0.75 : null,
    };
    const result = resolveBattle(strongTeam, weakTeam, lookup, () => 0.99);
    expect(result.resolvedOutcome).toBe('Lose');
    const text = result.explanation.join(' ');
    expect(text).toContain('Hero6');
    expect(text).toContain('Hero1');
  });

  it('never lets a High confidence favorite win with certainty — underdog draw is reachable', () => {
    const strongTeam = team(5, { teamfight: 9, scaling: 9, burst: 9 });
    const weakTeam = team(5, {}, 6);
    // Win-weight for High tier is 0.72, so a draw of 0.8 must resolve against the favorite.
    const result = resolveBattle(strongTeam, weakTeam, noData, () => 0.8);
    expect(result.resolvedOutcome).toBe('Lose');
  });

  it('amplifies rather than adds: a strong counter matchup increases the effective diff beyond the raw power diff', () => {
    const teamA = team(5, { teamfight: 5 });
    const teamB = team(5, { teamfight: 5 }, 6);
    const noEdge = resolveBattle(teamA, teamB, noData, () => 0.4);

    const favorableMatchups: MatchupLookup = {
      getMatchupWinRate: () => 0.9,
      getSynergyWinRate: () => null,
    };
    const withEdge = resolveBattle(teamA, teamB, favorableMatchups, () => 0.4);

    expect(noEdge.advantageDirection).toBe('Even');
    expect(withEdge.advantageDirection).toBe('A');
    expect(withEdge.confidenceTier).not.toBe('Low');
  });
});
