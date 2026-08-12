import { Controller, Get } from '@nestjs/common';
import { DevService } from './dev.service';

// Testing-only. See dev.module.ts for why this never reaches production.
@Controller('dev')
export class DevController {
  constructor(private readonly devService: DevService) {}

  @Get('hero-matrix')
  heroMatrix() {
    return this.devService.heroMatrix();
  }
}
