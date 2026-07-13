import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PoolPrismaService } from './pool-prisma.service';
import { DraftService } from '../draft/draft.service';
import type { CommitDraftResponse, PooledDraftSummary, PooledDraftSource } from 'shared';

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

    const created = await this.runPoolQuery(() =>
      this.pool.pooledDraft.create({
        data: { source: 'player', submitterToken, heroIds },
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
        teamName: row.teamName,
        leagueName: row.leagueName,
      };
    });
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
