import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { HeroService } from '../hero/hero.service';
import {
  ROLES,
  type DraftPoolResponse,
  type Hero,
  type PooledHeroRole,
  type RunLeaderboardEntry,
} from 'shared';

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

  private requireOwnerToken(ownerToken: string): string {
    const token = ownerToken?.trim() ?? '';
    if (!token) throw new UnauthorizedException('Missing owner token');
    return token;
  }

  private async loadOwned(
    draftId: string,
    ownerToken: string,
    db: { draft: { findUnique: PrismaService['draft']['findUnique'] } } = this.prisma,
  ) {
    const token = this.requireOwnerToken(ownerToken);
    const draft = await db.draft.findUnique({
      where: { id: draftId },
      include: { heroes: true },
    });
    if (!draft || draft.ownerToken !== token) {
      throw new NotFoundException('Draft not found');
    }
    return draft;
  }

  // Round 1's pool, generated and deliberately NOT persisted. Replaces the
  // old start(), which wrote a Draft row the moment the page opened.
  //
  // Being side-effect-free is the point: opening (or reloading, or
  // StrictMode double-mounting) the draft page can now call this as often
  // as it likes and the database is untouched.
  async generatePool(): Promise<DraftPoolResponse> {
    const seed = Math.floor(Math.random() * 2 ** 31);
    const pool = await this.heroService.randomPool([], POOL_SIZE, seed);
    return { seed, pool };
  }

  // The Draft row is created by the FIRST PICK, not by opening the page.
  // Under the old flow every abandoned visit left an empty draft behind:
  // 383 of the 393 PICKING rows in the dev database had zero picks when
  // this was changed.
  //
  // The row and its first DraftHero go in as one nested create, which is
  // what actually enforces the rule rather than merely arranging for it —
  // there is no code path anywhere that inserts a Draft without a hero.
  //
  // `seed` comes from the client (it's what generatePool() handed out) but
  // is not trusted to describe the pool: the round-1 pool is recomputed
  // from it here and the pick validated against that, the same way pick()
  // validates against the stored pool.
  async create(
    seed: number,
    heroId: number,
    rerollUsed: boolean,
    ownerToken: string,
  ): Promise<DraftStateView> {
    const token = this.requireOwnerToken(ownerToken);
    const pool = await this.heroService.randomPool([], POOL_SIZE, seed);
    if (!pool.some((h) => h.id === heroId)) {
      throw new BadRequestException('Hero is not in current pool');
    }

    // Same successor-seed rule as pick()'s `draft.seed + pickOrder`, with
    // pickOrder = 1 — round 2's pool has to come out identical either way.
    // Excludes the WHOLE round-1 pool, not just the picked hero, so no hero
    // shown this round can reappear next round (user: no repeats between
    // consecutive draft stages). The picked hero is in `pool`, so it's covered.
    const nextPool = (
      await this.heroService.randomPool(
        pool.map((h) => h.id),
        POOL_SIZE,
        seed + 1,
      )
    ).map((h) => h.id);

    const draft = await this.prisma.draft.create({
      data: {
        seed,
        pool: JSON.stringify(nextPool),
        status: 'PICKING',
        rerollsRemaining: rerollUsed ? 0 : 1,
        ownerToken: token,
        heroes: { create: { heroId, pickOrder: 1 } },
      },
      include: { heroes: true },
    });

    return this.toView(draft);
  }

  async getById(draftId: string, ownerToken: string): Promise<DraftStateView> {
    return this.toView(await this.loadOwned(draftId, ownerToken));
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

  // "Best Runs" leaderboard (Blueprint/10-tech-debt-backlog.md, "Лидерборд
  // драфтов" — two-part split): the calling-player side the pool board does
  // NOT track. A "run" is one draft the player fought Battle Mode with in a
  // session; its record is aggregated from that draftId's BattleResult rows
  // (resolvedOutcome is stored from the CALLING player's perspective, see
  // BattleService.fight()). Scoped to the anonymous ownerToken — this is
  // the caller's board, not a global dump of every visitor's runs.
  //
  // minFights gates out noisy short runs (a 1-fight 100% run isn't a "run") —
  // set high (5) deliberately, this board is meant to reward sustained
  // sessions, not one-offs. Ranked wins-first then win rate, same shape as the
  // pool board's getLeaderboard(). resolvedOutcome is only ever 'Win'/'Lose'
  // (Battle Mode always coin-flips to one, never 'Even' at this layer), so a
  // non-'Win' row is counted as a loss.
  async getBestRuns(limit: number, minFights: number, ownerToken: string): Promise<RunLeaderboardEntry[]> {
    const token = this.requireOwnerToken(ownerToken);
    const grouped = await this.prisma.battleResult.groupBy({
      by: ['draftId', 'resolvedOutcome'],
      where: { draft: { ownerToken: token } },
      _count: { _all: true },
    });

    const tally = new Map<string, { wins: number; losses: number }>();
    for (const g of grouped) {
      const rec = tally.get(g.draftId) ?? { wins: 0, losses: 0 };
      if (g.resolvedOutcome === 'Win') rec.wins += g._count._all;
      else rec.losses += g._count._all;
      tally.set(g.draftId, rec);
    }

    const qualifying = [...tally.entries()]
      .map(([draftId, r]) => ({
        draftId,
        wins: r.wins,
        losses: r.losses,
        total: r.wins + r.losses,
        winRate: r.wins / (r.wins + r.losses),
      }))
      .filter((r) => r.total >= minFights)
      .sort((a, b) => b.wins - a.wins || b.winRate - a.winRate)
      .slice(0, limit);

    if (qualifying.length === 0) return [];

    // Fetch draft details only for the winners (heroes + roles + eval score).
    const drafts = await this.prisma.draft.findMany({
      where: { id: { in: qualifying.map((r) => r.draftId) }, ownerToken: token },
      include: { heroes: true },
    });
    const draftById = new Map(drafts.map((d) => [d.id, d]));

    return qualifying.map((r) => {
      const draft = draftById.get(r.draftId);
      const heroes = (draft?.heroes ?? []).slice().sort((a, b) => a.pickOrder - b.pickOrder);
      const heroRoles: PooledHeroRole[] | null = heroes.every((h) => h.assignedRole)
        ? heroes.map((h) => ({ heroId: h.heroId, role: h.assignedRole as string }))
        : null;
      let evaluationScore: number | null = null;
      if (draft?.evaluationResult) {
        try {
          evaluationScore = (JSON.parse(draft.evaluationResult) as { totalScore: number }).totalScore;
        } catch {
          evaluationScore = null;
        }
      }
      return {
        draftId: r.draftId,
        heroIds: heroes.map((h) => h.heroId),
        heroRoles,
        evaluationScore,
        wins: r.wins,
        losses: r.losses,
        winRate: r.winRate,
      };
    });
  }

  // Every opponent lineup this draft (= this run) has already fought, as
  // hero-id arrays — read from its BattleResult rows' denormalized
  // opponentHeroIds. Battle Mode uses this to guarantee a player never faces
  // the same opponent draft twice within one run (user, hard constraint):
  // OpponentPoolService.pullRandom filters these out. A "run" is one draftId,
  // so scoping the query to draftId is exactly this session's history.
  async getFacedOpponentHeroSets(draftId: string): Promise<number[][]> {
    const rows = await this.prisma.battleResult.findMany({
      where: { draftId },
      select: { opponentHeroIds: true },
    });
    return rows.map((r) => JSON.parse(r.opponentHeroIds) as number[]);
  }

  async pick(draftId: string, heroId: number, ownerToken: string): Promise<DraftStateView> {
    return this.prisma.$transaction(async (tx) => {
      const draft = await this.loadOwned(draftId, ownerToken, tx);
      if (draft.heroes.some((h) => h.heroId === heroId)) {
        return this.toView(draft);
      }
      if (draft.status !== 'PICKING') {
        throw new BadRequestException('Draft is not in picking phase');
      }

      const poolIds = JSON.parse(draft.pool) as number[];
      if (!poolIds.includes(heroId)) {
        throw new BadRequestException('Hero is not in current pool');
      }

      const pickOrder = draft.heroes.length + 1;
      await tx.draftHero.create({
        data: { draftId, heroId, pickOrder },
      });

      const pickedIds = [...draft.heroes.map((h) => h.heroId), heroId];
      const isComplete = pickOrder === ROUNDS;

      // Exclude everything picked AND the pool just shown (poolIds), so a hero
      // offered this round can't reappear next round — no repeats between
      // consecutive draft stages (user).
      const excludeIds = [...new Set([...pickedIds, ...poolIds])];
      const nextPool = isComplete
        ? []
        : (await this.heroService.randomPool(excludeIds, POOL_SIZE, draft.seed + pickOrder)).map((h) => h.id);

      const updated = await tx.draft.update({
        where: { id: draftId },
        data: {
          pool: JSON.stringify(nextPool),
          status: isComplete ? 'ASSIGNING_ROLES' : 'PICKING',
        },
        include: { heroes: true },
      });

      return this.toView(updated);
    });
  }

  // One-time reroll of the CURRENT round's offered pool (Blueprint/10-tech-debt-backlog.md,
  // "Кнопка реролла пула героев") — not a per-round allowance, `rerollsRemaining`
  // is set once at draft creation and never replenished. Uses a fresh
  // random seed (unlike pick()'s `draft.seed + pickOrder`, which is part of
  // the deterministic replay chain for subsequent rounds) since a reroll is
  // a one-off player action, not something that needs to reproduce from
  // the original seed.
  async reroll(draftId: string, ownerToken: string): Promise<DraftStateView> {
    const token = this.requireOwnerToken(ownerToken);
    const draft = await this.loadOwned(draftId, ownerToken);
    if (draft.status !== 'PICKING') {
      throw new BadRequestException('Draft is not in picking phase');
    }
    if (draft.rerollsRemaining <= 0) {
      throw new BadRequestException('No rerolls remaining');
    }

    const pickedIds = draft.heroes.map((h) => h.heroId);
    const newSeed = Math.floor(Math.random() * 2 ** 31);
    const newPool = (await this.heroService.randomPool(pickedIds, POOL_SIZE, newSeed)).map((h) => h.id);

    const claimed = await this.prisma.draft.updateMany({
      where: { id: draftId, ownerToken: token, status: 'PICKING', rerollsRemaining: { gt: 0 } },
      data: {
        pool: JSON.stringify(newPool),
        rerollsRemaining: { decrement: 1 },
      },
    });
    if (claimed.count === 0) {
      const again = await this.loadOwned(draftId, ownerToken);
      if (again.status !== 'PICKING') {
        throw new BadRequestException('Draft is not in picking phase');
      }
      throw new BadRequestException('No rerolls remaining');
    }

    const updated = await this.prisma.draft.findUnique({
      where: { id: draftId },
      include: { heroes: true },
    });
    return this.toView(updated!);
  }

  async assignRoles(
    draftId: string,
    assignments: { heroId: number; role: string }[],
    ownerToken: string,
  ): Promise<DraftStateView> {
    return this.prisma.$transaction(async (tx) => {
      const draft = await this.loadOwned(draftId, ownerToken, tx);
      if (draft.status === 'COMPLETED') {
        return this.toView(draft);
      }
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

      for (const a of assignments) {
        await tx.draftHero.update({
          where: { draftId_heroId: { draftId, heroId: a.heroId } },
          data: { assignedRole: a.role },
        });
      }

      const updated = await tx.draft.update({
        where: { id: draftId },
        data: { status: 'COMPLETED' },
        include: { heroes: true },
      });

      return this.toView(updated);
    });
  }
}
