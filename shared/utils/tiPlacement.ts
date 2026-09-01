import type { TiBracketMatch, TiPathFight, TiPlacementKind } from '../types/ti-run';

export type { TiPlacementKind };

export interface TiPlacement {
  kind: TiPlacementKind;
  lastRound: string | null;
}

export function deriveTiPlacement(input: {
  status: string;
  path: TiPathFight[];
  matches: TiBracketMatch[];
}): TiPlacement {
  const status = input.status;
  if (status === 'CHAMPION') {
    const last = lastPathFight(input.path);
    return { kind: 'champion', lastRound: last?.round ?? 'Grand Final' };
  }
  if (status !== 'ELIMINATED') {
    return { kind: 'playing', lastRound: null };
  }

  const death = lastLoss(input.path) ?? lastPathFight(input.path);
  const lastRound = death?.round ?? null;
  if (!death) return { kind: 'round', lastRound };

  const match = input.matches.find((m) => m.id === death.matchId);
  if (!match) {
    if (lastRound && /grand\s*final/i.test(lastRound)) {
      return { kind: 'second', lastRound };
    }
    return { kind: 'round', lastRound };
  }

  if (match.bracket === 'grand') {
    return { kind: 'second', lastRound: match.round };
  }

  const hops = hopsToGrand(match, input.matches);
  const siblings = input.matches.filter((m) => m.bracket === match.bracket && m.round === match.round).length;

  if (hops === 1) {
    return { kind: siblings <= 1 ? 'third' : 'top4', lastRound: match.round };
  }
  if (hops === 2) {
    return { kind: siblings <= 1 ? 'fourth' : 'top4', lastRound: match.round };
  }
  if (hops === 3) {
    return { kind: 'top8', lastRound: match.round };
  }
  return { kind: 'round', lastRound: match.round };
}

function lastPathFight(path: TiPathFight[]): TiPathFight | undefined {
  return path.length > 0 ? path[path.length - 1] : undefined;
}

function lastLoss(path: TiPathFight[]): TiPathFight | undefined {
  for (let i = path.length - 1; i >= 0; i--) {
    if (path[i].outcome === 'Lose') return path[i];
  }
  return undefined;
}

function hopsToGrand(start: TiBracketMatch, matches: TiBracketMatch[]): number | null {
  const byId = new Map(matches.map((m) => [m.id, m]));
  const seen = new Set<string>();
  let cur: TiBracketMatch | undefined = start;
  let hops = 0;
  while (cur) {
    if (seen.has(cur.id)) return null;
    seen.add(cur.id);
    if (cur.bracket === 'grand') return hops;
    if (!cur.nextWin) return hops;
    hops += 1;
    cur = byId.get(cur.nextWin);
    if (hops > 24) return null;
  }
  return hops;
}
