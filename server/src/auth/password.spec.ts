import { hashPassword, verifyPassword } from './password';

describe('password hashing', () => {
  it('accepts the original password and rejects a wrong one', async () => {
    const stored = await hashPassword('correct horse');
    await expect(verifyPassword('correct horse', stored)).resolves.toBe(true);
    await expect(verifyPassword('wrong horse', stored)).resolves.toBe(false);
  });

  it('rejects a truncated or garbage hash without throwing', async () => {
    await expect(verifyPassword('x', 'not-a-hash')).resolves.toBe(false);
    await expect(verifyPassword('x', ':abcd')).resolves.toBe(false);
  });
});
