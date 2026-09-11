import { AUTH_COOKIE, clearSessionCookie, readCookie, sessionCookie } from './cookie';

describe('auth cookies', () => {
  it('reads a named cookie and ignores neighbors', () => {
    expect(readCookie(`${AUTH_COOKIE}=abc; other=1`, AUTH_COOKIE)).toBe('abc');
    expect(readCookie('other=1', AUTH_COOKIE)).toBeNull();
    expect(readCookie(undefined, AUTH_COOKIE)).toBeNull();
  });

  it('sets HttpOnly Lax cookies and omits Secure outside production', () => {
    const set = sessionCookie('sid-1', false);
    expect(set).toContain(`${AUTH_COOKIE}=sid-1`);
    expect(set).toContain('HttpOnly');
    expect(set).toContain('SameSite=Lax');
    expect(set).not.toContain('Secure');
    expect(sessionCookie('sid-1', true)).toContain('Secure');
    expect(clearSessionCookie(false)).toContain('Max-Age=0');
  });
});
