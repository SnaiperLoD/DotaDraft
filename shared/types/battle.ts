import type { PooledDraftSource } from './opponent-pool';

export type ConfidenceTier = 'Low' | 'Moderate' | 'High';
export type AdvantageDirection = 'A' | 'B' | 'Even';
export type ResolvedOutcome = 'Win' | 'Lose';

export interface BattleOpponentHero {
  heroId: number;
  heroName: string;
  assignedRole?: string | null;
  // See PooledHeroRole.playerName (opponent-pool.ts) — only ever set for
  // 'pro' opponents with backfilled player data.
  playerName?: string | null;
}

export type BattleLaneId = 'safe' | 'mid' | 'off';
export type BattleLaneWinner = 'mine' | 'opponent' | 'even';

export interface BattleLaneResult {
  lane: BattleLaneId;
  mine: string[];
  opponent: string[];
  winner: BattleLaneWinner;
}

export interface BattleOpponent {
  source: PooledDraftSource;
  heroes: BattleOpponentHero[];
  teamName: string | null;
  leagueName: string | null;
  // OpenDota matchId, present only for 'pro' opponents. See
  // Blueprint/10-tech-debt-backlog.md, "Ссылка на исходный матч для про-пиков".
  matchId: string | null;
}

export interface BattleRequest {
  draftId: string;
  submitterToken: string;
}

// Real (OpenDota) win-rate rows surfaced in the battle result, always from
// the calling player's own draft perspective (teamA), win or lose. Unlike the
// narrative `winningHighlights`, these carry the raw winRate so the client can
// show the number — a deliberate exception to the file's usual "no raw
// percentage" convention, by direct user request ("show real best pairs by
// win rate, best/worst matchups vs the opponent's draft").
export interface BattlePair {
  heroA: string;
  heroAId: number;
  heroB: string;
  heroBId: number;
  winRate: number;
}

export interface BattleMatchup {
  hero: string;
  heroId: number;
  vs: string;
  vsId: number;
  // Real matchup win rate of `hero` into `vs` (confidence-shrunk toward 0.5
  // by sample size, HeroMetaService).
  winRate: number;
  // `hero`'s overall real win rate, for the "baseline → matchup" delta the
  // client shows (e.g. 49% overall → 60% into this opponent). null when the
  // snapshot has no overall win rate for the hero.
  baseWinRate: number | null;
}

export interface BattleResultResponse {
  resolvedOutcome: ResolvedOutcome;
  advantageDirection: AdvantageDirection;
  confidenceTier: ConfidenceTier;
  advantages: string[];
  disadvantages: string[];
  explanation: string[];
  // Your draft's best real synergy pairs (getSynergyWinRate), and your best /
  // worst individual matchups into THIS opponent's heroes (getMatchupWinRate).
  // Empty when no real matchup data is available for the heroes in play.
  bestPairs: BattlePair[];
  bestMatchups: BattleMatchup[];
  worstMatchups: BattleMatchup[];
  // Blueprint/10-tech-debt-backlog.md, "Комментарии по конкретным успешным
  // матчапам" — top real matchup/synergy pairs for whichever side actually
  // won this battle, narrative sentences only (see battle-resolution.ts).
  winningHighlights: string[];
  // Shutdown (common/shutdown.ts) — hero ids on EITHER side whose real
  // matchup win rate is below their own average vs every hero on the other
  // draft. Client marks portraits and builds localized notes from
  // shutdownHeroIds; shutdownNotes remain English fallbacks from the server.
  shutdownHeroIds: number[];
  shutdownNotes: string[];
  lanes?: BattleLaneResult[];
  opponent: BattleOpponent;
}
