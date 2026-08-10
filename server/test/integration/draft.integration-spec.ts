import './test-db-env';
import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ROLES } from 'shared';

// Round 1 is served by POST /draft/pool, which writes nothing; the Draft
// row is created by POST /draft, which carries the first pick. Helper so
// each test below can get to a real draft in one line.
async function startDraftWithFirstPick(
  server: ReturnType<INestApplication['getHttpServer']>,
  rerollUsed = false,
) {
  const poolRes = await request(server).post('/draft/pool').expect(201);
  const heroId = poolRes.body.pool[0].id as number;
  const createRes = await request(server)
    .post('/draft')
    .send({ seed: poolRes.body.seed, heroId, rerollUsed })
    .expect(201);
  return { draftId: createRes.body.id as string, firstHeroId: heroId, createRes, poolRes };
}

// Exercises the real HTTP stack (Controller -> Service -> Prisma -> SQLite)
// for the Draft flow, against the seeded real hero dataset (see
// global-setup.ts). Unit specs already cover DraftService's branching in
// isolation with mocks; this instead checks the wiring between layers that
// the unit suite can't: routing, status codes, and what actually lands in
// the database.
describe('Draft flow (integration)', () => {
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

  // The reason the draft isn't created on page load any more: it used to
  // leave an abandoned empty row behind on every visit that never picked
  // anything (383 of 393 PICKING rows in the dev database).
  it('does not write anything when a pool is requested', async () => {
    const before = await prisma.draft.count();

    for (let i = 0; i < 3; i++) {
      const res = await request(app.getHttpServer()).post('/draft/pool').expect(201);
      expect(res.body.pool).toHaveLength(5);
      expect(typeof res.body.seed).toBe('number');
    }

    expect(await prisma.draft.count()).toBe(before);
  });

  it('creates the draft with its first hero already attached', async () => {
    const before = await prisma.draft.count();
    const { draftId, firstHeroId } = await startDraftWithFirstPick(app.getHttpServer());

    expect(await prisma.draft.count()).toBe(before + 1);

    const row = await prisma.draft.findUnique({
      where: { id: draftId },
      include: { heroes: true },
    });
    expect(row?.status).toBe('PICKING');
    expect(row?.rerollsRemaining).toBe(1);
    expect(row?.heroes).toHaveLength(1);
    expect(row?.heroes[0]).toMatchObject({ heroId: firstHeroId, pickOrder: 1 });
  });

  // The invariant the whole change exists to hold.
  it('leaves no draft in the database without at least one hero', async () => {
    await request(app.getHttpServer()).post('/draft/pool').expect(201);
    await startDraftWithFirstPick(app.getHttpServer());

    expect(await prisma.draft.count({ where: { heroes: { none: {} } } })).toBe(0);
  });

  it('carries a round-1 re-roll into the created draft', async () => {
    const { draftId } = await startDraftWithFirstPick(app.getHttpServer(), true);
    const row = await prisma.draft.findUnique({ where: { id: draftId } });
    expect(row?.rerollsRemaining).toBe(0);

    await request(app.getHttpServer()).post(`/draft/${draftId}/reroll`).expect(400);
  });

  it('rejects a first pick that is not in the offered pool', async () => {
    const poolRes = await request(app.getHttpServer()).post('/draft/pool').expect(201);
    const poolIds = new Set(poolRes.body.pool.map((h: any) => h.id));
    const allHeroes = await request(app.getHttpServer()).get('/heroes').expect(200);
    const outsideHero = allHeroes.body.find((h: any) => !poolIds.has(h.id));

    const res = await request(app.getHttpServer())
      .post('/draft')
      .send({ seed: poolRes.body.seed, heroId: outsideHero.id, rerollUsed: false })
      .expect(400);
    expect(res.body.message).toMatch(/not in current pool/i);
  });

  it('runs a full draft from first pick through pick x5 to role assignment', async () => {
    const { draftId, firstHeroId, createRes } = await startDraftWithFirstPick(app.getHttpServer());
    expect(createRes.body.status).toBe('PICKING');
    expect(createRes.body.pool).toHaveLength(5);
    expect(createRes.body.heroes).toHaveLength(1);

    const pickedHeroIds: number[] = [firstHeroId];

    for (let round = 2; round <= 5; round++) {
      const current = await request(app.getHttpServer()).get(`/draft/${draftId}`).expect(200);
      const heroId = current.body.pool[0].id as number;
      pickedHeroIds.push(heroId);

      const pickRes = await request(app.getHttpServer())
        .post(`/draft/${draftId}/pick`)
        .send({ heroId })
        .expect(201);

      expect(pickRes.body.heroes).toHaveLength(round);
      expect(pickRes.body.heroes[round - 1]).toMatchObject({ heroId, pickOrder: round });

      if (round < 5) {
        expect(pickRes.body.status).toBe('PICKING');
        expect(pickRes.body.pool).toHaveLength(5);
      } else {
        expect(pickRes.body.status).toBe('ASSIGNING_ROLES');
        expect(pickRes.body.pool).toEqual([]);
      }
    }

    const assignments = pickedHeroIds.map((heroId, i) => ({ heroId, role: ROLES[i] }));
    const rolesRes = await request(app.getHttpServer())
      .post(`/draft/${draftId}/roles`)
      .send({ assignments })
      .expect(201);

    expect(rolesRes.body.status).toBe('COMPLETED');
    const rolesByHeroId = new Map(rolesRes.body.heroes.map((h: any) => [h.heroId, h.assignedRole]));
    for (const { heroId, role } of assignments) {
      expect(rolesByHeroId.get(heroId)).toBe(role);
    }

    // Confirm it actually persisted, not just echoed back in the response.
    const persisted = await request(app.getHttpServer()).get(`/draft/${draftId}`).expect(200);
    expect(persisted.body.status).toBe('COMPLETED');
    expect(persisted.body.heroes.map((h: any) => h.assignedRole).sort()).toEqual([...ROLES].sort());
  });

  it('allows one reroll then rejects a second', async () => {
    const { draftId } = await startDraftWithFirstPick(app.getHttpServer());

    const rerollRes = await request(app.getHttpServer()).post(`/draft/${draftId}/reroll`).expect(201);
    expect(rerollRes.body.rerollsRemaining).toBe(0);
    expect(rerollRes.body.pool).toHaveLength(5);
    expect(rerollRes.body.status).toBe('PICKING');

    const secondReroll = await request(app.getHttpServer()).post(`/draft/${draftId}/reroll`).expect(400);
    expect(secondReroll.body.message).toMatch(/no rerolls remaining/i);
  });

  it('returns 404 for a draft id that does not exist', async () => {
    await request(app.getHttpServer()).get('/draft/does-not-exist').expect(404);
  });

  it('rejects picking a hero that is not in the current pool', async () => {
    const { draftId, createRes } = await startDraftWithFirstPick(app.getHttpServer());
    const poolIds = new Set(createRes.body.pool.map((h: any) => h.id));

    const allHeroes = await request(app.getHttpServer()).get('/heroes').expect(200);
    const outsideHero = allHeroes.body.find((h: any) => !poolIds.has(h.id));

    const res = await request(app.getHttpServer())
      .post(`/draft/${draftId}/pick`)
      .send({ heroId: outsideHero.id })
      .expect(400);
    expect(res.body.message).toMatch(/not in current pool/i);
  });

  it('rejects role assignment while the draft is still in the picking phase', async () => {
    const { draftId } = await startDraftWithFirstPick(app.getHttpServer());

    const res = await request(app.getHttpServer())
      .post(`/draft/${draftId}/roles`)
      .send({ assignments: [] })
      .expect(400);
    expect(res.body.message).toMatch(/not in role assignment phase/i);
  });
});
