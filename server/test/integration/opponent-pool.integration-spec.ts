import './test-db-env';
import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { completeBattleDraft, withOwner } from './helpers';

describe('Opponent pool (integration, no Postgres)', () => {
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

  it('returns 503 with a readable message when committing without pool storage', async () => {
    const { draftId } = await completeBattleDraft(app.getHttpServer());

    const res = await withOwner(request(app.getHttpServer()).post('/opponent-pool/commit'))
      .send({ draftId })
      .expect(503);

    expect(typeof res.body.message).toBe('string');
    expect(res.body.message.length).toBeGreaterThan(0);
    expect(res.body.message).not.toMatch(/Prisma/i);
    expect(res.body.message).toMatch(/POOL_DATABASE_URL|not reachable/i);
  });

  it('returns 503 for GET /leaderboard when pool storage is unavailable', async () => {
    const res = await request(app.getHttpServer()).get('/leaderboard').expect(503);

    expect(typeof res.body.message).toBe('string');
    expect(res.body.message.length).toBeGreaterThan(0);
    expect(res.body.message).not.toMatch(/Prisma/i);
  });
});

(process.env.POOL_DATABASE_URL?.trim() ? describe : describe.skip)(
  'Opponent pool (integration, live Postgres)',
  () => {
    let app: INestApplication;

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      await app.init();
    });

    afterAll(async () => {
      await app.close();
    });

    it('commits a completed battle draft and retries idempotently', async () => {
      const { draftId } = await completeBattleDraft(app.getHttpServer());

      const first = await withOwner(request(app.getHttpServer()).post('/opponent-pool/commit'))
        .send({ draftId })
        .expect(201);
      expect(typeof first.body.id).toBe('string');
      expect(typeof first.body.committedAt).toBe('string');

      const second = await withOwner(request(app.getHttpServer()).post('/opponent-pool/commit'))
        .send({ draftId })
        .expect(201);
      expect(second.body.id).toBe(first.body.id);
      expect(second.body.committedAt).toBe(first.body.committedAt);
    });
  },
);
