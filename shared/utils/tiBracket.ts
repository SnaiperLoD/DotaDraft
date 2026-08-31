import type { TiBracketMatch, TiPathFight, TiSeries, TiSlot } from '../types/ti-run';

function norm(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function canonTeam(name: string, aliases: Record<string, string[]> = {}): string {
  const needle = norm(name);
  for (const [canonical, others] of Object.entries(aliases)) {
    if (norm(canonical) === needle) return canonical;
    if (others.some((alias) => norm(alias) === needle)) return canonical;
  }
  return name.trim();
}

export function teamsMatch(a: string, b: string, aliases: Record<string, string[]> = {}): boolean {
  return norm(canonTeam(a, aliases)) === norm(canonTeam(b, aliases));
}

export function teamInitials(name: string): string {
  const parts = name
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 3).toUpperCase();
  return parts
    .slice(0, 3)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
}

export function linkSeries(series: TiSeries[]): TiBracketMatch[] {
  return series.map((row, index) => {
    const loser = row.winner === row.teamA ? row.teamB : row.teamA;
    const later = series.slice(index + 1);
    const nextWin = later.find((m) => m.teamA === row.winner || m.teamB === row.winner);
    const nextLose = later.find((m) => m.teamA === loser || m.teamB === loser);
    const slotOf = (match: TiSeries, team: string): TiSlot => (match.teamA === team ? 'A' : 'B');
    return {
      ...row,
      nextWin: nextWin?.id ?? null,
      nextWinSlot: nextWin ? slotOf(nextWin, row.winner) : null,
      nextLose: nextLose?.id ?? null,
      nextLoseSlot: nextLose ? slotOf(nextLose, loser) : null,
      matchIds: [],
    };
  });
}

export function playoffTeams(matches: TiBracketMatch[]): string[] {
  const names = new Set<string>();
  for (const match of matches) {
    names.add(match.teamA);
    names.add(match.teamB);
  }
  return [...names];
}

export function openingMatch(
  matches: TiBracketMatch[],
  team: string,
  aliases: Record<string, string[]> = {},
): TiBracketMatch {
  const found = matches.find((m) => teamsMatch(m.teamA, team, aliases) || teamsMatch(m.teamB, team, aliases));
  if (!found) throw new Error(`Team ${team} is not in this playoff`);
  return found;
}

export function otherTeam(
  match: TiBracketMatch,
  team: string,
  aliases: Record<string, string[]> = {},
): string {
  if (teamsMatch(match.teamA, team, aliases)) return match.teamB;
  if (teamsMatch(match.teamB, team, aliases)) return match.teamA;
  throw new Error(`Team ${team} is not in ${match.id}`);
}

export function historicalMover(match: TiBracketMatch, won: boolean): string {
  if (won) return match.winner;
  return match.winner === match.teamA ? match.teamB : match.teamA;
}

export function advanceBracket(
  matches: TiBracketMatch[],
  currentMatchId: string,
  won: boolean,
): { nextMatchId: string | null; opponent: string | null; champion: boolean; eliminated: boolean } {
  const match = matches.find((m) => m.id === currentMatchId);
  if (!match) throw new Error(`Unknown match ${currentMatchId}`);
  if (match.bracket === 'grand') {
    return won
      ? { nextMatchId: null, opponent: null, champion: true, eliminated: false }
      : { nextMatchId: null, opponent: null, champion: false, eliminated: true };
  }
  const nextId = won ? match.nextWin : match.nextLose;
  if (!nextId) {
    return { nextMatchId: null, opponent: null, champion: false, eliminated: true };
  }
  const next = matches.find((m) => m.id === nextId);
  if (!next) throw new Error(`Unknown next match ${nextId}`);
  const mover = historicalMover(match, won);
  const opponent = next.teamA === mover ? next.teamB : next.teamA;
  return { nextMatchId: nextId, opponent, champion: false, eliminated: false };
}

export function projectLiveBracket(
  template: TiBracketMatch[],
  input: {
    playerTeam: string | null;
    path: TiPathFight[];
    currentMatchId: string | null;
    aliases?: Record<string, string[]>;
  },
): TiBracketMatch[] {
  const aliases = input.aliases ?? {};
  const projected = template.map((match) => ({ ...match, teamA: '', teamB: '', winner: '' }));
  const live = new Map(projected.map((match) => [match.id, match]));
  const source = new Map(template.map((match) => [match.id, match]));
  const player = input.playerTeam?.trim() ?? '';
  if (!player) return projected;

  const paint = (matchId: string, occupyAs: string, opponent: string, winner: string) => {
    const src = source.get(matchId);
    const dst = live.get(matchId);
    if (!src || !dst) return;
    if (teamsMatch(src.teamA, occupyAs, aliases)) {
      dst.teamA = player;
      dst.teamB = opponent;
    } else if (teamsMatch(src.teamB, occupyAs, aliases)) {
      dst.teamB = player;
      dst.teamA = opponent;
    } else {
      dst.teamA = player;
      dst.teamB = opponent;
    }
    dst.winner = winner;
  };

  let occupyAs = player;
  for (const fight of input.path) {
    const src = source.get(fight.matchId);
    if (!src) continue;
    const won = fight.outcome === 'Win';
    paint(fight.matchId, occupyAs, fight.opponent, won ? player : fight.opponent);
    occupyAs = historicalMover(src, won);
  }

  const currentId = input.currentMatchId;
  if (currentId && !input.path.some((fight) => fight.matchId === currentId)) {
    const src = source.get(currentId);
    if (src) {
      let opponent = '';
      try {
        opponent = otherTeam(src, occupyAs, aliases);
      } catch {
        opponent = '';
      }
      paint(currentId, occupyAs, opponent, '');
    }
  }

  return projected;
}
