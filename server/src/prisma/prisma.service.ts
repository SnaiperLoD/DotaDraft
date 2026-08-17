import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { logReady } from '../common/log';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
    logReady('sqlite.ready');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
