import {
  BadRequestException,
  UnauthorizedException,
  createParamDecorator,
  ExecutionContext,
} from '@nestjs/common';
import { OWNER_TOKEN_HEADER } from 'shared';

export function parseOwnerToken(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const token = typeof value === 'string' ? value.trim() : '';
  if (!token) {
    throw new UnauthorizedException('Missing owner token');
  }
  if (token.length > 128) {
    throw new BadRequestException('Invalid owner token');
  }
  return token;
}

export function readOwnerToken(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const token = typeof value === 'string' ? value.trim() : '';
  if (!token) return null;
  if (token.length > 128) {
    throw new BadRequestException('Invalid owner token');
  }
  return token;
}

function headerFrom(ctx: ExecutionContext): string | string[] | undefined {
  const request = ctx.switchToHttp().getRequest<{ headers: Record<string, string | string[] | undefined> }>();
  return request.headers[OWNER_TOKEN_HEADER.toLowerCase()];
}

export const OwnerToken = createParamDecorator((_data: unknown, ctx: ExecutionContext) =>
  parseOwnerToken(headerFrom(ctx)),
);

export const OptionalOwnerToken = createParamDecorator((_data: unknown, ctx: ExecutionContext) =>
  readOwnerToken(headerFrom(ctx)),
);
