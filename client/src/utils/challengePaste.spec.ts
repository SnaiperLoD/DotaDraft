import { describe, expect, it } from 'vitest';
import { sanitizeDraftCodeInput } from 'shared';

describe('sanitizeDraftCodeInput', () => {
  it('strips markup delimiters and maps Crockford confusables in letters', () => {
    expect(sanitizeDraftCodeInput('<script>alert(1)</script>')).toBe('scr1pta1ert1scr1pt');
    expect(sanitizeDraftCodeInput('dd1abc<script>')).toBe('dd1abcscr1pt');
  });

  it('maps I/L/O confusables and caps length', () => {
    expect(sanitizeDraftCodeInput('dd1ILO')).toBe('dd1110');
    expect(sanitizeDraftCodeInput(`${'a'.repeat(40)}`)).toHaveLength(24);
  });
});
