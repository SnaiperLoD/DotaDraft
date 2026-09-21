import { shadowOverallPowerForPhase } from './battle-shadow';
import { makeHero, DEFAULT_EVALUATION_VALUES } from '../test-utils/hero-factory';
import type { BattlePick } from '../assessment-core/team-pick';
import type { HeroEvaluationValues } from 'shared';

function pick(
  id: number,
  name: string,
  role: string | null,
  axes: Partial<HeroEvaluationValues> = {},
  tags: string[] = [],
): BattlePick {
  return {
    hero: makeHero({
      id,
      name,
      tags,
      evaluation_values: { ...DEFAULT_EVALUATION_VALUES, ...axes },
    }),
    assignedRole: role,
  };
}

describe('shadowOverallPowerForPhase', () => {
  it('explicit: missing JSON keys (control/initiating/mobility) do not move power', () => {
    const highControl: BattlePick[] = [
      pick(1, 'A', 'Carry', { control: 10 }),
      pick(2, 'B', 'Mid', { control: 10 }),
      pick(3, 'C', 'Offlane', { control: 10 }),
      pick(4, 'D', 'Soft Support', { control: 10 }),
      pick(5, 'E', 'Hard Support', { control: 10 }),
    ];
    const lowControl: BattlePick[] = [
      pick(6, 'F', 'Carry', { control: 0 }),
      pick(7, 'G', 'Mid', { control: 0 }),
      pick(8, 'H', 'Offlane', { control: 0 }),
      pick(9, 'I', 'Soft Support', { control: 0 }),
      pick(10, 'J', 'Hard Support', { control: 0 }),
    ];
    const prodHigh = shadowOverallPowerForPhase(highControl, 'mid', undefined, 'off');
    const prodLow = shadowOverallPowerForPhase(lowControl, 'mid', undefined, 'off');
    const expHigh = shadowOverallPowerForPhase(highControl, 'mid', undefined, 'explicit');
    const expLow = shadowOverallPowerForPhase(lowControl, 'mid', undefined, 'explicit');
    expect(prodHigh).toBeGreaterThan(prodLow);
    expect(expHigh).toBeCloseTo(expLow, 5);
  });

  it('skirmish_role: Support skirmish does not change team power', () => {
    const base: BattlePick[] = [
      pick(1, 'C', 'Carry'),
      pick(2, 'M', 'Mid'),
      pick(3, 'O', 'Offlane'),
      pick(4, 'S4', 'Soft Support', { skirmish_rate: 1 }),
      pick(5, 'S5', 'Hard Support', { skirmish_rate: 1 }),
    ];
    const hot: BattlePick[] = [
      pick(1, 'C', 'Carry'),
      pick(2, 'M', 'Mid'),
      pick(3, 'O', 'Offlane'),
      pick(4, 'S4', 'Soft Support', { skirmish_rate: 10 }),
      pick(5, 'S5', 'Hard Support', { skirmish_rate: 10 }),
    ];
    const offDelta =
      shadowOverallPowerForPhase(hot, 'mid', undefined, 'off') -
      shadowOverallPowerForPhase(base, 'mid', undefined, 'off');
    const roleDelta =
      shadowOverallPowerForPhase(hot, 'mid', undefined, 'skirmish_role') -
      shadowOverallPowerForPhase(base, 'mid', undefined, 'skirmish_role');
    expect(offDelta).toBeGreaterThan(0.05);
    expect(Math.abs(roleDelta)).toBeLessThan(0.001);
  });

  it('body_integrity: summon_based durability is damped', () => {
    const tank: BattlePick[] = [
      pick(1, 'A', 'Carry', { durability: 10, objectives: 10 }),
      pick(2, 'B', 'Mid'),
      pick(3, 'C', 'Offlane'),
      pick(4, 'D', 'Soft Support'),
      pick(5, 'E', 'Hard Support'),
    ];
    const summon: BattlePick[] = [
      pick(1, 'A', 'Carry', { durability: 10, objectives: 10 }, ['summon_based']),
      pick(2, 'B', 'Mid'),
      pick(3, 'C', 'Offlane'),
      pick(4, 'D', 'Soft Support'),
      pick(5, 'E', 'Hard Support'),
    ];
    const offTank = shadowOverallPowerForPhase(tank, 'late', undefined, 'off');
    const offSummon = shadowOverallPowerForPhase(summon, 'late', undefined, 'off');
    const bodyTank = shadowOverallPowerForPhase(tank, 'late', undefined, 'body_integrity');
    const bodySummon = shadowOverallPowerForPhase(summon, 'late', undefined, 'body_integrity');
    expect(offTank).toBeCloseTo(offSummon, 5);
    expect(bodySummon).toBeLessThan(bodyTank);
  });

  it('combat_pc1: a combat-maxed team outranks a combat-floor team', () => {
    const high: BattlePick[] = Array.from({ length: 5 }, (_, i) =>
      pick(i + 1, `H${i}`, ['Carry', 'Mid', 'Offlane', 'Soft Support', 'Hard Support'][i], {
        burst: 10,
        scaling: 10,
        objectives: 10,
        teamfight: 10,
        durability: 10,
      }),
    );
    const low: BattlePick[] = Array.from({ length: 5 }, (_, i) =>
      pick(i + 11, `L${i}`, ['Carry', 'Mid', 'Offlane', 'Soft Support', 'Hard Support'][i], {
        burst: 0,
        scaling: 0,
        objectives: 0,
        teamfight: 0,
        durability: 0,
      }),
    );
    expect(shadowOverallPowerForPhase(high, 'late', undefined, 'combat_pc1')).toBeGreaterThan(
      shadowOverallPowerForPhase(low, 'late', undefined, 'combat_pc1'),
    );
  });

  it('r2_f: missing control keys do not move mid power', () => {
    const highControl: BattlePick[] = [
      pick(1, 'A', 'Carry', { control: 10 }),
      pick(2, 'B', 'Mid', { control: 10 }),
      pick(3, 'C', 'Offlane', { control: 10 }),
      pick(4, 'D', 'Soft Support', { control: 10 }),
      pick(5, 'E', 'Hard Support', { control: 10 }),
    ];
    const lowControl: BattlePick[] = [
      pick(6, 'F', 'Carry', { control: 0 }),
      pick(7, 'G', 'Mid', { control: 0 }),
      pick(8, 'H', 'Offlane', { control: 0 }),
      pick(9, 'I', 'Soft Support', { control: 0 }),
      pick(10, 'J', 'Hard Support', { control: 0 }),
    ];
    expect(shadowOverallPowerForPhase(highControl, 'mid', undefined, 'r2_f')).toBeCloseTo(
      shadowOverallPowerForPhase(lowControl, 'mid', undefined, 'r2_f'),
      5,
    );
  });

  it('r2_f: summon_based durability is damped inside PC1', () => {
    const tank: BattlePick[] = [
      pick(1, 'A', 'Carry', { durability: 10, objectives: 10 }),
      pick(2, 'B', 'Mid'),
      pick(3, 'C', 'Offlane'),
      pick(4, 'D', 'Soft Support'),
      pick(5, 'E', 'Hard Support'),
    ];
    const summon: BattlePick[] = [
      pick(1, 'A', 'Carry', { durability: 10, objectives: 10 }, ['summon_based']),
      pick(2, 'B', 'Mid'),
      pick(3, 'C', 'Offlane'),
      pick(4, 'D', 'Soft Support'),
      pick(5, 'E', 'Hard Support'),
    ];
    const pc1Tank = shadowOverallPowerForPhase(tank, 'late', undefined, 'combat_pc1');
    const pc1Summon = shadowOverallPowerForPhase(summon, 'late', undefined, 'combat_pc1');
    const r2Tank = shadowOverallPowerForPhase(tank, 'late', undefined, 'r2_f');
    const r2Summon = shadowOverallPowerForPhase(summon, 'late', undefined, 'r2_f');
    expect(pc1Tank).toBeCloseTo(pc1Summon, 5);
    expect(r2Summon).toBeLessThan(r2Tank);
  });

  it('farm_need_v2: low tempo beats high tempo at equal scaling', () => {
    const roles = ['Carry', 'Mid', 'Offlane', 'Soft Support', 'Hard Support'];
    const lowTempo: BattlePick[] = Array.from({ length: 5 }, (_, i) =>
      pick(i + 1, `L${i}`, roles[i], { scaling: 5, tempo: 0 }),
    );
    const highTempo: BattlePick[] = Array.from({ length: 5 }, (_, i) =>
      pick(i + 11, `H${i}`, roles[i], { scaling: 5, tempo: 10 }),
    );
    const v2Low = shadowOverallPowerForPhase(lowTempo, 'late', undefined, 'farm_need_v2');
    const v2High = shadowOverallPowerForPhase(highTempo, 'late', undefined, 'farm_need_v2');
    const prodLow = shadowOverallPowerForPhase(lowTempo, 'late', undefined, 'off');
    const prodHigh = shadowOverallPowerForPhase(highTempo, 'late', undefined, 'off');
    expect(v2Low).toBeGreaterThan(v2High);
    expect(prodHigh).toBeGreaterThan(prodLow);
  });

  it('r2_f_dis: control_strength moves power; r2_f ignores control', () => {
    const roles = ['Carry', 'Mid', 'Offlane', 'Soft Support', 'Hard Support'];
    // heroId 7 Earthshaker control_strength=18; heroId 1 Anti-Mage = 2
    const highDis: BattlePick[] = Array.from({ length: 5 }, (_, i) =>
      pick(7, `H${i}`, roles[i], { control: 3 }),
    );
    const lowDis: BattlePick[] = Array.from({ length: 5 }, (_, i) =>
      pick(1, `L${i}`, roles[i], { control: 10 }),
    );
    const r2High = shadowOverallPowerForPhase(highDis, 'mid', undefined, 'r2_f');
    const r2Low = shadowOverallPowerForPhase(lowDis, 'mid', undefined, 'r2_f');
    const disHigh = shadowOverallPowerForPhase(highDis, 'mid', undefined, 'r2_f_dis');
    const disLow = shadowOverallPowerForPhase(lowDis, 'mid', undefined, 'r2_f_dis');
    expect(r2High).toBeCloseTo(r2Low, 5);
    expect(disHigh).toBeGreaterThan(disLow);
  });

  it('r2_f_farm: low tempo beats high tempo at equal scaling; r2_f does the opposite', () => {
    const roles = ['Carry', 'Mid', 'Offlane', 'Soft Support', 'Hard Support'];
    const lowTempo: BattlePick[] = Array.from({ length: 5 }, (_, i) =>
      pick(i + 1, `L${i}`, roles[i], { scaling: 5, tempo: 0 }),
    );
    const highTempo: BattlePick[] = Array.from({ length: 5 }, (_, i) =>
      pick(i + 11, `H${i}`, roles[i], { scaling: 5, tempo: 10 }),
    );
    const farmLow = shadowOverallPowerForPhase(lowTempo, 'late', undefined, 'r2_f_farm');
    const farmHigh = shadowOverallPowerForPhase(highTempo, 'late', undefined, 'r2_f_farm');
    const r2Low = shadowOverallPowerForPhase(lowTempo, 'late', undefined, 'r2_f');
    const r2High = shadowOverallPowerForPhase(highTempo, 'late', undefined, 'r2_f');
    expect(farmLow).toBeGreaterThan(farmHigh);
    expect(r2High).toBeGreaterThan(r2Low);
  });
});
