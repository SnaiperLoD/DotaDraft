import { CallHandler, ExecutionContext, HttpException } from '@nestjs/common';
import { of } from 'rxjs';
import { WriteRateLimitInterceptor } from './write-rate-limit';

function mockContext(method: string, url: string, token = 'tok'): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ method, url, ip: '127.0.0.1', headers: { 'x-owner-token': token } }),
    }),
  } as ExecutionContext;
}

describe('WriteRateLimitInterceptor', () => {
  const originalEnv = process.env.NODE_ENV;
  const next: CallHandler = { handle: () => of(null) };

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('skips limiting when NODE_ENV is test', () => {
    process.env.NODE_ENV = 'test';
    const interceptor = new WriteRateLimitInterceptor();
    expect(() => interceptor.intercept(mockContext('POST', '/draft'), next)).not.toThrow();
  });

  it('returns 429 after 60 writes in a minute', () => {
    process.env.NODE_ENV = 'production';
    const interceptor = new WriteRateLimitInterceptor();
    const ctx = mockContext('POST', '/draft');
    for (let i = 0; i < 60; i++) interceptor.intercept(ctx, next);
    expect(() => interceptor.intercept(ctx, next)).toThrow(HttpException);
  });

  it('does not count GET or /health', () => {
    process.env.NODE_ENV = 'production';
    const interceptor = new WriteRateLimitInterceptor();
    for (let i = 0; i < 80; i++) {
      interceptor.intercept(mockContext('GET', '/history'), next);
      interceptor.intercept(mockContext('GET', '/health'), next);
    }
    expect(() => interceptor.intercept(mockContext('GET', '/health'), next)).not.toThrow();
  });
});
