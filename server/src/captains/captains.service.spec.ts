import { BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { CM_RESERVE_MS, CM_STEPS } from 'shared';
import { makeHero } from '../test-utils/hero-factory';
import { CaptainsService } from './captains.service';

const OWNER = 'cm-owner';
const ROSTER = Array.from({ length: 30 }, (_, i) =>
  makeHero({
    id: i + 1,
    name: `Hero${i + 1}`,
    presumed_positions: [{ position: i % 2 === 0 ? 'Carry' : 'Support', share: 0.8 }],
    evaluation_values: {
      ...makeHero({ id: 99, name: 'x' }).evaluation_values,
      teamfight: 9 - i * 0.2,
    },
  }),
);

function emptyActions(): string {
  return JSON.stringify(CM_STEPS.map((step) => ({ type: step.type, lane: step.lane, heroId: null })));
}

function makePrisma(row: Record<string, unknown>) {
  const store = { row: { ...row } as any };
  return {
    store,
    captainsSession: {
      create: jest.fn(async ({ data }: any) => {
        store.row = {
          id: 'cm-1',
          createdAt: new Date(),
          draftId: null,
          aiDraftId: null,
          ...data,
        };
        return store.row;
      }),
      findUnique: jest.fn(async ({ where }: any) => (store.row?.id === where.id ? store.row : null)),
      update: jest.fn(async ({ data }: any) => {
        Object.assign(store.row, data);
        return store.row;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        if (where.stepIndex != null && store.row.stepIndex !== where.stepIndex) return { count: 0 };
        if (where.status && store.row.status !== where.status) return { count: 0 };
        Object.assign(store.row, data);
        return { count: 1 };
      }),
    },
  };
}

function makeService(row?: Record<string, unknown>) {
  const prisma = makePrisma(
    row ?? {
      id: 'cm-1',
      ownerToken: OWNER,
      status: 'DRAFTING',
      stepIndex: 0,
      playerReserveMs: CM_RESERVE_MS,
      aiReserveMs: CM_RESERVE_MS,
      stepStartedAt: new Date(),
      actionsJson: emptyActions(),
      draftId: null,
      aiDraftId: null,
      createdAt: new Date(),
    },
  );
  const heroService = { findAll: jest.fn(async () => ROSTER) };
  const draftService = {
    createFromHeroIds: jest.fn(async (_ids: number[], _token: string, opts: { mode?: string } = {}) => ({
      id: opts.mode === 'captains_ai' ? 'ai-draft' : 'draft-from-cm',
    })),
    assignRoles: jest.fn(async () => ({ id: 'draft-from-cm', status: 'COMPLETED' })),
  };
  const evaluationService = { evaluate: jest.fn(async () => ({ totalScore: 5 })) };
  const heroMeta = { getMatchupWinRate: jest.fn(() => null) };
  const service = new CaptainsService(
    prisma as any,
    heroService as any,
    draftService as any,
    evaluationService as any,
    heroMeta as any,
  );
  return { service, prisma, draftService, evaluationService };
}

describe('CaptainsService', () => {
  it('starts a first-pick session with Dota reserve and empty slots', async () => {
    const { service, prisma } = makeService();
    const view = await service.start(OWNER, true);
    expect(prisma.captainsSession.create).toHaveBeenCalled();
    expect(view.acting).toBe('player');
    expect(view.current?.type).toBe('ban');
    expect(view.slots[0]?.lane).toBe('first');
    expect(view.bannedHeroIds).toEqual([]);
    expect(view.playerReserveMs).toBe(CM_RESERVE_MS);
    expect(view.slots).toHaveLength(CM_STEPS.length);
  });

  it('rejects a missing owner token', async () => {
    const { service } = makeService();
    await expect(service.start('  ', true)).rejects.toThrow(UnauthorizedException);
  });

  it('runs opening AI bans when the player loses the first-pick coin flip', async () => {
    const { service } = makeService();
    const view = await service.start(OWNER, false);
    expect(view.acting).toBe('player');
    expect(view.stepIndex).toBe(2);
    expect(view.slots[0]).toEqual(expect.objectContaining({ type: 'ban', lane: 'second' }));
    expect(view.slots[1]).toEqual(expect.objectContaining({ type: 'ban', lane: 'second' }));
    expect(view.bannedHeroIds).toHaveLength(2);
  });

  it('lets the second-pick player take the 4-1-2 ban cadence', async () => {
    const { service } = makeService();
    await service.start(OWNER, false);
    const afterOne = await service.act('cm-1', OWNER, 10, false);
    expect(afterOne.stepIndex).toBe(3);
    expect(afterOne.acting).toBe('player');
    const afterTwo = await service.act('cm-1', OWNER, 11, false);
    expect(afterTwo.stepIndex).toBe(5);
    expect(afterTwo.acting).toBe('player');
    expect(afterTwo.slots[4]).toEqual(expect.objectContaining({ type: 'ban', lane: 'second' }));
    expect(afterTwo.slots[4].heroId).not.toBeNull();
  });

  it('flips first pick from Math.random', async () => {
    const spy = jest.spyOn(Math, 'random');
    spy.mockReturnValueOnce(0.49);
    const first = await makeService().service.start(OWNER);
    expect(first.stepIndex).toBe(0);
    expect(first.slots[0]?.lane).toBe('first');
    spy.mockReturnValueOnce(0.5);
    const second = await makeService().service.start(OWNER);
    expect(second.stepIndex).toBe(2);
    expect(second.slots[0]?.lane).toBe('second');
    spy.mockRestore();
  });

  it('starts a fresh session every time rather than resuming', async () => {
    const { service, prisma } = makeService();
    await service.start(OWNER, true);
    await service.start(OWNER, true);
    expect(prisma.captainsSession.create).toHaveBeenCalledTimes(2);
  });

  it("hides another player's session", async () => {
    const { service } = makeService();
    await expect(service.get('cm-1', 'someone-else')).rejects.toThrow(NotFoundException);
  });

  it('applies a player ban then lets the AI fill until the next player step', async () => {
    const { service } = makeService();
    await service.act('cm-1', OWNER, 1, false);
    const afterSecond = await service.act('cm-1', OWNER, 2, false);
    expect(afterSecond.bannedHeroIds).toEqual(expect.arrayContaining([1, 2]));
    expect(afterSecond.bannedHeroIds.length).toBeGreaterThan(2);
    expect(afterSecond.acting).toBe('player');
    expect(afterSecond.stepIndex).toBe(4);
    expect(new Set(afterSecond.bannedHeroIds).size).toBe(afterSecond.bannedHeroIds.length);
  });

  it('returns the in-flight act instead of applying a second pick on the same step', async () => {
    const { service } = makeService();
    const first = service.act('cm-1', OWNER, 1, false);
    const second = service.act('cm-1', OWNER, 2, false);
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(b);
    expect(a.bannedHeroIds).toContain(1);
  });

  it('skips a timed-out ban instead of locking a random hero', async () => {
    const { service, prisma } = makeService();
    await service.act('cm-1', OWNER, null, true);
    const slots = JSON.parse(prisma.store.row.actionsJson);
    expect(slots[0]).toEqual({ type: 'ban', lane: 'first', heroId: null });
    expect(prisma.store.row.stepIndex).toBe(1);
  });

  it('rejects a player act while the inverted opening bans still belong to the AI', async () => {
    const { service } = makeService({
      id: 'cm-1',
      ownerToken: OWNER,
      status: 'DRAFTING',
      stepIndex: 0,
      playerReserveMs: CM_RESERVE_MS,
      aiReserveMs: CM_RESERVE_MS,
      stepStartedAt: new Date(),
      actionsJson: JSON.stringify(
        CM_STEPS.map((step) => ({
          type: step.type,
          lane: step.lane === 'first' ? 'second' : 'first',
          heroId: null,
        })),
      ),
      draftId: null,
      aiDraftId: null,
      createdAt: new Date(),
    });
    await expect(service.act('cm-1', OWNER, 1, false)).rejects.toThrow(BadRequestException);
  });

  it('rejects picking a hero that is already taken', async () => {
    const { service } = makeService();
    await service.act('cm-1', OWNER, 1, false);
    await expect(service.act('cm-1', OWNER, 1, false)).rejects.toThrow(BadRequestException);
  });

  it('opens role assignment after the last AI pick', async () => {
    const filled = CM_STEPS.map((step, i) => ({
      type: step.type,
      lane: step.lane,
      heroId: i < 22 ? i + 1 : null,
    }));
    const { service, draftService, prisma } = makeService({
      id: 'cm-1',
      ownerToken: OWNER,
      status: 'DRAFTING',
      stepIndex: 22,
      playerReserveMs: CM_RESERVE_MS,
      aiReserveMs: CM_RESERVE_MS,
      stepStartedAt: new Date(),
      actionsJson: JSON.stringify(filled),
      draftId: null,
      aiDraftId: null,
      createdAt: new Date(),
    });

    const view = await service.act('cm-1', OWNER, 23, false);

    expect(draftService.createFromHeroIds).toHaveBeenCalledTimes(2);
    const playerPicks = (draftService.createFromHeroIds as jest.Mock).mock.calls[0][0];
    expect(playerPicks).toHaveLength(5);
    expect((draftService.createFromHeroIds as jest.Mock).mock.calls[0][2]).toEqual(
      expect.objectContaining({ mode: 'captains', status: 'ASSIGNING_ROLES' }),
    );
    expect((draftService.createFromHeroIds as jest.Mock).mock.calls[1][2]).toEqual(
      expect.objectContaining({ mode: 'captains_ai', status: 'COMPLETED' }),
    );
    expect(view.status).toBe('ASSIGNING_ROLES');
    expect(view.draftId).toBe('draft-from-cm');
    expect(view.aiDraftId).toBe('ai-draft');
    expect(prisma.store.row.stepIndex).toBe(CM_STEPS.length);
  });

  it('finishes an inverted second-pick session on the last player pick', async () => {
    const filled = CM_STEPS.map((step, i) => ({
      type: step.type,
      lane: step.lane === 'first' ? 'second' : 'first',
      heroId: i < 23 ? i + 1 : null,
    }));
    const { service, draftService } = makeService({
      id: 'cm-1',
      ownerToken: OWNER,
      status: 'DRAFTING',
      stepIndex: 23,
      playerReserveMs: CM_RESERVE_MS,
      aiReserveMs: CM_RESERVE_MS,
      stepStartedAt: new Date(),
      actionsJson: JSON.stringify(filled),
      draftId: null,
      aiDraftId: null,
      createdAt: new Date(),
    });

    const view = await service.act('cm-1', OWNER, 24, false);
    expect(view.status).toBe('ASSIGNING_ROLES');
    expect(draftService.createFromHeroIds).toHaveBeenCalledTimes(2);
    const playerPicks = (draftService.createFromHeroIds as jest.Mock).mock.calls[0][0];
    expect(playerPicks).toHaveLength(5);
    expect(playerPicks).toContain(24);
  });
});
