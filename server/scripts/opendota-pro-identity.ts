import { resolveOfficialPlayerName } from 'shared';
import type { OpenDotaMatchPlayer, PooledHeroRole } from 'shared';

// Shared OpenDota identity helpers for pro-match fetch/backfill scripts.
// Official handles come from /api/proPlayers keyed by Steam account_id —
// that list is what OpenDota already syncs from Liquipedia/Valve, so a
// 1:1 Steam id map beats fuzzy name matching against LPDB.

const RANK_TO_ROLE: Record<number, string> = {
  1: 'Carry',
  2: 'Mid',
  3: 'Offlane',
  4: 'Soft Support',
  5: 'Hard Support',
};

export interface OpenDotaMatchPlayerRow extends OpenDotaMatchPlayer {
  hero_id: number;
  player_slot?: number;
  gold_per_min?: number | null;
}

export function opendotaUrl(apiPath: string): string {
  const base = `https://api.opendota.com/api/${apiPath.replace(/^\//, '')}`;
  const key = process.env.OPENDOTA_API_KEY?.trim();
  if (!key) return base;
  return `${base}${base.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(key)}`;
}

export async function opendotaJson<T>(apiPath: string): Promise<T> {
  const res = await fetch(opendotaUrl(apiPath), { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${apiPath} HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function fetchProPlayerNameMap(): Promise<Map<number, string>> {
  const rows = await opendotaJson<{ account_id?: number; name?: string | null }[]>('proPlayers');
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('proPlayers returned an empty list');
  }
  const map = new Map<number, string>();
  for (const row of rows) {
    const id = row.account_id;
    const name = row.name?.trim();
    if (typeof id === 'number' && id > 0 && name) map.set(id, name);
  }
  if (map.size === 0) throw new Error('proPlayers had no usable account_id/name rows');
  return map;
}

export function trimTeamName(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

export function pooledRolesForSide(
  players: OpenDotaMatchPlayerRow[],
  proNameByAccountId: ReadonlyMap<number, string>,
  opts?: { requireGpm?: boolean },
): PooledHeroRole[] | null {
  if (opts?.requireGpm && players.some((p) => p.gold_per_min == null || Number.isNaN(p.gold_per_min))) {
    return null;
  }
  return [...players]
    .sort((a, b) => (b.gold_per_min ?? 0) - (a.gold_per_min ?? 0))
    .map((p, i) => ({
      heroId: p.hero_id,
      role: RANK_TO_ROLE[i + 1],
      playerName: resolveOfficialPlayerName(p, proNameByAccountId),
      accountId: typeof p.account_id === 'number' && p.account_id > 0 ? p.account_id : null,
    }));
}

export function matchHasResolvedIdentities(m: {
  radiantName: string | null;
  direName: string | null;
  radiantHeroRoles?: PooledHeroRole[] | null;
  direHeroRoles?: PooledHeroRole[] | null;
}): boolean {
  const roles = [...(m.radiantHeroRoles ?? []), ...(m.direHeroRoles ?? [])];
  if (roles.length !== 10) return false;
  // accountId is written on every successful identity overlay (number or
  // null for anonymous). Pre-backfill rows omit the key entirely.
  return roles.every((r) => Object.prototype.hasOwnProperty.call(r, 'accountId'));
}
