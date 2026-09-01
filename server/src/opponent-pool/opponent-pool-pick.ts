// Weighted opponent pick for Battle matchmaking — prefers fresher drafts
// and lightly boosts player-sourced rows so the pool isn't ~100% pro when
// players have committed anything. Pure functions so unit tests don't need
// Nest/Prisma. Recency for pro rows uses OpenDota match ids (roughly
// monotonic with time) parsed from `pro-${matchId}` ids — no ProMatch join.

import { parsePooledProMatchId } from './pooled-pro-id';

export interface PoolPickRow {
  id: string;
  source: string;
  heroIds: number[];
  heroRoles?: unknown;
  teamName?: string | null;
  leagueName?: string | null;
  createdAt?: Date | string | null;
}

const PLAYER_SOURCE_BOOST = 2.5;
const HAS_ROLES_BOOST = 1.15;
const OLD_PRO_PENALTY = 0.35; // bottom quintile of matchId in the candidate set
const MIN_WEIGHT = 0.05;

function proMatchId(row: PoolPickRow): number | null {
  if (row.source !== 'pro') return null;
  const raw = parsePooledProMatchId(row.id);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function createdAtMs(row: PoolPickRow): number | null {
  if (!row.createdAt) return null;
  const t = new Date(row.createdAt).getTime();
  return Number.isFinite(t) ? t : null;
}

/** Normalize x into [0,1] given observed min/max; flat 0.5 if degenerate. */
function unit(x: number, min: number, max: number): number {
  if (!(max > min)) return 0.5;
  return Math.max(0, Math.min(1, (x - min) / (max - min)));
}

/**
 * Relative pick weight for one row given the candidate set's range stats.
 * Higher = more likely. Never returns <= 0.
 */
export function opponentPickWeight(
  row: PoolPickRow,
  ranges: {
    minMatchId: number;
    maxMatchId: number;
    minCreatedAt: number;
    maxCreatedAt: number;
    oldMatchIdCutoff: number;
  },
): number {
  let w = 1;

  if (row.source === 'player') {
    w *= PLAYER_SOURCE_BOOST;
    const t = createdAtMs(row);
    if (t != null) {
      // Square the unit age so the newest commits dominate without zeroing old ones.
      const freshness = unit(t, ranges.minCreatedAt, ranges.maxCreatedAt);
      w *= 0.25 + 0.75 * freshness * freshness;
    }
  } else {
    const mid = proMatchId(row);
    if (mid != null) {
      const freshness = unit(mid, ranges.minMatchId, ranges.maxMatchId);
      w *= 0.2 + 0.8 * freshness * freshness;
      if (mid <= ranges.oldMatchIdCutoff) w *= OLD_PRO_PENALTY;
    }
    // Soft preference for modern TI / 2025+ league names when present.
    const league = (row.leagueName ?? '').toLowerCase();
    if (league.includes('2026') || league.includes('international 202')) w *= 1.35;
    else if (league.includes('2024') || league.includes('2025')) w *= 1.1;
  }

  if (row.heroRoles != null) w *= HAS_ROLES_BOOST;

  return Math.max(MIN_WEIGHT, w);
}

export function buildOpponentPickRanges(rows: PoolPickRow[]): {
  minMatchId: number;
  maxMatchId: number;
  minCreatedAt: number;
  maxCreatedAt: number;
  oldMatchIdCutoff: number;
} {
  const matchIds = rows.map(proMatchId).filter((n): n is number => n != null);
  const created = rows.map(createdAtMs).filter((n): n is number => n != null);
  const minMatchId = matchIds.length ? Math.min(...matchIds) : 0;
  const maxMatchId = matchIds.length ? Math.max(...matchIds) : 1;
  const minCreatedAt = created.length ? Math.min(...created) : 0;
  const maxCreatedAt = created.length ? Math.max(...created) : 1;

  // Bottom 20% of pro match ids in this candidate set count as "old".
  let oldMatchIdCutoff = minMatchId;
  if (matchIds.length >= 5) {
    const sorted = [...matchIds].sort((a, b) => a - b);
    oldMatchIdCutoff = sorted[Math.floor(sorted.length * 0.2)]!;
  }

  return { minMatchId, maxMatchId, minCreatedAt, maxCreatedAt, oldMatchIdCutoff };
}

/** Weighted random index; `rand` in [0,1). */
export function pickWeightedIndex(weights: number[], rand: number): number {
  const total = weights.reduce((a, b) => a + b, 0);
  if (!(total > 0) || weights.length === 0) return 0;
  let r = rand * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r < 0) return i;
  }
  return weights.length - 1;
}

export function pickWeightedOpponent<T extends PoolPickRow>(rows: T[], rand: () => number = Math.random): T {
  if (rows.length === 0) throw new Error('pickWeightedOpponent: empty rows');
  if (rows.length === 1) return rows[0];
  const ranges = buildOpponentPickRanges(rows);
  const weights = rows.map((r) => opponentPickWeight(r, ranges));
  return rows[pickWeightedIndex(weights, rand())];
}
