// Maps a batch of original timestamps onto a spread window that ends 12h
// before `now`, so live player commits stay strictly newer (freshness² in
// opponent-pool-pick.ts) while the archive still has relative age among itself.
export function spreadLegacyCreatedAt(
  originalMs: number[],
  nowMs: number,
  liveMaxMs?: number | null,
): Date[] {
  const n = originalMs.length;
  if (n === 0) return [];
  let windowEnd = nowMs - 12 * 60 * 60 * 1000;
  if (liveMaxMs != null && Number.isFinite(liveMaxMs)) {
    // Existing tokened commits stay strictly newer than the archive.
    windowEnd = Math.min(windowEnd, liveMaxMs - 1);
  }
  const min = Math.min(...originalMs);
  const max = Math.max(...originalMs);
  const span = Math.max(max - min, 1);
  const windowStart = Math.min(min, windowEnd - span);
  if (max === min) {
    if (n === 1) return [new Date(windowEnd)];
    return originalMs.map((_, i) => new Date(windowStart + (i / (n - 1)) * (windowEnd - windowStart)));
  }
  return originalMs.map((t) => new Date(windowStart + ((t - min) / span) * (windowEnd - windowStart)));
}

/** Keep already-snapshotted ISO dates; spread only ids that are new. */
export function freezeLegacyCreatedAt(
  items: { id: string; originalMs: number }[],
  previousIsoById: Map<string, string>,
  nowMs: number,
  liveMaxMs?: number | null,
): string[] {
  let previous = previousIsoById;
  if (liveMaxMs != null && Number.isFinite(liveMaxMs)) {
    const tooNew = [...previous.values()].some((iso) => Date.parse(iso) >= liveMaxMs);
    if (tooNew) previous = new Map();
  }
  const needSpread = items.filter((item) => !previous.has(item.id));
  const spread = spreadLegacyCreatedAt(
    needSpread.map((item) => item.originalMs),
    nowMs,
    liveMaxMs,
  );
  let idx = 0;
  return items.map((item) => previous.get(item.id) ?? spread[idx++].toISOString());
}
