import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { OpponentPoolModule } from '../opponent-pool/opponent-pool.module';

@Module({
  imports: [OpponentPoolModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
