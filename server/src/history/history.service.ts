import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { HeroService } from '../hero/hero.service';
import {
  deriveTiPlacement,
  tiBracketById,
  type DraftMode,
  type EvaluationResult,
  type HistoryEntry,
  type HistoryTiSummary,
  type TiPathFight,
} from 'shared';

@Injectable()
export class HistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly heroService: HeroService,
  ) {}

  async findAll(ownerToken: string): Promise<HistoryEntry[]> {
    const drafts = await this.prisma.draft.findMany({
      where: { status: 'COMPLETED', ownerToken, NOT: { mode: 'captains_ai' } },
      include: { heroes: true, battleResults: { orderBy: { createdAt: 'desc' } } },
      orderBy: { createdAt: 'desc' },
    });

    const tiRuns = await this.prisma.tiRun.findMany({
      where: { draftId: { in: drafts.map((d) => d.id) } },
    });
    const tiByDraft = new Map(tiRuns.map((r) => [r.draftId, r]));

    const allHeroIds = [
      ...drafts.flatMap((d) => d.heroes.map((h) => h.heroId)),
      ...drafts.flatMap((d) =>
        d.battleResults.flatMap((b) => {
          try {
            return JSON.parse(b.opponentHeroIds) as number[];
          } catch {
            return [];
          }
        }),
      ),
    ];
    const heroes = await this.heroService.findByIds(allHeroIds);
    const heroById = new Map(heroes.map((h) => [h.id, h]));

    return drafts.map((draft) => {
      const tiRow = tiByDraft.get(draft.id);
      let ti: HistoryTiSummary | null = null;
      if (tiRow?.teamName) {
        const status =
          tiRow.status === 'CHAMPION' || tiRow.status === 'ELIMINATED' || tiRow.status === 'PLAYING'
            ? tiRow.status
            : 'PLAYING';
        const path = parseTiPath(tiRow.pathJson);
        const matches = tiBracketById(tiRow.bracketId)?.matches ?? [];
        const placement = deriveTiPlacement({ status, path, matches });
        ti = {
          runId: tiRow.id,
          leagueName: tiRow.leagueName,
          teamName: tiRow.teamName,
          status,
          placement: placement.kind,
          lastRound: placement.lastRound,
        };
      }
      return {
        id: draft.id,
        mode: (draft.mode || 'battle') as DraftMode,
        createdAt: draft.createdAt.toISOString(),
        heroes: draft.heroes
          .sort((a, b) => a.pickOrder - b.pickOrder)
          .map((dh) => ({
            heroId: dh.heroId,
            heroName: heroById.get(dh.heroId)?.name ?? 'Unknown',
            assignedRole: dh.assignedRole,
            pickOrder: dh.pickOrder,
          })),
        evaluation: draft.evaluationResult ? (JSON.parse(draft.evaluationResult) as EvaluationResult) : null,
        battles: draft.battleResults.map((b) => {
          let opponentHeroIds: number[] = [];
          try {
            opponentHeroIds = JSON.parse(b.opponentHeroIds) as number[];
          } catch {
            opponentHeroIds = [];
          }
          return {
            id: b.id,
            resolvedOutcome: b.resolvedOutcome,
            advantageDirection: b.advantageDirection,
            confidenceTier: b.confidenceTier,
            opponentSource: b.opponentSource,
            opponentTeamName: b.opponentTeamName,
            opponentLeagueName: b.opponentLeagueName,
            opponentHeroIds,
            stage: b.stage ?? null,
            opponentMatchId: b.opponentMatchId ?? null,
            createdAt: b.createdAt.toISOString(),
          };
        }),
        ti,
      };
    });
  }
}

function parseTiPath(json: string | null | undefined): TiPathFight[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as TiPathFight[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
