import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  async check(@Res({ passthrough: true }) res: Response) {
    const body = await this.health.snapshot();
    if (body.sqlite !== 'ok') res.status(503);
    return body;
  }
}
