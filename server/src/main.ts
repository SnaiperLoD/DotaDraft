import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './configure-app';
import { logReady } from './common/log';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  configureApp(app);
  const port = process.env.PORT ? Number(process.env.PORT) : 3001;
  await app.listen(port);

  logReady('listen', { port });
  if (!process.env.POOL_DATABASE_URL?.trim()) {
    logReady('pool.disabled');
  }
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
