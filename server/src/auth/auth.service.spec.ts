import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { hashPassword } from './password';

function userRow(
  over: Partial<{
    id: string;
    email: string;
    passwordHash: string | null;
    googleId: string | null;
    ownerToken: string;
  }> = {},
) {
  return {
    id: 'u1',
    email: 'nick@example.com',
    passwordHash: null as string | null,
    googleId: null as string | null,
    ownerToken: 'guest-token',
    ...over,
  };
}

function makePrisma() {
  return {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    authSession: {
      create: jest.fn(),
      findUnique: jest.fn(),
      deleteMany: jest.fn(),
    },
  };
}

describe('AuthService', () => {
  it('registers by claiming the guest token and opening a session', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue(userRow({ passwordHash: 'hash' }));
    prisma.authSession.create.mockResolvedValue({ id: 'sid' });
    const auth = new AuthService(prisma as never);

    const result = await auth.register('nick@example.com', 'password1', 'guest-token');

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: 'nick@example.com', ownerToken: 'guest-token' }),
      }),
    );
    expect(result.sessionId).toBe('sid');
    expect(result.body.ownerToken).toBe('guest-token');
    expect(result.body.user.hasPassword).toBe(true);
  });

  it('refuses to register when this browser already has an account', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(userRow({ email: 'other@example.com' }));
    const auth = new AuthService(prisma as never);
    await expect(auth.register('nick@example.com', 'password1', 'guest-token')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('logs in with a password and rejects google-only accounts', async () => {
    const prisma = makePrisma();
    const passwordHash = await hashPassword('password1');
    prisma.user.findUnique.mockResolvedValue(userRow({ passwordHash }));
    prisma.authSession.create.mockResolvedValue({ id: 'sid' });
    const auth = new AuthService(prisma as never);
    const result = await auth.login('nick@example.com', 'password1');
    expect(result.body.ownerToken).toBe('guest-token');

    prisma.user.findUnique.mockResolvedValue(userRow({ passwordHash: null, googleId: 'g1' }));
    await expect(auth.login('nick@example.com', 'password1')).rejects.toBeInstanceOf(BadRequestException);

    prisma.user.findUnique.mockResolvedValue(null);
    await expect(auth.login('missing@example.com', 'password1')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('returns guest me without 401', () => {
    const auth = new AuthService(makePrisma() as never);
    const me = auth.me(null);
    expect(me.user).toBeNull();
    expect(me.ownerToken).toBeNull();
  });
});
