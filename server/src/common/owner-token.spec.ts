import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { parseOwnerToken, readOwnerToken } from './owner-token';

describe('owner token parsing', () => {
  it('rejects a missing or blank token', () => {
    expect(() => parseOwnerToken(undefined)).toThrow(UnauthorizedException);
    expect(() => parseOwnerToken('   ')).toThrow(UnauthorizedException);
    expect(readOwnerToken(undefined)).toBeNull();
    expect(readOwnerToken('')).toBeNull();
  });

  it('trims a valid token and takes the first header value', () => {
    expect(parseOwnerToken('  abc-123  ')).toBe('abc-123');
    expect(parseOwnerToken(['abc-123', 'other'])).toBe('abc-123');
    expect(readOwnerToken('  abc-123  ')).toBe('abc-123');
  });

  it('rejects an oversized token', () => {
    const huge = 'x'.repeat(129);
    expect(() => parseOwnerToken(huge)).toThrow(BadRequestException);
    expect(() => readOwnerToken(huge)).toThrow(BadRequestException);
  });
});
