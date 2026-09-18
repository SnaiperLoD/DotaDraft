import './test-db-env';
import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { OWNER_TOKEN_HEADER } from 'shared';
import { AUTH_COOKIE } from '../../src/auth/cookie';

function uniqueEmail(label: string): string {
  return `integration-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`;
}

function sessionCookieHeader(setCookie: string | string[] | undefined): string {
  const lines = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const sidLine = lines.find((line) => line.startsWith(`${AUTH_COOKIE}=`));
  expect(sidLine).toBeDefined();
  return sidLine!.split(';')[0];
}

describe('Auth flow (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers with X-Owner-Token and sets session cookie', async () => {
    const guestToken = `auth-guest-${Date.now()}`;
    const email = uniqueEmail('register');
    const password = 'password1';

    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .set(OWNER_TOKEN_HEADER, guestToken)
      .send({ email, password })
      .expect(201);

    const setCookie = res.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    expect(sessionCookieHeader(setCookie)).toMatch(new RegExp(`^${AUTH_COOKIE}=.+`));
    expect(res.body.ownerToken).toBe(guestToken);
    expect(res.body.user.email).toBe(email);
  });

  it('returns the signed-in user from GET /auth/me when the session cookie is present', async () => {
    const guestToken = `auth-guest-me-${Date.now()}`;
    const email = uniqueEmail('me');
    const password = 'password1';

    const registerRes = await request(app.getHttpServer())
      .post('/auth/register')
      .set(OWNER_TOKEN_HEADER, guestToken)
      .send({ email, password })
      .expect(201);

    const cookie = sessionCookieHeader(registerRes.headers['set-cookie']);
    const meRes = await request(app.getHttpServer()).get('/auth/me').set('Cookie', cookie).expect(200);

    expect(meRes.body.user).not.toBeNull();
    expect(meRes.body.user.email).toBe(email);
    expect(meRes.body.ownerToken).toBe(guestToken);
  });

  it('returns anonymous GET /auth/me without cookie or owner header', async () => {
    const res = await request(app.getHttpServer()).get('/auth/me').expect(200);
    expect(res.body).toEqual({ user: null, googleEnabled: false, ownerToken: null });
  });

  it('clears the session on logout and /auth/me becomes anonymous', async () => {
    const guestToken = `auth-guest-logout-${Date.now()}`;
    const email = uniqueEmail('logout');
    const password = 'password1';

    const registerRes = await request(app.getHttpServer())
      .post('/auth/register')
      .set(OWNER_TOKEN_HEADER, guestToken)
      .send({ email, password })
      .expect(201);

    const cookie = sessionCookieHeader(registerRes.headers['set-cookie']);

    const logoutRes = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', cookie)
      .expect(201);
    const cleared = logoutRes.headers['set-cookie'];
    expect(cleared).toBeDefined();
    const clearedLine = Array.isArray(cleared) ? cleared.join(';') : cleared;
    expect(clearedLine).toMatch(/Max-Age=0/);

    const meRes = await request(app.getHttpServer()).get('/auth/me').set('Cookie', cookie).expect(200);
    expect(meRes.body.user).toBeNull();
  });

  it('restores session on login after logout and rejects duplicate register email with 409', async () => {
    const guestToken = `auth-guest-login-${Date.now()}`;
    const email = uniqueEmail('login-dup');
    const password = 'password1';

    const registerRes = await request(app.getHttpServer())
      .post('/auth/register')
      .set(OWNER_TOKEN_HEADER, guestToken)
      .send({ email, password })
      .expect(201);

    const cookie = sessionCookieHeader(registerRes.headers['set-cookie']);
    await request(app.getHttpServer()).post('/auth/logout').set('Cookie', cookie).expect(201);

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(201);
    expect(loginRes.body.user.email).toBe(email);

    const loginCookie = sessionCookieHeader(loginRes.headers['set-cookie']);
    const meRes = await request(app.getHttpServer()).get('/auth/me').set('Cookie', loginCookie).expect(200);
    expect(meRes.body.user.email).toBe(email);

    const dupRes = await request(app.getHttpServer())
      .post('/auth/register')
      .set(OWNER_TOKEN_HEADER, `auth-guest-dup-${Date.now()}`)
      .send({ email, password })
      .expect(409);
    expect(dupRes.body.message).toMatch(/already exists/i);
  });
});
