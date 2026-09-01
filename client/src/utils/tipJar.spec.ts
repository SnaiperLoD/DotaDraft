import { describe, expect, it } from 'vitest';
import { tipJarUrl } from './tipJar';

describe('tipJarUrl', () => {
  it('returns a default Ko-fi URL when env is unset', () => {
    expect(tipJarUrl()).toMatch(/^https:\/\/ko-fi\.com\//);
  });
});
