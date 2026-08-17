import { Test } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('HealthController', () => {
  it('returns ok with sqlite up and pool disabled', async () => {
    const health = {
      snapshot: jest.fn().mockResolvedValue({ status: 'ok', sqlite: 'ok', pool: 'disabled' }),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: HealthService, useValue: health }],
    }).compile();
    const controller = moduleRef.get(HealthController);
    const res = { status: jest.fn() };
    await expect(controller.check(res as any)).resolves.toEqual({
      status: 'ok',
      sqlite: 'ok',
      pool: 'disabled',
    });
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 503 when sqlite is down', async () => {
    const health = {
      snapshot: jest.fn().mockResolvedValue({ status: 'error', sqlite: 'error', pool: 'disabled' }),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: HealthService, useValue: health }],
    }).compile();
    const controller = moduleRef.get(HealthController);
    const res = { status: jest.fn() };
    await expect(controller.check(res as any)).resolves.toEqual({
      status: 'error',
      sqlite: 'error',
      pool: 'disabled',
    });
    expect(res.status).toHaveBeenCalledWith(503);
  });
});
