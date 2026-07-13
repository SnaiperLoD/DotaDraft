import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '../../generated/pool-client';

// No OnModuleInit/$connect() here on purpose: Prisma Client connects lazily
// on first query, so the rest of the app keeps working even before
// POOL_DATABASE_URL is provisioned (see server/.env). Eagerly connecting
// would fail app boot entirely whenever the pool DB isn't configured yet.
@Injectable()
export class PoolPrismaService extends PrismaClient implements OnModuleDestroy {
  async onModuleDestroy() {
    await this.$disconnect().catch(() => undefined);
  }
}
