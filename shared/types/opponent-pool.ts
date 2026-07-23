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
}

export interface CommitDraftRequest {
  draftId: string;
  submitterToken: string;
}

export interface CommitDraftResponse {
  id: string;
  committedAt: string;
}
