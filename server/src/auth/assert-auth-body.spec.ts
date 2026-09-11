import { BadRequestException } from '@nestjs/common';
import { assertEmailPasswordBody } from './assert-auth-body';

describe('assertEmailPasswordBody', () => {
  it('trims and lowercases email', () => {
    expect(assertEmailPasswordBody({ email: '  Nick@Example.COM ', password: 'password1' })).toEqual({
      email: 'nick@example.com',
      password: 'password1',
    });
  });

  it('rejects short passwords and junk email', () => {
    expect(() => assertEmailPasswordBody({ email: 'nick@example.com', password: 'short' })).toThrow(
      BadRequestException,
    );
    expect(() => assertEmailPasswordBody({ email: 'not-an-email', password: 'password1' })).toThrow(
      BadRequestException,
    );
  });
});
