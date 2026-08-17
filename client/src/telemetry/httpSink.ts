import { getSubmitterToken } from '../utils/submitterToken';
import { OWNER_TOKEN_HEADER } from 'shared';
import type { TelemetryEvent, TelemetrySink } from './types';

const MAX_BATCH = 20;
const FLUSH_MS = 4000;

export class HttpTelemetrySink implements TelemetrySink {
  private queue: TelemetryEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inflight: Promise<void> | null = null;

  enqueue(event: TelemetryEvent): void {
    this.queue.push(event);
    if (this.queue.length >= MAX_BATCH) {
      void this.flush();
      return;
    }
    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.flush();
      }, FLUSH_MS);
    }
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.inflight) await this.inflight;
    const batch = this.queue.splice(0, MAX_BATCH);
    if (batch.length === 0) return;
    this.inflight = post(batch).finally(() => {
      this.inflight = null;
    });
    await this.inflight;
  }
}

async function post(events: TelemetryEvent[]): Promise<void> {
  try {
    await fetch('/api/telemetry', {
      method: 'POST',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        [OWNER_TOKEN_HEADER]: getSubmitterToken(),
      },
      body: JSON.stringify({ events }),
    });
  } catch {
    // Telemetry must never break product flows.
  }
}
