import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PoolPrismaService } from './pool-prisma.service';
import type { Prisma } from '../../generated/pool-client';
import { DraftService } from '../draft/draft.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CommitDraftResponse,
  PooledDraftSummary,
  PooledDraftSource,
  PooledHeroRole,
  LeaderboardEntryView,
  ResolvedOutcome,
  teamInitials,
  teamsMatch,
  type TiTeamCard,
} from 'shared';
import { pickWeightedOpponent } from './opponent-pool-pick';
import type { PoolPickRow } from './opponent-pool-pick';
import { parsePooledProMatchId, pooledProIdsForOpenDotaMatch } from './pooled-pro-id';

@Injectable()
export class OpponentPoolService {
  constructor(
    private readonly pool: PoolPrismaService,
    private readonly draftService: DraftService,
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  async commit(draftId: string, submitterToken: string): Promise<CommitDraftResponse> {
    const draft = await this.draftService.getById(draftId, submitterToken);
    if (draft.status !== 'COMPLETED') {
      throw new BadRequestException('Draft must be completed before it can be committed to the pool');
    }
    if (draft.mode !== 'battle') {
      throw new BadRequestException('Only Battle Mode drafts can be committed to the pool');
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

    const existing = await this.runPoolQuery(() =>
      this.pool.pooledDraft.findUnique({ where: { sourceDraftId: draftId } }),
    );
    if (existing) {
      return { id: existing.id, committedAt: existing.createdAt.toISOString() };
    }

    try {
      const created = await this.runPoolQuery(() =>
        this.pool.pooledDraft.create({
          data: {
            source: 'player',
            submitterToken,
            sourceDraftId: draftId,
            heroIds,
            heroRoles: heroRoles as unknown as Prisma.InputJsonValue,
            evaluationScore,
          },
        }),
      );
      return { id: created.id, committedAt: created.createdAt.toISOString() };
    } catch (err) {
      if (isUniqueConflict(err)) {
        const raced = await this.runPoolQuery(() =>
          this.pool.pooledDraft.findUnique({ where: { sourceDraftId: draftId } }),
        );
        if (raced) {
          return { id: raced.id, committedAt: raced.createdAt.toISOString() };
        }
      }
      throw err;
    }
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
  //
  // excludeHeroIds (Blueprint/10-tech-debt-backlog.md, "Механизм против
  // совпадения героев с оппонентом", by direct user request, full exclusion
  // on ANY overlap): a real Dota draft can never share a hero with its
  // opponent (both sides draw from the same 127-hero pool without repeats)
  // — the pool previously had no such check. Filtered in application code,
  // not SQL: `heroIds` is a JSON column on both SQLite (dev) and Postgres
  // (prod), and the pool is small enough (~100-ish rows) that loading
  // candidate rows into memory to filter is simpler than two JSON-query
  // dialects. Same fallback shape as excludingOwn above — if excluding every
  // overlapping draft would leave nothing to pull from, fall back to
  // allowing overlap rather than failing Battle Mode outright.
  // excludeFacedHeroSets (user, HARD constraint): the opponent lineups this run
  // has already fought (DraftService.getFacedOpponentHeroSets). A player must
  // never face the same opponent draft twice within one run — matched by the
  // 5-hero SET (order-independent), so two pool rows with the same heroes count
  // as the same opponent. Unlike excludeHeroIds/excludeSubmitterToken below,
  // this filter does NOT fall back to allowing a repeat if it empties the pool:
  // "hard" means a run that has fought every available opponent gets a clear
  // "no new opponents" error rather than a rerun. With ~150 pool rows and runs
  // of a handful of fights, that's effectively never hit in practice.
  async pullRandom(
    excludeSubmitterToken?: string,
    excludeHeroIds: number[] = [],
    excludeFacedHeroSets: number[][] = [],
    leagueContains?: string,
  ): Promise<PooledDraftSummary> {
    const heroSetKey = (ids: number[]): string => [...ids].sort((a, b) => a - b).join(',');
    return this.runPoolQuery(async () => {
      const excludingOwn = excludeSubmitterToken
        ? { OR: [{ submitterToken: null }, { NOT: { submitterToken: excludeSubmitterToken } }] }
        : {};

      let rows = await this.pool.pooledDraft.findMany({ where: excludingOwn });
      if (rows.length === 0) {
        rows = await this.pool.pooledDraft.findMany({ where: {} });
      }
      if (leagueContains) {
        const needle = leagueContains.toLowerCase();
        const filtered = rows.filter((r) => (r.leagueName ?? '').toLowerCase().includes(needle));
        if (filtered.length === 0) {
          throw new NotFoundException('No matching league drafts in the opponent pool for this TI run');
        }
        rows = filtered;
      }
      if (rows.length === 0) {
        throw new NotFoundException('Opponent Pool is empty — no opponent available yet');
      }

      if (excludeFacedHeroSets.length > 0) {
        const facedKeys = new Set(excludeFacedHeroSets.map(heroSetKey));
        rows = rows.filter((r) => !facedKeys.has(heroSetKey(r.heroIds as number[])));
        if (rows.length === 0) {
          throw new NotFoundException(
            'No new opponents left in the pool for this run — every available draft has been fought.',
          );
        }
      }

      if (excludeHeroIds.length > 0) {
        const excludeSet = new Set(excludeHeroIds);
        const noOverlap = rows.filter((r) => !(r.heroIds as number[]).some((id) => excludeSet.has(id)));
        if (noOverlap.length > 0) rows = noOverlap;
      }

      // Soft freshness / player-source bias (not a hard filter). Pro recency
      // uses match ids in `pro-${matchId}` — roughly monotonic with time —
      // so we don't need a ProMatch join on the pull path.
      const row = pickWeightedOpponent(rows as PoolPickRow[]);

      return {
        id: row.id,
        source: row.source as PooledDraftSource,
        heroIds: row.heroIds,
        heroRoles: (row.heroRoles as PooledHeroRole[] | null) ?? null,
        teamName: row.teamName ?? null,
        leagueName: row.leagueName ?? null,
        // Derived from the id, not a stored column — see seed-opponent-pool.ts
        // (`pro-${matchId}`) and PooledDraftSummary's matchId doc comment.
        matchId: row.source === 'pro' ? parsePooledProMatchId(row.id) : null,
      };
    });
  }

  async pullForTeam(
    teamName: string,
    leagueName: string,
    aliases: Record<string, string[]>,
    matchIds: string[],
    excludeHeroIds: number[] = [],
    excludeFacedHeroSets: number[][] = [],
  ): Promise<PooledDraftSummary> {
    const refine = (rows: PoolPickRow[]): PoolPickRow[] =>
      refineTeamRows(rows, matchIds, excludeHeroIds, excludeFacedHeroSets);

    const fromPool = await this.runPoolQuery(async () => {
      let ofTeam = (await this.leagueRows(leagueName)).filter((r) =>
        teamsMatch(r.teamName ?? '', teamName, aliases),
      );
      if (ofTeam.length === 0) {
        const loose = await this.pool.pooledDraft.findMany({
          where: { teamName: { contains: teamName } },
        });
        ofTeam = loose.filter((r) => teamsMatch(r.teamName ?? '', teamName, aliases));
      }
      const rows = refine(ofTeam as PoolPickRow[]);
      return rows.length > 0 ? pickWeightedOpponent(rows) : null;
    });
    if (fromPool) return toPooledSummary(fromPool);

    const local = refine(await this.localProTeamRows(teamName, leagueName, aliases));
    if (local.length > 0) return toPooledSummary(pickWeightedOpponent(local));

    throw new NotFoundException(`No pool drafts for ${teamName} at ${leagueName}`);
  }

  private async localProTeamRows(
    teamName: string,
    leagueName: string,
    aliases: Record<string, string[]>,
  ): Promise<PoolPickRow[]> {
    if (!this.prisma) return [];
    const matches = await this.prisma.proMatch.findMany({
      where: {
        OR: [{ radiantName: { contains: teamName } }, { direName: { contains: teamName } }],
      },
    });
    const mapped: PoolPickRow[] = [];
    for (const match of matches) {
      const radiant = teamsMatch(match.radiantName ?? '', teamName, aliases);
      const dire = teamsMatch(match.direName ?? '', teamName, aliases);
      if (!radiant && !dire) continue;
      const useRadiant = radiant;
      mapped.push({
        id: `pro-${match.id}`,
        source: 'pro',
        heroIds: JSON.parse(useRadiant ? match.radiantHeroIds : match.direHeroIds) as number[],
        heroRoles: parseJsonRoles(useRadiant ? match.radiantHeroRoles : match.direHeroRoles),
        teamName: useRadiant ? match.radiantName : match.direName,
        leagueName: match.leagueName,
      });
    }
    const sameLeague = mapped.filter((row) => {
      const name = row.leagueName ?? '';
      if (!name) return false;
      return name === leagueName || name.includes(leagueName) || leagueName.includes(name);
    });
    const year = /\b(20\d{2})\b/.exec(leagueName)?.[1];
    const sameYear = year
      ? mapped.filter((row) => (row.leagueName ?? '').includes(`International ${year}`))
      : [];
    if (sameLeague.length > 0) return sameLeague;
    if (sameYear.length > 0) return sameYear;
    return mapped;
  }

  async summarizeTeams(
    leagueName: string,
    teamNames: string[],
    aliases: Record<string, string[]>,
  ): Promise<TiTeamCard[]> {
    return this.runPoolQuery(async () => {
      const rows = await this.leagueRows(leagueName);
      const cards: TiTeamCard[] = [];
      for (const name of teamNames) {
        const ofTeam = rows.filter((r) => teamsMatch(r.teamName ?? '', name, aliases));
        if (ofTeam.length === 0) continue;
        const counts = new Map<string, number>();
        for (const row of ofTeam) {
          for (const role of (row.heroRoles as PooledHeroRole[] | null) ?? []) {
            const player = role.playerName?.trim();
            if (!player) continue;
            counts.set(player, (counts.get(player) ?? 0) + 1);
          }
        }
        const players = [...counts.entries()]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .slice(0, 5)
          .map(([player]) => player);
        cards.push({ name, players, initials: teamInitials(name) });
      }
      return cards;
    });
  }

  private async leagueRows(leagueName: string) {
    let rows = await this.pool.pooledDraft.findMany({
      where: { leagueName: { contains: leagueName } },
    });
    if (rows.length === 0) {
      const year = /\b(20\d{2})\b/.exec(leagueName)?.[1];
      if (year) {
        rows = await this.pool.pooledDraft.findMany({
          where: { leagueName: { contains: `International ${year}` } },
        });
      }
    }
    return rows;
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
  async getLeaderboard(limit: number, callerToken?: string | null): Promise<LeaderboardEntryView[]> {
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
        isMine: callerToken != null && row.submitterToken === callerToken,
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

function parseJsonRoles(raw: string | null): PooledHeroRole[] | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PooledHeroRole[];
  } catch {
    return null;
  }
}

function heroSetKey(ids: number[]): string {
  return [...ids].sort((a, b) => a - b).join(',');
}

function refineTeamRows(
  rows: PoolPickRow[],
  matchIds: string[],
  excludeHeroIds: number[],
  excludeFacedHeroSets: number[][],
): PoolPickRow[] {
  let next = rows;
  if (matchIds.length > 0) {
    const idSet = new Set(matchIds.flatMap((id) => pooledProIdsForOpenDotaMatch(id)));
    const staged = next.filter((r) => idSet.has(r.id));
    if (staged.length > 0) next = staged;
  }
  if (excludeFacedHeroSets.length > 0) {
    const facedKeys = new Set(excludeFacedHeroSets.map(heroSetKey));
    const fresh = next.filter((r) => !facedKeys.has(heroSetKey(r.heroIds)));
    if (fresh.length > 0) next = fresh;
  }
  if (excludeHeroIds.length > 0) {
    const excludeSet = new Set(excludeHeroIds);
    const noOverlap = next.filter((r) => !r.heroIds.some((id) => excludeSet.has(id)));
    if (noOverlap.length > 0) next = noOverlap;
  }
  return next;
}

function toPooledSummary(row: PoolPickRow): PooledDraftSummary {
  return {
    id: row.id,
    source: row.source as PooledDraftSource,
    heroIds: row.heroIds,
    heroRoles: (row.heroRoles as PooledHeroRole[] | null) ?? null,
    teamName: row.teamName ?? null,
    leagueName: row.leagueName ?? null,
    matchId: row.source === 'pro' ? parsePooledProMatchId(row.id) : null,
  };
}

function isUniqueConflict(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';
}
