import type { Hero } from '../../../shared/types/hero';
import type { PickRequest, AssignRolesRequest, HistoryEntry } from '../../../shared/types/draft';
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

  assignRoles: (id: string, assignments: AssignRolesRequest['assignments']) =>
    request<DraftStateView>(`/draft/${id}/roles`, {
      method: 'POST',
      body: JSON.stringify({ assignments } satisfies AssignRolesRequest),
    }),

  getHistory: () => request<HistoryEntry[]>('/history'),
};
