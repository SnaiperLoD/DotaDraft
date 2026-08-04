import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { HeroService } from '../hero/hero.service';
import { ROLES, type Hero } from 'shared';

const POOL_SIZE = 5;
const ROUNDS = 5;

export interface DraftHeroView {
  heroId: number;
  hero: Hero;
  assignedRole: string | null;
  pickOrder: number;
}

export interface DraftStateView {
  id: string;
  status: string;
  heroes: DraftHeroView[];
  pool: Hero[];
  createdAt: Date;
  rerollsRemaining: number;
}

@Injectable()
export class DraftService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly heroService: HeroService,
  ) {}

  private async toView(draft: {
    id: string;
    status: string;
    pool: unknown;
    createdAt: Date;
    rerollsRemaining: number;
    heroes: { heroId: number; assignedRole: string | null; pickOrder: number }[];
  }): Promise<DraftStateView> {
    const poolIds = JSON.parse(draft.pool as string) as number[];
    const pickedIds = draft.heroes.map((h) => h.heroId);
    const [poolHeroes, pickedHeroes] = await Promise.all([
      this.heroService.findByIds(poolIds),
      this.heroService.findByIds(pickedIds),
    ]);
    const heroById = new Map(pickedHeroes.map((h) => [h.id, h]));

    return {
      id: draft.id,
      status: draft.status,
      pool: poolHeroes,
      createdAt: draft.createdAt,
      rerollsRemaining: draft.rerollsRemaining,
      heroes: draft.heroes
        .sort((a, b) => a.pickOrder - b.pickOrder)
        .map((dh) => ({
          heroId: dh.heroId,
          hero: heroById.get(dh.heroId) as Hero,
          assignedRole: dh.assignedRole,
          pickOrder: dh.pickOrder,
        })),
    };
  }

  async start(): Promise<DraftStateView> {
    const seed = Math.floor(Math.random() * 2 ** 31);
    const pool = await this.heroService.randomPool([], POOL_SIZE, seed);
    const draft = await this.prisma.draft.create({
      data: {
        seed,
        pool: JSON.stringify(pool.map((h) => h.id)),
        status: 'PICKING',
      },
      include: { heroes: true },
    });
    return this.toView(draft);
  }

  async getById(draftId: string): Promise<DraftStateView> {
    const draft = await this.prisma.draft.findUnique({
      where: { id: draftId },
      include: { heroes: true },
    });
    if (!draft) throw new NotFoundException('Draft not found');
    return this.toView(draft);
  }

  // Blueprint/10-tech-debt-backlog.md, "Лидерборд драфтов" — read at commit
  // time (OpponentPoolService.commit()) to snapshot the draft's evaluation
  // score into the shared pool. Not part of DraftStateView (that's the
  // draft-flow UI shape) — a narrow read, not a general-purpose accessor.
  async getEvaluationScore(draftId: string): Promise<number | null> {
    const draft = await this.prisma.draft.findUnique({
      where: { id: draftId },
      select: { evaluationResult: true },
    });
    if (!draft?.evaluationResult) return null;
    const parsed = JSON.parse(draft.evaluationResult) as { totalScore: number };
    return parsed.totalScore;
  }

  // Persists the most recent EvaluationResult for History (Blueprint/10-tech-debt-backlog.md,
  // "Сохранять в истории результаты боёв") — called by EvaluationService
  // after computing a result, not versioned (overwrites on re-evaluate).
  async saveEvaluationResult(draftId: string, resultJson: string): Promise<void> {
    await this.prisma.draft.update({
      where: { id: draftId },
      data: { evaluationResult: resultJson },
    });
  }

  // One row per Battle Mode fight, for History's expandable battle list
  // (Blueprint/10-tech-debt-backlog.md, "Сохранять в истории результаты
  // боёв") — called by BattleService.fight() after resolveBattle().
  async saveBattleResult(
    draftId: string,
    result: {
      resolvedOutcome: string;
      advantageDirection: string;
      confidenceTier: string;
      opponentSource: string;
      opponentTeamName: string | null;
      opponentLeagueName: string | null;
      opponentHeroIds: number[];
    },
  ): Promise<void> {
    await this.prisma.battleResult.create({
      data: {
        draftId,
        resolvedOutcome: result.resolvedOutcome,
        advantageDirection: result.advantageDirection,
        confidenceTier: result.confidenceTier,
        opponentSource: result.opponentSource,
        opponentTeamName: result.opponentTeamName,
        opponentLeagueName: result.opponentLeagueName,
        opponentHeroIds: JSON.stringify(result.opponentHeroIds),
      },
    });
  }

  async pick(draftId: string, heroId: number): Promise<DraftStateView> {
    const draft = await this.prisma.draft.findUnique({
      where: { id: draftId },
      include: { heroes: true },
    });
    if (!draft) throw new NotFoundException('Draft not found');
    if (draft.status !== 'PICKING') {
      throw new BadRequestException('Draft is not in picking phase');
    }

    const poolIds = JSON.parse(draft.pool) as number[];
    if (!poolIds.includes(heroId)) {
      throw new BadRequestException('Hero is not in current pool');
    }

    const pickOrder = draft.heroes.length + 1;
    await this.prisma.draftHero.create({
      data: { draftId, heroId, pickOrder },
    });

    const pickedIds = [...draft.heroes.map((h) => h.heroId), heroId];
    const isComplete = pickOrder === ROUNDS;

    const nextPool = isComplete
      ? []
      : (await this.heroService.randomPool(pickedIds, POOL_SIZE, draft.seed + pickOrder)).map((h) => h.id);

    const updated = await this.prisma.draft.update({
      where: { id: draftId },
      data: {
        pool: JSON.stringify(nextPool),
        status: isComplete ? 'ASSIGNING_ROLES' : 'PICKING',
      },
      include: { heroes: true },
    });

    return this.toView(updated);
  }

  // One-time reroll of the CURRENT round's offered pool (Blueprint/10-tech-debt-backlog.md,
  // "Кнопка реролла пула героев") — not a per-round allowance, `rerollsRemaining`
  // is set once at draft creation and never replenished. Uses a fresh
  // random seed (unlike pick()'s `draft.seed + pickOrder`, which is part of
  // the deterministic replay chain for subsequent rounds) since a reroll is
  // a one-off player action, not something that needs to reproduce from
  // the original seed.
  async reroll(draftId: string): Promise<DraftStateView> {
    const draft = await this.prisma.draft.findUnique({
      where: { id: draftId },
      include: { heroes: true },
    });
    if (!draft) throw new NotFoundException('Draft not found');
    if (draft.status !== 'PICKING') {
      throw new BadRequestException('Draft is not in picking phase');
    }
    if (draft.rerollsRemaining <= 0) {
      throw new BadRequestException('No rerolls remaining');
    }

    const pickedIds = draft.heroes.map((h) => h.heroId);
    const newSeed = Math.floor(Math.random() * 2 ** 31);
    const newPool = (await this.heroService.randomPool(pickedIds, POOL_SIZE, newSeed)).map((h) => h.id);

    const updated = await this.prisma.draft.update({
      where: { id: draftId },
      data: {
        pool: JSON.stringify(newPool),
        rerollsRemaining: draft.rerollsRemaining - 1,
      },
      include: { heroes: true },
    });

    return this.toView(updated);
  }

  async assignRoles(
    draftId: string,
    assignments: { heroId: number; role: string }[],
  ): Promise<DraftStateView> {
    const draft = await this.prisma.draft.findUnique({
      where: { id: draftId },
      include: { heroes: true },
    });
    if (!draft) throw new NotFoundException('Draft not found');
    if (draft.status !== 'ASSIGNING_ROLES') {
      throw new BadRequestException('Draft is not in role assignment phase');
    }

    const pickedIds = new Set(draft.heroes.map((h) => h.heroId));
    if (assignments.length !== ROUNDS) {
      throw new BadRequestException(`Expected ${ROUNDS} role assignments`);
    }
    for (const a of assignments) {
      if (!pickedIds.has(a.heroId)) {
        throw new BadRequestException(`Hero ${a.heroId} is not part of this draft`);
      }
      if (!(ROLES as readonly string[]).includes(a.role)) {
        throw new BadRequestException(`Invalid role: ${a.role}`);
      }
    }
    const assignedHeroIds = new Set(assignments.map((a) => a.heroId));
    if (assignedHeroIds.size !== ROUNDS) {
      throw new BadRequestException('Each hero must receive exactly one role');
    }
    const assignedRoles = new Set(assignments.map((a) => a.role));
    if (assignedRoles.size !== ROUNDS) {
      throw new BadRequestException('Each role must be assigned to exactly one hero');
    }

    await this.prisma.$transaction(
      assignments.map((a) =>
        this.prisma.draftHero.update({
          where: { draftId_heroId: { draftId, heroId: a.heroId } },
          data: { assignedRole: a.role },
        }),
      ),
    );

    const updated = await this.prisma.draft.update({
      where: { id: draftId },
      data: { status: 'COMPLETED' },
      include: { heroes: true },
    });

    return this.toView(updated);
  }
}
