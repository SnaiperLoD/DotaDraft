import { Module } from '@nestjs/common';
import { DevController } from './dev.controller';
import { DevService } from './dev.service';
import { HeroModule } from '../hero/hero.module';
import { HeroMetaModule } from '../hero-meta/hero-meta.module';

// Testing-only module. It exposes the full internal calibration surface for a
// hero — every raw axis value, every tag including the hidden ones, and the
// model's own favoured-rate against real winRate — which is exactly what a
// shipped build should not hand out. app.module.ts imports it only when
// NODE_ENV !== 'production', so the route simply doesn't exist in a
// production server.
@Module({
  imports: [HeroModule, HeroMetaModule],
  controllers: [DevController],
  providers: [DevService],
})
export class DevModule {}
