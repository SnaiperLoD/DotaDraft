import type { PooledDraftSource } from './opponent-pool';

export type ConfidenceTier = 'Low' | 'Moderate' | 'High';
export type AdvantageDirection = 'A' | 'B' | 'Even';
export type ResolvedOutcome = 'Win' | 'Lose';

export interface BattleOpponentHero {
  heroId: number;
  heroName: string;
  // See PooledHeroRole.playerName (opponent-pool.ts) — only ever set for
  // 'pro' opponents with backfilled player data.
  playerName?: string | null;
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

export interface BattleResultResponse {
  resolvedOutcome: ResolvedOutcome;
  advantageDirection: AdvantageDirection;
  confidenceTier: ConfidenceTier;
  advantages: string[];
  disadvantages: string[];
  explanation: string[];
  // Blueprint/10-tech-debt-backlog.md, "Комментарии по конкретным успешным
  // матчапам" — top real matchup/synergy pairs for whichever side actually
  // won this battle, narrative sentences only (see battle-resolution.ts).
  winningHighlights: string[];
  // Shutdown (common/shutdown.ts) — hero ids on EITHER side (mine or the
  // opponent's) uniformly countered by all 5 heroes on the other draft.
  // Client marks the matching portrait regardless of which side it belongs
  // to; shutdownNotes are separate narrative lines already phrased from the
  // calling player's own perspective.
  shutdownHeroIds: number[];
  shutdownNotes: string[];
  opponent: BattleOpponent;
}
