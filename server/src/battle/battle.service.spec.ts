import { encodeCopiedDraft } from 'shared';
import { BattleService } from './battle.service';
import { makeHero } from '../test-utils/hero-factory';

const ROLES = ['Carry', 'Mid', 'Offlane', 'Soft Support', 'Hard Support'] as const;

function makeTeam() {
  return ROLES.map((role, i) => {
    const hero = makeHero({ id: i + 1, name: `Hero${i + 1}` });
    return { heroId: hero.id, hero, assignedRole: role, pickOrder: i };
  });
}

function makeService() {
  const heroes = makeTeam();
  const roster = heroes.map((h) => h.hero);
  const draftService = {
    getById: jest.fn(async () => ({
      id: 'd1',
      status: 'COMPLETED',
      mode: 'battle',
      heroes,
      pool: roster,
      createdAt: new Date(),
      rerollsRemaining: 0,
    })),
    getFacedOpponentHeroSets: jest.fn(async () => []),
    saveBattleResult: jest.fn(async () => undefined),
  };
  const heroService = {
    findAll: jest.fn(async () => roster),
    findByIds: jest.fn(async (ids: number[]) => roster.filter((h) => ids.includes(h.id))),
  };
  const heroMetaService = {};
  const opponentPoolService = {
    pullRandom: jest.fn(),
    recordDraftOutcome: jest.fn(),
  };
  const captainsService = { getAiOpponent: jest.fn(), markFought: jest.fn() };
  const tiRunService = { prepareFight: jest.fn(), recordFight: jest.fn() };
  const service = new BattleService(
    draftService as never,
    heroService as never,
    heroMetaService as never,
    opponentPoolService as never,
    captainsService as never,
    tiRunService as never,
  );
  return { service, draftService, opponentPoolService, heroes };
}

describe('BattleService coin-flip challenge', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('pasting your own five heroes coins the fight and skips the pool', async () => {
    const { service, draftService, opponentPoolService, heroes } = makeService();
    jest.spyOn(Math, 'random').mockReturnValue(0.1);
    const copiedDraft = encodeCopiedDraft(heroes.map((h) => ({ heroId: h.heroId, role: h.assignedRole })));

    const result = await service.fight('d1', 'owner', { copiedDraft });

    expect(result.coinFlip).toBe(true);
    expect(result.resolvedOutcome).toBe('Win');
    expect(result.advantageDirection).toBe('Even');
    expect(result.confidenceTier).toBe('Low');
    expect(result.story.beats).toEqual([]);
    expect(draftService.saveBattleResult).toHaveBeenCalledWith(
      'd1',
      expect.objectContaining({
        resolvedOutcome: 'Win',
        advantageDirection: 'Even',
        confidenceTier: 'Low',
        opponentSource: 'player',
      }),
    );
    expect(opponentPoolService.pullRandom).not.toHaveBeenCalled();
    expect(opponentPoolService.recordDraftOutcome).not.toHaveBeenCalled();
  });

  it('lands Lose when the coin rng is at or above 0.5', async () => {
    const { service, heroes } = makeService();
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
    const copiedDraft = encodeCopiedDraft(heroes.map((h) => ({ heroId: h.heroId, role: h.assignedRole })));

    const result = await service.fight('d1', 'owner', { copiedDraft });

    expect(result.coinFlip).toBe(true);
    expect(result.resolvedOutcome).toBe('Lose');
  });
});
