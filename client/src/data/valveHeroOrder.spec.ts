import { describe, expect, it } from 'vitest';
import { VALVE_HERO_ORDER, compareValveHeroOrder, valveHeroOrder } from './valveHeroOrder';

describe('valveHeroOrder', () => {
  it('keeps Anti-Mage and Axe at the front of Valve order', () => {
    expect(valveHeroOrder(1)).toBe(1);
    expect(valveHeroOrder(2)).toBe(2);
  });

  it('sorts unknown ids after the Valve table', () => {
    expect(valveHeroOrder(9999)).toBeGreaterThan(10_000);
    expect(compareValveHeroOrder({ id: 2 }, { id: 9999 })).toBeLessThan(0);
  });

  it('breaks ties by hero id', () => {
    expect(compareValveHeroOrder({ id: 10 }, { id: 20 })).not.toBe(0);
  });

  it('does not repeat HeroOrderID values', () => {
    const values = Object.values(VALVE_HERO_ORDER);
    expect(new Set(values).size).toBe(values.length);
  });
});
