export type TelemetryEventName =
  | 'session_start'
  | 'draft_completed'
  | 'evaluate_success'
  | 'battle_enter'
  | 'battle_fight'
  | 'battle_outcome'
  | 'draft_copy'
  | 'pool_commit'
  | 'tapalka_click';

export type TelemetryProp = string | number | boolean | null;

export interface TelemetryEvent {
  name: TelemetryEventName;
  ts: number;
  sessionId: string;
  visitorId: string;
  draftKey?: string;
  props?: Record<string, TelemetryProp>;
}

export interface TelemetrySink {
  enqueue(event: TelemetryEvent): void;
  flush?(): Promise<void> | void;
}

export interface FunnelSnapshot {
  sessionId: string;
  visitorId: string;
  total: number;
  counts: Record<TelemetryEventName, number>;
  recent: TelemetryEvent[];
}
