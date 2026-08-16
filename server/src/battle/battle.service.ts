import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DraftService } from '../draft/draft.service';
import { HeroService } from '../hero/hero.service';
import { HeroMetaService } from '../hero-meta/hero-meta.service';
import { OpponentPoolService } from '../opponent-pool/opponent-pool.service';
import { resolveBattle, type BattlePick } from './battle-resolution';
import { alignOpponentToRoles } from './opponent-alignment';
import { ROLES } from 'shared';
import type { BattleLaneResult, BattleResultResponse, DraftRole, Hero, ResolvedOutcome } from 'shared';

const LANE_ROLES: {
  lane: BattleLaneResult['lane'];
  mine: DraftRole[];
  opponent: DraftRole[];
}[] = [
  { lane: 'safe', mine: ['Carry', 'Hard Support'], opponent: ['Offlane', 'Soft Support'] },
  { lane: 'mid', mine: ['Mid'], opponent: ['Mid'] },
  { lane: 'off', mine: ['Offlane', 'Soft Support'], opponent: ['Carry', 'Hard Support'] },
];

function buildLaneResults(
  mineByRole: Map<string, Hero>,
  opponentByRole: Map<string, Hero>,
  lookup: HeroMetaService,
): BattleLaneResult[] {
  return LANE_ROLES.map((spec) => {
    const mine = spec.mine.map((role) => mineByRole.get(role)).filter((hero): hero is Hero => hero != null);
    const opponent = spec.opponent
      .map((role) => opponentByRole.get(role))
      .filter((hero): hero is Hero => hero != null);
    const edges: number[] = [];
    for (const hero of mine) {
      for (const enemy of opponent) {
        const winRate = lookup.getMatchupWinRate(hero.id, enemy.id);
        if (winRate !== null) edges.push(winRate - 0.5);
      }
    }
    const averageEdge = edges.length > 0 ? edges.reduce((sum, edge) => sum + edge, 0) / edges.length : 0;
    return {
      lane: spec.lane,
      mine: mine.map((hero) => hero.name),
      opponent: opponent.map((hero) => hero.name),
      winner: averageEdge > 0 ? 'mine' : averageEdge < 0 ? 'opponent' : 'even',
    };
  });
}

@Injectable()
export class BattleService {
  constructor(
    private readonly draftService: DraftService,
    private readonly heroService: HeroService,
    private readonly heroMetaService: HeroMetaService,
    private readonly opponentPoolService: OpponentPoolService,
  ) {}

  async fight(draftId: string, submitterToken: string): Promise<BattleResultResponse> {
    const draft = await this.draftService.getById(draftId);
    if (!draft) throw new NotFoundException('Draft not found');
    if (draft.status !== 'COMPLETED') {
      throw new BadRequestException('Draft must be completed before entering Battle Mode');
    }

    const teamA: BattlePick[] = draft.heroes.map((h) => ({ hero: h.hero, assignedRole: h.assignedRole }));

    // Opponent lineups already fought this run — a player never faces the same
    // opponent draft twice within one run (user, hard constraint; enforced in
    // pullRandom, which throws rather than repeating if the pool is exhausted).
    const facedOpponents = await this.draftService.getFacedOpponentHeroSets(draftId);
    const opponent = await this.opponentPoolService.pullRandom(
      submitterToken,
      draft.heroes.map((h) => h.heroId),
      facedOpponents,
    );
    const opponentHeroes = await this.heroService.findByIds(opponent.heroIds);
    // heroRoles is null for pool rows committed before role-fit reached
    // Battle Engine (see opponent-pool schema) — those heroes just get no
    // boost, same as any hero with assignedRole: null.
    const roleByHeroId = new Map((opponent.heroRoles ?? []).map((r) => [r.heroId, r.role]));
    // playerName is only ever populated for 'pro' rows with backfilled
    // OpenDota player data (see PooledHeroRole.playerName) — undefined for
    // everything else, same null-safe map lookup as roleByHeroId.
    const playerNameByHeroId = new Map((opponent.heroRoles ?? []).map((r) => [r.heroId, r.playerName]));
    const teamB: BattlePick[] = opponentHeroes.map((hero) => ({
      hero,
      assignedRole: roleByHeroId.get(hero.id) ?? null,
    }));

    const result = resolveBattle(teamA, teamB, this.heroMetaService);

    // Aligned purely for display (so the Battle screen can show opponent
    // heroes facing the user's role slots) — doesn't feed back into
    // resolveBattle, which treats both teams as unordered sets.
    const teamBAligned = alignOpponentToRoles(opponentHeroes);
    const mineByRole = new Map(
      teamA
        .filter((pick): pick is BattlePick & { assignedRole: string } => pick.assignedRole != null)
        .map((pick) => [pick.assignedRole, pick.hero]),
    );
    const opponentByRole = new Map(teamBAligned.map((hero, index) => [ROLES[index], hero]));
    const lanes = buildLaneResults(mineByRole, opponentByRole, this.heroMetaService);

    // Persisted for History (Blueprint/10-tech-debt-backlog.md, "Сохранять
    // в истории результаты боёв") — best-effort, same reasoning as
    // EvaluationService: a storage hiccup shouldn't fail the fight itself.
    await this.draftService
      .saveBattleResult(draftId, {
        resolvedOutcome: result.resolvedOutcome,
        advantageDirection: result.advantageDirection,
        confidenceTier: result.confidenceTier,
        opponentSource: opponent.source,
        opponentTeamName: opponent.teamName,
        opponentLeagueName: opponent.leagueName,
        opponentHeroIds: opponent.heroIds,
      })
      .catch(() => undefined);

    // Best-effort, same reasoning as saveBattleResult above — the
    // leaderboard (Blueprint/10-tech-debt-backlog.md, "Лидерборд драфтов")
    // is a nice-to-have ranking, not something that should ever fail
    // Battle Mode itself if the shared Postgres pool is briefly
    // unreachable. Inverted outcome: result.resolvedOutcome is from the
    // CALLING player's perspective (teamA) — the opponent draft (teamB)
    // won exactly when the caller lost, and vice versa.
    const opponentOutcome: ResolvedOutcome = result.resolvedOutcome === 'Win' ? 'Lose' : 'Win';
    await this.opponentPoolService.recordDraftOutcome(opponent.id, opponentOutcome).catch(() => undefined);

    return {
      resolvedOutcome: result.resolvedOutcome,
      advantageDirection: result.advantageDirection,
      confidenceTier: result.confidenceTier,
      advantages: result.advantages,
      disadvantages: result.disadvantages,
      explanation: result.explanation,
      winningHighlights: result.winningHighlights,
      bestPairs: result.bestPairs,
      bestMatchups: result.bestMatchups,
      worstMatchups: result.worstMatchups,
      shutdownHeroIds: result.shutdownHeroIds,
      shutdownNotes: result.shutdownNotes,
      lanes,
      opponent: {
        source: opponent.source,
        heroes: teamBAligned.map((h, index) => ({
          heroId: h.id,
          heroName: h.name,
          assignedRole: ROLES[index],
          playerName: playerNameByHeroId.get(h.id) ?? null,
        })),
        teamName: opponent.teamName,
        leagueName: opponent.leagueName,
        matchId: opponent.matchId,
      },
    };
  }
}
