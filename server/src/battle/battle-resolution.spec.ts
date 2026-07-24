import { resolveBattle, assessBattle, type MatchupLookup, type BattlePick } from './battle-resolution';
import type { Hero, HeroEvaluationValues } from 'shared';
import { makeHero, DEFAULT_EVALUATION_VALUES } from '../test-utils/hero-factory';

function hero(id: number, name: string, axisOverrides: Partial<HeroEvaluationValues> = {}): Hero {
  return makeHero({ id, name, evaluation_values: { ...DEFAULT_EVALUATION_VALUES, ...axisOverrides } });
}

const noData: MatchupLookup = {
  getMatchupWinRate: () => null,
  getSynergyWinRate: () => null,
  getWinRate: () => null,
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

  // Axis weights (server/data/axis-weights.json) get retuned frequently as
  // calibration scripts turn up findings — this file has already needed
  // recomputing 3 times this session. To stop that churn, "strong team"
  // tests below max out 5 axes (not just 3) rather than hand-tuning a
  // borderline value against the current weight snapshot — gives enough
  // margin to survive reasonable future retuning without going stale.
  function dominantTeam(startId = 1): BattlePick[] {
    return team(5, { teamfight: 10, scaling: 10, burst: 10, durability: 10, objectives: 10 }, startId);
  }

  it('favors the objectively stronger team and resolves Win when the random draw favors them', () => {
    const strongTeam = dominantTeam();
    const weakTeam = team(5, {}, 6);
    // random() below the favorite's win-weight resolves in their favor.
    const result = resolveBattle(strongTeam, weakTeam, noData, () => 0.1);
    expect(result.advantageDirection).toBe('A');
    expect(result.confidenceTier).toBe('High');
    expect(result.resolvedOutcome).toBe('Win');
    expect(result.advantages.length).toBeGreaterThan(0);
  });

  it('produces an upset explanation (not "the model was wrong") when the underdog wins', () => {
    const strongTeam = dominantTeam();
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
    const strongTeam = dominantTeam();
    const weakTeam = team(5, {}, 6);
    const lookup: MatchupLookup = {
      getMatchupWinRate: (heroId, opponentHeroId) => (heroId === 6 && opponentHeroId === 1 ? 0.8 : null),
      getSynergyWinRate: (heroId, allyHeroId) =>
        (heroId === 6 && allyHeroId === 7) || (heroId === 7 && allyHeroId === 6) ? 0.75 : null,
      getWinRate: () => null,
    };
    const result = resolveBattle(strongTeam, weakTeam, lookup, () => 0.99);
    expect(result.resolvedOutcome).toBe('Lose');
    const text = result.explanation.join(' ');
    expect(text).toContain('Hero6');
    expect(text).toContain('Hero1');
  });

  it('never lets a High confidence favorite win with certainty — underdog draw is reachable', () => {
    const strongTeam = dominantTeam();
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
      getWinRate: () => null,
    };
    const withEdge = resolveBattle(teamA, teamB, favorableMatchups, () => 0.4);

    expect(noEdge.advantageDirection).toBe('Even');
    expect(withEdge.advantageDirection).toBe('A');
    expect(withEdge.confidenceTier).not.toBe('Low');
  });

  describe('role-fit', () => {
    // Role-fit alone (BOOST_WEIGHT=0.3, common/role-fit.ts) is deliberately
    // subtle relative to a full matchup: averaged over a 5-hero team and
    // then over 11 axis weights (server/data/axis-weights.json), its
    // contribution can't flip a matchup by itself, only tip an
    // already-close one (same "amplifies rather than adds" shape as the
    // matchup-edge test above). This scenario combines a small non-role
    // edge (hero1's teamfight) with a role-appropriate assignment (hero2
    // as Offlane, whose 3 role-fit axes — durability/control/initiating)
    // so together — not individually — they cross the threshold.
    it('tips an already-close matchup, combined with another small edge, toward the role-appropriate side', () => {
      // hero1's teamfight=9 gives team A a real pre-role edge — under the
      // advantageDirection threshold on its own, with margin on both sides
      // of the current axis-weight snapshot (server/data/axis-weights.json),
      // not a hairline value. hero2 is otherwise matched with its opposite
      // number (8.5 durability/control/initiating both sides) — no
      // difference until role-fit enters.
      const teamAUnassigned: BattlePick[] = [
        { hero: hero(1, 'A1', { teamfight: 9 }), assignedRole: null },
        { hero: hero(2, 'A2', { durability: 8.5, control: 8.5, initiating: 8.5 }), assignedRole: null },
        ...team(3, {}, 3),
      ];
      const teamB: BattlePick[] = [
        { hero: hero(6, 'B1'), assignedRole: null },
        { hero: hero(7, 'B2', { durability: 8.5, control: 8.5, initiating: 8.5 }), assignedRole: null },
        ...team(3, {}, 8),
      ];
      const closeButEven = resolveBattle(teamAUnassigned, teamB, noData, () => 0.4);
      expect(closeButEven.advantageDirection).toBe('Even');

      // Assigning hero2 Offlane boosts all 3 of its role-fit axes (8.5 ->
      // 9.6 each) — not enough on its own, but enough to push this
      // already-close matchup over the threshold combined with hero1's edge.
      const teamAWithRole: BattlePick[] = [
        teamAUnassigned[0],
        { ...teamAUnassigned[1], assignedRole: 'Offlane' },
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

  describe('hard-carry stacking penalty', () => {
    function heroAtPosition(id: number, name: string, position: 'Carry' | 'Mid' | 'Offlane' | 'Support', share: number): Hero {
      return makeHero({
        id,
        name,
        evaluation_values: { ...DEFAULT_EVALUATION_VALUES },
        presumed_positions: [{ position, share }],
      });
    }

    function teamWithHardCarries(hardCarryCount: number): BattlePick[] {
      return Array.from({ length: 5 }, (_, i) => ({
        hero:
          i < hardCarryCount
            ? heroAtPosition(i + 1, `HC${i + 1}`, 'Carry', 0.8)
            : heroAtPosition(i + 1, `Sup${i + 1}`, 'Support', 0.8),
        assignedRole: null,
      }));
    }

    it('matches the configured penalty schedule exactly, with no penalty below 2', () => {
      const opponent = teamWithHardCarries(0);
      const powers = [0, 1, 2, 3, 4, 5].map(
        (n) => assessBattle(teamWithHardCarries(n), opponent, noData).powerA,
      );

      // 0 and 1 hard-carries: identical power, penalty hasn't engaged yet.
      expect(powers[1]).toBeCloseTo(powers[0], 5);
      // 2 through 5: strictly decreasing as more hard-carries stack.
      for (let i = 2; i <= 5; i++) {
        expect(powers[i]).toBeLessThan(powers[i - 1]);
      }
      // Matches server/data/axis-weights.json's hardCarryStackPenalty exactly.
      const penalties: Record<number, number> = { 2: 0.05, 3: 0.15, 4: 0.3, 5: 0.45 };
      for (const [n, penalty] of Object.entries(penalties)) {
        expect(powers[Number(n)]).toBeCloseTo(powers[1] * (1 - penalty), 5);
      }
    });

    it('reports hardCarryCount in the assessment for calibration scripts', () => {
      const assessment = assessBattle(teamWithHardCarries(3), teamWithHardCarries(0), noData);
      expect(assessment.hardCarryCountA).toBe(3);
      expect(assessment.hardCarryCountB).toBe(0);
    });
  });
});
