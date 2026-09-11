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
  LeaderboardResponse,
  CaptainsStateView,
  TiRunStateView,
  AuthMeResponse,
  AuthSessionResponse,
  AuthGoogleStartResponse,
} from 'shared';
import type { DraftStateView, TiFormResponse } from './types';
import { getSubmitterToken, OWNER_TOKEN_HEADER } from '../utils/submitterToken';
import { parseApiError } from './parseApiError';

const BASE_URL = '/api';

// Exported so the testing-only DebugMatrixPage can call /dev/hero-matrix
// without that endpoint appearing as a method on the shipped `api` object —
// the page and its one dev-only request both live behind the lazy import in
// App.tsx, so nothing about /dev reaches a production bundle.
export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      [OWNER_TOKEN_HEADER]: getSubmitterToken(),
      ...options?.headers,
    },
  });
  if (!res.ok) {
    throw new Error(await parseApiError(res));
  }
  return res.json() as Promise<T>;
}

export const api = {
  getHeroes: () => request<Hero[]>('/heroes'),
  getTiForm: () => request<TiFormResponse>('/heroes/ti-form'),

  // Round 1's pool. Writes nothing — the draft row only exists once
  // createDraft() below lands the first pick (server: DraftService.create).
  getDraftPool: () => request<DraftPoolResponse>('/draft/pool', { method: 'POST' }),

  createDraft: (seed: number, heroId: number, rerollUsed: boolean, mode: 'battle' | 'ti' = 'battle') =>
    request<DraftStateView>('/draft', {
      method: 'POST',
      body: JSON.stringify({ seed, heroId, rerollUsed, mode } satisfies CreateDraftRequest),
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

  fightBattle: (
    draftId: string,
    submitterToken: string,
    opts: { copiedDraft?: string; captainsSessionId?: string; tiRunId?: string } = {},
  ) =>
    request<BattleResultResponse>('/battle', {
      method: 'POST',
      body: JSON.stringify({
        draftId,
        submitterToken,
        ...(opts.copiedDraft ? { copiedDraft: opts.copiedDraft } : {}),
        ...(opts.captainsSessionId ? { captainsSessionId: opts.captainsSessionId } : {}),
        ...(opts.tiRunId ? { tiRunId: opts.tiRunId } : {}),
      }),
    }),

  getSynergyPreview: (pickedHeroIds: number[], candidateHeroIds: number[]) =>
    request<SynergyPreviewEntry[]>('/heroes/synergy-preview', {
      method: 'POST',
      body: JSON.stringify({ pickedHeroIds, candidateHeroIds } satisfies SynergyPreviewRequest),
    }),

  getTopAbilities: (heroId: number, category: AbilityCategory, limit = 3) =>
    request<TopAbility[]>(`/heroes/${heroId}/top-abilities?category=${category}&limit=${limit}`),

  getLeaderboard: (limit = 20) => request<LeaderboardResponse>(`/leaderboard?limit=${limit}`),

  startCaptains: () => request<CaptainsStateView>('/captains', { method: 'POST' }),
  getCaptains: (id: string) => request<CaptainsStateView>(`/captains/${id}`),
  actCaptains: (id: string, heroId: number | null, timedOut = false) =>
    request<CaptainsStateView>(`/captains/${id}/act`, {
      method: 'POST',
      body: JSON.stringify({ heroId, timedOut }),
    }),
  assignCaptainsRoles: (id: string, assignments: AssignRolesRequest['assignments']) =>
    request<CaptainsStateView>(`/captains/${id}/roles`, {
      method: 'POST',
      body: JSON.stringify({ assignments } satisfies AssignRolesRequest),
    }),

  startTiRun: () => request<TiRunStateView>('/ti-run', { method: 'POST' }),
  getTiRun: (id: string) => request<TiRunStateView>(`/ti-run/${id}`),
  chooseTiRunTeam: (id: string, teamName: string) =>
    request<TiRunStateView>(`/ti-run/${id}/choose`, {
      method: 'POST',
      body: JSON.stringify({ teamName }),
    }),
  attachTiRunDraft: (id: string, draftId: string) =>
    request<TiRunStateView>(`/ti-run/${id}/attach`, {
      method: 'POST',
      body: JSON.stringify({ draftId }),
    }),

  authMe: () => request<AuthMeResponse>('/auth/me'),
  authRegister: (email: string, password: string) =>
    request<AuthSessionResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  authLogin: (email: string, password: string) =>
    request<AuthSessionResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  authLogout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),
  authGoogleStart: () => request<AuthGoogleStartResponse>('/auth/google/start', { method: 'POST' }),
};
