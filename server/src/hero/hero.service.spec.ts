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
  const support = (id: number) =>
    makeHero({ id, name: `Support${id}`, roles: ['Support'], presumed_positions: [{ position: 'Support', share: 0.8 }] });
  const core = (id: number) =>
    makeHero({ id, name: `Core${id}`, roles: ['Carry'], presumed_positions: [{ position: 'Carry', share: 0.8 }] });
  const isSupportReal = (h: ReturnType<typeof support>) => h.presumed_positions.some((p) => p.position === 'Support');

  it('leaves the pool unchanged when it already has both a Support and a core hero', () => {
    const pool = [support(1), core(2)];
    const rest = [core(3)];
    expect(ensureRoleCoverage(pool, rest)).toEqual(pool);
  });

  it('swaps in a Support hero from rest when the pool has none', () => {
    const pool = [core(1), core(2)];
    const rest = [core(3), support(4)];
    const result = ensureRoleCoverage(pool, rest);
    expect(result.some(isSupportReal)).toBe(true);
    // Only the last slot is given up, the rest of the pool is untouched.
    expect(result[0]).toEqual(core(1));
  });

  it('swaps in a core hero from rest when the pool is all Support', () => {
    const pool = [support(1), support(2)];
    const rest = [support(3), core(4)];
    const result = ensureRoleCoverage(pool, rest);
    expect(result.some((h) => !isSupportReal(h))).toBe(true);
    expect(result[0]).toEqual(support(1));
  });

  it('leaves the pool as-is when rest has no fix available either', () => {
    const pool = [core(1), core(2)];
    const rest = [core(3)]; // no Support anywhere
    expect(ensureRoleCoverage(pool, rest)).toEqual(pool);
  });

  it('trusts real presumed_positions over a stale/wrong roles tag', () => {
    // Tagged non-Support but real GPM data says otherwise (the Pugna/Nyx
    // Assassin/Bounty Hunter pattern found in the backlog audit).
    const secretSupport = makeHero({
      id: 5,
      name: 'SecretSupport',
      roles: ['Carry'],
      presumed_positions: [{ position: 'Support', share: 0.9 }],
    });
    const pool = [core(1), core(2)];
    const rest = [core(3), secretSupport];
    const result = ensureRoleCoverage(pool, rest);
    expect(result).toContainEqual(secretSupport);
  });

  it('falls back to the roles tag when a hero has no position data at all', () => {
    const noDataSupport = makeHero({ id: 6, name: 'NoDataSupport', roles: ['Support'], presumed_positions: [] });
    const pool = [core(1), core(2)];
    const rest = [core(3), noDataSupport];
    const result = ensureRoleCoverage(pool, rest);
    expect(result).toContainEqual(noDataSupport);
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
