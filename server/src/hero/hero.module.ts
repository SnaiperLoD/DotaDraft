import { Module } from '@nestjs/common';
import { HeroService } from './hero.service';
import { HeroController } from './hero.controller';
import { HeroMetaModule } from '../hero-meta/hero-meta.module';

@Module({
  imports: [HeroMetaModule],
  controllers: [HeroController],
  providers: [HeroService],
  exports: [HeroService],
})
export class HeroModule {}
