import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DraftService } from '../draft/draft.service';
import { HeroService } from '../hero/hero.service';
import { HeroMetaService } from '../hero-meta/hero-meta.service';
import { OpponentPoolService } from '../opponent-pool/opponent-pool.service';
import { resolveBattle } from './battle-resolution';
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

    const teamA = draft.heroes.map((h) => h.hero);
    const opponent = await this.opponentPoolService.pullRandom(submitterToken);
    const teamB = await this.heroService.findByIds(opponent.heroIds);

    const result = resolveBattle(teamA, teamB, this.heroMetaService);

    // Aligned purely for display (so the Battle screen can show opponent
    // heroes facing the user's role slots) — doesn't feed back into
    // resolveBattle, which treats both teams as unordered sets.
    const teamBAligned = alignOpponentToRoles(teamB);

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
      },
    };
  }
}
