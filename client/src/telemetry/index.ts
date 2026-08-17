import { getSessionId, getVisitorId, hashDraftId } from './ids';
import { LocalBufferSink, clearTelemetryEvents, funnelSnapshot, readTelemetryEvents } from './localBufferSink';
import type { TelemetryEvent, TelemetryEventName, TelemetryProp, TelemetrySink } from './types';

let sink: TelemetrySink = new LocalBufferSink();
let sessionStarted = false;
let tapalkaClicks = 0;

export function setTelemetrySink(next: TelemetrySink): void {
  sink = next;
}

export function track(
  name: TelemetryEventName,
  props?: Record<string, TelemetryProp>,
  draftId?: string,
): void {
  void (async () => {
    try {
      const event: TelemetryEvent = {
        name,
        ts: Date.now(),
        sessionId: getSessionId(),
        visitorId: await getVisitorId(),
        props,
      };
      if (draftId) event.draftKey = await hashDraftId(draftId);
      sink.enqueue(event);
    } catch {
      // Telemetry must never break product flows.
    }
  })();
}

export function trackSessionStart(): void {
  if (sessionStarted) return;
  sessionStarted = true;
  track('session_start');
}

export function trackTapalkaClick(): void {
  tapalkaClicks += 1;
  // First click + every 10th — enough signal without drowning the buffer.
  if (tapalkaClicks === 1 || tapalkaClicks % 10 === 0) {
    track('tapalka_click', { count: tapalkaClicks });
  }
}

export async function dumpTelemetryFunnel() {
  return funnelSnapshot(getSessionId(), await getVisitorId());
}

declare global {
  interface Window {
    __DOTADRAFT_TELEMETRY__?: {
      dump: typeof dumpTelemetryFunnel;
      events: typeof readTelemetryEvents;
      clear: typeof clearTelemetryEvents;
    };
  }
}

export function installTelemetryDevtools(): void {
  if (typeof window === 'undefined') return;
  window.__DOTADRAFT_TELEMETRY__ = {
    dump: dumpTelemetryFunnel,
    events: readTelemetryEvents,
    clear: clearTelemetryEvents,
  };
}

export type { TelemetryEvent, TelemetryEventName, TelemetrySink };
