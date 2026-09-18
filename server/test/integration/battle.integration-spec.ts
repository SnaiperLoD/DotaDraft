import './test-db-env';
import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { encodeCopiedDraft } from 'shared';
import { completeBattleDraft, startDraftWithFirstPick, withOwner } from './helpers';

describe('Battle flow (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('coin-flips when copiedDraft mirrors the completed draft heroes', async () => {
    const { draftId, assignments } = await completeBattleDraft(app.getHttpServer());
    const copiedDraft = encodeCopiedDraft(assignments);

    const res = await withOwner(request(app.getHttpServer()).post('/battle'))
      .send({ draftId, copiedDraft })
      .expect(201);

    expect(res.body.coinFlip).toBe(true);
    expect(['Win', 'Lose']).toContain(res.body.resolvedOutcome);
  });

  it('rejects battle while the draft is still picking', async () => {
    const { draftId } = await startDraftWithFirstPick(app.getHttpServer());

    const res = await withOwner(request(app.getHttpServer()).post('/battle'))
      .send({ draftId, copiedDraft: 'AAAA' })
      .expect(400);
    expect(res.body.message).toMatch(/completed before entering Battle Mode/i);
  });

  it('returns 401 when the owner token is missing', async () => {
    const { draftId, assignments } = await completeBattleDraft(app.getHttpServer());
    const copiedDraft = encodeCopiedDraft(assignments);

    await request(app.getHttpServer()).post('/battle').send({ draftId, copiedDraft }).expect(401);
  });

  it('rejects both copiedDraft and captainsSessionId in one request', async () => {
    const { draftId, assignments } = await completeBattleDraft(app.getHttpServer());
    const copiedDraft = encodeCopiedDraft(assignments);

    const res = await withOwner(request(app.getHttpServer()).post('/battle'))
      .send({
        draftId,
        copiedDraft,
        captainsSessionId: '00000000-0000-4000-8000-000000000001',
      })
      .expect(400);
    expect(res.body.message).toMatch(/choose one opponent source/i);
  });
});
