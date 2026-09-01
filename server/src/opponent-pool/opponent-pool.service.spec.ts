import { OpponentPoolService } from './opponent-pool.service';
import { PoolPrismaService } from './pool-prisma.service';

function makeMockPool() {
  return {
    pooledDraft: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
    },
  };
}

function makeMockDraftService(
  draft: { status: string; mode?: string; heroes: { heroId: number; assignedRole?: string }[] },
  evaluationScore: number | null = null,
) {
  return {
    getById: jest.fn().mockResolvedValue({ mode: 'battle', ...draft }),
    getEvaluationScore: jest.fn().mockResolvedValue(evaluationScore),
  };
}

describe('OpponentPoolService.commit', () => {
  it('rejects a draft that is not COMPLETED', async () => {
    const pool = makeMockPool();
    const draftService = makeMockDraftService({ status: 'PICKING', heroes: [] });
    const service = new OpponentPoolService(pool as any, draftService as any);

    await expect(service.commit('draft-1', 'token')).rejects.toThrow(
      'Draft must be completed before it can be committed to the pool',
    );
    expect(pool.pooledDraft.create).not.toHaveBeenCalled();
  });

  it('commits the heroIds and assigned roles from a completed draft under source "player"', async () => {
    const pool = makeMockPool();
    const heroes = [
      { heroId: 1, assignedRole: 'Carry' },
      { heroId: 2, assignedRole: 'Mid' },
      { heroId: 3, assignedRole: 'Offlane' },
      { heroId: 4, assignedRole: 'Soft Support' },
      { heroId: 5, assignedRole: 'Hard Support' },
    ];
    const draftService = makeMockDraftService({ status: 'COMPLETED', heroes }, null);
    pool.pooledDraft.create.mockResolvedValue({ id: 'pool-1', createdAt: new Date('2026-01-01T00:00:00Z') });
    const service = new OpponentPoolService(pool as any, draftService as any);

    const result = await service.commit('draft-1', 'my-token');

    expect(pool.pooledDraft.create).toHaveBeenCalledWith({
      data: {
        source: 'player',
        submitterToken: 'my-token',
        sourceDraftId: 'draft-1',
        heroIds: [1, 2, 3, 4, 5],
        heroRoles: [
          { heroId: 1, role: 'Carry' },
          { heroId: 2, role: 'Mid' },
          { heroId: 3, role: 'Offlane' },
          { heroId: 4, role: 'Soft Support' },
          { heroId: 5, role: 'Hard Support' },
        ],
        evaluationScore: null,
      },
    });
    expect(result).toEqual({ id: 'pool-1', committedAt: '2026-01-01T00:00:00.000Z' });
  });

  it('snapshots the evaluation score when the draft was already evaluated', async () => {
    const pool = makeMockPool();
    const heroes = [
      { heroId: 1, assignedRole: 'Carry' },
      { heroId: 2, assignedRole: 'Mid' },
      { heroId: 3, assignedRole: 'Offlane' },
      { heroId: 4, assignedRole: 'Soft Support' },
      { heroId: 5, assignedRole: 'Hard Support' },
    ];
    const draftService = makeMockDraftService({ status: 'COMPLETED', heroes }, 7.2);
    pool.pooledDraft.create.mockResolvedValue({ id: 'pool-1', createdAt: new Date('2026-01-01T00:00:00Z') });
    const service = new OpponentPoolService(pool as any, draftService as any);

    await service.commit('draft-1', 'my-token');

    expect(pool.pooledDraft.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ evaluationScore: 7.2 }) }),
    );
  });

  it('returns the existing pool row instead of inserting a duplicate on retry', async () => {
    const pool = makeMockPool();
    const heroes = [
      { heroId: 1, assignedRole: 'Carry' },
      { heroId: 2, assignedRole: 'Mid' },
      { heroId: 3, assignedRole: 'Offlane' },
      { heroId: 4, assignedRole: 'Soft Support' },
      { heroId: 5, assignedRole: 'Hard Support' },
    ];
    const draftService = makeMockDraftService({ status: 'COMPLETED', heroes }, null);
    pool.pooledDraft.findUnique.mockResolvedValue({
      id: 'pool-existing',
      createdAt: new Date('2026-01-02T00:00:00Z'),
    });
    const service = new OpponentPoolService(pool as any, draftService as any);

    const result = await service.commit('draft-1', 'my-token');

    expect(pool.pooledDraft.create).not.toHaveBeenCalled();
    expect(result).toEqual({ id: 'pool-existing', committedAt: '2026-01-02T00:00:00.000Z' });
  });

  it('rejects a non-battle draft', async () => {
    const pool = makeMockPool();
    const draftService = makeMockDraftService({
      status: 'COMPLETED',
      mode: 'captains',
      heroes: [
        { heroId: 1, assignedRole: 'Carry' },
        { heroId: 2, assignedRole: 'Mid' },
        { heroId: 3, assignedRole: 'Offlane' },
        { heroId: 4, assignedRole: 'Soft Support' },
        { heroId: 5, assignedRole: 'Hard Support' },
      ],
    });
    const service = new OpponentPoolService(pool as any, draftService as any);
    await expect(service.commit('draft-1', 'token')).rejects.toThrow(
      'Only Battle Mode drafts can be committed to the pool',
    );
    expect(pool.pooledDraft.create).not.toHaveBeenCalled();
  });

  it('reports storage as unreachable rather than a raw Prisma error when POOL_DATABASE_URL is unset', async () => {
    const pool = makeMockPool();
    const draftService = makeMockDraftService({ status: 'COMPLETED', heroes: [] });
    pool.pooledDraft.create.mockRejectedValue(
      new Error(
        'Error validating datasource `db`: environment variable `POOL_DATABASE_URL` resolved to an empty string',
      ),
    );
    const service = new OpponentPoolService(pool as any, draftService as any);

    await expect(service.commit('draft-1', 'token')).rejects.toThrow(
      'POOL_DATABASE_URL may not be configured',
    );
  });
});

