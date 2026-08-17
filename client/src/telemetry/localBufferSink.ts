import type { FunnelSnapshot, TelemetryEvent, TelemetryEventName, TelemetrySink } from './types';

const STORAGE_KEY = 'dotadraft.telemetry.v1';
const MAX_EVENTS = 200;

const EMPTY_COUNTS = (): Record<TelemetryEventName, number> => ({
  session_start: 0,
  draft_first_pick: 0,
  draft_completed: 0,
  evaluate_success: 0,
  battle_enter: 0,
  battle_fight: 0,
  battle_outcome: 0,
  draft_copy: 0,
  pool_commit: 0,
  tapalka_click: 0,
});

function readBuffer(): TelemetryEvent[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as TelemetryEvent[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeBuffer(events: TelemetryEvent[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(events.slice(-MAX_EVENTS)));
}

export class LocalBufferSink implements TelemetrySink {
  enqueue(event: TelemetryEvent): void {
    const next = [...readBuffer(), event];
    writeBuffer(next);
  }
}

export function readTelemetryEvents(): TelemetryEvent[] {
  return readBuffer();
}

export function clearTelemetryEvents(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function funnelSnapshot(sessionId: string, visitorId: string): FunnelSnapshot {
  const recent = readBuffer();
  const counts = EMPTY_COUNTS();
  for (const event of recent) {
    if (event.name in counts) counts[event.name] += 1;
  }
  return {
    sessionId,
    visitorId,
    total: recent.length,
    counts,
    recent: recent.slice(-30),
  };
}
