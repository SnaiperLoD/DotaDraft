import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { HeroModule } from './hero/hero.module';
import { DraftModule } from './draft/draft.module';
import { HistoryModule } from './history/history.module';
import { EvaluationModule } from './evaluation/evaluation.module';
import { OpponentPoolModule } from './opponent-pool/opponent-pool.module';
import { BattleModule } from './battle/battle.module';
import { DevModule } from './dev/dev.module';
import { HealthModule } from './health/health.module';

// DevModule is testing-only — it serves the hero calibration matrix (raw axis
// values, hidden tags, real vs modelled winRate). Gated on NODE_ENV so the
// route does not exist in a production server at all, rather than relying on
// nobody guessing the URL.
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

@Module({
  imports: [
    HealthModule,
    PrismaModule,
    HeroModule,
    DraftModule,
    HistoryModule,
    EvaluationModule,
    OpponentPoolModule,
    BattleModule,
    ...(IS_PRODUCTION ? [] : [DevModule]),
  ],
})
export class AppModule {}
