import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { HeroModule } from './hero/hero.module';
import { DraftModule } from './draft/draft.module';
import { HistoryModule } from './history/history.module';
import { EvaluationModule } from './evaluation/evaluation.module';

@Module({
  imports: [PrismaModule, HeroModule, DraftModule, HistoryModule, EvaluationModule],
})
export class AppModule {}
