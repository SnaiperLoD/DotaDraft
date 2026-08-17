import { HistoryService } from './history.service';

describe('HistoryService.findAll', () => {
  it('queries only completed drafts owned by the caller', async () => {
    const prisma = {
      draft: {
        findMany: jest.fn(async () => []),
      },
    };
    const heroService = { findByIds: jest.fn(async () => []) };
    const service = new HistoryService(prisma as any, heroService as any);

    await service.findAll('owner-a');

    expect(prisma.draft.findMany).toHaveBeenCalledWith({
      where: { status: 'COMPLETED', ownerToken: 'owner-a' },
      include: { heroes: true, battleResults: { orderBy: { createdAt: 'desc' } } },
      orderBy: { createdAt: 'desc' },
    });
  });
});
