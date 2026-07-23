import { resolveBattle, type MatchupLookup, type BattlePick } from './battle-resolution';
import type { Hero, HeroEvaluationValues } from 'shared';
import { makeHero, DEFAULT_EVALUATION_VALUES } from '../test-utils/hero-factory';

function hero(id: number, name: string, axisOverrides: Partial<HeroEvaluationValues> = {}): Hero {
  return makeHero({ id, name, evaluation_values: { ...DEFAULT_EVALUATION_VALUES, ...axisOverrides } });
}

const noData: MatchupLookup = {
  getMatchupWinRate: () => null,
  getSynergyWinRate: () => null,
};

// assignedRole: null throughout — these tests cover matchup/synergy/power
// mechanics, not role-fit specifically (see the dedicated describe block
// below for that).
function team(count: number, axisBoost: Partial<HeroEvaluationValues> = {}, startId = 1): BattlePick[] {
  return Array.from({ length: count }, (_, i) => ({
    hero: hero(startId + i, `Hero${startId + i}`, axisBoost),
    assignedRole: null,
  }));
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

  it("cites the underdog's real matchup/synergy edges in the upset explanation when data exists", () => {
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

  describe('role-fit', () => {
    // Role-fit alone (BOOST_WEIGHT=0.15) is deliberately subtle: averaged
    // over a 5-hero team and then over 10 axes, its maximum possible
    // contribution to overallPower is well under the 0.15 advantageDirection
    // threshold — it can't flip a matchup by itself, only tip an
    // already-close one (same "amplifies rather than adds" shape as the
    // matchup-edge test above). This scenario combines a small non-role
    // edge (hero1's teamfight) with a role-appropriate assignment (hero2 as
    // Carry) so together — not individually — they cross the threshold.
    it('tips an already-close matchup, combined with another small edge, toward the role-appropriate side', () => {
      // hero1's teamfight gives team A a real edge (contributes ~0.13 to
      // the overallPower diff) that alone stays just under the 0.15
      // advantageDirection threshold. hero2 is otherwise matched with its
      // opposite number (9.3 scaling/burst both sides) — no difference
      // until role-fit enters.
      const teamAUnassigned: BattlePick[] = [
        { hero: hero(1, 'A1', { teamfight: 9.5 }), assignedRole: null },
        { hero: hero(2, 'A2', { scaling: 9.3, burst: 9.3 }), assignedRole: null },
        ...team(3, {}, 3),
      ];
      const teamB: BattlePick[] = [
        { hero: hero(6, 'B1'), assignedRole: null },
        { hero: hero(7, 'B2', { scaling: 9.3, burst: 9.3 }), assignedRole: null },
        ...team(3, {}, 8),
      ];
      const closeButEven = resolveBattle(teamAUnassigned, teamB, noData, () => 0.4);
      expect(closeButEven.advantageDirection).toBe('Even');

      // Assigning hero2 Carry (scaling/burst are Carry's role-fit axes)
      // adds ~0.026 more — not enough on its own (see the test above), but
      // enough to push this already-close matchup over 0.15 combined.
      const teamAWithRole: BattlePick[] = [
        teamAUnassigned[0],
        { ...teamAUnassigned[1], assignedRole: 'Carry' },
        ...teamAUnassigned.slice(2),
      ];
      const tippedOver = resolveBattle(teamAWithRole, teamB, noData, () => 0.4);
      expect(tippedOver.advantageDirection).toBe('A');
    });

    it('does not boost when the hero is already below the role-fit baseline', () => {
      const belowBaseline: BattlePick[] = [
        { hero: hero(1, 'A', { scaling: 3 }), assignedRole: 'Carry' },
        ...team(4, {}, 2),
      ];
      const sameNoRole: BattlePick[] = [{ hero: hero(6, 'B', { scaling: 3 }), assignedRole: null }, ...team(4, {}, 7)];

      const result = resolveBattle(belowBaseline, sameNoRole, noData, () => 0.4);
      expect(result.advantageDirection).toBe('Even');
    });
  });
});
