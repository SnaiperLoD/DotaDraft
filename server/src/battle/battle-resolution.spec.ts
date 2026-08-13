import {
  resolveBattle,
  assessBattle,
  bestSynergyPair,
  bestMatchupEdge,
  AXIS_LABEL,
  AXES,
  type MatchupLookup,
  type BattlePick,
} from './battle-resolution';
import type { Hero, HeroEvaluationValues } from 'shared';
import { makeHero, DEFAULT_EVALUATION_VALUES } from '../test-utils/hero-factory';
import axisWeightsConfig from '../../data/axis-weights.json';

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
    // Exact wording for the 'Even' branch of buildExplanation — identical axis
    // values on both sides mean every axisDelta is exactly 0, so the sort is
    // stable and topAxisDelta is AXES[0] ('teamfight'), with delta>0 false.
    expect(result.explanation).toEqual([
      'This is a close matchup with no clear favorite (Low confidence) — a deficit in damage output for your draft was the closest thing to an edge.',
      'Your draft came out on top in what was essentially a coin flip.',
    ]);
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

  // Deliberately a *smaller* edge than dominantTeam — lands in Moderate
  // tier, where WIN_WEIGHT_BY_TIER still allows bare-variance upsets (High
  // is now fully deterministic absent an explained mechanic like High
  // Skill — see the "High confidence" describe block below). Used for the
  // generic upset-explanation tests, which want real randomness to be
  // possible without needing a tagged hero.
  //
  // control/initiating, not teamfight/scaling (2026-07-25, axis composite
  // fix, Blueprint/10-tech-debt-backlog.md "Поворотный момент") —
  // teamfight/scaling/durability/objectives/burst are now weighted at ~0.2
  // combined-cluster share instead of ~1 each, so maxing them out no longer
  // produces a meaningful power edge on their own.
  function moderateEdgeTeam(startId = 1): BattlePick[] {
    return team(5, { control: 7, initiating: 7 }, startId);
  }

  // A bigger edge than moderateEdgeTeam — still short of dominantTeam, but
  // large enough to stay favored (direction 'A') even after the underdog's
  // hand-crafted synergy bonus below (a real matchup/synergy pair pushes the
  // underdog's power up ~50% via the Non-Linearity Rule) — used only by the
  // matchup/synergy-citation test, which needs both real data AND a survived
  // A-favored, non-High tier to exercise the upset-citation branch.
  //
  // Same two utility axes as moderateEdgeTeam, maxed instead of 7 (not a
  // 3rd utility axis, as this used to add — common/utility-stacking.ts,
  // Blueprint/10-tech-debt-backlog.md "Поворотный момент", discounts any
  // hero with 3+ of control/initiating/mobility/saving/skirmish_rate/
  // map_control at/above 7). tempo tops up the edge instead — it's outside
  // that discounted set, so it adds margin without tripping the penalty.
  function strongerEdgeTeam(startId = 1): BattlePick[] {
    return team(5, { control: 10, initiating: 10, tempo: 9 }, startId);
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
    // Only the (favoredIsA=true, userWon=true) branch of the closingLine
    // ternary is reachable when !isUpset (the other favoredIsA=true branch
    // requires userWon=false, which is the isUpset path instead) — exact
    // text pins that reachable branch.
    expect(result.explanation[1]).toBe('That advantage held up.');
  });

  it('says the favorite\'s edge "held up" when the opponent (not the user) is correctly favored and wins', () => {
    // Mirror of the above for favoredIsA=false — the only reachable
    // (favoredIsA=false, userWon=false) branch of the same ternary.
    const weakTeam = team(5, {}, 1);
    const strongOpponent = dominantTeam(6);
    const result = resolveBattle(weakTeam, strongOpponent, noData, () => 0.5);
    expect(result.advantageDirection).toBe('B');
    expect(result.resolvedOutcome).toBe('Lose');
    expect(result.explanation[1]).toBe('That edge held up here.');
  });

  it('produces an upset explanation (not "the model was wrong") when the underdog wins', () => {
    const strongTeam = moderateEdgeTeam();
    const weakTeam = team(5, {}, 6);
    const preCheck = resolveBattle(strongTeam, weakTeam, noData, () => 0.1);
    expect(preCheck.confidenceTier).toBe('Moderate'); // sanity: still real variance at this tier
    // random() above the favorite's win-weight resolves against them (underdog win).
    const result = resolveBattle(strongTeam, weakTeam, noData, () => 0.99);
    expect(result.advantageDirection).toBe('A');
    expect(result.resolvedOutcome).toBe('Lose');
    const text = result.explanation.join(' ');
    expect(text.toLowerCase()).not.toContain('model was wrong');
    expect(text).toMatch(/upset|edge of its own|advantages of its own|odds still had to break/i);
  });

  it("cites the underdog's real matchup/synergy edges in the upset explanation when data exists", () => {
    const strongTeam = strongerEdgeTeam();
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

  it("cites the underdog's own strongest axis in the upset explanation when no real matchup/synergy data exists at all", () => {
    const strongTeam = moderateEdgeTeam();
    const weakTeam: BattlePick[] = [
      { hero: hero(6, 'Underdog', { saving: 9 }), assignedRole: null },
      ...team(4, {}, 7),
    ];
    const result = resolveBattle(strongTeam, weakTeam, noData, () => 0.99);
    expect(result.resolvedOutcome).toBe('Lose');
    const text = result.explanation.join(' ');
    expect(text).toContain('actually led in ally saving power despite trailing on the overall picture');
  });

  describe('High confidence (deterministic absent an explained mechanic)', () => {
    it('never lets bare variance beat a High confidence favorite', () => {
      const strongTeam = dominantTeam();
      const weakTeam = team(5, {}, 6);
      // Even a near-certain draw (0.999...) must still resolve for the favorite.
      const result = resolveBattle(strongTeam, weakTeam, noData, () => 0.999999);
      expect(result.confidenceTier).toBe('High');
      expect(result.resolvedOutcome).toBe('Win');
    });

    it('CAN still lose at High confidence when a High Skill hero shifts the roll, and names them', () => {
      const strongTeam = dominantTeam();
      const weakTeamWithHighSkill: BattlePick[] = [
        { hero: hero(6, 'Invoker'), assignedRole: null },
        ...team(4, {}, 7),
      ];
      // basePWinA=1 (High), shifted pWinA=0.95 (one High Skill hero) -> 0.97 lands in the swing zone.
      const result = resolveBattle(strongTeam, weakTeamWithHighSkill, noData, () => 0.97);
      expect(result.confidenceTier).toBe('High');
      expect(result.resolvedOutcome).toBe('Lose');
      const text = result.explanation.join(' ');
      expect(text).toContain('Invoker');
      expect(text.toLowerCase()).not.toContain('model was wrong');
    });

    it('Mechanical on the board suppresses the High Skill upset pull (machines do not tilt)', () => {
      // Same setup as the test above, but the favorite fields Clockwerk
      // (Mechanical). The High Skill pull that would drop pWinA to 0.95 and
      // let 0.97 upset the favorite is cancelled, so the same roll resolves
      // for the favorite.
      const dominantAxes = { teamfight: 10, scaling: 10, burst: 10, durability: 10, objectives: 10 };
      const strongTeamWithMechanical: BattlePick[] = [
        { hero: hero(1, 'Clockwerk', dominantAxes), assignedRole: null },
        ...team(4, dominantAxes, 2),
      ];
      const weakTeamWithHighSkill: BattlePick[] = [
        { hero: hero(6, 'Invoker'), assignedRole: null },
        ...team(4, {}, 7),
      ];
      const result = resolveBattle(strongTeamWithMechanical, weakTeamWithHighSkill, noData, () => 0.97);
      expect(result.confidenceTier).toBe('High');
      expect(result.resolvedOutcome).toBe('Win');
    });
  });

  describe('real-winRate pairs and matchups (teamA perspective)', () => {
    it('surfaces your best synergy pair and best/worst matchups into the opponent', () => {
      const teamA = team(5, {}, 1); // Hero1..Hero5
      const teamB = team(5, {}, 6); // Hero6..Hero10
      const lookup: MatchupLookup = {
        getSynergyWinRate: (a, b) => ((a === 1 && b === 2) || (a === 2 && b === 1) ? 0.62 : null),
        getMatchupWinRate: (h, o) => {
          if (h === 1 && o === 6) return 0.7; // your best lane
          if (h === 3 && o === 7) return 0.3; // your worst lane
          return null;
        },
        getWinRate: (h) => (h === 1 ? 0.49 : null), // Hero1's overall baseline
      };
      const result = resolveBattle(teamA, teamB, lookup, () => 0.4);
      expect(result.bestPairs[0]).toEqual({
        heroA: 'Hero1',
        heroAId: 1,
        heroB: 'Hero2',
        heroBId: 2,
        winRate: 0.62,
      });
      // Carries the hero ids (for icons) and the hero's overall win rate (for
      // the baseline -> matchup delta the client shows).
      expect(result.bestMatchups[0]).toEqual({
        hero: 'Hero1',
        heroId: 1,
        vs: 'Hero6',
        vsId: 6,
        winRate: 0.7,
        baseWinRate: 0.49,
      });
      expect(result.worstMatchups[0]).toEqual({
        hero: 'Hero3',
        heroId: 3,
        vs: 'Hero7',
        vsId: 7,
        winRate: 0.3,
        baseWinRate: null,
      });
    });

    it("ranks by delta from the hero's baseline, not absolute win rate", () => {
      // Reported bug: a 51% lane for a 52% hero was listed as a BEST matchup
      // because 51% clears 50%. Relative to that hero's own 52% norm it's a
      // worse-than-usual matchup, so it must rank as worst, not best.
      const teamA = team(5, {}, 1);
      const teamB = team(5, {}, 6);
      const lookup: MatchupLookup = {
        getSynergyWinRate: () => null,
        getMatchupWinRate: (h, o) => {
          if (h === 1 && o === 6) return 0.51; // > 50% but BELOW Hero1's 52% baseline
          if (h === 2 && o === 7) return 0.58; // above Hero2's 50% baseline
          return null;
        },
        getWinRate: (h) => (h === 1 ? 0.52 : h === 2 ? 0.5 : null),
      };
      const result = resolveBattle(teamA, teamB, lookup, () => 0.4);
      expect(result.bestMatchups.some((m) => m.heroId === 1)).toBe(false);
      expect(result.worstMatchups.some((m) => m.heroId === 1)).toBe(true);
      expect(result.bestMatchups[0].heroId).toBe(2);
    });

    it('returns empty rows when no real matchup data covers the heroes', () => {
      const result = resolveBattle(team(5, {}, 1), team(5, {}, 6), noData, () => 0.4);
      expect(result.bestPairs).toEqual([]);
      expect(result.bestMatchups).toEqual([]);
      expect(result.worstMatchups).toEqual([]);
    });
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
    // as Offlane, whose 3 role-fit axes — map_control/initiating/mobility,
    // round 3 of the role-fit derivation, common/role-fit.ts) so together —
    // not individually — they cross the threshold.
    it('tips an already-close matchup, combined with another small edge, toward the role-appropriate side', () => {
      // hero1's tempo=10 gives team A a real pre-role edge — under the
      // advantageDirection threshold on its own, with margin on both sides
      // of the current axis-weight snapshot (server/data/axis-weights.json),
      // not a hairline value. Uses tempo (2026-07-25, axis composite fix) —
      // not teamfight, which is now weighted too low on its own to provide
      // this kind of edge — and not one of hero2's Offlane role-fit axes
      // (map_control/initiating/mobility) below, so the two edges stay
      // independent. hero2 is otherwise matched with its opposite number
      // (8.5 map_control/initiating/mobility both sides) — no difference
      // until role-fit enters.
      // Filler IDs start at 9001/9011, not 3/8 — real hero IDs top out
      // around 160, and server/data/manual-power-overrides.json (keyed by
      // real hero.id, common/manual-power-overrides.ts) is recalibrated
      // often enough that a small filler ID risks silently colliding with
      // one and breaking this test's "otherwise matched" assumption (id=5
      // did exactly that once already).
      const teamAUnassigned: BattlePick[] = [
        { hero: hero(1, 'A1', { tempo: 10 }), assignedRole: null },
        { hero: hero(2, 'A2', { map_control: 8.5, initiating: 8.5, mobility: 8.5 }), assignedRole: null },
        ...team(3, {}, 9001),
      ];
      const teamB: BattlePick[] = [
        { hero: hero(6, 'B1'), assignedRole: null },
        { hero: hero(7, 'B2', { map_control: 8.5, initiating: 8.5, mobility: 8.5 }), assignedRole: null },
        ...team(3, {}, 9011),
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
        { hero: hero(1, 'A', { control: 3 }), assignedRole: 'Carry' },
        ...team(4, {}, 2),
      ];
      const sameNoRole: BattlePick[] = [{ hero: hero(6, 'B', { control: 3 }), assignedRole: null }, ...team(4, {}, 7)];

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

    it('has no penalty below 3 hard-carries (threshold shifted from 2)', () => {
      const opponent = teamWithHardCarries(0);
      const powers = [0, 1, 2].map((n) => assessBattle(teamWithHardCarries(n), opponent, noData).powerA);
      expect(powers[1]).toBeCloseTo(powers[0], 5);
      expect(powers[2]).toBeCloseTo(powers[0], 5);
    });

    // Aggregate powerA isn't a clean "strictly decreasing" signal any more
    // once scaling is exempt (and boosted) while every other axis is
    // penalized — the two pull in opposite directions, and DEFAULT_EVALUATION_VALUES
    // gives every axis equal standing, so the net direction depends on axis
    // weights, not just the hard-carry count. Test the actual mechanism
    // directly instead: pick an axis the penalty *does* apply to and
    // confirm it drops, and confirm scaling rises, once the threshold hits.
    it('penalizes a non-scaling axis but boosts scaling once 3+ hard-carries are drafted', () => {
      const opponent = teamWithHardCarries(0);
      const teamfightBelow = assessBattle(teamWithHardCarries(2), opponent, noData).axisDeltas.find(
        (d) => d.axis === 'teamfight',
      )!.delta;
      const teamfightAt = assessBattle(teamWithHardCarries(3), opponent, noData).axisDeltas.find(
        (d) => d.axis === 'teamfight',
      )!.delta;
      expect(teamfightAt).toBeLessThan(teamfightBelow);

      const scalingBelow = assessBattle(teamWithHardCarries(2), opponent, noData).axisDeltas.find(
        (d) => d.axis === 'scaling',
      )!.delta;
      const scalingAt = assessBattle(teamWithHardCarries(3), opponent, noData).axisDeltas.find(
        (d) => d.axis === 'scaling',
      )!.delta;
      expect(scalingAt).toBeGreaterThan(scalingBelow);
    });

    it('reports hardCarryCount in the assessment for calibration scripts', () => {
      const assessment = assessBattle(teamWithHardCarries(3), teamWithHardCarries(0), noData);
      expect(assessment.hardCarryCountA).toBe(3);
      expect(assessment.hardCarryCountB).toBe(0);
    });
  });

  describe('Custom Tags (custom-tags.ts) end-to-end', () => {
    function pick(h: Hero): BattlePick {
      return { hero: h, assignedRole: null };
    }

    it('a blessing (Statstealer) raises powerA once 2+ tagged heroes are on the team', () => {
      const withoutStatstealer: BattlePick[] = [
        pick(hero(1, 'Silencer')),
        pick(hero(2, 'Sniper')),
        ...team(3, {}, 3),
      ];
      const withStatstealer: BattlePick[] = [
        pick(hero(1, 'Silencer')),
        pick(hero(2, 'Slark')),
        ...team(3, {}, 3),
      ];
      const opponent: BattlePick[] = team(5, {}, 10);

      const baseline = assessBattle(withoutStatstealer, opponent, noData).powerA;
      const boosted = assessBattle(withStatstealer, opponent, noData).powerA;
      expect(boosted).toBeGreaterThan(baseline);
    });

    it('a curse (Agility Crusher) lowers the opposing agility carry\'s side, only when Elder Titan is drafted', () => {
      const agiCarry = makeHero({
        id: 20,
        name: 'Anti-Mage',
        primary_attribute: 'agi',
        evaluation_values: { ...DEFAULT_EVALUATION_VALUES, scaling: 8 },
        presumed_positions: [{ position: 'Carry', share: 0.8 }],
      });
      const enemyTeam: BattlePick[] = [pick(agiCarry), ...team(4, {}, 21)];

      const withoutElderTitan: BattlePick[] = team(5, {}, 1);
      const withElderTitan: BattlePick[] = [pick(hero(1, 'Elder Titan')), ...team(4, {}, 2)];

      const powerBBaseline = assessBattle(withoutElderTitan, enemyTeam, noData).powerB;
      const powerBCursed = assessBattle(withElderTitan, enemyTeam, noData).powerB;
      expect(powerBCursed).toBeLessThan(powerBBaseline);
    });
  });

  describe('High Skill upset mechanic (custom-tags.ts, resolveBattle-only)', () => {
    function pick(h: Hero): BattlePick {
      return { hero: h, assignedRole: null };
    }

    // dominantTeam() (above) vs a flat weak team resolves High confidence,
    // favorWeight=1 (WIN_WEIGHT_BY_TIER — fully deterministic at High as of
    // this revision). A roll of 0.97 is < 1 (A wins with no shift) but not
    // < 0.95 (A loses once a High Skill hero on B pulls pWinA toward 0.5 by
    // 0.05) — lands exactly in the swing zone.
    it('can flip the favorite\'s win into a loss when the underdog has a High Skill hero, and names them', () => {
      const strongTeam = dominantTeam();
      const weakTeamWithHighSkill: BattlePick[] = [pick(hero(6, 'Invoker')), ...team(4, {}, 7)];

      const result = resolveBattle(strongTeam, weakTeamWithHighSkill, noData, () => 0.97);
      expect(result.resolvedOutcome).toBe('Lose');
      expect(result.explanation.some((line) => line.includes('Invoker'))).toBe(true);
    });

    it('does not flip the outcome (or mention High Skill) without a tagged hero present, same roll', () => {
      const strongTeam = dominantTeam();
      const weakTeamPlain = team(5, {}, 6);

      const result = resolveBattle(strongTeam, weakTeamPlain, noData, () => 0.97);
      expect(result.resolvedOutcome).toBe('Win');
    });

    it('does not add a High Skill narrative line when the roll is nowhere near the swing zone', () => {
      const strongTeam = dominantTeam();
      const weakTeamWithHighSkill: BattlePick[] = [pick(hero(6, 'Invoker')), ...team(4, {}, 7)];

      // 0.1 is comfortably below both 1 and 0.95 -> Win either way, no swing.
      const result = resolveBattle(strongTeam, weakTeamWithHighSkill, noData, () => 0.1);
      expect(result.resolvedOutcome).toBe('Win');
      expect(result.explanation.some((line) => line.includes('Invoker'))).toBe(false);
    });

    // Mirror of the two tests above with the roles reversed: here the
    // UNDERDOG (team A, favoredIsA=false so advantageDirection='B') has the
    // High Skill hero, exercising pullTowardCoinflip's p<0.5 branch (basePWinA=0
    // pulled UP toward 0.5) and highSkillSwingHero's favoredIsA=false path —
    // neither reachable from the favorite-has-High-Skill tests above.
    it('flips the outcome when the underdog (not the favorite) has a High Skill hero, pulling their own low win chance up', () => {
      const strongOpponent = dominantTeam(6);
      const weakTeamWithHighSkill: BattlePick[] = [pick(hero(1, 'Invoker')), ...team(4, {}, 2)];

      // basePWinA=0 (B favored, High tier), shifted pWinA=min(0.5, 0+0.05)=0.05 -> 0.02 lands in the swing zone.
      const result = resolveBattle(weakTeamWithHighSkill, strongOpponent, noData, () => 0.02);
      expect(result.advantageDirection).toBe('B');
      expect(result.resolvedOutcome).toBe('Win');
      expect(result.explanation.some((line) => line.includes('Invoker'))).toBe(true);
    });
  });

  describe('bestSynergyPair (exported)', () => {
    it('returns null when no pair has real synergy data', () => {
      const t = [hero(1, 'A'), hero(2, 'B'), hero(3, 'C')];
      expect(bestSynergyPair(t, noData)).toBeNull();
    });

    it('returns the single highest-winRate pair among several, ignoring pairs with no data', () => {
      const t = [hero(1, 'A'), hero(2, 'B'), hero(3, 'C')];
      const lookup: MatchupLookup = {
        getMatchupWinRate: () => null,
        getSynergyWinRate: (a, b) => {
          const key = [a, b].sort((x, y) => x - y).join('-');
          if (key === '1-2') return 0.6;
          if (key === '1-3') return 0.8;
          return null; // 2-3 deliberately has no data
        },
        getWinRate: () => null,
      };
      expect(bestSynergyPair(t, lookup)).toEqual({ heroA: 'A', heroB: 'C', winRate: 0.8 });
    });
  });

  describe('bestMatchupEdge (exported)', () => {
    it('returns null when no team-vs-opponent pair has real matchup data', () => {
      expect(bestMatchupEdge([hero(1, 'A')], [hero(6, 'X')], noData)).toBeNull();
    });

    it('returns the single highest-winRate matchup among several team x opponent pairs', () => {
      const t = [hero(1, 'A'), hero(2, 'B')];
      const o = [hero(6, 'X'), hero(7, 'Y')];
      const lookup: MatchupLookup = {
        getMatchupWinRate: (h, opp) => {
          if (h === 1 && opp === 6) return 0.55;
          if (h === 1 && opp === 7) return 0.9;
          if (h === 2 && opp === 6) return 0.7;
          return null; // 2-vs-7 deliberately has no data
        },
        getSynergyWinRate: () => null,
        getWinRate: () => null,
      };
      expect(bestMatchupEdge(t, o, lookup)).toEqual({ hero: 'A', vs: 'Y', winRate: 0.9 });
    });
  });

  describe('winningHighlights (via resolveBattle, since topMatchupEdges/topSynergyPairs are private)', () => {
    it('combines a matchup and a synergy highlight for the winning side, ordered by winRate descending', () => {
      const strongTeam = dominantTeam(); // ids 1-5
      const weakTeam = team(5, {}, 6); // ids 6-10
      const lookup: MatchupLookup = {
        getMatchupWinRate: (h, opp) => (h === 1 && opp === 6 ? 0.7 : null),
        getSynergyWinRate: (a, b) => ((a === 2 && b === 3) || (a === 3 && b === 2) ? 0.9 : null),
        getWinRate: () => null,
      };
      const result = resolveBattle(strongTeam, weakTeam, lookup, () => 0.1); // A wins at High confidence
      expect(result.resolvedOutcome).toBe('Win');
      expect(result.winningHighlights).toEqual([
        'The Hero2 + Hero3 combination gave your draft a real, data-backed edge.',
        "Hero1's matchup into Hero6 worked in your draft's favor.",
      ]);
    });

    it('excludes a matchup exactly at the 0.5 threshold (only real edges count, not coinflips)', () => {
      const strongTeam = dominantTeam();
      const weakTeam = team(5, {}, 6);
      const lookup: MatchupLookup = {
        getMatchupWinRate: (h, opp) => (h === 1 && opp === 6 ? 0.5 : null),
        getSynergyWinRate: () => null,
        getWinRate: () => null,
      };
      const result = resolveBattle(strongTeam, weakTeam, lookup, () => 0.1);
      expect(result.winningHighlights).toEqual([]);
    });

    it('limits highlights to 3 even when more real edges exist', () => {
      const strongTeam = dominantTeam(); // ids 1-5
      const weakTeam = team(5, {}, 6); // ids 6-10
      const lookup: MatchupLookup = {
        getMatchupWinRate: (h, opp) => (h >= 1 && h <= 5 && opp >= 6 && opp <= 10 ? 0.6 : null),
        getSynergyWinRate: () => null,
        getWinRate: () => null,
      };
      const result = resolveBattle(strongTeam, weakTeam, lookup, () => 0.1);
      expect(result.winningHighlights).toHaveLength(3);
    });
  });

  // These target the Non-Linearity Rule's multiplicative power formula
  // (powerA/powerB in assessBattle) directly and precisely — the qualitative
  // advantageDirection/resolvedOutcome checks elsewhere in this file don't
  // distinguish "multiply by the clamped factor" from "divide by it" or
  // "add it," which is exactly what several mutants exploited. Both sides
  // start from an IDENTICAL base team (same axis values, only differing by
  // filler hero id) so taggedPowerA===taggedPowerB cancels out of the ratio,
  // leaving powerA/powerB equal to exactly the clamped multiplier under test.
  describe('Non-Linearity Rule: exact multiplicative formula', () => {
    it('synergy bonus multiplies only the side with the synergy pair, by exactly clamp(1 + bonus*2)', () => {
      const teamA = team(5, {}, 9001); // 9001-9005
      const teamB = team(5, {}, 9011); // 9011-9015
      const lookup: MatchupLookup = {
        getMatchupWinRate: () => null,
        getSynergyWinRate: (a, b) => ((a === 9001 && b === 9002) || (a === 9002 && b === 9001) ? 0.7 : null),
        getWinRate: () => null,
      };
      const { powerA, powerB } = assessBattle(teamA, teamB, lookup);
      expect(powerA / powerB).toBeCloseTo(1.4, 10); // clamp(1 + 0.2*2, 0.3, 1.7) = 1.4
    });

    it('matchup edge multiplies the two sides in OPPOSITE directions, by exactly clamp(1 +/- edge*3)', () => {
      const teamA = team(5, {}, 9001);
      const teamB = team(5, {}, 9011);
      const lookup: MatchupLookup = {
        getMatchupWinRate: (h, opp) => (h === 9001 && opp === 9011 ? 0.6 : null),
        getSynergyWinRate: () => null,
        getWinRate: () => null,
      };
      const { powerA, powerB } = assessBattle(teamA, teamB, lookup);
      // clamp(1 + 0.1*3, 0.3, 1.7) / clamp(1 - 0.1*3, 0.3, 1.7) = 1.3 / 0.7
      expect(powerA / powerB).toBeCloseTo(1.3 / 0.7, 10);
    });

    it('real winRate edge multiplies only the side with real data, by exactly clamp(1 + edge*realWinRateWeight)', () => {
      const teamA = team(5, {}, 9001);
      const teamB = team(5, {}, 9011);
      const lookup: MatchupLookup = {
        getMatchupWinRate: () => null,
        getSynergyWinRate: () => null,
        getWinRate: (heroId) => (heroId >= 9001 && heroId <= 9005 ? 0.6 : null),
      };
      const { powerA, powerB } = assessBattle(teamA, teamB, lookup);
      const expected = Math.min(1.3, Math.max(0.7, 1 + 0.1 * axisWeightsConfig.realWinRateWeight));
      expect(powerA / powerB).toBeCloseTo(expected, 10);
    });
  });

  describe('axisDeltas', () => {
    it('map_control never contributes, since its blended phase weight is 0 in every phase', () => {
      const teamA: BattlePick[] = [{ hero: hero(9001, 'A', { map_control: 10 }), assignedRole: null }, ...team(4, {}, 9002)];
      const teamB: BattlePick[] = [{ hero: hero(9011, 'B', { map_control: 0 }), assignedRole: null }, ...team(4, {}, 9012)];
      const { axisDeltas } = assessBattle(teamA, teamB, noData);
      expect(axisDeltas.find((d) => d.axis === 'map_control')!.delta).toBe(0);
    });

    it('is sorted by absolute delta magnitude, largest first', () => {
      const teamA: BattlePick[] = [{ hero: hero(9001, 'A', { tempo: 9, saving: 6 }), assignedRole: null }, ...team(4, {}, 9002)];
      const teamB = team(5, {}, 9011);
      const { axisDeltas } = assessBattle(teamA, teamB, noData);
      const magnitudes = axisDeltas.map((d) => Math.abs(d.delta));
      for (let i = 1; i < magnitudes.length; i++) {
        expect(magnitudes[i]).toBeLessThanOrEqual(magnitudes[i - 1]);
      }
    });
  });

  it('AXIS_LABEL has a distinct, non-empty display label for every axis used in AXES', () => {
    for (const axis of AXES) {
      expect(AXIS_LABEL[axis]).toEqual(expect.stringMatching(/\S/));
    }
    const labels = AXES.map((axis) => AXIS_LABEL[axis]);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
