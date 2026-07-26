import { roleFitValue, isRoleFitAxis } from './role-fit';

describe('roleFitValue', () => {
  it('returns the raw value unchanged when no role is assigned', () => {
    expect(roleFitValue('scaling', null, 8)).toBe(8);
  });

  it('returns the raw value unchanged when the role has no relevant axes for this key', () => {
    expect(roleFitValue('saving', 'Carry', 8)).toBe(8);
  });

  it('returns the raw value unchanged when the hero is at or below the baseline (5)', () => {
    expect(roleFitValue('scaling', 'Carry', 5)).toBe(5);
    expect(roleFitValue('scaling', 'Carry', 3)).toBe(3);
  });

  it('boosts a relevant axis proportionally to how far above baseline it already is', () => {
    // 8 is 3 above baseline (5); boost = 0.3 * 3 = 0.9 -> 8.9
    expect(roleFitValue('scaling', 'Carry', 8)).toBe(8.9);
  });

  it('caps the boosted value at 10', () => {
    expect(roleFitValue('scaling', 'Carry', 10)).toBe(10);
  });

  it('applies to both axes mapped for a role', () => {
    expect(roleFitValue('scaling', 'Carry', 9)).toBeGreaterThan(9);
    expect(roleFitValue('burst', 'Carry', 9)).toBeGreaterThan(9);
  });

  it('boosts initiating for Offlane alongside durability/control', () => {
    expect(roleFitValue('initiating', 'Offlane', 8)).toBeGreaterThan(8);
    expect(roleFitValue('initiating', 'Carry', 8)).toBe(8);
  });

  it('applies distinct axes for Hard Support vs Soft Support', () => {
    expect(roleFitValue('map_control', 'Hard Support', 8)).toBeGreaterThan(8);
    expect(roleFitValue('map_control', 'Soft Support', 8)).toBe(8);
    expect(roleFitValue('control', 'Soft Support', 8)).toBeGreaterThan(8);
    expect(roleFitValue('control', 'Hard Support', 8)).toBe(8);
  });

  it('does not boost an unrecognized role string', () => {
    expect(roleFitValue('scaling', 'Jungle', 9)).toBe(9);
  });

  it('dampens a below-baseline durability/objectives value for Hard/Soft Support', () => {
    // 0.6 is 4.4 below baseline (5); dampen = 0.3 * 4.4 = 1.32 -> 1.9
    expect(roleFitValue('durability', 'Hard Support', 0.6)).toBe(1.9);
    expect(roleFitValue('objectives', 'Soft Support', 0.6)).toBe(1.9);
  });

  it('does not dampen durability/objectives for roles outside the map', () => {
    expect(roleFitValue('durability', 'Carry', 0.6)).toBe(0.6);
    expect(roleFitValue('objectives', 'Mid', 0.6)).toBe(0.6);
  });

  it('does not dampen an axis at or above baseline', () => {
    expect(roleFitValue('durability', 'Hard Support', 5)).toBe(5);
    expect(roleFitValue('durability', 'Hard Support', 7)).toBe(7);
  });

  it('does not dampen a hero already past the utility-stacking breadth gate', () => {
    // Same low value as the dampened case above, but utilityStackBreadth=3
    // (past UTILITY_BREADTH_GATE=2) — this is the Treant Protector/Chen/Io
    // signature (common/utility-stacking.ts), not the pure-caster-support
    // case this dampening targets, so it must stay unchanged.
    expect(roleFitValue('durability', 'Hard Support', 0.6, 3)).toBe(0.6);
  });

  it('still dampens at exactly the gate boundary (breadth=2)', () => {
    expect(roleFitValue('durability', 'Hard Support', 0.6, 2)).toBe(1.9);
  });
});

describe('isRoleFitAxis', () => {
  it('returns false with no role', () => {
    expect(isRoleFitAxis('scaling', null)).toBe(false);
  });

  it('returns true only for axes relevant to the given role', () => {
    expect(isRoleFitAxis('scaling', 'Carry')).toBe(true);
    expect(isRoleFitAxis('saving', 'Carry')).toBe(false);
  });
});
