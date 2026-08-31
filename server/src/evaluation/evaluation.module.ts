import { Module } from '@nestjs/common';
import { EvaluationService } from './evaluation.service';
import { EvaluationController } from './evaluation.controller';
import { DraftModule } from '../draft/draft.module';
import { ProMatchModule } from '../pro-match/pro-match.module';
import { HeroMetaModule } from '../hero-meta/hero-meta.module';
import { HeroModule } from '../hero/hero.module';

@Module({
  imports: [DraftModule, ProMatchModule, HeroMetaModule, HeroModule],
  controllers: [EvaluationController],
  providers: [EvaluationService],
  exports: [EvaluationService],
})
export class EvaluationModule {}
