import { Controller, Get, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { OWNER_TOKEN_HEADER } from 'shared';
import { parseOwnerToken } from '../common/owner-token';
import { assertEmailPasswordBody } from './assert-auth-body';
import { AuthService } from './auth.service';
import type { AuthedRequest } from './auth.middleware';
import { AUTH_COOKIE, clearSessionCookie, cookiesAreSecure, readCookie, sessionCookie } from './cookie';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Get('me')
  me(@Req() req: AuthedRequest) {
    return this.auth.me(req.authUser ?? null);
  }

  @Post('register')
  async register(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    const { email, password } = assertEmailPasswordBody(req.body);
    const guest = parseOwnerToken(req.headers[OWNER_TOKEN_HEADER.toLowerCase()]);
    const { sessionId, body } = await this.auth.register(email, password, guest);
    this.setSession(res, sessionId);
    return body;
  }

  @Post('login')
  async login(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { email, password } = assertEmailPasswordBody(req.body);
    const { sessionId, body } = await this.auth.login(email, password);
    this.setSession(res, sessionId);
    return body;
  }

  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(readCookie(req.headers.cookie, AUTH_COOKIE));
    res.append('Set-Cookie', clearSessionCookie(cookiesAreSecure()));
    return { ok: true };
  }

  @Post('google/start')
  googleStart(@Req() req: Request) {
    const guest = parseOwnerToken(req.headers[OWNER_TOKEN_HEADER.toLowerCase()]);
    return this.auth.startGoogle(guest, req);
  }

  @Get('google/callback')
  async googleCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ) {
    if (error || !code || !state) {
      const origin = process.env.AUTH_PUBLIC_ORIGIN?.replace(/\/$/, '') || 'http://localhost:5173';
      res.redirect(`${origin}/account?error=google`);
      return;
    }
    try {
      const { sessionId, origin } = await this.auth.finishGoogle(code, state);
      res.append('Set-Cookie', sessionCookie(sessionId, cookiesAreSecure()));
      res.redirect(`${origin}/account?ok=1`);
    } catch {
      const origin = process.env.AUTH_PUBLIC_ORIGIN?.replace(/\/$/, '') || 'http://localhost:5173';
      res.redirect(`${origin}/account?error=google`);
    }
  }

  private setSession(res: Response, sessionId: string): void {
    res.append('Set-Cookie', sessionCookie(sessionId, cookiesAreSecure()));
  }
}
