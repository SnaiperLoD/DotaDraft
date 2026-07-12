import { Module } from '@nestjs/common';
import { HistoryService } from './history.service';
import { HistoryController } from './history.controller';
import { HeroModule } from '../hero/hero.module';

@Module({
  imports: [HeroModule],
  controllers: [HistoryController],
  providers: [HistoryService],
})
export class HistoryModule {}
