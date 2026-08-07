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
        draftRow = {
          id: 'draft-1',
          status: data.status,
          seed: data.seed,
          pool: data.pool,
          createdAt: new Date(),
          rerollsRemaining: data.rerollsRemaining ?? 1,
        };
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

async function playToRoleAssignment(service: DraftService) {
  let draft = await service.start();
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
  it('start() creates a draft in PICKING status with a 5-hero pool', async () => {
    const { service } = makeService();
    const draft = await service.start();
    expect(draft.status).toBe('PICKING');
    expect(draft.pool).toHaveLength(5);
    expect(draft.heroes).toHaveLength(0);
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
      const draft = await service.start();
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
      let draft = await service.start();
      const firstPick = draft.pool[0].id;
      draft = await service.pick(draft.id, firstPick);

      const excludeArg = heroService.randomPool.mock.calls[1][0];
      expect(excludeArg).toContain(firstPick);
    });

    it("derives each round's pool seed as draft.seed + pickOrder (the deterministic replay chain)", async () => {
      const { service, heroService } = makeService();
      let draft = await service.start();
      const startSeed = heroService.randomPool.mock.calls[0][2];

      draft = await service.pick(draft.id, draft.pool[0].id);
      expect(heroService.randomPool.mock.calls[1][2]).toBe(startSeed + 1);

      draft = await service.pick(draft.id, draft.pool[0].id);
      expect(heroService.randomPool.mock.calls[2][2]).toBe(startSeed + 2);
    });
  });

  describe('reroll()', () => {
    it('throws NotFoundException for an unknown draft', async () => {
      const { service } = makeService();
      await expect(service.reroll('nonexistent')).rejects.toThrow('Draft not found');
    });

    it('starts with 1 reroll available', async () => {
      const { service } = makeService();
      const draft = await service.start();
      expect(draft.rerollsRemaining).toBe(1);
    });

    it('replaces the current pool and decrements rerollsRemaining to 0', async () => {
      const { service } = makeService();
      const draft = await service.start();
      const result = await service.reroll(draft.id);
      expect(result.rerollsRemaining).toBe(0);
      expect(result.pool).toHaveLength(5);
    });

    it('rejects a second reroll once the first is used', async () => {
      const { service } = makeService();
      const draft = await service.start();
      await service.reroll(draft.id);
      await expect(service.reroll(draft.id)).rejects.toThrow('No rerolls remaining');
    });

    it('excludes already-picked heroes from the rerolled pool', async () => {
      const { service, heroService } = makeService();
      let draft = await service.start();
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
      const draft = await service.start();
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
      const draft = await service.start();
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
      const draft = await service.start();
      expect(await service.getEvaluationScore(draft.id)).toBeNull();
    });

    it('returns the saved totalScore after saveEvaluationResult()', async () => {
      const { service } = makeService();
      const draft = await service.start();
      await service.saveEvaluationResult(draft.id, JSON.stringify({ totalScore: 7.5 }));
      expect(await service.getEvaluationScore(draft.id)).toBe(7.5);
    });

    it('overwrites the previous evaluation on a second save rather than versioning it', async () => {
      const { service } = makeService();
      const draft = await service.start();
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
      const draft = await service.start();

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
      const draft = await service.start();

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
});
