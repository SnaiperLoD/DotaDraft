import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { HeroService } from '../hero/hero.service';
import type { HistoryEntry, EvaluationResult } from 'shared';

@Injectable()
export class HistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly heroService: HeroService,
  ) {}

  async findAll(ownerToken: string): Promise<HistoryEntry[]> {
    const drafts = await this.prisma.draft.findMany({
      where: { status: 'COMPLETED', ownerToken },
      include: { heroes: true, battleResults: { orderBy: { createdAt: 'desc' } } },
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
      // Stored as a full JSON snapshot (see EvaluationService.evaluate()) —
      // parsed here rather than re-run through the live calibration, so
      // History shows what the draft evaluated as, not a fresh recompute.
      evaluation: draft.evaluationResult ? (JSON.parse(draft.evaluationResult) as EvaluationResult) : null,
      battles: draft.battleResults.map((b) => ({
        id: b.id,
        resolvedOutcome: b.resolvedOutcome,
        advantageDirection: b.advantageDirection,
        confidenceTier: b.confidenceTier,
        opponentSource: b.opponentSource,
        opponentTeamName: b.opponentTeamName,
        opponentLeagueName: b.opponentLeagueName,
        createdAt: b.createdAt.toISOString(),
      })),
    }));
  }
}
