import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { HeroService } from '../hero/hero.service';
import type { HistoryEntry } from 'shared';

@Injectable()
export class HistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly heroService: HeroService,
  ) {}

  async findAll(): Promise<HistoryEntry[]> {
    const drafts = await this.prisma.draft.findMany({
      where: { status: 'COMPLETED' },
      include: { heroes: true },
      orderBy: { createdAt: 'desc' },
    });

    const allHeroIds = drafts.flatMap((d) => d.heroes.map((h) => h.heroId));
    const heroes = await this.heroService.findByIds(allHeroIds);
    const heroById = new Map(heroes.map((h) => [h.id, h]));

    return drafts.map((draft) => ({
      id: draft.id,
      createdAt: draft.createdAt.toISOString(),
      heroes: draft.heroes
        .sort((a, b) => a.pickOrder - b.pickOrder)
        .map((dh) => ({
          heroId: dh.heroId,
          heroName: heroById.get(dh.heroId)?.name ?? 'Unknown',
          assignedRole: dh.assignedRole,
          pickOrder: dh.pickOrder,
        })),
    }));
  }
}
