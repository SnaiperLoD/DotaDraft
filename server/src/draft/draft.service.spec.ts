import { DraftService } from './draft.service';
import { makeHero } from '../test-utils/hero-factory';
import type { Hero } from 'shared';

const HERO_POOL: Hero[] = Array.from({ length: 10 }, (_, i) => makeHero({ id: i + 1, name: `Hero${i + 1}` }));

function makeFakeHeroService() {
  return {
    randomPool: jest.fn(async (excludeIds: number[], size: number, _seed: number) =>
      HERO_POOL.filter((h) => !excludeIds.includes(h.id)).slice(0, size),
    ),
    findByIds: jest.fn(async (ids: number[]) => HERO_POOL.filter((h) => ids.includes(h.id))),
  };
}

function makeFakePrisma() {
  let draftRow: {
    id: string;
    status: string;
    seed: number;
    pool: string;
    createdAt: Date;
    rerollsRemaining: number;
  } | null = null;
  const heroRows: {
    id: number;
    draftId: string;
    heroId: number;
    assignedRole: string | null;
    pickOrder: number;
  }[] = [];
  let nextRowId = 1;

  const withHeroes = () => ({ ...draftRow!, heroes: heroRows.filter((h) => h.draftId === draftRow!.id) });

  return {
    draft: {
      create: jest.fn(async ({ data }: any) => {
        const id = 'draft-1';
        draftRow = {
          id,
          status: data.status,
          seed: data.seed,
          pool: data.pool,
          createdAt: new Date(),
          rerollsRemaining: data.rerollsRemaining ?? 1,
        };
        // Nested hero create — DraftService.create() writes the draft and
        // its first hero in a single statement, which is what makes "no
        // Draft row without a hero" an invariant rather than a convention.
        const nested = data.heroes?.create;
        if (nested) {
          for (const h of Array.isArray(nested) ? nested : [nested]) {
            heroRows.push({
              id: nextRowId++,
              draftId: id,
              heroId: h.heroId,
              assignedRole: null,
              pickOrder: h.pickOrder,
            });
          }
        }
        return withHeroes();
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        if (!draftRow || draftRow.id !== where.id) return null;
        return withHeroes();
      }),
      update: jest.fn(async ({ data }: any) => {
        Object.assign(draftRow!, data);
        return withHeroes();
      }),
    },
    draftHero: {
      create: jest.fn(async ({ data }: any) => {
        const row = {
          id: nextRowId++,
          draftId: data.draftId,
          heroId: data.heroId,
          assignedRole: null,
          pickOrder: data.pickOrder,
        };
        heroRows.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = heroRows.find(
          (h) => h.draftId === where.draftId_heroId.draftId && h.heroId === where.draftId_heroId.heroId,
        );
        Object.assign(row!, data);
        return row;
      }),
    },
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    battleResult: {
      create: jest.fn(async ({ data }: any) => data),
    },
  };
}

function makeService() {
  const prisma = makeFakePrisma();
  const heroService = makeFakeHeroService();
  const service = new DraftService(prisma as any, heroService as any);
  return { service, prisma, heroService };
}

// A draft only exists once its first pick lands (DraftService.create), so
// everything that used to call start() now needs a pick to get an id.
async function startDraft(service: DraftService, rerollUsed = false) {
  const { seed, pool } = await service.generatePool();
  return service.create(seed, pool[0].id, rerollUsed);
}

async function playToRoleAssignment(service: DraftService) {
  let draft = await startDraft(service);
  while (draft.status === 'PICKING') {
    draft = await service.pick(draft.id, draft.pool[0].id);
  }
  return draft;
}

async function playToCompleted(service: DraftService) {
  const draft = await playToRoleAssignment(service);
  const roles = ['Carry', 'Mid', 'Offlane', 'Soft Support', 'Hard Support'];
  return service.assignRoles(
    draft.id,
    draft.heroes.map((h, i) => ({ heroId: h.heroId, role: roles[i] })),
  );
}

