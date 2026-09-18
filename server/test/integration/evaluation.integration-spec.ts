import './test-db-env';
import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { EVAL_RESULT_SCHEMA_VERSION, parseEvaluationResult } from 'shared';
import { completeBattleDraft, startDraftWithFirstPick, withOwner } from './helpers';

describe('Evaluation (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 404 when the draft does not exist', async () => {
    const res = await withOwner(
      request(app.getHttpServer()).get('/evaluation/00000000-0000-4000-8000-000000000000'),
    ).expect(404);
    expect(res.body.message).toMatch(/draft not found/i);
  });

  it('rejects evaluation before all 5 heroes are picked', async () => {
    const { draftId } = await startDraftWithFirstPick(app.getHttpServer());

    const res = await withOwner(request(app.getHttpServer()).get(`/evaluation/${draftId}`)).expect(400);
    expect(res.body.message).toBe('Draft must have all 5 heroes picked before evaluation');
  });

  it('rejects evaluation while roles are still unassigned', async () => {
    const { draftId } = await startDraftWithFirstPick(app.getHttpServer());

    for (let round = 2; round <= 5; round++) {
      const current = await withOwner(request(app.getHttpServer()).get(`/draft/${draftId}`)).expect(200);
      await withOwner(request(app.getHttpServer()).post(`/draft/${draftId}/pick`))
        .send({ heroId: current.body.pool[0].id })
        .expect(201);
    }

    const res = await withOwner(request(app.getHttpServer()).get(`/evaluation/${draftId}`)).expect(400);
    expect(res.body.message).toBe('Draft must be completed before evaluation');
  });

  it('returns 401 when the owner token is missing', async () => {
    const { draftId } = await completeBattleDraft(app.getHttpServer());
    await request(app.getHttpServer()).get(`/evaluation/${draftId}`).expect(401);
  });

  it('returns EvaluationResult and persists schemaVersion 1 on the draft', async () => {
    const { draftId } = await completeBattleDraft(app.getHttpServer());

    const res = await withOwner(request(app.getHttpServer()).get(`/evaluation/${draftId}`)).expect(200);

    expect(res.body.schemaVersion).toBe(EVAL_RESULT_SCHEMA_VERSION);
    expect(res.body.draftId).toBe(draftId);
    expect(typeof res.body.totalScore).toBe('number');
    expect(Array.isArray(res.body.breakdown)).toBe(true);
    expect(res.body.breakdown.length).toBeGreaterThan(0);
    expect(Array.isArray(res.body.summary?.strengths)).toBe(true);
    expect(Array.isArray(res.body.summary?.weaknesses)).toBe(true);

    const row = await prisma.draft.findUnique({ where: { id: draftId } });
    const persisted = parseEvaluationResult(row?.evaluationResult ?? '');
    expect(persisted?.schemaVersion).toBe(EVAL_RESULT_SCHEMA_VERSION);
    expect(persisted?.draftId).toBe(draftId);
    expect(persisted?.totalScore).toBe(res.body.totalScore);
  });
});
