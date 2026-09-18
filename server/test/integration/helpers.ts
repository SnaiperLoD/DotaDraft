import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { OWNER_TOKEN_HEADER, ROLES } from 'shared';

export const OWNER = 'integration-owner';
export const OTHER = 'other-owner';

export function withOwner(req: request.Test, token = OWNER) {
  return req.set(OWNER_TOKEN_HEADER, token);
}

// Round 1 is served by POST /draft/pool, which writes nothing; the Draft
// row is created by POST /draft, which carries the first pick. Helper so
// each test below can get to a real draft in one line.
export async function startDraftWithFirstPick(
  server: ReturnType<INestApplication['getHttpServer']>,
  rerollUsed = false,
  token = OWNER,
) {
  const poolRes = await request(server).post('/draft/pool').expect(201);
  const heroId = poolRes.body.pool[0].id as number;
  const createRes = await withOwner(request(server).post('/draft'), token)
    .send({ seed: poolRes.body.seed, heroId, rerollUsed })
    .expect(201);
  return { draftId: createRes.body.id as string, firstHeroId: heroId, createRes, poolRes };
}

/** Five picks + unique roles → COMPLETED battle-mode draft. */
export async function completeBattleDraft(
  server: ReturnType<INestApplication['getHttpServer']>,
  token = OWNER,
) {
  const { draftId, firstHeroId } = await startDraftWithFirstPick(server, false, token);
  const pickedHeroIds: number[] = [firstHeroId];

  for (let round = 2; round <= 5; round++) {
    const current = await withOwner(request(server).get(`/draft/${draftId}`), token).expect(200);
    const heroId = current.body.pool[0].id as number;
    pickedHeroIds.push(heroId);

    await withOwner(request(server).post(`/draft/${draftId}/pick`), token)
      .send({ heroId })
      .expect(201);
  }

  const assignments = pickedHeroIds.map((heroId, i) => ({ heroId, role: ROLES[i] }));
  const rolesRes = await withOwner(request(server).post(`/draft/${draftId}/roles`), token)
    .send({ assignments })
    .expect(201);

  expect(rolesRes.body.status).toBe('COMPLETED');
  return { draftId, pickedHeroIds, assignments };
}
