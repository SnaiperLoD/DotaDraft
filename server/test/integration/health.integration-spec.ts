import './test-db-env';
import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';

describe('Health HTTP (integration)', () => {
  let app: INestApplication;
  const previousPoolUrl = process.env.POOL_DATABASE_URL;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    if (previousPoolUrl === undefined) delete process.env.POOL_DATABASE_URL;
    else process.env.POOL_DATABASE_URL = previousPoolUrl;
  });

  it('returns 200 with sqlite ok and a request id while sqlite is up', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);

    expect(res.body.sqlite).toBe('ok');
    expect(['ok', 'disabled', 'error']).toContain(res.body.pool);
    expect(res.body.status).toBe(res.body.pool === 'error' ? 'degraded' : 'ok');
    expect(typeof res.headers['x-request-id']).toBe('string');
    expect(res.headers['x-request-id'].length).toBeGreaterThan(0);
  });

  it('reports pool disabled without 503 when POOL_DATABASE_URL is empty', async () => {
    const prev = process.env.POOL_DATABASE_URL;
    delete process.env.POOL_DATABASE_URL;
    try {
      const res = await request(app.getHttpServer()).get('/health').expect(200);
      expect(res.body).toEqual({ status: 'ok', sqlite: 'ok', pool: 'disabled' });
    } finally {
      if (prev === undefined) delete process.env.POOL_DATABASE_URL;
      else process.env.POOL_DATABASE_URL = prev;
    }
  });
});
