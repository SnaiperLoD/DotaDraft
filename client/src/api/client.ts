import type {
  Hero,
  PickRequest,
  AssignRolesRequest,
  DraftPoolResponse,
  CreateDraftRequest,
  HistoryEntry,
  EvaluationResult,
  CommitDraftResponse,
  BattleResultResponse,
  SynergyPreviewRequest,
  SynergyPreviewEntry,
  TopAbility,
  AbilityCategory,
  LeaderboardEntryView,
} from 'shared';
import type { DraftStateView } from './types';

const BASE_URL = '/api';

// Exported so the testing-only DebugMatrixPage can call /dev/hero-matrix
// without that endpoint appearing as a method on the shipped `api` object —
// the page and its one dev-only request both live behind the lazy import in
// App.tsx, so nothing about /dev reaches a production bundle.
export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Request failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getHeroes: () => request<Hero[]>('/heroes'),

  // Round 1's pool. Writes nothing — the draft row only exists once
  // createDraft() below lands the first pick (server: DraftService.create).
  getDraftPool: () => request<DraftPoolResponse>('/draft/pool', { method: 'POST' }),

  createDraft: (seed: number, heroId: number, rerollUsed: boolean) =>
    request<DraftStateView>('/draft', {
      method: 'POST',
      body: JSON.stringify({ seed, heroId, rerollUsed } satisfies CreateDraftRequest),
    }),

  getDraft: (id: string) => request<DraftStateView>(`/draft/${id}`),

  pickHero: (id: string, heroId: number) =>
    request<DraftStateView>(`/draft/${id}/pick`, {
      method: 'POST',
      body: JSON.stringify({ heroId } satisfies PickRequest),
    }),

  reroll: (id: string) => request<DraftStateView>(`/draft/${id}/reroll`, { method: 'POST' }),

  assignRoles: (id: string, assignments: AssignRolesRequest['assignments']) =>
    request<DraftStateView>(`/draft/${id}/roles`, {
      method: 'POST',
      body: JSON.stringify({ assignments } satisfies AssignRolesRequest),
    }),

  getHistory: () => request<HistoryEntry[]>('/history'),

  getEvaluation: (draftId: string) => request<EvaluationResult>(`/evaluation/${draftId}`),

  commitToPool: (draftId: string, submitterToken: string) =>
    request<CommitDraftResponse>('/opponent-pool/commit', {
      method: 'POST',
      body: JSON.stringify({ draftId, submitterToken }),
    }),

  fightBattle: (draftId: string, submitterToken: string) =>
    request<BattleResultResponse>('/battle', {
      method: 'POST',
      body: JSON.stringify({ draftId, submitterToken }),
    }),

  getSynergyPreview: (pickedHeroIds: number[], candidateHeroIds: number[]) =>
    request<SynergyPreviewEntry[]>('/heroes/synergy-preview', {
      method: 'POST',
      body: JSON.stringify({ pickedHeroIds, candidateHeroIds } satisfies SynergyPreviewRequest),
    }),

  getTopAbilities: (heroId: number, category: AbilityCategory, limit = 3) =>
    request<TopAbility[]>(`/heroes/${heroId}/top-abilities?category=${category}&limit=${limit}`),

  getLeaderboard: (limit = 20) => request<LeaderboardEntryView[]>(`/leaderboard?limit=${limit}`),
};
