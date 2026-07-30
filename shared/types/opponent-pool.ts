export type PooledDraftSource = 'player' | 'pro';

export interface PooledHeroRole {
  heroId: number;
  role: string;
}

export interface PooledDraftSummary {
  id: string;
  source: PooledDraftSource;
  heroIds: number[];
  // null for rows committed before role-fit reached Battle Engine — see
  // Blueprint/10-tech-debt-backlog.md, "Role-fit in Battle Engine".
  heroRoles: PooledHeroRole[] | null;
  teamName: string | null;
  leagueName: string | null;
  // OpenDota matchId for 'pro' rows (derived from the deterministic
  // `pro-${matchId}` id scheme, see seed-opponent-pool.ts — no separate
  // column needed). Always null for 'player' rows (no real match backs
  // them). See Blueprint/10-tech-debt-backlog.md, "Ссылка на исходный матч
  // для про-пиков".
  matchId: string | null;
}

export interface CommitDraftRequest {
  draftId: string;
  submitterToken: string;
}

export interface CommitDraftResponse {
  id: string;
  committedAt: string;
}

// GET /leaderboard — Blueprint/10-tech-debt-backlog.md, "Лидерборд". No
// account system backs this (explicit MVP shortcut) — submitterToken is
// the same anonymous client-generated UUID used to commit to the
// Opponent Pool, not a player identity. The client is responsible for
// deciding how to display a raw token (e.g. a short "Player #ab12cd34"
// label) and for recognizing its own row via getSubmitterToken().
export interface LeaderboardEntryView {
  submitterToken: string;
  wins: number;
  losses: number;
  winRate: number;
}
