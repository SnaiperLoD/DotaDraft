import { HeroService, ensureRoleCoverage } from './hero.service';
import { makeHero } from '../test-utils/hero-factory';
import type { Hero } from 'shared';

function rawRow(hero: Hero) {
  return {
    id: hero.id,
    name: hero.name,
    primaryAttribute: hero.primary_attribute,
    attackType: hero.attack_type,
    roles: JSON.stringify(hero.roles),
    tags: JSON.stringify(hero.tags),
    synergyTags: JSON.stringify(hero.synergy_tags),
    counterTags: JSON.stringify(hero.counter_tags),
    evaluationValues: JSON.stringify(hero.evaluation_values),
    presumedPositions: JSON.stringify(hero.presumed_positions),
  };
}

describe('ensureRoleCoverage', () => {
  const support = (id: number) => makeHero({ id, name: `Support${id}`, roles: ['Support'] });
  const core = (id: number) => makeHero({ id, name: `Core${id}`, roles: ['Carry'] });

  it('leaves the pool unchanged when it already has both a Support and a core hero', () => {
    const pool = [support(1), core(2)];
    const rest = [core(3)];
    expect(ensureRoleCoverage(pool, rest)).toEqual(pool);
  });

  it('swaps in a Support hero from rest when the pool has none', () => {
    const pool = [core(1), core(2)];
    const rest = [core(3), support(4)];
    const result = ensureRoleCoverage(pool, rest);
    expect(result.some((h) => h.roles.includes('Support'))).toBe(true);
    // Only the last slot is given up, the rest of the pool is untouched.
    expect(result[0]).toEqual(core(1));
  });

  it('swaps in a core hero from rest when the pool is all Support', () => {
    const pool = [support(1), support(2)];
    const rest = [support(3), core(4)];
    const result = ensureRoleCoverage(pool, rest);
    expect(result.some((h) => !h.roles.includes('Support'))).toBe(true);
    expect(result[0]).toEqual(support(1));
  });

  it('leaves the pool as-is when rest has no fix available either', () => {
    const pool = [core(1), core(2)];
    const rest = [core(3)]; // no Support anywhere
    expect(ensureRoleCoverage(pool, rest)).toEqual(pool);
  });
});

describe('HeroService', () => {
  function makeService(rows: ReturnType<typeof rawRow>[]) {
    const findMany = jest.fn().mockResolvedValue(rows);
    const prisma = { hero: { findMany } } as any;
    return { service: new HeroService(prisma), findMany };
  }

  it('findAll parses the JSON-stringified DB columns back into a Hero', () => {
    const original = makeHero({ id: 1, name: 'Axe', roles: ['Initiator'], tags: ['teamfight'] });
    const { service } = makeService([rawRow(original)]);

    return service.findAll().then((heroes) => {
      expect(heroes).toEqual([original]);
    });
  });

  it('findByIds queries with an `id in [...]` filter', async () => {
    const { service, findMany } = makeService([]);
    await service.findByIds([1, 2, 3]);
    expect(findMany).toHaveBeenCalledWith({ where: { id: { in: [1, 2, 3] } } });
  });

  it('randomPool is deterministic for the same seed and excludes the given hero ids', async () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      rawRow(makeHero({ id: i + 1, name: `Hero${i + 1}`, roles: i % 3 === 0 ? ['Support'] : ['Carry'] })),
    );
    const { service } = makeService(rows);

    const poolA = await service.randomPool([1, 2], 5, 42);
    const poolB = await service.randomPool([1, 2], 5, 42);

    expect(poolA.map((h) => h.id)).toEqual(poolB.map((h) => h.id));
    expect(poolA.some((h) => h.id === 1 || h.id === 2)).toBe(false);
  });
});
