import { describe, expect, it } from 'vitest';
import { firstEnabledHero, moveHeroCursor } from './cmHeroGrid';

const COLS = [[1, 2, 3], [4, 5], [6]];

describe('moveHeroCursor', () => {
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
