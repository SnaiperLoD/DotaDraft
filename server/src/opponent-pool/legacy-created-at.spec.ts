import { freezeLegacyCreatedAt, spreadLegacyCreatedAt } from './legacy-created-at';

describe('spreadLegacyCreatedAt', () => {
  const now = Date.parse('2026-08-20T00:00:00.000Z');
  const twelveH = 12 * 60 * 60 * 1000;

  it('preserves relative order and lands the newest 12h before now', () => {
    const a = Date.parse('2026-07-12T22:00:00.000Z');
    const b = Date.parse('2026-08-17T02:00:00.000Z');
    const [first, last] = spreadLegacyCreatedAt([a, b], now);
    expect(first.getTime()).toBeLessThan(last.getTime());
    expect(last.getTime()).toBe(now - twelveH);
    expect(first.getTime()).toBe(a);
  });

  it('evenly fans identical timestamps instead of collapsing freshness', () => {
    const t = Date.parse('2026-07-01T00:00:00.000Z');
    const out = spreadLegacyCreatedAt([t, t, t], now);
    expect(new Set(out.map((d) => d.getTime())).size).toBe(3);
    expect(out[0].getTime()).toBeLessThan(out[2].getTime());
    expect(out[2].getTime()).toBe(now - twelveH);
  });

  it('returns empty for an empty batch', () => {
    expect(spreadLegacyCreatedAt([], now)).toEqual([]);
  });

  it('freezes previously snapshotted dates and only spreads new ids', () => {
    const frozen = '2026-07-20T00:00:00.000Z';
    const previous = new Map([['old', frozen]]);
    const out = freezeLegacyCreatedAt(
      [
        { id: 'old', originalMs: Date.parse('2026-07-12T00:00:00.000Z') },
        { id: 'new', originalMs: Date.parse('2026-08-01T00:00:00.000Z') },
      ],
      previous,
      now,
    );
    expect(out[0]).toBe(frozen);
    expect(out[1]).toBe(new Date(now - twelveH).toISOString());
  });

  it('caps the window so archive stays older than existing live commits', () => {
    const a = Date.parse('2026-07-12T22:00:00.000Z');
    const b = Date.parse('2026-08-17T02:00:00.000Z');
    const liveMax = Date.parse('2026-08-17T02:30:00.000Z');
    const [first, last] = spreadLegacyCreatedAt([a, b], now, liveMax);
    expect(first.getTime()).toBe(a);
    expect(last.getTime()).toBe(liveMax - 1);
  });

  it('respreads frozen dates that would outrank live commits', () => {
    const liveMax = Date.parse('2026-08-17T02:30:00.000Z');
    const previous = new Map([['old', '2026-08-19T09:53:42.284Z']]);
    const out = freezeLegacyCreatedAt(
      [{ id: 'old', originalMs: Date.parse('2026-08-17T02:00:00.000Z') }],
      previous,
      now,
      liveMax,
    );
    expect(Date.parse(out[0])).toBe(liveMax - 1);
  });
});
