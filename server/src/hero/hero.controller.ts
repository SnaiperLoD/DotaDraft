import { Controller, Get } from '@nestjs/common';
import { HeroService } from './hero.service';

@Controller('heroes')
export class HeroController {
  constructor(private readonly heroService: HeroService) {}

  @Get()
  findAll() {
    return this.heroService.findAll();
  }
}
