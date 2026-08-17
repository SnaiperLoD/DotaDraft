import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PoolPrismaService } from '../opponent-pool/pool-prisma.service';

export type DependencyStatus = 'ok' | 'error';
export type PoolStatus = 'ok' | 'disabled' | 'error';

export interface HealthSnapshot {
  status: 'ok' | 'degraded' | 'error';
  sqlite: DependencyStatus;
  pool: PoolStatus;
}

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pool: PoolPrismaService,
  ) {}

  async snapshot(): Promise<HealthSnapshot> {
    const sqlite = await this.pingSqlite();
    const pool = await this.pingPool();
    const status = sqlite !== 'ok' ? 'error' : pool === 'error' ? 'degraded' : 'ok';
    return { status, sqlite, pool };
  }

  private async pingSqlite(): Promise<DependencyStatus> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return 'ok';
    } catch {
      return 'error';
    }
  }

  private async pingPool(): Promise<PoolStatus> {
    if (!process.env.POOL_DATABASE_URL?.trim()) return 'disabled';
    try {
      await this.pool.$queryRaw`SELECT 1`;
      return 'ok';
    } catch {
      return 'error';
    }
  }
}
