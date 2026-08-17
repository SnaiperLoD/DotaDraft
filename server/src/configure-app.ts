import { json } from 'express';
import type { INestApplication } from '@nestjs/common';

const JSON_LIMIT = '64kb';

export function configureApp(app: INestApplication): void {
  app.use(json({ limit: JSON_LIMIT }));
  const raw = process.env.CORS_ORIGIN?.trim();
  if (!raw) {
    // Dev default: open CORS. Production without CORS_ORIGIN relies on
    // same-origin reverse-proxy / static hosting (see Blueprint/13-deploy.md).
    app.enableCors({ origin: process.env.NODE_ENV === 'production' ? false : true });
  } else {
    app.enableCors({
      origin: raw
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    });
  }
}
