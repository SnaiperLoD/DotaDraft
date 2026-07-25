import { makeHero } from '../test-utils/hero-factory';
import { isHardCarry, hardCarryPenalty, hardCarryAxisMultipliers } from './hard-carry';

function heroAtPosition(id: number, name: string, position: 'Carry' | 'Mid' | 'Offlane' | 'Support', share: number) {
  return makeHero({ id, name, presumed_positions: [{ position, share }] });
}

function teamWithHardCarries(count: number) {
  return Array.from({ length: 5 }, (_, i) =>
    i < count ? heroAtPosition(i + 1, `HC${i + 1}`, 'Carry', 0.8) : heroAtPosition(i + 1, `Sup${i + 1}`, 'Support', 0.8),
  );
}

describe('isHardCarry', () => {
  it('is true above the share threshold on Carry or Mid, false at/below it', () => {
    expect(isHardCarry(heroAtPosition(1, 'A', 'Carry', 0.51))).toBe(true);
    expect(isHardCarry(heroAtPosition(2, 'B', 'Mid', 0.6))).toBe(true);
    expect(isHardCarry(heroAtPosition(3, 'C', 'Carry', 0.5))).toBe(false);
    expect(isHardCarry(heroAtPosition(4, 'D', 'Support', 0.9))).toBe(false);
  });
});

describe('hardCarryPenalty', () => {
  it('is 0 for 0, 1, or 2 hard-carries (threshold shifted to 3+)', () => {
    expect(hardCarryPenalty(teamWithHardCarries(0))).toBe(0);
    expect(hardCarryPenalty(teamWithHardCarries(1))).toBe(0);
    expect(hardCarryPenalty(teamWithHardCarries(2))).toBe(0);
  });

  it('matches the configured schedule exactly for 3, 4, 5', () => {
    expect(hardCarryPenalty(teamWithHardCarries(3))).toBe(0.05);
    expect(hardCarryPenalty(teamWithHardCarries(4))).toBe(0.15);
    expect(hardCarryPenalty(teamWithHardCarries(5))).toBe(0.3);
  });
});

describe('hardCarryAxisMultipliers', () => {
  it('returns no multipliers at all below the 3-hard-carry threshold', () => {
    expect(hardCarryAxisMultipliers(teamWithHardCarries(2))).toEqual({});
  });

  it('exempts scaling from the penalty and gives it a flat +10% instead, once the threshold is hit', () => {
    const multipliers = hardCarryAxisMultipliers(teamWithHardCarries(3));
    expect(multipliers.scaling).toBe(1.1);
  });

  it('applies the same (1 - penalty) to every other axis', () => {
    const multipliers = hardCarryAxisMultipliers(teamWithHardCarries(4));
    expect(multipliers.teamfight).toBeCloseTo(1 - 0.15, 10);
    expect(multipliers.durability).toBeCloseTo(1 - 0.15, 10);
    expect(multipliers.camp_stacking).toBeCloseTo(1 - 0.15, 10);
    expect(multipliers.scaling).toBe(1.1);
  });

  it("scaling's +10% boost doesn't scale up with more hard-carries (flat, unlike the penalty)", () => {
    expect(hardCarryAxisMultipliers(teamWithHardCarries(3)).scaling).toBe(1.1);
    expect(hardCarryAxisMultipliers(teamWithHardCarries(5)).scaling).toBe(1.1);
  });
});
