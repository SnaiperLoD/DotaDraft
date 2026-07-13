import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { seededShuffle } from '../common/random';
import type { Hero } from 'shared';

@Injectable()
export class HeroService {
  constructor(private readonly prisma: PrismaService) {}

  private toHero(row: any): Hero {
    return {
      id: row.id,
      name: row.name,
      primary_attribute: row.primaryAttribute,
      attack_type: row.attackType,
      roles: JSON.parse(row.roles),
      tags: JSON.parse(row.tags),
      synergy_tags: JSON.parse(row.synergyTags),
      counter_tags: JSON.parse(row.counterTags),
      evaluation_values: JSON.parse(row.evaluationValues),
      presumed_positions: JSON.parse(row.presumedPositions ?? '[]'),
    };
  }

  async findAll(): Promise<Hero[]> {
    const rows = await this.prisma.hero.findMany({ orderBy: { id: 'asc' } });
    return rows.map((row) => this.toHero(row));
  }

  async findByIds(ids: number[]): Promise<Hero[]> {
    const rows = await this.prisma.hero.findMany({ where: { id: { in: ids } } });
    return rows.map((row) => this.toHero(row));
  }

  async randomPool(excludeIds: number[], size: number, seed: number): Promise<Hero[]> {
    const all = await this.findAll();
    const available = all.filter((hero) => !excludeIds.includes(hero.id));
    const shuffled = seededShuffle(available, seed);
    const pool = shuffled.slice(0, size);
    const rest = shuffled.slice(size);
    return this.ensureRoleCoverage(pool, rest);
  }

  // Guarantees at least one Support hero and one non-Support ("core") hero in
  // every offered pool, since >5 rounds a purely random draw of 5 from 127
  // heroes (48 Support / 79 core) is meaningfully likely to skip Support
  // entirely (~9% chance) and occasionally skip core too. Stays deterministic:
  // both `pool` and `rest` come from the same seeded shuffle, so the result
  // only ever depends on the seed, preserving reproducibility.
  private ensureRoleCoverage(pool: Hero[], rest: Hero[]): Hero[] {
    const isSupport = (h: Hero) => h.roles.includes('Support');
    const result = [...pool];

    if (!result.some(isSupport)) {
      const replacement = rest.find(isSupport);
      if (replacement) {
        // Every hero here is core (none are Support), so any slot is safe to give up.
        const removeIndex = result.length - 1;
        result[removeIndex] = replacement;
      }
    } else if (!result.some((h) => !isSupport(h))) {
      const replacement = rest.find((h) => !isSupport(h));
      if (replacement) {
        // Every hero here is Support, so any slot is safe to give up.
        const removeIndex = result.length - 1;
        result[removeIndex] = replacement;
      }
    }

    return result;
  }
}
