import type { PooledDraftSource } from './opponent-pool';

export type ConfidenceTier = 'Low' | 'Moderate' | 'High';
export type AdvantageDirection = 'A' | 'B' | 'Even';
export type ResolvedOutcome = 'Win' | 'Lose';

export interface BattleOpponentHero {
  heroId: number;
  heroName: string;
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
  opponent: BattleOpponent;
}
