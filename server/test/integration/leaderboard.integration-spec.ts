import './test-db-env';
import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { DraftService } from '../../src/draft/draft.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { completeBattleDraft } from './helpers';

describe('Run leaderboard (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let drafts: DraftService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    drafts = app.get(DraftService);
  });

  afterAll(async () => {
    await app.close();
  });

  function fight(draftId: string, resolvedOutcome: string, opponentSource: string, coinFlip = false) {
    return {
      draftId,
      resolvedOutcome,
      advantageDirection: 'Even',
      confidenceTier: 'Low',
      opponentSource,
      opponentHeroIds: '[1,2,3,4,5]',
      coinFlip,
    };
  }

  it('reports the share of pro-team opponents per run, excluding coin flips', async () => {
    const owner = `lb-owner-${Date.now()}`;
    const { draftId } = await completeBattleDraft(app.getHttpServer(), owner);

    await prisma.battleResult.createMany({
      data: [
        fight(draftId, 'Win', 'pro'),
        fight(draftId, 'Win', 'pro'),
        fight(draftId, 'Lose', 'pro'),
        fight(draftId, 'Win', 'player'),
        // Coin flips never count toward the record or the share.
        fight(draftId, 'Win', 'player', true),
        fight(draftId, 'Lose', 'player', true),
      ],
    });

    const runs = await drafts.getBestRuns(10, 4, owner, 'mine');
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ draftId, wins: 3, losses: 1, isMine: true });
    expect(runs[0].winRate).toBeCloseTo(0.75);
    expect(runs[0].proOpponentShare).toBeCloseTo(0.75);
  });

  it('reports a zero pro share for an all-player run and respects minFights', async () => {
    const owner = `lb-owner-pool-${Date.now()}`;
    const { draftId } = await completeBattleDraft(app.getHttpServer(), owner);
    await prisma.battleResult.createMany({
      data: [fight(draftId, 'Win', 'player'), fight(draftId, 'Lose', 'player')],
    });

    const runs = await drafts.getBestRuns(10, 2, owner, 'mine');
    expect(runs.map((r) => r.draftId)).toEqual([draftId]);
    expect(runs[0].proOpponentShare).toBe(0);
    expect(await drafts.getBestRuns(10, 3, owner, 'mine')).toEqual([]);
  });
});
