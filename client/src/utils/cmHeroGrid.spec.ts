import { describe, expect, it } from 'vitest';
import { compareValveHeroOrder } from '../data/valveHeroOrder';
import { firstEnabledHero, moveHeroCursor, valvePickColumns } from './cmHeroGrid';

const COLS = [[1, 2, 3], [4, 5], [6]];

describe('valvePickColumns', () => {
  it('splits a Valve-ordered attribute into two row-major columns', () => {
    expect(valvePickColumns([2, 7, 14, 16])).toEqual([
      [2, 14],
      [7, 16],
    ]);
    expect(valvePickColumns([2, 7, 14])).toEqual([[2, 14], [7]]);
    expect(valvePickColumns([])).toEqual([[], []]);
  });
});

describe('compareValveHeroOrder', () => {
  it('puts Anti-Mage before Bloodseeker, not alphabetical', () => {
    expect(compareValveHeroOrder({ id: 1 }, { id: 4 })).toBeLessThan(0);
    expect(compareValveHeroOrder({ id: 2 }, { id: 102 })).toBeLessThan(0);
  });
});

describe('moveHeroCursor', () => {
  it('moves down the left Valve column, not to the right-hand pair', () => {
    const cols = valvePickColumns([2, 7, 14, 16]);
    const enabled = new Set([2, 7, 14, 16]);
    expect(moveHeroCursor(cols, enabled, 2, 'down')).toBe(14);
    expect(moveHeroCursor(cols, enabled, 2, 'right')).toBe(7);
  });

  it('skips disabled heroes going down a column and wraps', () => {
    const enabled = new Set([1, 3, 4, 5, 6]);
    expect(moveHeroCursor(COLS, enabled, 1, 'down')).toBe(3);
    expect(moveHeroCursor(COLS, enabled, 3, 'down')).toBe(1);
  });

  it('moves to the same visual row in the next column', () => {
    const enabled = new Set([1, 2, 3, 4, 5, 6]);
    expect(moveHeroCursor(COLS, enabled, 1, 'right')).toBe(4);
    expect(moveHeroCursor(COLS, enabled, 3, 'right')).toBe(5);
    expect(moveHeroCursor(COLS, enabled, 6, 'left')).toBe(4);
  });

  it('home/end stay in the current column', () => {
    const enabled = new Set([1, 2, 3, 4, 5, 6]);
    expect(moveHeroCursor(COLS, enabled, 3, 'home')).toBe(1);
    expect(moveHeroCursor(COLS, enabled, 1, 'end')).toBe(3);
  });

  it('falls back to the first enabled hero when the cursor is gone', () => {
    const enabled = new Set([4, 5]);
    expect(firstEnabledHero(COLS, enabled)).toBe(4);
    expect(moveHeroCursor(COLS, enabled, 99, 'down')).toBe(4);
  });
});
