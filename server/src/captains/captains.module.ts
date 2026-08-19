import { Module } from '@nestjs/common';
import { CaptainsService } from './captains.service';
import { CaptainsController } from './captains.controller';
import { HeroModule } from '../hero/hero.module';
import { DraftModule } from '../draft/draft.module';

@Module({
  imports: [HeroModule, DraftModule],
  controllers: [CaptainsController],
  providers: [CaptainsService],
})
export class CaptainsModule {}
