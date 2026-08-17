import { HealthService } from './health.service';

describe('HealthService', () => {
  const originalPoolUrl = process.env.POOL_DATABASE_URL;

  afterEach(() => {
    process.env.POOL_DATABASE_URL = originalPoolUrl;
  });

  it('reports pool disabled when POOL_DATABASE_URL is empty', async () => {
    process.env.POOL_DATABASE_URL = '';
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ '1': 1 }]) };
    const pool = { $queryRaw: jest.fn() };
    const service = new HealthService(prisma as any, pool as any);

    await expect(service.snapshot()).resolves.toEqual({ status: 'ok', sqlite: 'ok', pool: 'disabled' });
    expect(pool.$queryRaw).not.toHaveBeenCalled();
  });

  it('reports degraded when sqlite is up but the pool ping fails', async () => {
    process.env.POOL_DATABASE_URL = 'postgresql://dota:dota@localhost:5432/opponent_pool';
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ '1': 1 }]) };
    const pool = { $queryRaw: jest.fn().mockRejectedValue(new Error("Can't reach database")) };
    const service = new HealthService(prisma as any, pool as any);

    await expect(service.snapshot()).resolves.toEqual({ status: 'degraded', sqlite: 'ok', pool: 'error' });
  });
});
