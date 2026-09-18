import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { STATUS_CODES } from 'http';
import type { Response } from 'express';
import { REQUEST_ID_HEADER, type RequestWithId } from './request-id.middleware';

const INTERNAL_MESSAGE = 'Internal server error';

function statusText(statusCode: number): string {
  return STATUS_CODES[statusCode] ?? 'Error';
}

function normalizeMessage(raw: unknown): string {
  if (typeof raw === 'string' && raw.trim()) return raw;
  if (Array.isArray(raw) && raw.every((part) => typeof part === 'string')) {
    return raw.join(', ');
  }
  return INTERNAL_MESSAGE;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<RequestWithId>();

    const requestId = request.requestId ?? randomUUID();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let error = statusText(statusCode);
    let message = INTERNAL_MESSAGE;

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      error = statusText(statusCode);

      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = normalizeMessage(body);
      } else if (body && typeof body === 'object') {
        const record = body as { message?: unknown; error?: unknown };
        message = normalizeMessage(record.message);
        if (typeof record.error === 'string' && record.error.trim()) {
          error = record.error;
        }
      }
    }

    response.setHeader(REQUEST_ID_HEADER, requestId);
    response.status(statusCode).json({ requestId, statusCode, error, message });
  }
}
