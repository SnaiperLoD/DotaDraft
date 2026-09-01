import { TiRunService } from './ti-run.service';

type TiRunRow = {
  id: string;
  ownerToken: string;
  bracketId: string;
  leagueName: string;
  teamName: string | null;
  draftId: string | null;
  status: string;
  losses: number;
  currentMatchId: string | null;
  choiceJson: string;
  pathJson: string;
  createdAt: Date;
};

function makeService(initial: TiRunRow) {
  let stored = { ...initial };
  const prisma = {
    tiRun: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        where.id === stored.id ? stored : null,
      ),
      update: jest.fn(async ({ data }: { data: Partial<TiRunRow> }) => {
        stored = { ...stored, ...data };
        return stored;
      }),
    },
  };
  const service = new TiRunService(prisma as never, {} as never, {} as never);
  return { service, getRow: () => stored };
}

const baseRow = (): TiRunRow => ({
  id: 'run-1',
  ownerToken: 'owner-tok',
  bracketId: 'ti-2021',
  leagueName: 'The International 2021',
  teamName: 'Team Spirit',
  draftId: 'draft-1',
  status: 'PLAYING',
  losses: 0,
  currentMatchId: 'ub_r1_1',
  choiceJson: JSON.stringify({ teams: [], occupyAs: 'Team Spirit' }),
  pathJson: '[]',
  createdAt: new Date(),
});

describe('TiRunService recordFight', () => {
  it('records an upper-bracket win and advances the occupy slot', async () => {
    const { service } = makeService(baseRow());
    const view = await service.recordFight('run-1', 'owner-tok', {
      outcome: 'Win',
      advantageDirection: 'A',
      confidenceTier: 'Moderate',
    });
    expect(view.status).toBe('PLAYING');
    expect(view.path).toHaveLength(1);
    expect(view.path[0]).toMatchObject({ matchId: 'ub_r1_1', outcome: 'Win' });
    expect(view.currentMatchId).not.toBe('ub_r1_1');
    expect(view.matches.find((m) => m.id === 'ub_r1_1')?.winner).toBe('Team Spirit');
  });

  it('drops into the lower bracket after an upper-bracket loss', async () => {
    const { service, getRow } = makeService(baseRow());
    const view = await service.recordFight('run-1', 'owner-tok', {
      outcome: 'Lose',
      advantageDirection: 'B',
      confidenceTier: 'Low',
    });
    expect(view.status).toBe('PLAYING');
    expect(getRow().losses).toBe(1);
    expect(view.path[0].outcome).toBe('Lose');
    expect(view.currentMatchId).not.toBe('ub_r1_1');
    expect(view.matches.find((m) => m.id === 'ub_r1_1')?.winner).toBe('Invictus Gaming');
  });

  it('marks champion after a grand-final win', async () => {
    const { service } = makeService({
      ...baseRow(),
      currentMatchId: 'gf',
    });
    const view = await service.recordFight('run-1', 'owner-tok', {
      outcome: 'Win',
      advantageDirection: 'A',
      confidenceTier: 'High',
    });
    expect(view.status).toBe('CHAMPION');
    expect(view.currentMatchId).toBeNull();
    expect(view.matches.find((m) => m.id === 'gf')?.winner).toBe('Team Spirit');
  });

  it('marks eliminated after a grand-final loss', async () => {
    const { service } = makeService({
      ...baseRow(),
      currentMatchId: 'gf',
    });
    const view = await service.recordFight('run-1', 'owner-tok', {
      outcome: 'Lose',
      advantageDirection: 'B',
      confidenceTier: 'High',
    });
    expect(view.status).toBe('ELIMINATED');
    expect(view.currentMatchId).toBeNull();
    expect(view.matches.find((m) => m.id === 'gf')?.winner).not.toBe('Team Spirit');
  });
});
