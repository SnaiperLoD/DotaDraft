import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuthModule } from './auth/auth.module';
import { AuthSessionMiddleware } from './auth/auth.middleware';
import { HeroModule } from './hero/hero.module';
import { DraftModule } from './draft/draft.module';
import { HistoryModule } from './history/history.module';
import { EvaluationModule } from './evaluation/evaluation.module';
import { OpponentPoolModule } from './opponent-pool/opponent-pool.module';
import { BattleModule } from './battle/battle.module';
import { CaptainsModule } from './captains/captains.module';
import { TiRunModule } from './ti-run/ti-run.module';
import { DevModule } from './dev/dev.module';
import { HealthModule } from './health/health.module';
import { TelemetryModule } from './telemetry/telemetry.module';
import { PrismaModule } from './prisma/prisma.module';
import { WriteRateLimitInterceptor } from './common/write-rate-limit';

// DevModule is testing-only — it serves the hero calibration matrix (raw axis
// values, hidden tags, real vs modelled winRate). Gated on NODE_ENV so the
// route does not exist in a production server at all, rather than relying on
// nobody guessing the URL.
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

@Module({
  imports: [
    PrismaModule,
    HealthModule,
    AuthModule,
    TelemetryModule,
    HeroModule,
    DraftModule,
    HistoryModule,
    EvaluationModule,
    OpponentPoolModule,
    BattleModule,
    CaptainsModule,
    TiRunModule,
    ...(IS_PRODUCTION ? [] : [DevModule]),
  ],
  providers: [{ provide: APP_INTERCEPTOR, useClass: WriteRateLimitInterceptor }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(AuthSessionMiddleware).forRoutes('*');
  }
}
