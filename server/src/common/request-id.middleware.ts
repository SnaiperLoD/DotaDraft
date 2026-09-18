import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'X-Request-Id';
const MAX_REQUEST_ID_LENGTH = 128;

/** Printable ASCII (space through tilde) — typical opaque correlation ids. */
const SANE_REQUEST_ID = /^[\x20-\x7E]+$/;

export type RequestWithId = Request & { requestId: string };

function isSaneRequestId(value: string): boolean {
  return value.length > 0 && value.length <= MAX_REQUEST_ID_LENGTH && SANE_REQUEST_ID.test(value);
}

function readIncomingRequestId(header: string | string[] | undefined): string {
  if (typeof header === 'string') return header.trim();
  if (Array.isArray(header) && typeof header[0] === 'string') return header[0].trim();
  return '';
}

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: RequestWithId, res: Response, next: NextFunction): void {
    const candidate = readIncomingRequestId(req.headers['x-request-id']);
    req.requestId = isSaneRequestId(candidate) ? candidate : randomUUID();
    res.setHeader(REQUEST_ID_HEADER, req.requestId);
    next();
  }
}
