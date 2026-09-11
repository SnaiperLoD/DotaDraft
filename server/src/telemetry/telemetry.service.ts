import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export const FUNNEL_EVENT_NAMES = [
  'session_start',
  'draft_first_pick',
  'draft_completed',
  'evaluate_success',
  'battle_enter',
  'battle_fight',
  'battle_outcome',
  'draft_copy',
  'pool_commit',
  'tapalka_click',
] as const;

export type FunnelEventName = (typeof FUNNEL_EVENT_NAMES)[number];

const NAME_SET = new Set<string>(FUNNEL_EVENT_NAMES);
const MAX_BATCH = 20;
const MAX_ID = 64;
const MAX_PROP_KEYS = 8;
const MAX_PROP_STRING = 64;

export interface IngestEvent {
  name: FunnelEventName;
  ts: Date;
  sessionId: string;
  visitorId: string;
  draftKey: string | null;
  props: Record<string, string | number | boolean | null> | null;
}

export interface FunnelSnapshot {
  events: number;
  sessions: number;
  visitors: number;
  counts: Record<FunnelEventName, number>;
  sessionsReached: Record<
    | 'session_start'
    | 'draft_first_pick'
    | 'draft_completed'
    | 'evaluate_success'
    | 'battle_enter'
    | 'second_fight'
    | 'pool_commit',
    number
  >;
}

@Injectable()
export class TelemetryService {
  constructor(private readonly prisma: PrismaService) {}

  parseBatch(body: unknown): IngestEvent[] {
    if (!body || typeof body !== 'object') throw new BadRequestException('Invalid body');
    const events = (body as { events?: unknown }).events;
    if (!Array.isArray(events) || events.length === 0 || events.length > MAX_BATCH) {
      throw new BadRequestException(`Expected 1–${MAX_BATCH} events`);
    }
    return events.map(parseEvent);
  }

  async ingest(events: IngestEvent[]): Promise<void> {
    await this.prisma.funnelEvent.createMany({
      data: events.map((e) => ({
        name: e.name,
        ts: e.ts,
        sessionId: e.sessionId,
        visitorId: e.visitorId,
        draftKey: e.draftKey,
        props: e.props ? JSON.stringify(e.props) : null,
      })),
    });
  }

  async snapshot(): Promise<FunnelSnapshot> {
    const [events, byName, bySessionName, byVisitor, commits] = await Promise.all([
      this.prisma.funnelEvent.count(),
      this.prisma.funnelEvent.groupBy({ by: ['name'], _count: { _all: true } }),
      this.prisma.funnelEvent.groupBy({ by: ['sessionId', 'name'], _count: { _all: true } }),
      this.prisma.funnelEvent.groupBy({ by: ['visitorId'], _count: { _all: true } }),
      this.prisma.funnelEvent.findMany({
        where: { name: 'pool_commit' },
        select: { sessionId: true, props: true },
      }),
    ]);
    const counts = emptyCounts();
    for (const row of byName) {
      if (row.name in counts) counts[row.name as FunnelEventName] += row._count._all;
    }
    const perSession = new Map<string, { names: Set<string>; fights: number; commitOk: boolean }>();
    for (const row of bySessionName) {
      const rec = perSession.get(row.sessionId) ?? { names: new Set(), fights: 0, commitOk: false };
      rec.names.add(row.name);
      if (row.name === 'battle_fight') rec.fights += row._count._all;
      perSession.set(row.sessionId, rec);
    }
    for (const row of commits) {
      const rec = perSession.get(row.sessionId) ?? { names: new Set(), fights: 0, commitOk: false };
      rec.names.add('pool_commit');
      rec.commitOk = rec.commitOk || propOk(row.props);
      perSession.set(row.sessionId, rec);
    }

    const reached = {
      session_start: 0,
      draft_first_pick: 0,
      draft_completed: 0,
      evaluate_success: 0,
      battle_enter: 0,
      second_fight: 0,
      pool_commit: 0,
    };
    for (const rec of perSession.values()) {
      if (rec.names.has('session_start')) reached.session_start += 1;
      if (rec.names.has('draft_first_pick')) reached.draft_first_pick += 1;
      if (rec.names.has('draft_completed')) reached.draft_completed += 1;
      if (rec.names.has('evaluate_success')) reached.evaluate_success += 1;
      if (rec.names.has('battle_enter')) reached.battle_enter += 1;
      if (rec.fights >= 2) reached.second_fight += 1;
      if (rec.commitOk) reached.pool_commit += 1;
    }

    return {
      events,
      sessions: perSession.size,
      visitors: byVisitor.length,
      counts,
      sessionsReached: reached,
    };
  }
}

function emptyCounts(): Record<FunnelEventName, number> {
  return Object.fromEntries(FUNNEL_EVENT_NAMES.map((n) => [n, 0])) as Record<FunnelEventName, number>;
}

function parseEvent(raw: unknown): IngestEvent {
  if (!raw || typeof raw !== 'object') throw new BadRequestException('Invalid event');
  const e = raw as Record<string, unknown>;
  if (typeof e.name !== 'string' || !NAME_SET.has(e.name)) {
    throw new BadRequestException('Invalid event name');
  }
  if (typeof e.ts !== 'number' || !Number.isFinite(e.ts) || e.ts < 0) {
    throw new BadRequestException('Invalid ts');
  }
  const sessionId = assertId(e.sessionId, 'sessionId');
  const visitorId = assertId(e.visitorId, 'visitorId');
  const draftKey = e.draftKey == null ? null : assertId(e.draftKey, 'draftKey');
  return {
    name: e.name as FunnelEventName,
    ts: new Date(e.ts),
    sessionId,
    visitorId,
    draftKey,
    props: parseProps(e.props),
  };
}

function assertId(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > MAX_ID) {
    throw new BadRequestException(`Invalid ${field}`);
  }
  return value;
}

function parseProps(value: unknown): IngestEvent['props'] {
  if (value == null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('Invalid props');
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_PROP_KEYS) throw new BadRequestException('Too many props');
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, v] of entries) {
    if (key.length > 32) throw new BadRequestException('Invalid prop key');
    if (v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) {
      out[key] = v;
    } else if (typeof v === 'string' && v.length <= MAX_PROP_STRING) {
      out[key] = v;
    } else {
      throw new BadRequestException(`Invalid prop ${key}`);
    }
  }
  return out;
}

function propOk(propsJson: string | null): boolean {
  if (!propsJson) return false;
  try {
    const parsed = JSON.parse(propsJson) as { ok?: unknown };
    return parsed.ok === true;
  } catch {
    return false;
  }
}
