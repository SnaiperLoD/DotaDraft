import { Module } from '@nestjs/common';
import { HeroMetaService } from './hero-meta.service';

@Module({
  providers: [HeroMetaService],
  exports: [HeroMetaService],
})
export class HeroMetaModule {}
