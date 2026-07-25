import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { seededShuffle } from '../common/random';
import type { Hero } from 'shared';

// Guarantees at least one Support hero and one non-Support ("core") hero in
// every offered pool, since >5 rounds a purely random draw of 5 from 127
// heroes is meaningfully likely to skip Support entirely and occasionally
// skip core too. Stays deterministic: both `pool` and `rest` come from the
// same seeded shuffle, so the result only ever depends on the seed,
// preserving reproducibility. Exported as a standalone function (rather
// than a private method) so it can be unit tested without fighting the
// shuffle RNG for a seed that happens to reproduce the edge case.
//
// "Support" is read from real GPM-rank data (`presumed_positions`, same
// source `common/hard-carry.ts::isHardCarry()` already trusts for "is this
// hero actually X in practice"), not the hand-authored `roles` tag —
// 23/127 heroes disagree between the two (e.g. Pugna/Nyx Assassin/Bounty
// Hunter/Tusk/Clockwerk/Spirit Breaker/Techies are tagged non-Support but
// are real Support in the overwhelming majority of their games), which
// meant the guarantee this function exists to provide could silently not
// hold for those heroes. Falls back to the `roles` tag only when a hero has
// no position data at all (empty `presumed_positions` — not expected for
// any of the current 127, but the old sole signal stays as a safety net).
export function ensureRoleCoverage(pool: Hero[], rest: Hero[]): Hero[] {
  const isSupport = (h: Hero) =>
    h.presumed_positions.length > 0
      ? h.presumed_positions.some((p) => p.position === 'Support')
      : h.roles.includes('Support');
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
    return ensureRoleCoverage(pool, rest);
  }
}
