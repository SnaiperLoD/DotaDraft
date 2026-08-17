import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DraftService } from '../draft/draft.service';
import { HeroService } from '../hero/hero.service';
import { HeroMetaService } from '../hero-meta/hero-meta.service';
import { OpponentPoolService } from '../opponent-pool/opponent-pool.service';
import { resolveBattle, type BattlePick } from './battle-resolution';
import { alignOpponentToRoles } from './opponent-alignment';
import { buildBattleStory } from './battle-story';
import { buildLaneResults } from './battle-lanes';
import { ROLES } from 'shared';
import type { BattleResultResponse, ResolvedOutcome } from 'shared';
import { logPersistenceFailure } from '../common/log';
import { classifyPicksArchetype } from '../evaluation/draft-archetype';

@Injectable()
export class BattleService {
  private readonly inflight = new Map<string, Promise<BattleResultResponse>>();

  constructor(
    private readonly draftService: DraftService,
    private readonly heroService: HeroService,
    private readonly heroMetaService: HeroMetaService,
    private readonly opponentPoolService: OpponentPoolService,
  ) {}

  async fight(draftId: string, submitterToken: string): Promise<BattleResultResponse> {
    const running = this.inflight.get(draftId);
    if (running) {
      // Serialize fights on the same draft. Fight Again is a new fight, not
      // a replay of the in-flight one — wait, then run.
      await running.catch(() => undefined);
    }
    const pending = this.doFight(draftId, submitterToken);
    this.inflight.set(draftId, pending);
    try {
      return await pending;
    } finally {
      if (this.inflight.get(draftId) === pending) this.inflight.delete(draftId);
    }
  }

  private async doFight(draftId: string, submitterToken: string): Promise<BattleResultResponse> {
    const draft = await this.draftService.getById(draftId, submitterToken);
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

    const teamBAligned = alignOpponentToRoles(opponentHeroes);
    const mineByRole = new Map(
      teamA
        .filter((pick): pick is BattlePick & { assignedRole: string } => pick.assignedRole != null)
        .map((pick) => [pick.assignedRole, pick.hero]),
    );
    const opponentByRole = new Map(teamBAligned.map((hero, index) => [ROLES[index], hero]));
    const lanes = buildLaneResults(mineByRole, opponentByRole, this.heroMetaService);
    const opponentPicks: BattlePick[] = teamBAligned.map((hero, index) => ({
      hero,
      assignedRole: ROLES[index],
    }));

    // Fight math still uses pool-stored teamB roles. Lanes and the aligned
    // opponent roster are display-side only — passed so Explanation talks
    // about the same lane cards the client renders.
    const result = resolveBattle(teamA, teamB, this.heroMetaService, Math.random, {
      lanes,
      narrativeOpponent: opponentPicks,
    });

    const story = buildBattleStory({
      resolvedOutcome: result.resolvedOutcome,
      advantageDirection: result.advantageDirection,
      lanes,
      mine: teamA,
      opponent: opponentPicks,
      lookup: this.heroMetaService,
      highSkillSwingHeroName: result.highSkillSwingHeroName,
      topAxis: result.topAxis,
    });

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
      .catch((err) => {
        logPersistenceFailure('battle.saveResult', err, { draftId });
      });

    // Best-effort, same reasoning as saveBattleResult above — the
    // leaderboard (Blueprint/10-tech-debt-backlog.md, "Лидерборд драфтов")
    // is a nice-to-have ranking, not something that should ever fail
    // Battle Mode itself if the shared Postgres pool is briefly
    // unreachable. Inverted outcome: result.resolvedOutcome is from the
    // CALLING player's perspective (teamA) — the opponent draft (teamB)
    // won exactly when the caller lost, and vice versa.
    const opponentOutcome: ResolvedOutcome = result.resolvedOutcome === 'Win' ? 'Lose' : 'Win';
    await this.opponentPoolService.recordDraftOutcome(opponent.id, opponentOutcome).catch((err) => {
      logPersistenceFailure('battle.recordDraftOutcome', err, { draftId, opponentId: opponent.id });
    });

    // Display-only Evaluate headline (Tempo / Late / 4+1 / …). Computed after
    // resolveBattle so it cannot change who wins. Pool-stored roles for the
    // opponent — same role-aware axis path Evaluate uses on a submitted draft.
    const archetype = classifyPicksArchetype(teamA);
    const opponentArchetype = classifyPicksArchetype(teamB);

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
      story,
      archetype,
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
        archetype: opponentArchetype,
      },
    };
  }
}
