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
    return seededShuffle(available, seed).slice(0, size);
  }
}
