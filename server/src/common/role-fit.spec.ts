import { roleFitValue, isRoleFitAxis, supportMiscastMultiplier, roleAwareAxisValue } from './role-fit';
import { makeHero, DEFAULT_EVALUATION_VALUES } from '../test-utils/hero-factory';
import type { Hero, PresumedPosition } from 'shared';

describe('roleFitValue', () => {
  it('returns the raw value unchanged when no role is assigned', () => {
    expect(roleFitValue('control', null, 8)).toBe(8);
  });

  it('returns the raw value unchanged when the role has no relevant axes for this key', () => {
    expect(roleFitValue('saving', 'Carry', 8)).toBe(8);
  });

  it('returns the raw value unchanged when the hero is at or below the baseline (5)', () => {
    expect(roleFitValue('initiating', 'Carry', 5)).toBe(5);
    expect(roleFitValue('initiating', 'Carry', 3)).toBe(3);
  });

  it('boosts a relevant axis proportionally to how far above baseline it already is', () => {
    // 8 is 3 above baseline (5); boost = 0.3 * 3 = 0.9 -> 8.9
    expect(roleFitValue('initiating', 'Carry', 8)).toBe(8.9);
  });

  it('caps the boosted value at 10', () => {
    expect(roleFitValue('initiating', 'Carry', 10)).toBe(10);
  });

  it('boosts initiating for Carry but no longer control (control removed from Carry)', () => {
    expect(roleFitValue('initiating', 'Carry', 9)).toBeGreaterThan(9);
    expect(roleFitValue('control', 'Carry', 9)).toBe(9);
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
    // saving re-added to both supports 2026-08-13 (user); control stays out.
    expect(roleFitValue('saving', 'Hard Support', 8)).toBeGreaterThan(8);
    expect(roleFitValue('saving', 'Soft Support', 8)).toBeGreaterThan(8);
    expect(roleFitValue('control', 'Soft Support', 8)).toBe(8);
    // Cores must NOT get a saving role-fit bonus.
    expect(roleFitValue('saving', 'Carry', 8)).toBe(8);
    expect(roleFitValue('saving', 'Mid', 8)).toBe(8);
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

  // ROLE_AXES maps every axis per role, but the existing tests above only
  // ever exercised ONE axis for Mid and ONE of the 4 axes for Offlane/Support
  // — Mid was never tested with an explicit 'Mid' role at all (it happens to
  // share the exact axis set with Carry, so nothing forced a distinction).
  it('boosts both control and initiating for Mid (control kept for Mid even though it was removed from Carry)', () => {
    expect(roleFitValue('control', 'Mid', 8)).toBeGreaterThan(8);
    expect(roleFitValue('initiating', 'Mid', 8)).toBeGreaterThan(8);
  });

  it('boosts all 3 Offlane axes: map_control, initiating, mobility', () => {
    expect(roleFitValue('map_control', 'Offlane', 8)).toBeGreaterThan(8);
    expect(roleFitValue('initiating', 'Offlane', 8)).toBeGreaterThan(8);
    expect(roleFitValue('mobility', 'Offlane', 8)).toBeGreaterThan(8);
  });

  it('boosts all 4 Hard/Soft Support axes: tempo, camp_stacking, mobility, map_control', () => {
    for (const role of ['Hard Support', 'Soft Support']) {
      expect(roleFitValue('tempo', role, 8)).toBeGreaterThan(8);
      expect(roleFitValue('camp_stacking', role, 8)).toBeGreaterThan(8);
      expect(roleFitValue('mobility', role, 8)).toBeGreaterThan(8);
      expect(roleFitValue('map_control', role, 8)).toBeGreaterThan(8);
    }
  });

  // Same gap for IRRELEVANT_AXIS_DAMPEN: the earlier dampen test only ever
  // paired durability with Hard Support and objectives with Soft Support —
  // the cross combos (durability+Soft Support, objectives+Hard Support)
  // were never independently checked.
  it('dampens BOTH durability and objectives for BOTH Hard and Soft Support', () => {
    for (const role of ['Hard Support', 'Soft Support']) {
      expect(roleFitValue('durability', role, 0.6)).toBe(1.9);
      expect(roleFitValue('objectives', role, 0.6)).toBe(1.9);
    }
  });
});

describe('isRoleFitAxis', () => {
  it('returns false with no role', () => {
    expect(isRoleFitAxis('scaling', null)).toBe(false);
  });

  it('returns true only for axes relevant to the given role', () => {
    expect(isRoleFitAxis('initiating', 'Carry')).toBe(true);
    expect(isRoleFitAxis('control', 'Carry')).toBe(false); // removed from Carry
    expect(isRoleFitAxis('saving', 'Carry')).toBe(false);
  });

  it('returns false (not a throw) for a role string with no ROLE_AXES entry at all', () => {
    expect(isRoleFitAxis('control', 'Jungle')).toBe(false);
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

  it('does not penalize at exactly the miscast threshold (0.05) — the cutoff is strictly-below, not at-or-below', () => {
    const atThreshold = makeHero({
      id: 5,
      name: 'AtThreshold',
      presumed_positions: [{ position: 'Support', share: 0.05 }],
    });
    expect(supportMiscastMultiplier(atThreshold, 'Hard Support')).toBe(1);
  });
});

// roleAwareAxisValue is the module's actual exported entry point (used by
// Battle Engine and axis.analyzer.ts) — everything above tests roleFitValue
// directly, but makeHero's default evaluation_values_by_role is all
// no_info (see test-utils/hero-factory.ts), so no existing test anywhere in
// the suite ever exercised roleAwareAxisValue's real-per-role-data branch or
// its private mapAssignedRoleToPresumedPosition helper.
describe('roleAwareAxisValue', () => {
  // Aggregate control (2) is deliberately different from the per-role value
  // (9) so a test can tell which one the function actually returned.
  function heroWithRealRoleData(position: PresumedPosition): Hero {
    return makeHero({
      id: 1,
      name: 'X',
      evaluation_values: { ...DEFAULT_EVALUATION_VALUES, control: 2 },
      evaluation_values_by_role: {
        Carry: { no_info: true },
        Mid: { no_info: true },
        Offlane: { no_info: true },
        Support: { no_info: true },
        [position]: { ...DEFAULT_EVALUATION_VALUES, control: 9 },
      },
    });
  }

  it('prefers real per-role data over the aggregate/heuristic fallback when it exists, for Carry/Mid/Offlane', () => {
    expect(roleAwareAxisValue('control', heroWithRealRoleData('Carry'), 'Carry')).toBe(9);
    expect(roleAwareAxisValue('control', heroWithRealRoleData('Mid'), 'Mid')).toBe(9);
    expect(roleAwareAxisValue('control', heroWithRealRoleData('Offlane'), 'Offlane')).toBe(9);
  });

  it('maps BOTH Hard Support and Soft Support to the same real Support per-role data', () => {
    const hero = heroWithRealRoleData('Support');
    expect(roleAwareAxisValue('control', hero, 'Hard Support')).toBe(9);
    expect(roleAwareAxisValue('control', hero, 'Soft Support')).toBe(9);
  });

  it('falls back to the old aggregate + heuristic-boost mechanism when no real per-role data exists (no_info)', () => {
    // makeHero defaults every role to no_info. `initiating` (still a Carry
    // role-fit axis) exercises the boost; control no longer would.
    const hero = makeHero({ id: 2, name: 'Y', evaluation_values: { ...DEFAULT_EVALUATION_VALUES, initiating: 8 } });
    // roleFitValue's own boost formula: 8 is 3 above baseline(5) -> +0.9 -> 8.9.
    expect(roleAwareAxisValue('initiating', hero, 'Carry')).toBe(8.9);
  });

  it('falls back to the aggregate unchanged when assignedRole is null (no position to look up)', () => {
    const hero = makeHero({ id: 3, name: 'Z', evaluation_values: { ...DEFAULT_EVALUATION_VALUES, control: 8 } });
    expect(roleAwareAxisValue('control', hero, null)).toBe(8);
  });

  it('falls back to the aggregate unchanged for an unrecognized role string (maps to no position)', () => {
    const hero = makeHero({ id: 4, name: 'W', evaluation_values: { ...DEFAULT_EVALUATION_VALUES, control: 8 } });
    expect(roleAwareAxisValue('control', hero, 'Jungle')).toBe(8);
  });

  it('does not map null or an unrecognized role to Support, even when the hero HAS real Support-role data', () => {
    // Distinguishes "correctly resolves to no position" from "happens to
    // fall back to the aggregate anyway because this hero has no real data
    // for ANY role" (the two tests above can't tell those apart on their
    // own) — this hero has real Support data, so an incorrect Support
    // mapping would visibly return 9 instead of the aggregate's 2.
    const hero = heroWithRealRoleData('Support');
    expect(roleAwareAxisValue('control', hero, null)).toBe(2);
    expect(roleAwareAxisValue('control', hero, 'Jungle')).toBe(2);
  });
});
