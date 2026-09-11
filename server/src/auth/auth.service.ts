import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { AuthMeResponse, AuthSessionResponse, AuthUserView } from 'shared';
import { PrismaService } from '../prisma/prisma.service';
import { SESSION_TTL_MS } from './cookie';
import {
  exchangeGoogleCode,
  googleAuthorizeUrl,
  googleEnabled,
  googleRedirectUri,
  newOauthState,
  publicOrigin,
} from './google-oauth';
import { hashPassword, verifyPassword } from './password';

type UserRow = {
  id: string;
  email: string;
  passwordHash: string | null;
  googleId: string | null;
  ownerToken: string;
};

@Injectable()
export class AuthService {
  private readonly oauth = new Map<string, { ownerToken: string; redirectUri: string; expires: number }>();

  constructor(private readonly prisma: PrismaService) {}

  googleEnabled(): boolean {
    return googleEnabled();
  }

  toView(user: UserRow): AuthUserView {
    return {
      email: user.email,
      googleLinked: Boolean(user.googleId),
      hasPassword: Boolean(user.passwordHash),
    };
  }

  me(user: UserRow | null): AuthMeResponse {
    return {
      user: user ? this.toView(user) : null,
      googleEnabled: googleEnabled(),
      ownerToken: user?.ownerToken ?? null,
    };
  }

  async register(
    email: string,
    password: string,
    guestToken: string,
  ): Promise<{ sessionId: string; body: AuthSessionResponse }> {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('An account with this email already exists');
    const ownerToken = await this.claimGuestToken(guestToken);
    const passwordHash = await hashPassword(password);
    const user = await this.prisma.user.create({
      data: { email, passwordHash, ownerToken },
    });
    return this.openSession(user);
  }

  async login(email: string, password: string): Promise<{ sessionId: string; body: AuthSessionResponse }> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user?.passwordHash) {
      if (user?.googleId) throw new BadRequestException('This email uses Google sign-in');
      throw new UnauthorizedException('Invalid email or password');
    }
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid email or password');
    return this.openSession(user);
  }

  async logout(sessionId: string | null): Promise<void> {
    if (!sessionId) return;
    await this.prisma.authSession.deleteMany({ where: { id: sessionId } });
  }

  async startGoogle(
    guestToken: string,
    req: { protocol?: string; headers: Record<string, string | string[] | undefined> },
  ): Promise<{ url: string }> {
    if (!googleEnabled()) throw new NotFoundException('Google sign-in is not configured');
    const origin = publicOrigin(req);
    const redirectUri = googleRedirectUri(origin);
    const state = newOauthState();
    this.oauth.set(state, { ownerToken: guestToken, redirectUri, expires: Date.now() + 10 * 60_000 });
    return { url: googleAuthorizeUrl(state, redirectUri) };
  }

  async finishGoogle(code: string, state: string): Promise<{ sessionId: string; origin: string }> {
    const pending = this.oauth.get(state);
    this.oauth.delete(state);
    if (!pending || pending.expires < Date.now()) {
      throw new BadRequestException('Google sign-in expired. Try again.');
    }
    let profile: { googleId: string; email: string };
    try {
      profile = await exchangeGoogleCode(code, pending.redirectUri);
    } catch {
      throw new BadRequestException('Google sign-in failed');
    }
    const user = await this.upsertGoogleUser(profile.googleId, profile.email, pending.ownerToken);
    const { sessionId } = await this.openSession(user);
    const origin = pending.redirectUri.replace(/\/api\/auth\/google\/callback$/, '');
    return { sessionId, origin };
  }

  async userForSession(sessionId: string | null): Promise<UserRow | null> {
    if (!sessionId) return null;
    const row = await this.prisma.authSession.findUnique({
      where: { id: sessionId },
      include: { user: true },
    });
    if (!row || row.expiresAt.getTime() <= Date.now()) {
      if (row) await this.prisma.authSession.deleteMany({ where: { id: row.id } });
      return null;
    }
    return row.user;
  }

  private async claimGuestToken(guestToken: string): Promise<string> {
    const taken = await this.prisma.user.findUnique({ where: { ownerToken: guestToken } });
    if (!taken) return guestToken;
    throw new ConflictException('This browser already has an account. Log in instead.');
  }

  private async upsertGoogleUser(googleId: string, email: string, guestToken: string): Promise<UserRow> {
    const byGoogle = await this.prisma.user.findUnique({ where: { googleId } });
    if (byGoogle) return byGoogle;
    const byEmail = await this.prisma.user.findUnique({ where: { email } });
    if (byEmail) {
      return this.prisma.user.update({ where: { id: byEmail.id }, data: { googleId } });
    }
    let ownerToken = guestToken;
    const taken = await this.prisma.user.findUnique({ where: { ownerToken: guestToken } });
    if (taken) ownerToken = randomUUID();
    return this.prisma.user.create({ data: { email, googleId, ownerToken } });
  }

  private async openSession(user: UserRow): Promise<{ sessionId: string; body: AuthSessionResponse }> {
    const session = await this.prisma.authSession.create({
      data: {
        userId: user.id,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    });
    return {
      sessionId: session.id,
      body: { user: this.toView(user), ownerToken: user.ownerToken },
    };
  }
}
