import { TelemetryService } from './telemetry.service';

function makePrisma(rows: unknown[] = []) {
  return {
    funnelEvent: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue(rows),
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
