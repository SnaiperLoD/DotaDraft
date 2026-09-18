import './test-db-env';
import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { withOwner } from './helpers';

const MISSING_RUN_ID = '00000000-0000-4000-8000-000000000000';

describe('TI Run (integration, no Postgres pool)', () => {
  let app: INestApplication;
  const originalPoolUrl = process.env.POOL_DATABASE_URL;

  beforeAll(async () => {
    process.env.POOL_DATABASE_URL = '';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    process.env.POOL_DATABASE_URL = originalPoolUrl;
  });

  it('returns 401 when starting without an owner token', async () => {
    await request(app.getHttpServer()).post('/ti-run').expect(401);
  });

  it('returns 503 when the opponent pool has no TI playoff drafts', async () => {
    const res = await withOwner(request(app.getHttpServer()).post('/ti-run')).expect(503);

    expect(typeof res.body.message).toBe('string');
    expect(res.body.message).toMatch(/opponent pool/i);
    expect(typeof res.body.requestId).toBe('string');
    expect(res.body.requestId.length).toBeGreaterThan(0);
    expect(res.body.statusCode).toBe(503);
  });

  it('returns 404 for a missing TI run id', async () => {
    const res = await withOwner(request(app.getHttpServer()).get(`/ti-run/${MISSING_RUN_ID}`)).expect(404);
    expect(res.body.message).toMatch(/ti run not found/i);
  });

  it('returns 401 when GET is missing the owner token', async () => {
    await request(app.getHttpServer()).get(`/ti-run/${MISSING_RUN_ID}`).expect(401);
  });
});
