import { randomUUID } from 'crypto';

export function googleEnabled(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim());
}

export function publicOrigin(req: {
  protocol?: string;
  headers: Record<string, string | string[] | undefined>;
}): string {
  const fromEnv = process.env.AUTH_PUBLIC_ORIGIN?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  const protoRaw = req.headers['x-forwarded-proto'];
  const hostRaw = req.headers['x-forwarded-host'] ?? req.headers.host;
  const proto =
    (Array.isArray(protoRaw) ? protoRaw[0] : protoRaw)?.split(',')[0]?.trim() || req.protocol || 'http';
  const host = (Array.isArray(hostRaw) ? hostRaw[0] : hostRaw)?.split(',')[0]?.trim();
  if (!host) return 'http://localhost:5173';
  return `${proto}://${host}`;
}

export function googleRedirectUri(origin: string): string {
  return `${origin}/api/auth/google/callback`;
}

export function googleAuthorizeUrl(state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!.trim(),
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeGoogleCode(
  code: string,
  redirectUri: string,
): Promise<{ googleId: string; email: string }> {
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!.trim(),
      client_secret: process.env.GOOGLE_CLIENT_SECRET!.trim(),
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenRes.ok) {
    throw new Error('Google token exchange failed');
  }
  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  if (!tokenJson.access_token) throw new Error('Google token missing');
  const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });
  if (!infoRes.ok) throw new Error('Google userinfo failed');
  const info = (await infoRes.json()) as { sub?: string; email?: string };
  const googleId = info.sub?.trim() ?? '';
  const email = info.email?.trim().toLowerCase() ?? '';
  if (!googleId || !email) throw new Error('Google profile missing email');
  return { googleId, email };
}

export function newOauthState(): string {
  return randomUUID();
}
