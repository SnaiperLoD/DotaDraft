import { describe, expect, it } from 'vitest';
import { parseApiError } from './parseApiError';

function res(status: number, body: string, contentType = 'application/json'): Response {
  return new Response(body, { status, headers: { 'Content-Type': contentType } });
}

describe('parseApiError', () => {
  it('reads Nest message strings', async () => {
    await expect(parseApiError(res(400, JSON.stringify({ message: 'Draft not found' })))).resolves.toBe(
      'Draft not found',
    );
  });

  it('maps 503 without a JSON body', async () => {
    await expect(parseApiError(res(503, 'nope', 'text/plain'))).resolves.toMatch(/Battle pool is offline/);
  });

  it('maps 429 and 401 fallbacks', async () => {
    await expect(parseApiError(res(429, '', 'text/plain'))).resolves.toMatch(/Too many requests/);
    await expect(parseApiError(res(401, '', 'text/plain'))).resolves.toMatch(/draft token/);
  });
});
