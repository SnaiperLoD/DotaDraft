export type PooledDraftSource = 'player' | 'pro';

export interface PooledDraftSummary {
  id: string;
  source: PooledDraftSource;
  heroIds: number[];
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
