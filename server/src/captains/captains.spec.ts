import { CM_BAN_PHASE1_MS, CM_STEP_MS, CM_STEPS } from 'shared';
import { makeHero } from '../test-utils/hero-factory';
import { chooseAiBan, chooseAiPick, heroPower, remainingRoleSlots, tagCounterHits } from './captains-ai';
import { cmStepsForPlayer, currentCmStep, emptyCmSlots } from './captains-sequence';

describe('Captains Mode sequence (7.40)', () => {
  it('has 24 steps, 7 bans and 5 picks per lane', () => {
    expect(CM_STEPS).toHaveLength(24);
    expect(CM_STEPS.filter((s) => s.lane === 'first' && s.type === 'ban')).toHaveLength(7);
    expect(CM_STEPS.filter((s) => s.lane === 'second' && s.type === 'ban')).toHaveLength(7);
    expect(CM_STEPS.filter((s) => s.lane === 'first' && s.type === 'pick')).toHaveLength(5);
    expect(CM_STEPS.filter((s) => s.lane === 'second' && s.type === 'pick')).toHaveLength(5);
  });

  it('uses 15s on the first ban phase and 30s afterwards', () => {
    expect(CM_STEPS.slice(0, 7).every((s) => s.type === 'ban' && s.timeMs === CM_BAN_PHASE1_MS)).toBe(true);
    expect(CM_STEPS.slice(7).every((s) => s.timeMs === CM_STEP_MS)).toBe(true);
  });

  it('gives first pick 3-2-2 bans and second pick 4-1-2', () => {
    const first = cmStepsForPlayer(true);
    const second = cmStepsForPlayer(false);
    expect(first.slice(0, 7).filter((s) => s.lane === 'first')).toHaveLength(3);
    expect(first.slice(0, 7).filter((s) => s.lane === 'second')).toHaveLength(4);
    expect(second.slice(0, 7).filter((s) => s.lane === 'first')).toHaveLength(4);
    expect(second.slice(0, 7).filter((s) => s.lane === 'second')).toHaveLength(3);
  });

  it('inverts stored lanes so `first` still means the player after a lost coin flip', () => {
    const slots = emptyCmSlots(false);
    expect(slots[0]).toEqual({ type: 'ban', lane: 'second', heroId: null });
    expect(currentCmStep(slots, 0)?.lane).toBe('second');
    expect(currentCmStep(slots, 2)?.lane).toBe('first');
    expect(currentCmStep(slots, CM_STEPS.length)).toBeNull();
  });
});

describe('captains AI', () => {
  const evals = (teamfight: number) => ({
    ...makeHero({ id: 99, name: 'x' }).evaluation_values,
    teamfight,
  });

  it('bans the highest-power remaining hero when the opponent has not picked', () => {
    const weak = makeHero({ id: 1, name: 'Weak', evaluation_values: evals(1) });
    const strong = makeHero({ id: 2, name: 'Strong', evaluation_values: evals(9) });
    expect(heroPower(strong)).toBeGreaterThan(heroPower(weak));
    expect(chooseAiBan([weak, strong], new Set())).toBe(2);
    expect(chooseAiBan([weak, strong], new Set([2]))).toBe(1);
  });

  it('fills an unfilled primary position when the opponent has no counter signal', () => {
    const carry = makeHero({
      id: 1,
      name: 'Carry',
      presumed_positions: [{ position: 'Carry', share: 0.9 }],
      evaluation_values: evals(9),
    });
    const support = makeHero({
      id: 2,
      name: 'Support',
      presumed_positions: [{ position: 'Support', share: 0.9 }],
      evaluation_values: evals(8),
    });
    expect(chooseAiPick([carry, support], new Set(), { ownPicks: [carry], opponentPicks: [] })).toBe(2);
  });

  it('starves the opponent remaining roles after they lock carry and mid', () => {
    const leftoverCarry = makeHero({
      id: 1,
      name: 'AnotherCarry',
      presumed_positions: [{ position: 'Carry', share: 0.9 }],
      evaluation_values: evals(9),
    });
    const offlane = makeHero({
      id: 2,
      name: 'Offlane',
      presumed_positions: [{ position: 'Offlane', share: 0.9 }],
      evaluation_values: evals(4),
    });
    const theirCarry = makeHero({
      id: 10,
      name: 'TheirCarry',
      presumed_positions: [{ position: 'Carry', share: 0.9 }],
    });
    const theirMid = makeHero({
      id: 11,
      name: 'TheirMid',
      presumed_positions: [{ position: 'Mid', share: 0.9 }],
    });
    expect(remainingRoleSlots([theirCarry, theirMid])).toEqual(['Offlane', 'Support', 'Support']);
    expect(
      chooseAiBan([leftoverCarry, offlane], new Set(), {
        ownPicks: [],
        opponentPicks: [theirCarry, theirMid],
      }),
    ).toBe(2);
  });

  it('picks a matchup counter even when that hero is off our remaining roles', () => {
    const antiMage = makeHero({
      id: 1,
      name: 'Anti-Mage',
      presumed_positions: [{ position: 'Carry', share: 0.9 }],
      counter_tags: ['counters_illusions', 'counters_mana_reliant'],
      evaluation_values: evals(5),
    });
    const offlane = makeHero({
      id: 2,
      name: 'Offlane',
      presumed_positions: [{ position: 'Offlane', share: 0.9 }],
      evaluation_values: evals(8),
    });
    const ourCarry = makeHero({
      id: 3,
      name: 'OurCarry',
      presumed_positions: [{ position: 'Carry', share: 0.9 }],
    });
    const medusa = makeHero({
      id: 94,
      name: 'Medusa',
      presumed_positions: [{ position: 'Carry', share: 0.9 }],
      tags: ['late_game_scaling'],
    });
    const lookup = {
      getMatchupWinRate: (heroId: number, opponentHeroId: number) =>
        heroId === 1 && opponentHeroId === 94 ? 0.62 : null,
    };
    expect(
      chooseAiPick([antiMage, offlane], new Set(), {
        ownPicks: [ourCarry],
        opponentPicks: [medusa],
        lookup,
      }),
    ).toBe(1);
  });

  it('counts illusion_based tags as a counter hit', () => {
    const razor = makeHero({
      id: 1,
      name: 'Razor',
      counter_tags: ['counters_illusions'],
    });
    const naga = makeHero({
      id: 2,
      name: 'Naga Siren',
      tags: ['illusion_based'],
    });
    expect(tagCounterHits(razor, [naga])).toBe(1);
  });
});
