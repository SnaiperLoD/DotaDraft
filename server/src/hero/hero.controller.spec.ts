import { HeroController } from './hero.controller';
import { makeHero } from '../test-utils/hero-factory';
import type { HeroService } from './hero.service';
import type { HeroAbilitiesService } from './hero-abilities.service';
import type { HeroMetaService } from '../hero-meta/hero-meta.service';

describe('HeroController.synergyPreview', () => {
  function makeController(winRates: Record<number, number>, synergy: Record<string, number>) {
    const heroService = {
      findByIds: jest.fn((ids: number[]) => Promise.resolve(ids.map((id) => makeHero({ id, name: `Hero${id}` })))),
    } as unknown as HeroService;

    const heroMetaService = {
      getWinRate: (id: number) => winRates[id] ?? null,
      getSynergyWinRate: (a: number, b: number) => {
        const key = [a, b].sort((x, y) => x - y).join('-');
        return synergy[key] ?? null;
      },
    } as unknown as HeroMetaService;

    const heroAbilitiesService = {} as unknown as HeroAbilitiesService;

    return new HeroController(heroService, heroAbilitiesService, heroMetaService);
  }

  it('returns all-null scores with no picked heroes yet (round 1)', async () => {
    const controller = makeController({}, {});
    const result = await controller.synergyPreview({ pickedHeroIds: [], candidateHeroIds: [10, 11] });
    expect(result).toEqual([
      { heroId: 10, score: null },
      { heroId: 11, score: null },
    ]);
  });

  it('averages real synergy delta across all picked heroes for each candidate', async () => {
    // Candidate 10 vs picked 1 (winRate 0.5 each, synergy 0.55 -> delta +0.05)
    // and picked 2 (winRate 0.5 each, synergy 0.45 -> delta -0.05) averages to 0.
    const controller = makeController(
      { 1: 0.5, 2: 0.5, 10: 0.5 },
      { '1-10': 0.55, '2-10': 0.45 },
    );
    const result = await controller.synergyPreview({ pickedHeroIds: [1, 2], candidateHeroIds: [10] });
    expect(result[0].heroId).toBe(10);
    expect(result[0].score).toBeCloseTo(0);
  });

  it('excludes picked heroes with no real data from the average rather than treating them as 0', async () => {
    const controller = makeController({ 1: 0.5, 10: 0.5 }, { '1-10': 0.6 });
    // picked hero 2 has no synergy/winRate data at all -> realSynergyDelta is
    // null for that pairing and should be dropped, not averaged in as 0.
    const result = await controller.synergyPreview({ pickedHeroIds: [1, 2], candidateHeroIds: [10] });
    expect(result[0].score).toBeCloseTo(0.1); // only the 1-10 pairing counts
  });

  it('returns null for a candidate with no real data against any picked hero', async () => {
    const controller = makeController({ 1: 0.5 }, {});
    const result = await controller.synergyPreview({ pickedHeroIds: [1], candidateHeroIds: [10] });
    expect(result[0].score).toBeNull();
  });
});
