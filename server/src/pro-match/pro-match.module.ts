import { Module } from '@nestjs/common';
import { ProMatchService } from './pro-match.service';

@Module({
  providers: [ProMatchService],
  exports: [ProMatchService],
})
export class ProMatchModule {}
