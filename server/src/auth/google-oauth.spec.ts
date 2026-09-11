import { googleEnabled, googleRedirectUri, publicOrigin } from './google-oauth';

describe('google oauth helpers', () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
  });

  it('is disabled until both Google secrets are set', () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    expect(googleEnabled()).toBe(false);
    process.env.GOOGLE_CLIENT_ID = 'id';
    process.env.GOOGLE_CLIENT_SECRET = 'secret';
    expect(googleEnabled()).toBe(true);
  });

  it('prefers AUTH_PUBLIC_ORIGIN over forwarded headers', () => {
    process.env.AUTH_PUBLIC_ORIGIN = 'https://draft.example/';
    expect(
      publicOrigin({
        protocol: 'http',
        headers: { host: 'localhost:3001', 'x-forwarded-proto': 'https', 'x-forwarded-host': 'other' },
      }),
    ).toBe('https://draft.example');
    expect(googleRedirectUri('http://localhost:5173')).toBe('http://localhost:5173/api/auth/google/callback');
  });
});
