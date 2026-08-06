import { roleFitValue, isRoleFitAxis, supportMiscastMultiplier } from './role-fit';
import { makeHero } from '../test-utils/hero-factory';

describe('roleFitValue', () => {
  it('returns the raw value unchanged when no role is assigned', () => {
    expect(roleFitValue('control', null, 8)).toBe(8);
  });

  it('returns the raw value unchanged when the role has no relevant axes for this key', () => {
    expect(roleFitValue('saving', 'Carry', 8)).toBe(8);
  });

  it('returns the raw value unchanged when the hero is at or below the baseline (5)', () => {
    expect(roleFitValue('control', 'Carry', 5)).toBe(5);
    expect(roleFitValue('control', 'Carry', 3)).toBe(3);
  });

  it('boosts a relevant axis proportionally to how far above baseline it already is', () => {
    // 8 is 3 above baseline (5); boost = 0.3 * 3 = 0.9 -> 8.9
    expect(roleFitValue('control', 'Carry', 8)).toBe(8.9);
  });

  it('caps the boosted value at 10', () => {
    expect(roleFitValue('control', 'Carry', 10)).toBe(10);
  });

  it('applies to both axes mapped for a role', () => {
    expect(roleFitValue('control', 'Carry', 9)).toBeGreaterThan(9);
    expect(roleFitValue('initiating', 'Carry', 9)).toBeGreaterThan(9);
  });

  it('boosts initiating for Offlane alongside map_control/mobility, not for a role outside its map', () => {
    expect(roleFitValue('initiating', 'Offlane', 8)).toBeGreaterThan(8);
    // Support's round-3 map (control/initiating correlate with Carry/Mid/
    // Offlane specifically, not Support — see role-fit.ts's header comment)
    expect(roleFitValue('initiating', 'Hard Support', 8)).toBe(8);
  });

  it('applies the SAME axes to Hard Support and Soft Support (round 3 — the 4-way classifier never distinguished them)', () => {
    expect(roleFitValue('tempo', 'Hard Support', 8)).toBeGreaterThan(8);
    expect(roleFitValue('tempo', 'Soft Support', 8)).toBeGreaterThan(8);
    expect(roleFitValue('map_control', 'Hard Support', 8)).toBeGreaterThan(8);
    expect(roleFitValue('map_control', 'Soft Support', 8)).toBeGreaterThan(8);
    // saving/control were the old map's Support axes — no longer relevant per round 3's data.
    expect(roleFitValue('saving', 'Hard Support', 8)).toBe(8);
    expect(roleFitValue('control', 'Soft Support', 8)).toBe(8);
  });

  it('does not boost an unrecognized role string', () => {
    expect(roleFitValue('control', 'Jungle', 9)).toBe(9);
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
    expect(isRoleFitAxis('control', 'Carry')).toBe(true);
    expect(isRoleFitAxis('saving', 'Carry')).toBe(false);
  });
});

describe('supportMiscastMultiplier', () => {
  const neverSupports = makeHero({
    id: 1,
    name: 'Anti-Mage',
    presumed_positions: [{ position: 'Carry', share: 0.9 }],
  });
  const sometimesSupports = makeHero({
    id: 2,
    name: 'Ogre Magi',
    presumed_positions: [
      { position: 'Support', share: 0.4 },
      { position: 'Offlane', share: 0.6 },
    ],
  });

  it('penalizes a hero with under-threshold Support share when assigned Hard Support', () => {
    expect(supportMiscastMultiplier(neverSupports, 'Hard Support')).toBeCloseTo(0.9);
  });

  it('penalizes a hero with under-threshold Support share when assigned Soft Support', () => {
    expect(supportMiscastMultiplier(neverSupports, 'Soft Support')).toBeCloseTo(0.9);
  });

  it('does not penalize when Support share clears the threshold', () => {
    expect(supportMiscastMultiplier(sometimesSupports, 'Hard Support')).toBe(1);
  });

  it('does not penalize a hero with no Support entry at all when not assigned Support', () => {
    expect(supportMiscastMultiplier(neverSupports, 'Carry')).toBe(1);
    expect(supportMiscastMultiplier(neverSupports, null)).toBe(1);
  });

  it('treats a missing Support entry as 0% share (below threshold)', () => {
    const noSupportEntry = makeHero({ id: 3, name: 'Sniper', presumed_positions: [{ position: 'Mid', share: 1 }] });
    expect(supportMiscastMultiplier(noSupportEntry, 'Hard Support')).toBeCloseTo(0.9);
  });

  it('treats a Hero object missing presumed_positions entirely as 0% share', () => {
    const bare = makeHero({ id: 4, name: 'Sven' });
    delete (bare as { presumed_positions?: unknown }).presumed_positions;
    expect(supportMiscastMultiplier(bare, 'Soft Support')).toBeCloseTo(0.9);
  });
});
