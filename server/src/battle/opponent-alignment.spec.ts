import { alignOpponentToRoles } from './opponent-alignment';
import type { Hero, HeroEvaluationValues, PresumedPosition } from 'shared';

function values(): HeroEvaluationValues {
  return {
    teamfight: 3,
    tempo: 3,
    scaling: 3,
    mobility: 3,
    objectives: 3,
    control: 3,
    durability: 3,
    burst: 3,
    vision: 3,
  };
}

function hero(id: number, name: string, position: PresumedPosition | null, roles: string[] = []): Hero {
  return {
    id,
    name,
    primary_attribute: 'strength',
    attack_type: 'Melee',
    roles,
    tags: [],
    synergy_tags: [],
    counter_tags: [],
    evaluation_values: values(),
    presumed_positions: position ? [{ position, share: 0.9 }] : [],
  };
}

describe('alignOpponentToRoles', () => {
  it('places each hero opposite the matching role slot (Carry, Mid, Offlane, Soft Support, Hard Support)', () => {
    const carry = hero(1, 'Carry Hero', 'Carry');
    const mid = hero(2, 'Mid Hero', 'Mid');
    const offlane = hero(3, 'Offlane Hero', 'Offlane');
    const supportA = hero(4, 'Support A', 'Support');
    const supportB = hero(5, 'Support B', 'Support');

    const aligned = alignOpponentToRoles([supportB, mid, carry, supportA, offlane]);

    // Carry/Mid/Offlane are unambiguous. The two Support-classified heroes
    // fill the two Support slots, but which specific one lands on Soft vs
    // Hard Support is unspecified — we have no data to tell them apart.
    expect(aligned.slice(0, 3).map((h) => h.id)).toEqual([1, 2, 3]);
    expect(aligned.slice(3).map((h) => h.id).sort()).toEqual([4, 5]);
  });

  it('fills a missing position category from leftovers instead of dropping a hero', () => {
    // Two carries, no offlane-classified hero.
    const carryA = hero(1, 'Carry A', 'Carry');
    const carryB = hero(2, 'Carry B', 'Carry');
    const mid = hero(3, 'Mid', 'Mid');
    const supportA = hero(4, 'Support A', 'Support');
    const supportB = hero(5, 'Support B', 'Support');

    const aligned = alignOpponentToRoles([carryA, carryB, mid, supportA, supportB]);

    // All 5 heroes still appear exactly once, nobody is lost.
    expect(aligned.map((h) => h.id).sort()).toEqual([1, 2, 3, 4, 5]);
    // Carry slot (index 0) gets a carry-classified hero.
    expect(aligned[0].id).toBe(1);
    // Offlane slot (index 2) has no offlane-classified hero, so it falls
    // back to whatever's left (the second carry) rather than being empty.
    expect(aligned[2].id).toBe(2);
  });

  it('uses the official-roles fallback when a hero has no presumed_positions data', () => {
    const noDataSupport = hero(1, 'Thin Data Support', null, ['Support']);
    const carry = hero(2, 'Carry', 'Carry');
    const mid = hero(3, 'Mid', 'Mid');
    const offlane = hero(4, 'Offlane', 'Offlane');
    const supportB = hero(5, 'Support B', 'Support');

    const aligned = alignOpponentToRoles([noDataSupport, carry, mid, offlane, supportB]);

    // Both Support slots (index 3, 4) should be filled by the two
    // support-classified heroes, including the thin-data fallback one.
    expect([aligned[3].id, aligned[4].id].sort()).toEqual([1, 5]);
  });
});
