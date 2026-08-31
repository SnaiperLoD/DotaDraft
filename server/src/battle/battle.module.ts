import { Module } from '@nestjs/common';
import { BattleService } from './battle.service';
import { BattleController } from './battle.controller';
import { DraftModule } from '../draft/draft.module';
import { HeroModule } from '../hero/hero.module';
import { HeroMetaModule } from '../hero-meta/hero-meta.module';
import { OpponentPoolModule } from '../opponent-pool/opponent-pool.module';
import { CaptainsModule } from '../captains/captains.module';
import { TiRunModule } from '../ti-run/ti-run.module';

@Module({
  imports: [DraftModule, HeroModule, HeroMetaModule, OpponentPoolModule, CaptainsModule, TiRunModule],
  controllers: [BattleController],
  providers: [BattleService],
})
export class BattleModule {}
