import {
  Body,
  Controller,
  Get,
  Header,
  NotFoundException,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { TelemetryService } from './telemetry.service';

@Controller('telemetry')
export class TelemetryController {
  constructor(private readonly telemetry: TelemetryService) {}

  @Post()
  async ingest(@Body() body: unknown): Promise<{ ok: true }> {
    await this.telemetry.ingest(this.telemetry.parseBatch(body));
    return { ok: true };
  }

  @Get('funnel')
  @Header('Cache-Control', 'no-store')
  async funnel(@Req() req: Request) {
    const expected = process.env.TELEMETRY_READ_TOKEN?.trim();
    if (!expected) throw new NotFoundException();
    const got = header(req.headers['x-telemetry-read-token']);
    if (got !== expected) throw new UnauthorizedException();
    return this.telemetry.snapshot();
  }
}

function header(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' ? value.trim() : '';
}
