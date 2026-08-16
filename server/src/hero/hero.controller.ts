import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { HeroService } from './hero.service';
import { HeroAbilitiesService } from './hero-abilities.service';
import { HeroMetaService } from '../hero-meta/hero-meta.service';
import { realSynergyDelta } from '../evaluation/analyzers/synergy.analyzer';
import { ABILITY_CATEGORY_FOR_AXIS } from 'shared';
import type { SynergyPreviewRequest, SynergyPreviewEntry, TopAbility, AbilityCategory } from 'shared';

const VALID_CATEGORIES = new Set<string>(Object.values(ABILITY_CATEGORY_FOR_AXIS));
const DEFAULT_TOP_ABILITIES_LIMIT = 3;
const MAX_TOP_ABILITIES_LIMIT = 10;

@Controller('heroes')
export class HeroController {
  constructor(
    private readonly heroService: HeroService,
    private readonly heroAbilitiesService: HeroAbilitiesService,
    private readonly heroMetaService: HeroMetaService,
  ) {}

  @Get()
  findAll() {
    return this.heroService.findAll();
  }

  // Live golden/red-border synergy highlight (Blueprint/10-tech-debt-backlog.md,
  // "Живая подсветка синергичного пика") — for each candidate hero in the
  // current pool, average its real synergyDelta (same formula as Synergy
  // Analyzer, see synergy.analyzer.ts) against every already-picked hero.
  // Ranking (top/bottom within the pool, not against a population baseline)
  // is done client-side — this endpoint just returns the raw per-candidate
  // score. null when there's no real data for a candidate against any
  // picked hero (not enough games), or when there are no picked heroes yet
  // (round 1 — nothing to synergize with).
  @Post('synergy-preview')
  async synergyPreview(@Body() body: SynergyPreviewRequest): Promise<SynergyPreviewEntry[]> {
    if (body.pickedHeroIds.length === 0) {
      return body.candidateHeroIds.map((heroId) => ({ heroId, score: null }));
    }

    const picked = await this.heroService.findByIds(body.pickedHeroIds);
    const candidates = await this.heroService.findByIds(body.candidateHeroIds);

    return candidates.map((candidate) => {
      const deltas = picked
        .map((p) => realSynergyDelta(candidate, p, this.heroMetaService))
        .filter((d): d is number => d !== null);
      const score = deltas.length > 0 ? deltas.reduce((sum, d) => sum + d, 0) / deltas.length : null;
      return { heroId: candidate.id, score };
    });
  }

  @Get('ti-form')
  tiForm() {
    return this.heroService.tiForm(5);
  }

  // Blueprint/10-tech-debt-backlog.md, "Хайлайт топ-контрибьюторов по оси" —
  // powers EvaluationPanel's top-contributor ability drill-down. `category`
  // is the ability-tagging category (control_strength/mobility/saving/
  // initiating), not the evaluation axis key — see
  // shared/constants/ability-categories.ts for the mapping the client uses
  // to pick which one to ask for.
  @Get(':id/top-abilities')
  topAbilities(
    @Param('id', ParseIntPipe) id: number,
    @Query('category') category: string,
    @Query('limit') limitParam?: string,
  ): TopAbility[] {
    if (!VALID_CATEGORIES.has(category)) {
      throw new BadRequestException(`category must be one of: ${[...VALID_CATEGORIES].join(', ')}`);
    }
    const parsedLimit = limitParam ? parseInt(limitParam, 10) : NaN;
    const limit = Number.isNaN(parsedLimit) ? DEFAULT_TOP_ABILITIES_LIMIT : Math.min(MAX_TOP_ABILITIES_LIMIT, Math.max(1, parsedLimit));
    return this.heroAbilitiesService.topAbilities(id, category as AbilityCategory, limit);
  }
}
