export type TiRunStatus =
  'PICKING_TEAM' | 'SHOWING_BRACKET' | 'DRAFTING' | 'PLAYING' | 'CHAMPION' | 'ELIMINATED';

export type TiBracketSide = 'upper' | 'lower' | 'grand';
export type TiSlot = 'A' | 'B';

export interface TiSeries {
  id: string;
  round: string;
  bracket: TiBracketSide;
  teamA: string;
  teamB: string;
  winner: string;
}

export interface TiBracketMatch extends TiSeries {
  nextWin: string | null;
  nextWinSlot: TiSlot | null;
  nextLose: string | null;
  nextLoseSlot: TiSlot | null;
  matchIds: string[];
}

export interface TiBracket {
  id: string;
  year: number;
  leagueId: number;
  leagueName: string;
  aliases: Record<string, string[]>;
  matches: TiBracketMatch[];
}

export interface TiTeamCard {
  name: string;
  players: string[];
  initials: string;
}

export interface TiPathFight {
  matchId: string;
  round: string;
  opponent: string;
  outcome: 'Win' | 'Lose';
  advantageDirection: string;
  confidenceTier?: string;
}

/** Coarse double-elim finish — only labels the occupy-slot graph can honestly support. */
export type TiPlacementKind =
  'playing' | 'champion' | 'second' | 'third' | 'fourth' | 'top4' | 'top8' | 'round';

export interface TiRunStateView {
  id: string;
  status: TiRunStatus;
  bracketId: string;
  leagueName: string;
  year: number;
  teams: TiTeamCard[];
  teamName: string | null;
  draftId: string | null;
  currentMatchId: string | null;
  currentRound: string | null;
  opponentName: string | null;
  losses: number;
  path: TiPathFight[];
  matches: TiBracketMatch[];
}
