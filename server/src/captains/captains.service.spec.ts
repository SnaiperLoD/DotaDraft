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
          ...data,
        };
        return store.row;
      }),
      findUnique: jest.fn(async ({ where }: any) => (store.row?.id === where.id ? store.row : null)),
      update: jest.fn(async ({ data }: any) => {
        Object.assign(store.row, data);
        return store.row;
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
      createdAt: new Date(),
    },
  );
  const heroService = { findAll: jest.fn(async () => ROSTER) };
  const draftService = {
    createFromHeroIds: jest.fn(async () => ({ id: 'draft-from-cm' })),
  };
  const service = new CaptainsService(prisma as any, heroService as any, draftService as any);
  return { service, prisma, draftService };
}

describe('CaptainsService', () => {
  it('starts a first-pick session with Dota reserve and empty slots', async () => {
    const { service, prisma } = makeService();
    const view = await service.start(OWNER);
    expect(prisma.captainsSession.create).toHaveBeenCalled();
    expect(view.acting).toBe('player');
    expect(view.current?.type).toBe('ban');
    expect(view.playerReserveMs).toBe(CM_RESERVE_MS);
    expect(view.slots).toHaveLength(CM_STEPS.length);
  });

  it('rejects a missing owner token', async () => {
    const { service } = makeService();
    await expect(service.start('  ')).rejects.toThrow(UnauthorizedException);
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

  it('skips a timed-out ban instead of locking a random hero', async () => {
    const { service, prisma } = makeService();
    await service.act('cm-1', OWNER, null, true);
    const slots = JSON.parse(prisma.store.row.actionsJson);
    expect(slots[0]).toEqual({ type: 'ban', lane: 'first', heroId: null });
    expect(prisma.store.row.stepIndex).toBe(1);
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
      createdAt: new Date(),
    });

    const view = await service.act('cm-1', OWNER, 23, false);

    expect(draftService.createFromHeroIds).toHaveBeenCalled();
    const playerPicks = (draftService.createFromHeroIds as jest.Mock).mock.calls[0][0];
    expect(playerPicks).toHaveLength(5);
    expect(view.status).toBe('ASSIGNING_ROLES');
    expect(view.draftId).toBe('draft-from-cm');
    expect(prisma.store.row.stepIndex).toBe(CM_STEPS.length);
  });
});
