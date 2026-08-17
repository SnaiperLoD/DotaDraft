import { Logger } from '@nestjs/common';

const logger = new Logger('persistence');

export function logPersistenceFailure(
  event: string,
  err: unknown,
  extra: Record<string, unknown> = {},
): void {
  const message = err instanceof Error ? err.message : String(err);
  logger.warn(JSON.stringify({ event, ...extra, err: message }));
}

export function logReady(event: string, extra: Record<string, unknown> = {}): void {
  logger.log(JSON.stringify({ event, ...extra }));
}
