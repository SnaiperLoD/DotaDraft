import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PoolPrismaService } from './pool-prisma.service';
import type { Prisma } from '../../generated/pool-client';
import { DraftService } from '../draft/draft.service';
import type {
  CommitDraftResponse,
  PooledDraftSummary,
  PooledDraftSource,
  PooledHeroRole,
  LeaderboardEntryView,
  ResolvedOutcome,
} from 'shared';

@Injectable()
export class OpponentPoolService {
  constructor(
    private readonly pool: PoolPrismaService,
    private readonly draftService: DraftService,
  ) {}

  async commit(draftId: string, submitterToken: string): Promise<CommitDraftResponse> {
    const draft = await this.draftService.getById(draftId);
    if (draft.status !== 'COMPLETED') {
      throw new BadRequestException('Draft must be completed before it can be committed to the pool');
    }

    const heroIds = draft.heroes.map((h) => h.heroId);
    // assignedRole is guaranteed non-null here — status === 'COMPLETED'
    // means ASSIGNING_ROLES already ran (see draft.service.ts).
    const heroRoles: PooledHeroRole[] = draft.heroes.map((h) => ({
      heroId: h.heroId,
      role: h.assignedRole!,
    }));
    // Blueprint/10-tech-debt-backlog.md, "Лидерборд драфтов" — a snapshot,
    // not a live link: null if the player never clicked Evaluate Draft
    // before committing (Evaluate and Commit are independent actions, see
    // DraftPage.tsx).
    const evaluationScore = await this.draftService.getEvaluationScore(draftId);

    const created = await this.runPoolQuery(() =>
      this.pool.pooledDraft.create({
        data: {
          source: 'player',
          submitterToken,
          heroIds,
          heroRoles: heroRoles as unknown as Prisma.InputJsonValue,
          evaluationScore,
        },
      }),
    );

    return { id: created.id, committedAt: created.createdAt.toISOString() };
  }

  // Excludes the caller's own token where possible so a lone player doesn't
  // immediately fight their own committed draft — falls back to the full
  // pool if excluding would leave nothing (e.g. only one draft exists).
  //
  // `NOT: { submitterToken: token } }` alone is a SQL trap here: standard
  // three-valued logic means `submitterToken != token` evaluates to NULL
  // (not true) for every pro-sourced row, whose submitterToken is NULL —
  // so it would silently exclude the entire pro tier along with the
  // caller's own draft. The explicit OR keeps NULL rows in.
  async pullRandom(excludeSubmitterToken?: string): Promise<PooledDraftSummary> {
    return this.runPoolQuery(async () => {
      const excludingOwn = excludeSubmitterToken
        ? { OR: [{ submitterToken: null }, { NOT: { submitterToken: excludeSubmitterToken } }] }
        : {};

      let count = await this.pool.pooledDraft.count({ where: excludingOwn });
      let where = excludingOwn;
      if (count === 0) {
        count = await this.pool.pooledDraft.count();
        where = {};
      }
      if (count === 0) {
        throw new NotFoundException('Opponent Pool is empty — no opponent available yet');
      }

      const skip = Math.floor(Math.random() * count);
      const [row] = await this.pool.pooledDraft.findMany({ where, skip, take: 1 });

      return {
        id: row.id,
        source: row.source as PooledDraftSource,
        heroIds: row.heroIds as number[],
        heroRoles: (row.heroRoles as PooledHeroRole[] | null) ?? null,
        teamName: row.teamName,
        leagueName: row.leagueName,
        // Derived from the id, not a stored column — see seed-opponent-pool.ts
        // (`pro-${matchId}`) and PooledDraftSummary's matchId doc comment.
        matchId: row.source === 'pro' ? row.id.replace(/^pro-/, '') : null,
      };
    });
  }

  // "Weak" leaderboard, v2 — Blueprint/10-tech-debt-backlog.md, "Лидерборд
  // драфтов". Records the outcome for a specific PooledDraft as the
  // OPPONENT it was pulled as (BattleService.fight() calls this with the
  // opponent's id and the INVERSE of the calling player's own outcome —
  // this draft won/lost from its own perspective, not the caller's). Not
  // the calling player's own battle record — that's not tracked at all
  // anymore (superseded the earlier submitterToken-keyed version, which
  // tracked the wrong thing for what "лидерборд драфтов" asks for). Same
  // best-effort-at-the-call-site pattern as saveBattleResult.
  async recordDraftOutcome(pooledDraftId: string, outcome: ResolvedOutcome): Promise<void> {
    await this.runPoolQuery(() =>
      this.pool.pooledDraft.update({
        where: { id: pooledDraftId },
        data: outcome === 'Win' ? { wins: { increment: 1 } } : { losses: { increment: 1 } },
      }),
    );
  }

  // Ranked by wins first (the simple, gameable-by-design metric this
  // "weak" leaderboard is upfront about — see PooledDraft's doc comment in
  // prisma-pool/schema.prisma), win rate as a tiebreaker among equal win
  // counts. Only rows that have actually been fought at least once
  // (wins+losses > 0) — an unfought committed draft isn't a leaderboard
  // entry, just an unused pool row.
  async getLeaderboard(limit: number): Promise<LeaderboardEntryView[]> {
    const rows = await this.runPoolQuery(() =>
      this.pool.pooledDraft.findMany({ where: { OR: [{ wins: { gt: 0 } }, { losses: { gt: 0 } }] } }),
    );
    return rows
      .map((row) => ({
        id: row.id,
        source: row.source as PooledDraftSource,
        heroIds: row.heroIds as number[],
        heroRoles: (row.heroRoles as PooledHeroRole[] | null) ?? null,
        teamName: row.teamName,
        leagueName: row.leagueName,
        evaluationScore: row.evaluationScore,
        submitterToken: row.submitterToken,
        wins: row.wins,
        losses: row.losses,
        winRate: row.wins + row.losses > 0 ? row.wins / (row.wins + row.losses) : 0,
      }))
      .sort((a, b) => b.wins - a.wins || b.winRate - a.winRate)
      .slice(0, limit);
  }

  private async runPoolQuery<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof NotFoundException || err instanceof BadRequestException) throw err;
      const message = (err as Error).message ?? '';
      if (message.includes('POOL_DATABASE_URL') || message.includes("Can't reach database")) {
        throw new ServiceUnavailableException(
          'Opponent Pool storage is not reachable — POOL_DATABASE_URL may not be configured yet (see server/.env).',
        );
      }
      throw err;
    }
  }
}
