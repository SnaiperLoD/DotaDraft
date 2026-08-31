import { Module } from '@nestjs/common';
import { CaptainsService } from './captains.service';
import { CaptainsController } from './captains.controller';
import { HeroModule } from '../hero/hero.module';
import { DraftModule } from '../draft/draft.module';
import { EvaluationModule } from '../evaluation/evaluation.module';

@Module({
  imports: [HeroModule, DraftModule, EvaluationModule],
  controllers: [CaptainsController],
  providers: [CaptainsService],
  exports: [CaptainsService],
})
export class CaptainsModule {}