describe('DraftService', () => {
  describe('generatePool() / create()', () => {
    it('generatePool() returns a 5-hero pool and a seed without touching the database', async () => {
      const { service, prisma } = makeService();
      const { seed, pool } = await service.generatePool();
      expect(pool).toHaveLength(5);
      expect(typeof seed).toBe('number');
      expect(prisma.draft.create).not.toHaveBeenCalled();
    });

    it('create() writes the draft and its first hero in one statement', async () => {
      const { service, prisma } = makeService();
      await startDraft(service);

      // The whole point of the change: there is no window, not even inside
      // a single request, where a Draft row exists with no heroes.
      expect(prisma.draft.create).toHaveBeenCalledTimes(1);
      const data = (prisma.draft.create as jest.Mock).mock.calls[0][0].data;
      expect(data.heroes.create).toMatchObject({ pickOrder: 1 });
      expect(prisma.draftHero.create).not.toHaveBeenCalled();
    });

    it('create() returns a PICKING draft holding the first pick and round 2s pool', async () => {
      const { service } = makeService();
      const { seed, pool } = await service.generatePool();
      const draft = await service.create(seed, pool[0].id, false);
      expect(draft.status).toBe('PICKING');
      expect(draft.pool).toHaveLength(5);
      expect(draft.heroes).toHaveLength(1);
      expect(draft.heroes[0]).toMatchObject({ heroId: pool[0].id, pickOrder: 1 });
    });

    it('create() rejects a hero that was not in the pool the seed produces', async () => {
      const { service } = makeService();
      const { seed, pool } = await service.generatePool();
      const outsideId = HERO_POOL.find((h) => !pool.some((p) => p.id === h.id))!.id;
      await expect(service.create(seed, outsideId, false)).rejects.toThrow('Hero is not in current pool');
    });

    it('create() carries a round-1 re-roll through as a spent allowance', async () => {
      const { service } = makeService();
      const draft = await startDraft(service, true);
      expect(draft.rerollsRemaining).toBe(0);
    });
  });

  it('getById() throws NotFoundException for an unknown draft', async () => {
    const { service } = makeService();
    await expect(service.getById('nonexistent')).rejects.toThrow('Draft not found');
  });

  describe('pick()', () => {
    it('throws NotFoundException for an unknown draft', async () => {
      const { service } = makeService();
      await expect(service.pick('nonexistent', 1)).rejects.toThrow('Draft not found');
    });

    it('rejects a hero not in the current pool', async () => {
      const { service } = makeService();
      const draft = await startDraft(service);
      const outsideId = HERO_POOL.find((h) => !draft.pool.some((p) => p.id === h.id))!.id;
      await expect(service.pick(draft.id, outsideId)).rejects.toThrow('Hero is not in current pool');
    });

    it('rejects picking once the draft has left the PICKING phase', async () => {
      const { service } = makeService();
      const draft = await playToRoleAssignment(service);
      await expect(service.pick(draft.id, draft.heroes[0].heroId)).rejects.toThrow(
        'Draft is not in picking phase',
      );
    });

    it('transitions to ASSIGNING_ROLES with an empty pool after the 5th pick', async () => {
      const { service } = makeService();
      const draft = await playToRoleAssignment(service);
      expect(draft.status).toBe('ASSIGNING_ROLES');
      expect(draft.pool).toHaveLength(0);
      expect(draft.heroes).toHaveLength(5);
    });

    it('excludes already-picked heroes from the next pool', async () => {
      const { service, heroService } = makeService();
      const draft = await startDraft(service);
      const firstPick = draft.heroes[0].heroId;

      const excludeArg = heroService.randomPool.mock.calls.at(-1)![0];
      expect(excludeArg).toContain(firstPick);
    });

    it('never repeats a hero from one round in the next round\'s pool', async () => {
      const { service } = makeService();
      const { seed, pool: round1 } = await service.generatePool();
      const round1Ids = round1.map((h) => h.id);

      let draft = await service.create(seed, round1[0].id, false);
      const round2Ids = draft.pool.map((h) => h.id);
      expect(round2Ids.some((id) => round1Ids.includes(id))).toBe(false);

      draft = await service.pick(draft.id, draft.pool[0].id);
      const round3Ids = draft.pool.map((h) => h.id);
      expect(round3Ids.some((id) => round2Ids.includes(id))).toBe(false);
    });

    // Asserted against the last call rather than a fixed index: create()
    // makes two randomPool calls (one to re-derive round 1 and validate the
    // pick, one for round 2), so positional indices would only be tracking
    // that implementation detail.
    it("derives each round's pool seed as draft.seed + pickOrder (the deterministic replay chain)", async () => {
      const { service, heroService } = makeService();
      const { seed, pool } = await service.generatePool();

      let draft = await service.create(seed, pool[0].id, false);
      expect(heroService.randomPool.mock.calls.at(-1)![2]).toBe(seed + 1);

      draft = await service.pick(draft.id, draft.pool[0].id);
      expect(heroService.randomPool.mock.calls.at(-1)![2]).toBe(seed + 2);

      draft = await service.pick(draft.id, draft.pool[0].id);
      expect(heroService.randomPool.mock.calls.at(-1)![2]).toBe(seed + 3);
    });
  });

  describe('reroll()', () => {
    it('throws NotFoundException for an unknown draft', async () => {
      const { service } = makeService();
      await expect(service.reroll('nonexistent')).rejects.toThrow('Draft not found');
    });

    it('starts with 1 reroll available', async () => {
      const { service } = makeService();
      const draft = await startDraft(service);
      expect(draft.rerollsRemaining).toBe(1);
    });

    it('replaces the current pool and decrements rerollsRemaining to 0', async () => {
      const { service } = makeService();
      const draft = await startDraft(service);
      const result = await service.reroll(draft.id);
      expect(result.rerollsRemaining).toBe(0);
      expect(result.pool).toHaveLength(5);
    });

    it('rejects a second reroll once the first is used', async () => {
      const { service } = makeService();
      const draft = await startDraft(service);
      await service.reroll(draft.id);
      await expect(service.reroll(draft.id)).rejects.toThrow('No rerolls remaining');
    });

    it('excludes already-picked heroes from the rerolled pool', async () => {
      const { service, heroService } = makeService();
      let draft = await startDraft(service);
      const firstPick = draft.pool[0].id;
      draft = await service.pick(draft.id, firstPick);

      await service.reroll(draft.id);
      const excludeArg = heroService.randomPool.mock.calls.at(-1)![0];
      expect(excludeArg).toContain(firstPick);
    });

    it('rejects rerolling outside the picking phase', async () => {
      const { service } = makeService();
      const draft = await playToRoleAssignment(service);
      await expect(service.reroll(draft.id)).rejects.toThrow('Draft is not in picking phase');
    });

    it('derives the new seed as Math.floor(Math.random() * 2**31), not some other formula', async () => {
      const { service, heroService } = makeService();
      const draft = await startDraft(service);
      const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.25);
      try {
        await service.reroll(draft.id);
      } finally {
        randomSpy.mockRestore();
      }
      const rerollSeed = heroService.randomPool.mock.calls.at(-1)![2];
      expect(rerollSeed).toBe(Math.floor(0.25 * 2 ** 31));
    });
  });

  describe('assignRoles()', () => {
    it('throws NotFoundException for an unknown draft', async () => {
      const { service } = makeService();
      await expect(service.assignRoles('nonexistent', [])).rejects.toThrow('Draft not found');
    });

    it('rejects assigning roles before all 5 heroes are picked', async () => {
      const { service } = makeService();
      const draft = await startDraft(service);
      await expect(service.assignRoles(draft.id, [])).rejects.toThrow(
        'Draft is not in role assignment phase',
      );
    });

    it('rejects a role assignment count other than 5', async () => {
      const { service } = makeService();
      const draft = await playToRoleAssignment(service);
      await expect(
        service.assignRoles(draft.id, [{ heroId: draft.heroes[0].heroId, role: 'Carry' }]),
      ).rejects.toThrow('Expected 5 role assignments');
    });

    it('rejects an invalid role name', async () => {
      const { service } = makeService();
      const draft = await playToRoleAssignment(service);
      const assignments = draft.heroes.map((h) => ({ heroId: h.heroId, role: 'Jungler' }));
      await expect(service.assignRoles(draft.id, assignments)).rejects.toThrow('Invalid role');
    });

    it('rejects a heroId that is not part of this draft', async () => {
      const { service } = makeService();
      const draft = await playToRoleAssignment(service);
      const foreignId = HERO_POOL.find((h) => !draft.heroes.some((dh) => dh.heroId === h.id))!.id;
      const assignments = [
        { heroId: foreignId, role: 'Carry' },
        ...draft.heroes.slice(1).map((h) => ({ heroId: h.heroId, role: 'Mid' })),
      ];
      await expect(service.assignRoles(draft.id, assignments)).rejects.toThrow('is not part of this draft');
    });

    it('rejects assigning two roles to the same hero (duplicate heroId)', async () => {
      const { service } = makeService();
      const draft = await playToRoleAssignment(service);
      const [first, ...restHeroes] = draft.heroes;
      const assignments = [
        { heroId: first.heroId, role: 'Carry' },
        { heroId: first.heroId, role: 'Mid' },
        ...restHeroes.slice(0, 3).map((h) => ({ heroId: h.heroId, role: 'Offlane' })),
      ];
      await expect(service.assignRoles(draft.id, assignments)).rejects.toThrow(
        'Each hero must receive exactly one role',
      );
    });

    it('completes the draft and persists each assigned role', async () => {
      const { service } = makeService();
      const draft = await playToCompleted(service);
      expect(draft.status).toBe('COMPLETED');
      const roles = draft.heroes.map((h) => h.assignedRole).sort();
      expect(roles).toEqual(['Carry', 'Hard Support', 'Mid', 'Offlane', 'Soft Support']);
    });

    it('rejects assigning the same role to two different heroes', async () => {
      const { service } = makeService();
      const draft = await playToRoleAssignment(service);
      const assignments = draft.heroes.map((h) => ({ heroId: h.heroId, role: 'Carry' }));
      await expect(service.assignRoles(draft.id, assignments)).rejects.toThrow(
        'Each role must be assigned to exactly one hero',
      );
    });
  });

  // getEvaluationScore/saveEvaluationResult back History's "most recent
  // evaluation" snapshot (Blueprint/10-tech-debt-backlog.md) — previously
  // untested entirely, unlike start/pick/reroll/assignRoles above.
  describe('getEvaluationScore() / saveEvaluationResult()', () => {
    it('returns null for a draft that does not exist', async () => {
      const { service } = makeService();
      expect(await service.getEvaluationScore('nonexistent')).toBeNull();
    });

    it('returns null for a draft that has never had an evaluation saved', async () => {
      const { service } = makeService();
      const draft = await startDraft(service);
      expect(await service.getEvaluationScore(draft.id)).toBeNull();
    });

    it('returns the saved totalScore after saveEvaluationResult()', async () => {
      const { service } = makeService();
      const draft = await startDraft(service);
      await service.saveEvaluationResult(draft.id, JSON.stringify({ totalScore: 7.5 }));
      expect(await service.getEvaluationScore(draft.id)).toBe(7.5);
    });

    it('overwrites the previous evaluation on a second save rather than versioning it', async () => {
      const { service } = makeService();
      const draft = await startDraft(service);
      await service.saveEvaluationResult(draft.id, JSON.stringify({ totalScore: 3 }));
      await service.saveEvaluationResult(draft.id, JSON.stringify({ totalScore: 8.2 }));
      expect(await service.getEvaluationScore(draft.id)).toBe(8.2);
    });
  });

  // saveBattleResult persists one row per Battle Mode fight for History's
  // expandable battle list — also previously untested entirely.
  describe('saveBattleResult()', () => {
    it('creates a battleResult row with the draftId and every field passed through, JSON-stringifying opponentHeroIds', async () => {
      const { service, prisma } = makeService();
      const draft = await startDraft(service);

      await service.saveBattleResult(draft.id, {
        resolvedOutcome: 'Win',
        advantageDirection: 'A',
        confidenceTier: 'High',
        opponentSource: 'pro',
        opponentTeamName: 'Team Secret',
        opponentLeagueName: 'The International',
        opponentHeroIds: [1, 2, 3, 4, 5],
      });

      expect(prisma.battleResult.create).toHaveBeenCalledWith({
        data: {
          draftId: draft.id,
          resolvedOutcome: 'Win',
          advantageDirection: 'A',
          confidenceTier: 'High',
          opponentSource: 'pro',
          opponentTeamName: 'Team Secret',
          opponentLeagueName: 'The International',
          opponentHeroIds: '[1,2,3,4,5]',
        },
      });
    });

    it('passes through null opponentTeamName/opponentLeagueName unchanged (player-sourced opponents)', async () => {
      const { service, prisma } = makeService();
      const draft = await startDraft(service);

      await service.saveBattleResult(draft.id, {
        resolvedOutcome: 'Lose',
        advantageDirection: 'B',
        confidenceTier: 'Low',
        opponentSource: 'player',
        opponentTeamName: null,
        opponentLeagueName: null,
        opponentHeroIds: [6, 7, 8, 9, 10],
      });

      const call = (prisma.battleResult.create as jest.Mock).mock.calls[0][0];
      expect(call.data.opponentTeamName).toBeNull();
      expect(call.data.opponentLeagueName).toBeNull();
    });
  });

  // getBestRuns backs the "Best Runs" half of the two-part leaderboard —
  // aggregates a draftId's BattleResult rows (player-perspective outcomes)
  // into wins/losses, gates by minFights, ranks wins-first then win rate.
  // A purpose-built fake prisma (the shared one has no battleResult.groupBy).
  describe('getBestRuns()', () => {
    // grouped rows as prisma.battleResult.groupBy(by: [draftId, resolvedOutcome])
    // would return them.
    function makeRunService(
      groups: { draftId: string; resolvedOutcome: string; count: number }[],
      draftHeroes: Record<string, { heroId: number; assignedRole: string | null; pickOrder: number }[]> = {},
      evalByDraft: Record<string, string | null> = {},
    ) {
      const prisma = {
        battleResult: {
          groupBy: jest.fn(async () =>
            groups.map((g) => ({
              draftId: g.draftId,
              resolvedOutcome: g.resolvedOutcome,
              _count: { _all: g.count },
            })),
          ),
        },
        draft: {
          findMany: jest.fn(async ({ where }: any) => {
            const ids: string[] = where.id.in;
            return ids.map((id) => ({
              id,
              evaluationResult: evalByDraft[id] ?? null,
              heroes: draftHeroes[id] ?? [],
            }));
          }),
        },
      };
      const service = new DraftService(prisma as any, {} as any);
      return { service, prisma };
    }

    it('tallies wins/losses per draft and ranks wins-first, then win rate', async () => {
      const { service } = makeRunService([
        { draftId: 'a', resolvedOutcome: 'Win', count: 6 },
        { draftId: 'a', resolvedOutcome: 'Lose', count: 1 },
        { draftId: 'b', resolvedOutcome: 'Win', count: 2 },
        { draftId: 'b', resolvedOutcome: 'Lose', count: 3 },
        { draftId: 'c', resolvedOutcome: 'Win', count: 2 },
        { draftId: 'c', resolvedOutcome: 'Lose', count: 4 },
      ]);
      const runs = await service.getBestRuns(10, 5);
      expect(runs.map((r) => `${r.draftId}:${r.wins}-${r.losses}`)).toEqual(['a:6-1', 'b:2-3', 'c:2-4']);
      // b before c: equal 2 wins, b's win rate (0.4) beats c's (0.33).
      expect(runs[1].winRate).toBeCloseTo(0.4);
    });

    it('excludes runs below minFights', async () => {
      const { service } = makeRunService([
        { draftId: 'short', resolvedOutcome: 'Win', count: 4 },
        { draftId: 'long', resolvedOutcome: 'Win', count: 3 },
        { draftId: 'long', resolvedOutcome: 'Lose', count: 2 },
      ]);
      const runs = await service.getBestRuns(10, 5);
      expect(runs.map((r) => r.draftId)).toEqual(['long']);
    });

    it('honors the limit after ranking', async () => {
      const groups = ['a', 'b', 'c'].flatMap((d, i) => [
        { draftId: d, resolvedOutcome: 'Win', count: 5 + i },
        { draftId: d, resolvedOutcome: 'Lose', count: 1 },
      ]);
      const { service } = makeRunService(groups);
      const runs = await service.getBestRuns(2, 5);
      expect(runs).toHaveLength(2);
      expect(runs[0].draftId).toBe('c'); // 7 wins, highest
    });

    it('surfaces heroes in pickOrder, roles, and the parsed evaluation score', async () => {
      const { service } = makeRunService(
        [
          { draftId: 'a', resolvedOutcome: 'Win', count: 3 },
          { draftId: 'a', resolvedOutcome: 'Lose', count: 2 },
        ],
        {
          a: [
            { heroId: 20, assignedRole: 'Mid', pickOrder: 2 },
            { heroId: 10, assignedRole: 'Carry', pickOrder: 1 },
          ],
        },
        { a: JSON.stringify({ totalScore: 7.5 }) },
      );
      const [run] = await service.getBestRuns(10, 5);
      expect(run.heroIds).toEqual([10, 20]); // sorted by pickOrder
      expect(run.heroRoles).toEqual([
        { heroId: 10, role: 'Carry' },
        { heroId: 20, role: 'Mid' },
      ]);
      expect(run.evaluationScore).toBe(7.5);
    });

    it('returns a null score for an unparseable/absent evaluationResult and null roles when any is missing', async () => {
      const { service } = makeRunService(
        [
          { draftId: 'a', resolvedOutcome: 'Win', count: 5 },
        ],
        { a: [{ heroId: 10, assignedRole: null, pickOrder: 1 }] },
        { a: null },
      );
      const [run] = await service.getBestRuns(10, 5);
      expect(run.evaluationScore).toBeNull();
      expect(run.heroRoles).toBeNull();
    });

    it('returns an empty array when nothing clears minFights (no draft fetch)', async () => {
      const { service, prisma } = makeRunService([{ draftId: 'a', resolvedOutcome: 'Win', count: 1 }]);
      expect(await service.getBestRuns(10, 5)).toEqual([]);
      expect(prisma.draft.findMany).not.toHaveBeenCalled();
    });
  });
});
