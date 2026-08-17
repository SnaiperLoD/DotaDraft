import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Observable } from 'rxjs';

const WINDOW_MS = 60_000;
const WRITE_LIMIT = 60;

@Injectable()
export class WriteRateLimitInterceptor implements NestInterceptor {
  private readonly hits = new Map<string, number[]>();

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (process.env.NODE_ENV === 'test') return next.handle();

    const req = context.switchToHttp().getRequest<{
      method?: string;
      url?: string;
      ip?: string;
      headers: Record<string, string | string[] | undefined>;
    }>();
    const method = (req.method ?? 'GET').toUpperCase();
    const url = req.url ?? '';
    if (method === 'GET' || url.startsWith('/health')) return next.handle();

    const token = header(req.headers['x-owner-token']);
    const key = `${token || req.ip || 'anon'}:${method}`;
    const now = Date.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
    if (recent.length >= WRITE_LIMIT) {
      throw new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS);
    }
    recent.push(now);
    this.hits.set(key, recent);
    return next.handle();
  }
}

function header(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' ? value.trim() : '';
}
