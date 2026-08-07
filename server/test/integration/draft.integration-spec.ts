import './test-db-env';
import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { ROLES } from 'shared';

// Exercises the real HTTP stack (Controller -> Service -> Prisma -> SQLite)
// for the Draft flow, against the seeded real hero dataset (see
// global-setup.ts). Unit specs already cover DraftService's branching in
// isolation with mocks; this instead checks the wiring between layers that
// the unit suite can't: routing, status codes, and what actually lands in
// the database.
describe('Draft flow (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('runs a full draft from start through pick x5 to role assignment', async () => {
    const startRes = await request(app.getHttpServer()).post('/draft/start').expect(201);
    expect(startRes.body.status).toBe('PICKING');
    expect(startRes.body.pool).toHaveLength(5);
    expect(startRes.body.heroes).toEqual([]);
    expect(startRes.body.rerollsRemaining).toBe(1);

    const draftId = startRes.body.id;
    const pickedHeroIds: number[] = [];

    for (let round = 1; round <= 5; round++) {
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
    const startRes = await request(app.getHttpServer()).post('/draft/start').expect(201);
    const draftId = startRes.body.id;

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
    const startRes = await request(app.getHttpServer()).post('/draft/start').expect(201);
    const draftId = startRes.body.id;
    const poolIds = new Set(startRes.body.pool.map((h: any) => h.id));

    const allHeroes = await request(app.getHttpServer()).get('/heroes').expect(200);
    const outsideHero = allHeroes.body.find((h: any) => !poolIds.has(h.id));

    const res = await request(app.getHttpServer())
      .post(`/draft/${draftId}/pick`)
      .send({ heroId: outsideHero.id })
      .expect(400);
    expect(res.body.message).toMatch(/not in current pool/i);
  });

  it('rejects role assignment while the draft is still in the picking phase', async () => {
    const startRes = await request(app.getHttpServer()).post('/draft/start').expect(201);
    const draftId = startRes.body.id;

    const res = await request(app.getHttpServer())
      .post(`/draft/${draftId}/roles`)
      .send({ assignments: [] })
      .expect(400);
    expect(res.body.message).toMatch(/not in role assignment phase/i);
  });
});
