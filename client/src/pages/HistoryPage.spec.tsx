import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EvaluationResult, HistoryDraftHero, HistoryEntry } from 'shared';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { renderWithRouter } from '../test/render';
import HistoryPage from './HistoryPage';

vi.mock('../auth/AuthProvider', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../api/client', () => ({
  api: {
    getHistory: vi.fn(),
  },
}));

vi.mock('../components/CopyDraftButton', () => ({
  default: () => null,
}));

const ROLES = ['Carry', 'Mid', 'Offlane', 'Soft Support', 'Hard Support'] as const;
const HERO_NAMES = ['Anti-Mage', 'Invoker', 'Axe', 'Crystal Maiden', 'Lion'] as const;

function evaluation(overrides: Partial<EvaluationResult> = {}): EvaluationResult {
  return {
    schemaVersion: 1,
    draftId: 'draft-battle-1',
    totalScore: 7.2,
    breakdown: [],
    summary: { strengths: [], weaknesses: [], gameplan: 'Hold mid and scale.' },
    customTags: [],
    campStackingNote: null,
    hiddenCalibrationApplied: false,
    archetype: { id: 'tempo' },
    ...overrides,
  };
}

function battleHeroes(): HistoryDraftHero[] {
  return HERO_NAMES.map((heroName, i) => ({
    heroId: i + 1,
    heroName,
    assignedRole: ROLES[i],
    pickOrder: i + 1,
  }));
}

function battleHistoryEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: 'draft-battle-1',
    mode: 'battle',
    createdAt: '2026-01-01T00:00:00.000Z',
    heroes: battleHeroes(),
    evaluation: evaluation(),
    battles: [],
    ti: null,
    ...overrides,
  };
}

function mockAuth(overrides: Partial<ReturnType<typeof useAuth>> = {}) {
  const value = {
    user: null,
    googleEnabled: false,
    applySession: vi.fn(),
    logout: vi.fn(),
    ready: true,
    refresh: vi.fn(),
    ...overrides,
  };
  vi.mocked(useAuth).mockReturnValue(value as ReturnType<typeof useAuth>);
  return value;
}

describe('HistoryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth();
    vi.mocked(api.getHistory).mockResolvedValue([]);
  });

  it('shows empty copy and sign-in for a guest with no history', async () => {
    renderWithRouter(<HistoryPage />, { route: '/history' });

    expect(await screen.findByText('No completed drafts yet.')).toBeInTheDocument();
    expect(screen.getByTestId('history-sign-in')).toBeInTheDocument();
  });

  it('hides sign-in when a signed-in user has no history', async () => {
    mockAuth({
      user: { email: 'nick@example.com', googleLinked: false, hasPassword: true },
    });

    renderWithRouter(<HistoryPage />, { route: '/history' });

    expect(await screen.findByText('No completed drafts yet.')).toBeInTheDocument();
    expect(screen.queryByTestId('history-sign-in')).not.toBeInTheDocument();
  });

  it('shows the error message when history fails to load', async () => {
    vi.mocked(api.getHistory).mockRejectedValue(new Error('History unavailable'));

    renderWithRouter(<HistoryPage />, { route: '/history' });

    const error = await screen.findByText('History unavailable');
    expect(error).toHaveClass('error-text');
  });

  it('renders a battle draft with hero names, evaluation score, and refight', async () => {
    vi.mocked(api.getHistory).mockResolvedValue([battleHistoryEntry()]);

    renderWithRouter(<HistoryPage />, { route: '/history' });

    expect(await screen.findByText('Anti-Mage')).toBeInTheDocument();
    expect(screen.getByText('Invoker')).toBeInTheDocument();
    expect(screen.getByText('Axe')).toBeInTheDocument();
    expect(screen.getByText('Crystal Maiden')).toBeInTheDocument();
    expect(screen.getByText('Lion')).toBeInTheDocument();
    expect(screen.getByText(/7\.2/)).toBeInTheDocument();
    expect(screen.getByTestId('history-refight')).toBeInTheDocument();
  });

  it('shows empty-filter copy when TI filter has no matching drafts', async () => {
    const user = userEvent.setup();
    vi.mocked(api.getHistory).mockResolvedValue([battleHistoryEntry()]);

    renderWithRouter(<HistoryPage />, { route: '/history' });
    expect(await screen.findByText('Anti-Mage')).toBeInTheDocument();

    const tiFilter = document.querySelector('[data-history-filter="ti"]');
    expect(tiFilter).toBeInstanceOf(HTMLElement);
    await user.click(tiFilter as HTMLElement);

    await waitFor(() => {
      expect(screen.getByText('Nothing in this mode yet.')).toBeInTheDocument();
    });
  });
});
