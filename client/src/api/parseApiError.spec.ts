import { describe, expect, it } from 'vitest';
import { parseApiError, readRequestId } from './parseApiError';

function res(
  status: number,
  body: string,
  contentType = 'application/json',
  headers: Record<string, string> = {},
): Response {
  return new Response(body, { status, headers: { 'Content-Type': contentType, ...headers } });
}

describe('parseApiError', () => {
  it('reads Nest message strings', async () => {
    await expect(parseApiError(res(400, JSON.stringify({ message: 'Draft not found' })))).resolves.toBe(
      'Draft not found',
    );
  });

  it('reads message from the unified error envelope', async () => {
    await expect(
      parseApiError(
        res(
          404,
          JSON.stringify({
            requestId: 'rid-404',
            statusCode: 404,
            error: 'Not Found',
            message: 'Draft not found',
          }),
        ),
      ),
    ).resolves.toBe('Draft not found');
  });

  it('joins array validation messages', async () => {
    await expect(
      parseApiError(
        res(
          400,
          JSON.stringify({
            requestId: 'rid-400',
            statusCode: 400,
            error: 'Bad Request',
            message: ['seed must be a number', 'heroId must be a number'],
          }),
        ),
      ),
    ).resolves.toBe('seed must be a number, heroId must be a number');
  });

  it('maps 503 without a JSON body', async () => {
    await expect(parseApiError(res(503, 'nope', 'text/plain'))).resolves.toMatch(/Battle pool is offline/);
  });

  it('maps 429 and 401 fallbacks', async () => {
    await expect(parseApiError(res(429, '', 'text/plain'))).resolves.toMatch(/Too many requests/);
    await expect(parseApiError(res(401, '', 'text/plain'))).resolves.toMatch(/draft token/);
  });
});

describe('readRequestId', () => {
  it('prefers the response header', () => {
    expect(
      readRequestId(res(400, '{}', 'application/json', { 'X-Request-Id': 'header-rid' }), {
        requestId: 'body-rid',
      }),
    ).toBe('header-rid');
  });

  it('falls back to body.requestId', () => {
    expect(readRequestId(res(400, '{}'), { requestId: 'body-rid' })).toBe('body-rid');
  });
});
