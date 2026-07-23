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
    // 8 is 3 above baseline (5); boost = 0.15 * 3 = 0.45 -> 8.45 rounded to 8.5
    expect(roleFitValue('scaling', 'Carry', 8)).toBe(8.5);
  });

  it('caps the boosted value at 10', () => {
    expect(roleFitValue('scaling', 'Carry', 10)).toBe(10);
  });

  it('applies to both axes mapped for a role', () => {
    expect(roleFitValue('scaling', 'Carry', 9)).toBeGreaterThan(9);
    expect(roleFitValue('burst', 'Carry', 9)).toBeGreaterThan(9);
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
