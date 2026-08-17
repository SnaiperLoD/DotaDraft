import { Test } from '@nestjs/testing';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { TelemetryController } from './telemetry.controller';
import { TelemetryService } from './telemetry.service';

describe('TelemetryController.funnel', () => {
  const original = process.env.TELEMETRY_READ_TOKEN;

  afterEach(() => {
    process.env.TELEMETRY_READ_TOKEN = original;
  });

  it('404s when the read token is unset', async () => {
    delete process.env.TELEMETRY_READ_TOKEN;
    const telemetry = { snapshot: jest.fn(), parseBatch: jest.fn(), ingest: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      controllers: [TelemetryController],
      providers: [{ provide: TelemetryService, useValue: telemetry }],
    }).compile();
    const controller = moduleRef.get(TelemetryController);
    await expect(controller.funnel({ headers: {} } as any)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('401s on a wrong token and returns the snapshot on a match', async () => {
    process.env.TELEMETRY_READ_TOKEN = 'secret';
    const telemetry = {
      snapshot: jest.fn().mockResolvedValue({ events: 0 }),
      parseBatch: jest.fn(),
      ingest: jest.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [TelemetryController],
      providers: [{ provide: TelemetryService, useValue: telemetry }],
    }).compile();
    const controller = moduleRef.get(TelemetryController);
    await expect(
      controller.funnel({ headers: { 'x-telemetry-read-token': 'nope' } } as any),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      controller.funnel({ headers: { 'x-telemetry-read-token': 'secret' } } as any),
    ).resolves.toEqual({ events: 0 });
  });
});
