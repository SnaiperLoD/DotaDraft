import { HistoryService } from './history.service';

describe('HistoryService.findAll', () => {
  it('queries only completed drafts owned by the caller', async () => {
    const prisma = {
      draft: {
        findMany: jest.fn(async () => []),
      },
      tiRun: {
        findMany: jest.fn(async () => []),
      },
    };
    const heroService = { findByIds: jest.fn(async () => []) };
    const service = new HistoryService(prisma as any, heroService as any);

    await service.findAll('owner-a');

    expect(prisma.draft.findMany).toHaveBeenCalledWith({
      where: { status: 'COMPLETED', ownerToken: 'owner-a', NOT: { mode: 'captains_ai' } },
      include: { heroes: true, battleResults: { orderBy: { createdAt: 'desc' } } },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('attaches coarse TI placement from the occupy-slot graph, not a generic Eliminated', async () => {
    const prisma = {
      draft: {
        findMany: jest.fn(async () => [
          {
            id: 'd-gf',
            mode: 'ti',
            createdAt: new Date('2026-09-01T00:00:00.000Z'),
            evaluationResult: null,
            heroes: [],
            battleResults: [],
          },
          {
            id: 'd-cup',
            mode: 'ti',
            createdAt: new Date('2026-09-01T01:00:00.000Z'),
            evaluationResult: null,
            heroes: [],
            battleResults: [],
          },
        ]),
      },
      tiRun: {
        findMany: jest.fn(async () => [
          {
            draftId: 'd-gf',
            teamName: 'Team Spirit',
            leagueName: 'The International 2021',
            bracketId: 'ti-2021',
            status: 'ELIMINATED',
            pathJson: JSON.stringify([
              {
                matchId: 'gf',
                round: 'Grand Final',
                opponent: 'PSG.LGD',
                outcome: 'Lose',
                advantageDirection: 'A',
              },
            ]),
          },
          {
            draftId: 'd-cup',
            teamName: 'PSG.LGD',
            leagueName: 'The International 2021',
            bracketId: 'ti-2021',
            status: 'CHAMPION',
            pathJson: JSON.stringify([
              {
                matchId: 'gf',
                round: 'Grand Final',
                opponent: 'Team Spirit',
                outcome: 'Win',
                advantageDirection: 'A',
              },
            ]),
          },
        ]),
      },
    };
    const heroService = { findByIds: jest.fn(async () => []) };
    const service = new HistoryService(prisma as any, heroService as any);
    const rows = await service.findAll('owner-a');

    expect(rows.find((r) => r.id === 'd-gf')?.ti).toMatchObject({
      status: 'ELIMINATED',
      placement: 'second',
      lastRound: 'Grand Final',
    });
    expect(rows.find((r) => r.id === 'd-cup')?.ti).toMatchObject({
      status: 'CHAMPION',
      placement: 'champion',
    });
  });
});
