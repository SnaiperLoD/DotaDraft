import { BadRequestException } from '@nestjs/common';
import { HeroController } from './hero.controller';
import { makeHero } from '../test-utils/hero-factory';
import type { HeroService } from './hero.service';
import type { HeroAbilitiesService } from './hero-abilities.service';
import type { HeroMetaService } from '../hero-meta/hero-meta.service';
import { ABILITY_CATEGORY_FOR_AXIS } from 'shared';
import type { TopAbility } from 'shared';

describe('HeroController.synergyPreview', () => {
  function makeController(winRates: Record<number, number>, synergy: Record<string, number>) {
    const heroService = {
      findByIds: jest.fn((ids: number[]) =>
        Promise.resolve(ids.map((id) => makeHero({ id, name: `Hero${id}` }))),
      ),
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
    const controller = makeController({ 1: 0.5, 2: 0.5, 10: 0.5 }, { '1-10': 0.55, '2-10': 0.45 });
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

  it('averages (not sums) two distinct non-zero deltas', async () => {
    // Candidate 10 vs picked 1 (winRate 0.5 each, synergy 0.7 -> delta +0.2)
    // and picked 2 (winRate 0.5 each, synergy 0.9 -> delta +0.4): average is
    // 0.3 — the earlier tests' deltas happened to average to values where a
    // stray sum/multiply-by-length mistake wouldn't show up (0, or a single
    // delta with length 1); this pins the actual division.
    const controller = makeController({ 1: 0.5, 2: 0.5, 10: 0.5 }, { '1-10': 0.7, '2-10': 0.9 });
    const result = await controller.synergyPreview({ pickedHeroIds: [1, 2], candidateHeroIds: [10] });
    expect(result[0].score).toBeCloseTo(0.3);
  });
});

describe('HeroController.findAll', () => {
  it('delegates directly to HeroService.findAll', () => {
    const heroes = [makeHero({ id: 1, name: 'A' })];
    const heroService = { findAll: jest.fn(() => heroes) } as unknown as HeroService;
    const controller = new HeroController(
      heroService,
      {} as unknown as HeroAbilitiesService,
      {} as unknown as HeroMetaService,
    );
    expect(controller.findAll()).toBe(heroes);
    expect(heroService.findAll).toHaveBeenCalledTimes(1);
  });
});

describe('HeroController.topAbilities', () => {
  function makeController(topAbilitiesResult: TopAbility[] = []) {
    const heroAbilitiesService = {
      topAbilities: jest.fn(() => topAbilitiesResult),
    } as unknown as HeroAbilitiesService;
    const controller = new HeroController(
      {} as unknown as HeroService,
      heroAbilitiesService,
      {} as unknown as HeroMetaService,
    );
    return { controller, heroAbilitiesService };
  }

  it('throws BadRequestException for a category outside the ability-tagged axes, naming the valid ones comma-separated', () => {
    const { controller } = makeController();
    expect(() => controller.topAbilities(1, 'not_a_real_category')).toThrow(BadRequestException);
    expect(() => controller.topAbilities(1, 'not_a_real_category')).toThrow(
      'category must be one of: control_strength, mobility, saving, initiating, damage_mitigation',
    );
  });

  it('accepts every valid ability category and forwards it unchanged', () => {
    for (const category of Object.values(ABILITY_CATEGORY_FOR_AXIS)) {
      const { controller, heroAbilitiesService } = makeController();
      controller.topAbilities(5, category);
      expect(heroAbilitiesService.topAbilities).toHaveBeenCalledWith(5, category, 3);
    }
  });

  it('defaults the limit to 3 when none is given', () => {
    const { controller, heroAbilitiesService } = makeController();
    controller.topAbilities(5, 'mobility');
    expect(heroAbilitiesService.topAbilities).toHaveBeenCalledWith(5, 'mobility', 3);
  });

  it('parses a valid numeric limit string', () => {
    const { controller, heroAbilitiesService } = makeController();
    controller.topAbilities(5, 'mobility', '7');
    expect(heroAbilitiesService.topAbilities).toHaveBeenCalledWith(5, 'mobility', 7);
  });

  it('falls back to the default limit for a non-numeric limit string', () => {
    const { controller, heroAbilitiesService } = makeController();
    controller.topAbilities(5, 'mobility', 'not-a-number');
    expect(heroAbilitiesService.topAbilities).toHaveBeenCalledWith(5, 'mobility', 3);
  });

  it('clamps a limit above the maximum down to 10', () => {
    const { controller, heroAbilitiesService } = makeController();
    controller.topAbilities(5, 'mobility', '999');
    expect(heroAbilitiesService.topAbilities).toHaveBeenCalledWith(5, 'mobility', 10);
  });

  it('clamps a limit at or below zero up to 1', () => {
    const { controller, heroAbilitiesService } = makeController();
    controller.topAbilities(5, 'mobility', '0');
    expect(heroAbilitiesService.topAbilities).toHaveBeenCalledWith(5, 'mobility', 1);

    const { controller: controller2, heroAbilitiesService: heroAbilitiesService2 } = makeController();
    controller2.topAbilities(5, 'mobility', '-5');
    expect(heroAbilitiesService2.topAbilities).toHaveBeenCalledWith(5, 'mobility', 1);
  });

  it('accepts the maximum limit (10) unchanged, without over-clamping', () => {
    const { controller, heroAbilitiesService } = makeController();
    controller.topAbilities(5, 'mobility', '10');
    expect(heroAbilitiesService.topAbilities).toHaveBeenCalledWith(5, 'mobility', 10);
  });

  it('returns whatever HeroAbilitiesService.topAbilities produces', () => {
    const stub: TopAbility[] = [{ abilityKey: 'x', abilityName: 'X', iconUrl: 'url', score: 4.2 }];
    const { controller } = makeController(stub);
    expect(controller.topAbilities(5, 'mobility')).toBe(stub);
  });
});
