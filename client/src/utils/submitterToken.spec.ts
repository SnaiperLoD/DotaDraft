import { afterEach, describe, expect, it } from 'vitest';
import {
  CAPTAINS_SESSION_KEY,
  TI_RUN_SESSION_KEY,
  getSubmitterToken,
  setSubmitterToken,
} from './submitterToken';

describe('setSubmitterToken', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('keeps captains and TI persist when the claimed token is the same', () => {
    const token = getSubmitterToken();
    localStorage.setItem(CAPTAINS_SESSION_KEY, 'cm-1');
    localStorage.setItem(TI_RUN_SESSION_KEY, 'ti-1');
    expect(setSubmitterToken(token)).toBe(false);
    expect(localStorage.getItem(CAPTAINS_SESSION_KEY)).toBe('cm-1');
    expect(localStorage.getItem(TI_RUN_SESSION_KEY)).toBe('ti-1');
  });

  it('drops captains and TI persist when login switches identity', () => {
    getSubmitterToken();
    localStorage.setItem(CAPTAINS_SESSION_KEY, 'cm-1');
    localStorage.setItem(TI_RUN_SESSION_KEY, 'ti-1');
    expect(setSubmitterToken('11111111-1111-1111-1111-111111111111')).toBe(true);
    expect(localStorage.getItem(CAPTAINS_SESSION_KEY)).toBeNull();
    expect(localStorage.getItem(TI_RUN_SESSION_KEY)).toBeNull();
  });
});
