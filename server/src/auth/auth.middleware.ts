import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { readOwnerToken } from '../common/owner-token';
import { AuthService } from './auth.service';
import { AUTH_COOKIE, readCookie } from './cookie';

export type AuthedRequest = Request & {
  ownerToken?: string | null;
  authUser?: {
    id: string;
    email: string;
    passwordHash: string | null;
    googleId: string | null;
    ownerToken: string;
  } | null;
};

@Injectable()
export class AuthSessionMiddleware implements NestMiddleware {
  constructor(private readonly auth: AuthService) {}

  async use(req: AuthedRequest, _res: Response, next: NextFunction): Promise<void> {
    try {
      const sid = readCookie(req.headers.cookie, AUTH_COOKIE);
      const user = await this.auth.userForSession(sid);
      if (user) {
        req.authUser = user;
        req.ownerToken = user.ownerToken;
        next();
        return;
      }
      req.authUser = null;
      req.ownerToken = readOwnerToken(req.headers['x-owner-token']);
      next();
    } catch (err) {
      next(err);
    }
  }
}