describe('OpponentPoolService.pullRandom', () => {
  it('throws NotFoundException when the pool is entirely empty', async () => {
    const pool = makeMockPool();
    pool.pooledDraft.findMany.mockResolvedValue([]);
    const service = new OpponentPoolService(pool as any, {} as any);

    await expect(service.pullRandom('token')).rejects.toThrow('Opponent Pool is empty');
  });

  it('falls back to the unrestricted pool when excluding the caller leaves nothing', async () => {
    const pool = makeMockPool();
    pool.pooledDraft.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 'p1', source: 'player', heroIds: [1, 2, 3, 4, 5], teamName: null, leagueName: null },
      ]);
    const service = new OpponentPoolService(pool as any, {} as any);

    const result = await service.pullRandom('token');

    expect(pool.pooledDraft.findMany).toHaveBeenLastCalledWith({ where: {} });
    expect(result.id).toBe('p1');
  });

  it('queries with an OR-null exclusion clause, not a bare NOT (regression: NOT alone silently excludes NULL rows in SQL)', async () => {
    const pool = makeMockPool();
    pool.pooledDraft.findMany.mockResolvedValue([
      { id: 'p1', source: 'pro', heroIds: [1, 2, 3, 4, 5], teamName: 'Team A', leagueName: null },
    ]);
    const service = new OpponentPoolService(pool as any, {} as any);

    await service.pullRandom('my-token');

    const whereArg = pool.pooledDraft.findMany.mock.calls[0][0].where;
    expect(whereArg).toEqual({
      OR: [{ submitterToken: null }, { NOT: { submitterToken: 'my-token' } }],
    });
  });

  it('excludes any pool row that shares even one hero with the caller-supplied draft', async () => {
    const pool = makeMockPool();
    pool.pooledDraft.findMany.mockResolvedValue([
      { id: 'overlap', source: 'pro', heroIds: [1, 6, 7, 8, 9], teamName: null, leagueName: null },
      { id: 'clean', source: 'pro', heroIds: [10, 11, 12, 13, 14], teamName: null, leagueName: null },
    ]);
    const service = new OpponentPoolService(pool as any, {} as any);

    for (let i = 0; i < 10; i++) {
      const result = await service.pullRandom(undefined, [1, 2, 3, 4, 5]);
      expect(result.id).toBe('clean');
    }
  });

  it('falls back to allowing overlap when excluding it would leave nothing to pull from', async () => {
    const pool = makeMockPool();
    pool.pooledDraft.findMany.mockResolvedValue([
      { id: 'only-row', source: 'pro', heroIds: [1, 2, 3, 4, 5], teamName: null, leagueName: null },
    ]);
    const service = new OpponentPoolService(pool as any, {} as any);

    const result = await service.pullRandom(undefined, [1, 2, 3, 4, 5]);

    expect(result.id).toBe('only-row');
  });

  it('does not filter by hero overlap when excludeHeroIds is omitted', async () => {
    const pool = makeMockPool();
    pool.pooledDraft.findMany.mockResolvedValue([
      { id: 'p1', source: 'pro', heroIds: [1, 2, 3, 4, 5], teamName: null, leagueName: null },
    ]);
    const service = new OpponentPoolService(pool as any, {} as any);

    const result = await service.pullRandom();

    expect(result.id).toBe('p1');
  });

  it('hard-excludes an opponent already faced this run, matched by hero SET (order-independent)', async () => {
    const pool = makeMockPool();
    pool.pooledDraft.findMany.mockResolvedValue([
      { id: 'faced', source: 'pro', heroIds: [1, 2, 3, 4, 5], teamName: null, leagueName: null },
      { id: 'fresh', source: 'pro', heroIds: [10, 11, 12, 13, 14], teamName: null, leagueName: null },
    ]);
    const service = new OpponentPoolService(pool as any, {} as any);

    // Faced set given in a DIFFERENT order than the pool row stores it.
    for (let i = 0; i < 10; i++) {
      const result = await service.pullRandom(undefined, [], [[5, 4, 3, 2, 1]]);
      expect(result.id).toBe('fresh');
    }
  });

  it('throws (hard constraint, no fallback) when every available opponent has already been faced this run', async () => {
    const pool = makeMockPool();
    pool.pooledDraft.findMany.mockResolvedValue([
      { id: 'only', source: 'pro', heroIds: [1, 2, 3, 4, 5], teamName: null, leagueName: null },
    ]);
    const service = new OpponentPoolService(pool as any, {} as any);

    await expect(service.pullRandom(undefined, [], [[1, 2, 3, 4, 5]])).rejects.toThrow(
      'No new opponents left in the pool for this run',
    );
  });

  it('restricts a TI run to International league rows and fails closed if none exist', async () => {
    const pool = makeMockPool();
    pool.pooledDraft.findMany.mockResolvedValue([
      { id: 'pub', source: 'player', heroIds: [1, 2, 3, 4, 5], teamName: null, leagueName: null },
      {
        id: 'ti',
        source: 'pro',
        heroIds: [10, 11, 12, 13, 14],
        teamName: 'Team Spirit',
        leagueName: 'The International 2025',
      },
    ]);
    const service = new OpponentPoolService(pool as any, {} as any);

    for (let i = 0; i < 8; i++) {
      const result = await service.pullRandom(undefined, [], [], 'International');
      expect(result.id).toBe('ti');
    }

    pool.pooledDraft.findMany.mockResolvedValue([
      { id: 'pub', source: 'player', heroIds: [1, 2, 3, 4, 5], teamName: null, leagueName: 'DreamLeague' },
    ]);
    await expect(service.pullRandom(undefined, [], [], 'International')).rejects.toThrow(
      'No matching league drafts in the opponent pool',
    );
  });
});

