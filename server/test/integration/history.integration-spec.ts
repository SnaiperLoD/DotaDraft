import './test-db-env';
import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { completeBattleDraft, OTHER, OWNER, withOwner } from './helpers';

describe('History (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns an empty list for an owner with no drafts', async () => {
    const unused = `history-empty-${Date.now()}`;
    const res = await withOwner(request(app.getHttpServer()).get('/history'), unused).expect(200);
    expect(res.body).toEqual([]);
  });

  it('does not leak another owners completed drafts', async () => {
    const { draftId: otherDraftId } = await completeBattleDraft(app.getHttpServer(), OTHER);

    const unused = `history-no-other-${Date.now()}`;
    const empty = await withOwner(request(app.getHttpServer()).get('/history'), unused).expect(200);
    expect(empty.body.map((row: { id: string }) => row.id)).not.toContain(otherDraftId);

    const ownerHistory = await withOwner(request(app.getHttpServer()).get('/history'), OWNER).expect(200);
    expect(ownerHistory.body.map((row: { id: string }) => row.id)).not.toContain(otherDraftId);
  });

  it('includes the evaluated draft with matching totalScore', async () => {
    const { draftId } = await completeBattleDraft(app.getHttpServer());
    const evalRes = await withOwner(request(app.getHttpServer()).get(`/evaluation/${draftId}`)).expect(200);

    const history = await withOwner(request(app.getHttpServer()).get('/history')).expect(200);
    const entry = history.body.find((row: { id: string }) => row.id === draftId);
    expect(entry).toBeDefined();
    expect(entry.evaluation?.totalScore).toBe(evalRes.body.totalScore);
  });

  it('hides OWNER drafts from OTHER', async () => {
    const { draftId } = await completeBattleDraft(app.getHttpServer(), OWNER);

    const otherHistory = await withOwner(request(app.getHttpServer()).get('/history'), OTHER).expect(200);
    expect(otherHistory.body.map((row: { id: string }) => row.id)).not.toContain(draftId);
  });
});
