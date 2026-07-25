import { Body, Controller, Get, Post } from '@nestjs/common';
import { HeroService } from './hero.service';
import { HeroMetaService } from '../hero-meta/hero-meta.service';
import { realSynergyDelta } from '../evaluation/analyzers/synergy.analyzer';
import type { SynergyPreviewRequest, SynergyPreviewEntry } from 'shared';

@Controller('heroes')
export class HeroController {
  constructor(
    private readonly heroService: HeroService,
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
}