describe('OpponentPoolService.recordDraftOutcome', () => {
  it('increments wins on the given PooledDraft row', async () => {
    const pool = makeMockPool();
    const service = new OpponentPoolService(pool as any, {} as any);

    await service.recordDraftOutcome('draft-1', 'Win');

    expect(pool.pooledDraft.update).toHaveBeenCalledWith({
      where: { id: 'draft-1' },
      data: { wins: { increment: 1 } },
    });
  });

  it('increments losses', async () => {
    const pool = makeMockPool();
    const service = new OpponentPoolService(pool as any, {} as any);

    await service.recordDraftOutcome('draft-1', 'Lose');

    expect(pool.pooledDraft.update).toHaveBeenCalledWith({
      where: { id: 'draft-1' },
      data: { losses: { increment: 1 } },
    });
  });
});

describe('OpponentPoolService.getLeaderboard', () => {
  function makeRow(overrides: Partial<Record<string, unknown>>) {
    return {
      id: 'row',
      source: 'player',
      heroIds: [1, 2, 3, 4, 5],
      heroRoles: null,
      teamName: null,
      leagueName: null,
      evaluationScore: null,
      submitterToken: null,
      wins: 0,
      losses: 0,
      ...overrides,
    };
  }

  it('only includes drafts that have actually been fought (wins+losses > 0)', async () => {
    const pool = makeMockPool();
    pool.pooledDraft.findMany.mockResolvedValue([makeRow({ id: 'fought', wins: 1, losses: 0 })]);
    const service = new OpponentPoolService(pool as any, {} as any);

    await service.getLeaderboard(10);

    expect(pool.pooledDraft.findMany).toHaveBeenCalledWith({
      where: { OR: [{ wins: { gt: 0 } }, { losses: { gt: 0 } }] },
    });
  });

  it('ranks by wins first, win rate as a tiebreaker among equal win counts', async () => {
    const pool = makeMockPool();
    pool.pooledDraft.findMany.mockResolvedValue([
      makeRow({ id: 'low-wins', wins: 2, losses: 0 }),
      makeRow({ id: 'high-wins-low-rate', wins: 5, losses: 15 }),
      makeRow({ id: 'high-wins-high-rate', wins: 5, losses: 1 }),
    ]);
    const service = new OpponentPoolService(pool as any, {} as any);

    const result = await service.getLeaderboard(10);

    expect(result.map((r) => r.id)).toEqual(['high-wins-high-rate', 'high-wins-low-rate', 'low-wins']);
    expect(result[0].winRate).toBeCloseTo(5 / 6);
  });

  it('truncates to the requested limit after ranking', async () => {
    const pool = makeMockPool();
    pool.pooledDraft.findMany.mockResolvedValue([
      makeRow({ id: 'a', wins: 3, losses: 0 }),
      makeRow({ id: 'b', wins: 2, losses: 0 }),
      makeRow({ id: 'c', wins: 1, losses: 0 }),
    ]);
    const service = new OpponentPoolService(pool as any, {} as any);

    const result = await service.getLeaderboard(2);

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('carries the evaluationScore snapshot through unchanged', async () => {
    const pool = makeMockPool();
    pool.pooledDraft.findMany.mockResolvedValue([makeRow({ id: 'a', wins: 1, evaluationScore: 6.4 })]);
    const service = new OpponentPoolService(pool as any, {} as any);

    const result = await service.getLeaderboard(10);

    expect(result[0].evaluationScore).toBe(6.4);
  });

  it('sets isMine from the caller token and never returns submitterToken', async () => {
    const pool = makeMockPool();
    pool.pooledDraft.findMany.mockResolvedValue([
      makeRow({ id: 'mine', wins: 1, submitterToken: 'owner-a' }),
      makeRow({ id: 'theirs', wins: 1, submitterToken: 'owner-b' }),
    ]);
    const service = new OpponentPoolService(pool as any, {} as any);

    const result = await service.getLeaderboard(10, 'owner-a');

    expect(result.map((r) => ({ id: r.id, isMine: r.isMine }))).toEqual([
      { id: 'mine', isMine: true },
      { id: 'theirs', isMine: false },
    ]);
    expect(result.every((r) => !('submitterToken' in r))).toBe(true);
  });
});

describe('OpponentPoolService.pullForTeam', () => {
  it('falls back to local ProMatch drafts when the league pool has no rows for the team', async () => {
    const pool = makeMockPool();
    pool.pooledDraft.findMany.mockResolvedValue([]);
    const prisma = {
      proMatch: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: '7395420827',
            radiantName: 'Entity',
            direName: 'Virtus.pro',
            leagueName: 'The International 2023',
            radiantHeroIds: '[1,2,3,4,5]',
            direHeroIds: '[6,7,8,9,10]',
            radiantHeroRoles: null,
            direHeroRoles: null,
          },
        ]),
      },
    };
    const service = new OpponentPoolService(pool as any, {} as any, prisma as any);

    const result = await service.pullForTeam('Entity', 'The International 2022', {}, []);

    expect(result.teamName).toBe('Entity');
    expect(result.heroIds).toEqual([1, 2, 3, 4, 5]);
    expect(result.id).toBe('pro-7395420827');
  });
});

