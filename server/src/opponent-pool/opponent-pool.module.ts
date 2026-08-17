import { Module } from '@nestjs/common';
import { OpponentPoolService } from './opponent-pool.service';
import { OpponentPoolController } from './opponent-pool.controller';
import { LeaderboardController } from './leaderboard.controller';
import { PoolPrismaService } from './pool-prisma.service';
import { DraftModule } from '../draft/draft.module';

@Module({
  imports: [DraftModule],
  controllers: [OpponentPoolController, LeaderboardController],
  providers: [PoolPrismaService, OpponentPoolService],
  exports: [OpponentPoolService, PoolPrismaService],
})
export class OpponentPoolModule {}
