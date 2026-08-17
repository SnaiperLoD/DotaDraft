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
    evaluationValuesByRole: JSON.stringify(hero.evaluation_values_by_role),
    presumedPositions: JSON.stringify(hero.presumed_positions),
  };
}

describe('ensureRoleCoverage', () => {
  const support = (id: number) =>
    makeHero({
      id,
      name: `Support${id}`,
      roles: ['Support'],
      presumed_positions: [{ position: 'Support', share: 0.8 }],
    });
  const core = (id: number) =>
    makeHero({
      id,
      name: `Core${id}`,
      roles: ['Carry'],
      presumed_positions: [{ position: 'Carry', share: 0.8 }],
    });
  const isSupportReal = (h: ReturnType<typeof support>) =>
    h.presumed_positions.some((p) => p.position === 'Support');

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
    const noDataSupport = makeHero({
      id: 6,
      name: 'NoDataSupport',
      roles: ['Support'],
      presumed_positions: [],
    });
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

  it('tiForm aggregates current TI league and ranks by wins then win rate', async () => {
    const findManyHero = jest.fn().mockResolvedValue([
      { id: 1, name: 'Anti-Mage' },
      { id: 2, name: 'Axe' },
      { id: 3, name: 'Bane' },
      { id: 4, name: 'Bloodseeker' },
    ]);
    const findManyMatch = jest.fn().mockResolvedValue([
      {
        leagueName: 'The International 2026',
        radiantHeroIds: '[1,2]',
        direHeroIds: '[3,4]',
        radiantWin: true,
        startTime: new Date('2026-08-01'),
      },
      {
        leagueName: 'The International 2026',
        radiantHeroIds: '[1]',
        direHeroIds: '[2]',
        radiantWin: false,
        startTime: new Date('2026-08-02'),
      },
      {
        leagueName: 'The International 2025',
        radiantHeroIds: '[1]',
        direHeroIds: '[2]',
        radiantWin: true,
        startTime: new Date('2025-08-01'),
      },
    ]);
    const prisma = {
      hero: { findMany: findManyHero },
      proMatch: { findMany: findManyMatch },
    } as any;
    const service = new HeroService(prisma);

    const result = await service.tiForm(5);
    expect(result.leagueName).toBe('The International 2026');
    expect(result.matchCount).toBe(2);
    // Axe: W as radiant + W as dire. Anti-Mage: W then L. Older TI25 ignored.
    expect(result.heroes[0]).toMatchObject({ heroId: 2, heroName: 'Axe', wins: 2, games: 2 });
    expect(result.heroes.find((h) => h.heroId === 1)).toMatchObject({ wins: 1, games: 2 });
  });

  it('tiForm returns empty when no TI matches exist', async () => {
    const prisma = {
      hero: { findMany: jest.fn() },
      proMatch: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;
    const service = new HeroService(prisma);
    await expect(service.tiForm()).resolves.toEqual({ leagueName: null, matchCount: 0, heroes: [] });
  });
});

describe('pool coverage smoke (heroes.json + hero-meta roster)', () => {
  // Mirrors server/scripts/audit-pool-coverage.ts on a smaller seed sample so
  // CI catches guarantee regressions without a 50k DB sweep. Positions come
  // from hero-meta.json the same way seed.ts writes presumedPositions.
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const { seededShuffle } = require('../common/random') as typeof import('../common/random');

  const dataDir = path.join(__dirname, '../../data');
  const rawHeroes: Hero[] = JSON.parse(fs.readFileSync(path.join(dataDir, 'heroes.json'), 'utf8'));
  const meta = JSON.parse(fs.readFileSync(path.join(dataDir, 'hero-meta.json'), 'utf8')) as {
    heroes: { heroId: number; positions: Hero['presumed_positions'] }[];
  };
  const positionsById = new Map(meta.heroes.map((h) => [h.heroId, h.positions ?? []]));
  const all: Hero[] = rawHeroes.map((h) => ({
    ...h,
    presumed_positions: positionsById.get(h.id) ?? [],
    evaluation_values_by_role: h.evaluation_values_by_role ?? {},
  }));

  const isSupport = (h: Hero) =>
    h.presumed_positions.length > 0
      ? h.presumed_positions.some((p) => p.position === 'Support')
      : h.roles.includes('Support');

  const localRandomPool = (excludeIds: number[], size: number, seed: number): Hero[] => {
    const ex = new Set(excludeIds);
    const available = all.filter((h) => !ex.has(h.id));
    const shuffled = seededShuffle(available, seed);
    return ensureRoleCoverage(shuffled.slice(0, size), shuffled.slice(size));
  };

  it('has both Support-eligible and core heroes in the seeded roster', () => {
    expect(all.length).toBeGreaterThan(100);
    expect(all.filter((h) => h.presumed_positions.length > 0).length).toBeGreaterThan(100);
    expect(all.some(isSupport)).toBe(true);
    expect(all.some((h) => !isSupport(h))).toBe(true);
  });

  it('never violates Support/core guarantee across 300 pools and 200 five-round drafts', () => {
    let violations = 0;
    for (let seed = 0; seed < 300; seed++) {
      const pool = localRandomPool([], 5, seed);
      if (!pool.some(isSupport) || !pool.some((h) => !isSupport(h))) violations += 1;
    }

    for (let n = 0; n < 200; n++) {
      const base = ((12345 + n * 2654435761) >>> 0) & 0x7fffffff;
      const excluded: number[] = [];
      for (let r = 0; r < 5; r++) {
        const pool = localRandomPool(excluded, 5, base + r);
        if (!pool.some(isSupport) || !pool.some((h) => !isSupport(h))) violations += 1;
        for (const h of pool) excluded.push(h.id);
      }
    }

    expect(violations).toBe(0);
  });
});