// Live regression test for the actual bug: `NOT: { submitterToken: token }`
// alone excludes every row where submitterToken IS NULL under SQL's
// three-valued logic, silently dropping the entire pro tier. A mocked
// Prisma client can't catch this — it just records what filter object was
// passed, not how Postgres evaluates it. Runs against the real pool
// Postgres and is skipped (not failed) when POOL_DATABASE_URL isn't
// configured, consistent with how the app itself treats that dependency as
// optional.
const hasPoolDb = !!process.env.POOL_DATABASE_URL;
(hasPoolDb ? describe : describe.skip)('OpponentPoolService.pullRandom (live Postgres regression)', () => {
  jest.setTimeout(20_000);

  const pool = new PoolPrismaService();
  const testIds = ['test-regression-own', 'test-regression-pro-1', 'test-regression-pro-2'];

  beforeAll(async () => {
    await pool.pooledDraft.create({
      data: {
        id: testIds[0],
        source: 'player',
        submitterToken: 'test-regression-token',
        heroIds: [1, 2, 3, 4, 5],
      },
    });
    await pool.pooledDraft.create({
      data: { id: testIds[1], source: 'pro', submitterToken: null, heroIds: [6, 7, 8, 9, 10] },
    });
    await pool.pooledDraft.create({
      data: { id: testIds[2], source: 'pro', submitterToken: null, heroIds: [11, 12, 13, 14, 15] },
    });
  });

  afterAll(async () => {
    await pool.pooledDraft.deleteMany({ where: { id: { in: testIds } } });
    await pool.$disconnect();
  });

  it('never draws the excluded token across repeated pulls', async () => {
    const service = new OpponentPoolService(pool, {} as any);

    for (let i = 0; i < 10; i++) {
      const result = await service.pullRandom('test-regression-token');
      expect(result.id).not.toBe(testIds[0]);
    }
  });

  // The core of the actual bug, tested directly and deterministically rather
  // than by hoping a random draw happens to surface a pro row (which is
  // flaky against a shared pool that also has real seeded data — a miss is
  // just bad luck, not a regression). Compares the buggy bare-NOT filter
  // against the OR-null filter the service actually uses.
  it('a bare NOT filter silently drops null-submitterToken rows that the OR-null filter correctly keeps', async () => {
    const buggyNaiveFilter = { NOT: { submitterToken: 'test-regression-token' } };
    const correctFilter = {
      OR: [{ submitterToken: null }, { NOT: { submitterToken: 'test-regression-token' } }],
    };

    const buggyCount = await pool.pooledDraft.count({ where: buggyNaiveFilter });
    const correctCount = await pool.pooledDraft.count({ where: correctFilter });

    expect(correctCount - buggyCount).toBeGreaterThanOrEqual(2); // at least our 2 seeded pro rows
  });
});
