import './test-db-env';
import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { OWNER_TOKEN_HEADER } from 'shared';

const OWNER = 'integration-owner';

function withOwner(req: request.Test, token = OWNER) {
  return req.set(OWNER_TOKEN_HEADER, token);
}

describe('Error envelope (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns the unified envelope for 401 without an owner token', async () => {
    const res = await request(app.getHttpServer()).get('/history').expect(401);

    expect(typeof res.body.message).toBe('string');
    expect(res.body.message.length).toBeGreaterThan(0);
    expect(typeof res.body.requestId).toBe('string');
    expect(res.body.requestId.length).toBeGreaterThan(0);
    expect(res.body.statusCode).toBe(401);
    expect(typeof res.body.error).toBe('string');
    expect(res.headers['x-request-id']).toBe(res.body.requestId);
  });

  it('returns the unified envelope for 404 on a missing draft', async () => {
    const res = await withOwner(
      request(app.getHttpServer()).get('/draft/00000000-0000-4000-8000-000000000000'),
    ).expect(404);

    expect(typeof res.body.message).toBe('string');
    expect(res.body.message).toMatch(/draft not found/i);
    expect(typeof res.body.requestId).toBe('string');
    expect(res.body.statusCode).toBe(404);
    expect(res.headers['x-request-id']).toBe(res.body.requestId);
  });

  it('returns the unified envelope for 400 on a malformed draft id', async () => {
    const res = await withOwner(request(app.getHttpServer()).get('/draft/does-not-exist')).expect(400);

    expect(typeof res.body.message).toBe('string');
    expect(typeof res.body.requestId).toBe('string');
    expect(res.body.statusCode).toBe(400);
    expect(res.headers['x-request-id']).toBe(res.body.requestId);
  });

  it('echoes a client-supplied X-Request-Id on error responses', async () => {
    const res = await request(app.getHttpServer())
      .get('/history')
      .set('X-Request-Id', 'test-rid-1')
      .expect(401);

    expect(res.body.requestId).toBe('test-rid-1');
    expect(res.headers['x-request-id']).toBe('test-rid-1');
  });
});
