import './test-db-env';
import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { CM_STEPS } from 'shared';
import { OTHER, withOwner } from './helpers';

type CaptainsView = {
  id: string;
  status: string;
  stepIndex: number;
  acting: 'player' | 'ai' | null;
  slots: unknown[];
  bannedHeroIds: number[];
  playerHeroIds: number[];
  aiHeroIds: number[];
  current: { type: 'ban' | 'pick' } | null;
};

async function startCaptains(server: ReturnType<INestApplication['getHttpServer']>) {
  const res = await withOwner(request(server).post('/captains'));
  expect([200, 201]).toContain(res.status);
  return res.body as CaptainsView;
}

async function unusedHeroId(server: ReturnType<INestApplication['getHttpServer']>, view: CaptainsView) {
  const heroes = await request(server).get('/heroes').expect(200);
  const taken = new Set([
    ...(view.bannedHeroIds ?? []),
    ...(view.playerHeroIds ?? []),
    ...(view.aiHeroIds ?? []),
  ]);
  const hero = (heroes.body as { id: number }[]).find((h) => Number.isInteger(h.id) && !taken.has(h.id));
  expect(hero).toBeDefined();
  return hero!.id;
}

describe('Captains (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('starts a captains session for the owner', async () => {
    const body = await startCaptains(app.getHttpServer());

    expect(typeof body.id).toBe('string');
    expect(body.id.length).toBeGreaterThan(0);
    expect(body.status).toBe('DRAFTING');
    expect(Array.isArray(body.slots)).toBe(true);
    expect(body.slots).toHaveLength(CM_STEPS.length);
  });

  it('returns the same session to the owner on GET', async () => {
    const started = await startCaptains(app.getHttpServer());

    const res = await withOwner(request(app.getHttpServer()).get(`/captains/${started.id}`)).expect(200);

    expect(res.body.id).toBe(started.id);
    expect(res.body.status).toBe('DRAFTING');
    expect(Array.isArray(res.body.slots)).toBe(true);
  });

  it('returns 401 when the owner token is missing', async () => {
    await request(app.getHttpServer()).post('/captains').expect(401);
  });

  it('returns 404 when another owner loads the session', async () => {
    const started = await startCaptains(app.getHttpServer());

    const res = await withOwner(request(app.getHttpServer()).get(`/captains/${started.id}`), OTHER).expect(
      404,
    );
    expect(res.body.message).toMatch(/captains session not found/i);
  });

  it('accepts one player act when it is the player turn', async () => {
    const started = await startCaptains(app.getHttpServer());
    // start() runs AI until the player step, so acting should be player.
    expect(started.acting).toBe('player');
    const view = started;

    const heroId = await unusedHeroId(app.getHttpServer(), view);
    const res = await withOwner(request(app.getHttpServer()).post(`/captains/${started.id}/act`)).send({
      heroId,
    });
    expect([200, 201]).toContain(res.status);

    const after = res.body as CaptainsView;
    expect(after.id).toBe(started.id);
    expect(after.status).toBe('DRAFTING');
    expect(after.stepIndex).toBeGreaterThan(view.stepIndex);
    const used = [...after.bannedHeroIds, ...after.playerHeroIds, ...after.aiHeroIds];
    expect(used).toContain(heroId);
  });
});
