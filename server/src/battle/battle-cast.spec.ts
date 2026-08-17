import { makeHero, DEFAULT_EVALUATION_VALUES } from '../test-utils/hero-factory';
import { idsOf, isBattleUpset, maxByAxes, pickByRole, roshanBand, teamAvg } from './battle-cast';
import type { BattlePick } from './battle-resolution';

function pick(
  id: number,
  name: string,
  role: string,
  axes: Partial<typeof DEFAULT_EVALUATION_VALUES>,
): BattlePick {
  return {
    hero: makeHero({
      id,
      name,
      evaluation_values: { ...DEFAULT_EVALUATION_VALUES, ...axes },
    }),
    assignedRole: role,
  };
}

describe('battle-cast helpers', () => {
  const carry = pick(1, 'Anti-Mage', 'Carry', { tempo: 4, scaling: 9, saving: 2, initiating: 1 });
  const mid = pick(2, 'Storm Spirit', 'Mid', { tempo: 8, scaling: 6, saving: 3, initiating: 7 });
  const support = pick(3, 'Dazzle', 'Hard Support', {
    tempo: 5.2,
    scaling: 5,
    saving: 8,
    initiating: 2,
  });

  it('pickByRole / idsOf / teamAvg / maxByAxes', () => {
    const team = [carry, mid, support];
    expect(pickByRole(team, 'Mid')?.hero.name).toBe('Storm Spirit');
    expect(idsOf(carry, mid, carry)).toEqual([1, 2]);
    expect(teamAvg([carry], 'scaling')).toBe(9);
    expect(maxByAxes(team, 'scaling')?.hero.name).toBe('Anti-Mage');
    expect(maxByAxes(team, 'tempo', 'scaling')?.hero.name).toBe('Storm Spirit');
  });

  it('roshanBand follows tempo vs scaling gap', () => {
    expect(roshanBand([mid]).band).toBe('15–20');
    expect(roshanBand([carry]).band).toBe('30+');
    expect(roshanBand([support]).band).toBe('20–30');
  });

  it('isBattleUpset only when the underdog wins', () => {
    expect(isBattleUpset('A', 'Lose')).toBe(true);
    expect(isBattleUpset('B', 'Win')).toBe(true);
    expect(isBattleUpset('A', 'Win')).toBe(false);
    expect(isBattleUpset('Even', 'Win')).toBe(false);
  });

  it('cameFromBehindLanes / laneTally', () => {
    const { cameFromBehindLanes, laneTally } = require('./battle-cast') as typeof import('./battle-cast');
    const lanes = [
      { lane: 'safe', winner: 'opponent' },
      { lane: 'mid', winner: 'opponent' },
      { lane: 'off', winner: 'mine' },
    ] as any;
    expect(cameFromBehindLanes(lanes, 'Win')).toBe(true);
    expect(laneTally(lanes, 'Win')).toEqual({ winnerWins: 1, loserWins: 2 });
  });
});
