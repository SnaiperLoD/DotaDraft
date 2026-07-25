import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DraftService } from '../draft/draft.service';
import { HeroService } from '../hero/hero.service';
import { HeroMetaService } from '../hero-meta/hero-meta.service';
import { OpponentPoolService } from '../opponent-pool/opponent-pool.service';
import { resolveBattle, type BattlePick } from './battle-resolution';
import { alignOpponentToRoles } from './opponent-alignment';
import type { BattleResultResponse } from 'shared';

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

    const opponent = await this.opponentPoolService.pullRandom(submitterToken);
    const opponentHeroes = await this.heroService.findByIds(opponent.heroIds);
    // heroRoles is null for pool rows committed before role-fit reached
    // Battle Engine (see opponent-pool schema) — those heroes just get no
    // boost, same as any hero with assignedRole: null.
    const roleByHeroId = new Map((opponent.heroRoles ?? []).map((r) => [r.heroId, r.role]));
    const teamB: BattlePick[] = opponentHeroes.map((hero) => ({
      hero,
      assignedRole: roleByHeroId.get(hero.id) ?? null,
    }));

    const result = resolveBattle(teamA, teamB, this.heroMetaService);

    // Aligned purely for display (so the Battle screen can show opponent
    // heroes facing the user's role slots) — doesn't feed back into
    // resolveBattle, which treats both teams as unordered sets.
    const teamBAligned = alignOpponentToRoles(opponentHeroes);

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

    return {
      resolvedOutcome: result.resolvedOutcome,
      advantageDirection: result.advantageDirection,
      confidenceTier: result.confidenceTier,
      advantages: result.advantages,
      disadvantages: result.disadvantages,
      explanation: result.explanation,
      opponent: {
        source: opponent.source,
        heroes: teamBAligned.map((h) => ({ heroId: h.id, heroName: h.name })),
        teamName: opponent.teamName,
        leagueName: opponent.leagueName,
        matchId: opponent.matchId,
      },
    };
  }
}
