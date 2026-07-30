import { OpponentPoolService } from './opponent-pool.service';
import { PoolPrismaService } from './pool-prisma.service';

function makeMockPool() {
  return {
    pooledDraft: {
      create: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
    },
    leaderboardEntry: {
      upsert: jest.fn(),
      findMany: jest.fn(),
    },
  };
}

function makeMockDraftService(draft: { status: string; heroes: { heroId: number; assignedRole?: string }[] }) {
  return { getById: jest.fn().mockResolvedValue(draft) };
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
    const draftService = makeMockDraftService({ status: 'COMPLETED', heroes });
    pool.pooledDraft.create.mockResolvedValue({ id: 'pool-1', createdAt: new Date('2026-01-01T00:00:00Z') });
    const service = new OpponentPoolService(pool as any, draftService as any);

    const result = await service.commit('draft-1', 'my-token');

    expect(pool.pooledDraft.create).toHaveBeenCalledWith({
      data: {
        source: 'player',
        submitterToken: 'my-token',
        heroIds: [1, 2, 3, 4, 5],
        heroRoles: [
          { heroId: 1, role: 'Carry' },
          { heroId: 2, role: 'Mid' },
          { heroId: 3, role: 'Offlane' },
          { heroId: 4, role: 'Soft Support' },
          { heroId: 5, role: 'Hard Support' },
        ],
      },
    });
    expect(result).toEqual({ id: 'pool-1', committedAt: '2026-01-01T00:00:00.000Z' });
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
    pool.pooledDraft.count.mockResolvedValue(0);
    const service = new OpponentPoolService(pool as any, {} as any);

    await expect(service.pullRandom('token')).rejects.toThrow('Opponent Pool is empty');
  });

  it('falls back to the unrestricted pool when excluding the caller leaves nothing', async () => {
    const pool = makeMockPool();
    pool.pooledDraft.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    pool.pooledDraft.findMany.mockResolvedValue([
      { id: 'p1', source: 'player', heroIds: [1, 2, 3, 4, 5], teamName: null, leagueName: null },
    ]);
    const service = new OpponentPoolService(pool as any, {} as any);

    const result = await service.pullRandom('token');

    expect(pool.pooledDraft.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
    expect(result.id).toBe('p1');
  });

  it('queries with an OR-null exclusion clause, not a bare NOT (regression: NOT alone silently excludes NULL rows in SQL)', async () => {
    const pool = makeMockPool();
    pool.pooledDraft.count.mockResolvedValue(5);
    pool.pooledDraft.findMany.mockResolvedValue([
      { id: 'p1', source: 'pro', heroIds: [1, 2, 3, 4, 5], teamName: 'Team A', leagueName: null },
    ]);
    const service = new OpponentPoolService(pool as any, {} as any);

    await service.pullRandom('my-token');

    const whereArg = pool.pooledDraft.count.mock.calls[0][0].where;
    expect(whereArg).toEqual({
      OR: [{ submitterToken: null }, { NOT: { submitterToken: 'my-token' } }],
    });
  });
});

describe('OpponentPoolService.recordBattleOutcome', () => {
  it('upserts a win, creating the row if the token has never fought before', async () => {
    const pool = makeMockPool();
    const service = new OpponentPoolService(pool as any, {} as any);

    await service.recordBattleOutcome('token-1', 'Win');

    expect(pool.leaderboardEntry.upsert).toHaveBeenCalledWith({
      where: { submitterToken: 'token-1' },
      create: { submitterToken: 'token-1', wins: 1, losses: 0 },
      update: { wins: { increment: 1 } },
    });
  });

  it('upserts a loss', async () => {
    const pool = makeMockPool();
    const service = new OpponentPoolService(pool as any, {} as any);

    await service.recordBattleOutcome('token-1', 'Lose');

    expect(pool.leaderboardEntry.upsert).toHaveBeenCalledWith({
      where: { submitterToken: 'token-1' },
      create: { submitterToken: 'token-1', wins: 0, losses: 1 },
      update: { losses: { increment: 1 } },
    });
  });
});

describe('OpponentPoolService.getLeaderboard', () => {
  it('ranks by wins first, win rate as a tiebreaker among equal win counts', async () => {
    const pool = makeMockPool();
    pool.leaderboardEntry.findMany.mockResolvedValue([
      { submitterToken: 'low-wins', wins: 2, losses: 0 },
      { submitterToken: 'high-wins-low-rate', wins: 5, losses: 15 },
      { submitterToken: 'high-wins-high-rate', wins: 5, losses: 1 },
    ]);
    const service = new OpponentPoolService(pool as any, {} as any);

    const result = await service.getLeaderboard(10);

    expect(result.map((r) => r.submitterToken)).toEqual(['high-wins-high-rate', 'high-wins-low-rate', 'low-wins']);
    expect(result[0].winRate).toBeCloseTo(5 / 6);
  });

  it('truncates to the requested limit after ranking', async () => {
    const pool = makeMockPool();
    pool.leaderboardEntry.findMany.mockResolvedValue([
      { submitterToken: 'a', wins: 3, losses: 0 },
      { submitterToken: 'b', wins: 2, losses: 0 },
      { submitterToken: 'c', wins: 1, losses: 0 },
    ]);
    const service = new OpponentPoolService(pool as any, {} as any);

    const result = await service.getLeaderboard(2);

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.submitterToken)).toEqual(['a', 'b']);
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
