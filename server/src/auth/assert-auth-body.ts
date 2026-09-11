import { BadRequestException } from '@nestjs/common';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function assertEmailPasswordBody(body: unknown): { email: string; password: string } {
  if (!body || typeof body !== 'object') throw new BadRequestException('Invalid body');
  const b = body as Record<string, unknown>;
  if (typeof b.email !== 'string' || typeof b.password !== 'string') {
    throw new BadRequestException('Email and password required');
  }
  const email = b.email.trim().toLowerCase();
  if (email.length < 3 || email.length > 254 || !EMAIL_RE.test(email)) {
    throw new BadRequestException('Invalid email');
  }
  const password = b.password;
  if (password.length < 8 || password.length > 128) {
    throw new BadRequestException('Password must be 8–128 characters');
  }
  return { email, password };
}
