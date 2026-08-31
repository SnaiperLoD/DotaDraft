import { Module } from '@nestjs/common';
import { TiRunService } from './ti-run.service';
import { TiRunController } from './ti-run.controller';
import { DraftModule } from '../draft/draft.module';
import { OpponentPoolModule } from '../opponent-pool/opponent-pool.module';

@Module({
  imports: [DraftModule, OpponentPoolModule],
  controllers: [TiRunController],
  providers: [TiRunService],
  exports: [TiRunService],
})
export class TiRunModule {}
