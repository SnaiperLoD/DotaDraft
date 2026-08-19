import { CM_BAN_PHASE1_MS, CM_STEP_MS, CM_STEPS } from 'shared';
import { makeHero } from '../test-utils/hero-factory';
import { chooseAiBan, chooseAiPick, heroPower } from './captains-ai';

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
});

describe('captains AI', () => {
  it('bans the highest-power remaining hero', () => {
    const weak = makeHero({
      id: 1,
      name: 'Weak',
      evaluation_values: { ...makeHero({ id: 9, name: 'x' }).evaluation_values, teamfight: 1 },
    });
    const strong = makeHero({
      id: 2,
      name: 'Strong',
      evaluation_values: { ...makeHero({ id: 8, name: 'y' }).evaluation_values, teamfight: 9 },
    });
    expect(heroPower(strong)).toBeGreaterThan(heroPower(weak));
    expect(chooseAiBan([weak, strong], new Set())).toBe(2);
    expect(chooseAiBan([weak, strong], new Set([2]))).toBe(1);
  });

  it('prefers an unfilled primary position when picking', () => {
    const carry = makeHero({
      id: 1,
      name: 'Carry',
      presumed_positions: [{ position: 'Carry', share: 0.9 }],
      evaluation_values: { ...makeHero({ id: 7, name: 'a' }).evaluation_values, teamfight: 9 },
    });
    const support = makeHero({
      id: 2,
      name: 'Support',
      presumed_positions: [{ position: 'Support', share: 0.9 }],
      evaluation_values: { ...makeHero({ id: 6, name: 'b' }).evaluation_values, teamfight: 8 },
    });
    expect(chooseAiPick([carry, support], new Set(), [carry])).toBe(2);
  });
});
