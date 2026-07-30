import type {
  Hero,
  PickRequest,
  AssignRolesRequest,
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

async function request<T>(path: string, options?: RequestInit): Promise<T> {
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

  startDraft: () => request<DraftStateView>('/draft/start', { method: 'POST' }),

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
