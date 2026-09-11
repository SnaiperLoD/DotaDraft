import { TelemetryService } from './telemetry.service';

function makePrisma(
  rows: { name: string; sessionId: string; visitorId: string; props: string | null }[] = [],
) {
  const byName = new Map<string, number>();
  const bySessionName = new Map<string, number>();
  const visitors = new Set<string>();
  for (const row of rows) {
    byName.set(row.name, (byName.get(row.name) ?? 0) + 1);
    const sk = `${row.sessionId}\0${row.name}`;
    bySessionName.set(sk, (bySessionName.get(sk) ?? 0) + 1);
    visitors.add(row.visitorId);
  }
  return {
    funnelEvent: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      count: jest.fn().mockResolvedValue(rows.length),
      groupBy: jest.fn(async ({ by }: { by: string[] }) => {
        if (by.length === 1 && by[0] === 'name') {
          return [...byName.entries()].map(([name, n]) => ({ name, _count: { _all: n } }));
        }
        if (by.length === 1 && by[0] === 'visitorId') {
          return [...visitors].map((visitorId) => ({ visitorId, _count: { _all: 1 } }));
        }
        return [...bySessionName.entries()].map(([key, n]) => {
          const [sessionId, name] = key.split('\0');
          return { sessionId, name, _count: { _all: n } };
        });
      }),
      findMany: jest.fn().mockResolvedValue(rows.filter((r) => r.name === 'pool_commit')),
    },
  };
}

describe('TelemetryService.parseBatch', () => {
  const service = new TelemetryService(makePrisma() as any);

  it('accepts a well-formed session_start and rejects junk', () => {
    const events = service.parseBatch({
      events: [
        {
          name: 'session_start',
          ts: 1,
          sessionId: 's1',
          visitorId: 'v1',
        },
      ],
    });
    expect(events).toHaveLength(1);
    expect(events[0].name).toBe('session_start');
    expect(() =>
      service.parseBatch({ events: [{ name: 'hack', ts: 1, sessionId: 's', visitorId: 'v' }] }),
    ).toThrow(/Invalid event name/);
    expect(() => service.parseBatch({ events: [] })).toThrow(/1–20/);
  });
});

describe('TelemetryService.snapshot', () => {
  it('counts sessions that reached each funnel step, including a second fight', async () => {
    const rows = [
      { name: 'session_start', sessionId: 'a', visitorId: '1', props: null },
      { name: 'draft_first_pick', sessionId: 'a', visitorId: '1', props: null },
      { name: 'draft_completed', sessionId: 'a', visitorId: '1', props: null },
      { name: 'evaluate_success', sessionId: 'a', visitorId: '1', props: null },
      { name: 'battle_enter', sessionId: 'a', visitorId: '1', props: null },
      { name: 'battle_fight', sessionId: 'a', visitorId: '1', props: '{"n":1}' },
      { name: 'battle_fight', sessionId: 'a', visitorId: '1', props: '{"n":2}' },
      { name: 'pool_commit', sessionId: 'a', visitorId: '1', props: '{"ok":true}' },
      { name: 'session_start', sessionId: 'b', visitorId: '2', props: null },
      { name: 'draft_first_pick', sessionId: 'b', visitorId: '2', props: null },
    ];
    const service = new TelemetryService(makePrisma(rows) as any);
    const snap = await service.snapshot();
    expect(snap.sessions).toBe(2);
    expect(snap.visitors).toBe(2);
    expect(snap.sessionsReached).toEqual({
      session_start: 2,
      draft_first_pick: 2,
      draft_completed: 1,
      evaluate_success: 1,
      battle_enter: 1,
      second_fight: 1,
      pool_commit: 1,
    });
  });
});
