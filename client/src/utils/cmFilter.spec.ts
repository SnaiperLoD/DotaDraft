import { describe, expect, it } from 'vitest';
import { heroMatchesFilter } from './cmFilter';

describe('heroMatchesFilter', () => {
  it('matches everyone when the query is empty or whitespace', () => {
    expect(heroMatchesFilter('Axe', '')).toBe(true);
    expect(heroMatchesFilter('Axe', '   ')).toBe(true);
  });

  it('is case-insensitive substring match, like the Valve picker', () => {
    expect(heroMatchesFilter('Anti-Mage', 'anti')).toBe(true);
    expect(heroMatchesFilter('Anti-Mage', 'MAGE')).toBe(true);
    expect(heroMatchesFilter('Axe', 'anti')).toBe(false);
  });
});
