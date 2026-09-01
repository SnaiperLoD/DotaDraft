/** Deterministic Opponent Pool ids for a ProMatch. Winner stays `pro-{id}`;
 *  TI losing sides are `pro-{id}-lose` so both lineups can live in the pool. */

export function isInternationalLeague(leagueName: string | null | undefined): boolean {
  return /the international\s+20\d{2}/i.test(leagueName ?? '');
}

export function pooledProWinId(matchId: string): string {
  return `pro-${matchId}`;
}

export function pooledProLoseId(matchId: string): string {
  return `pro-${matchId}-lose`;
}

export function parsePooledProMatchId(rowId: string): string | null {
  const matched = /^pro-(\d+)(?:-lose)?$/.exec(rowId);
  return matched?.[1] ?? null;
}

export function pooledProIdsForOpenDotaMatch(matchId: string): string[] {
  return [pooledProWinId(matchId), pooledProLoseId(matchId)];
}
