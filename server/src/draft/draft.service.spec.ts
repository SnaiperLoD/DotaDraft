import { DraftService } from './draft.service';
import { makeHero } from '../test-utils/hero-factory';
import type { Hero } from 'shared';

const HERO_POOL: Hero[] = Array.from({ length: 10 }, (_, i) => makeHero({ id: i + 1, name: `Hero${i + 1}` }));

function makeFakeHeroService() {
  return {
    randomPool: jest.fn(async (excludeIds: number[], size: number) =>
      HERO_POOL.filter((h) => !excludeIds.includes(h.id)).slice(0, size),
    ),
    findByIds: jest.fn(async (ids: number[]) => HERO_POOL.filter((h) => ids.includes(h.id))),
  };
}

function makeFakePrisma() {
  let draftRow: { id: string; status: string; seed: number; pool: string; createdAt: Date } | null = null;
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
  });

  describe('assignRoles()', () => {
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

    // Characterizes a known gap (Blueprint/10-tech-debt-backlog.md, "Нет
    // защиты от назначения одной роли двум героям"): the same *role* can be
    // assigned to two different heroes as long as heroIds themselves are
    // unique. This documents current behavior, not desired behavior — flip
    // this test when that backlog item is fixed.
    it('currently allows the same role on two different heroes (documented tech debt)', async () => {
      const { service } = makeService();
      const draft = await playToRoleAssignment(service);
      const assignments = draft.heroes.map((h) => ({ heroId: h.heroId, role: 'Carry' }));
      const result = await service.assignRoles(draft.id, assignments);
      expect(result.status).toBe('COMPLETED');
      expect(result.heroes.every((h) => h.assignedRole === 'Carry')).toBe(true);
    });
  });
});
