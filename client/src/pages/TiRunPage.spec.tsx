import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TiBracketMatch, TiRunStateView } from 'shared';
import { api } from '../api/client';
import { renderWithRouter } from '../test/render';
import { draftState, fiveDraftHeroes, fivePoolHeroes } from '../test/fixtures/draft';
import { TI_RUN_SESSION_KEY } from '../utils/submitterToken';
import TiRunPage from './TiRunPage';

vi.mock('../api/client', () => ({
  api: {
    startTiRun: vi.fn(),
    getTiRun: vi.fn(),
    chooseTiRunTeam: vi.fn(),
    attachTiRunDraft: vi.fn(),
    getDraftPool: vi.fn(),
    createDraft: vi.fn(),
    getDraft: vi.fn(),
    pickHero: vi.fn(),
    reroll: vi.fn(),
    assignRoles: vi.fn(),
    getSynergyPreview: vi.fn(),
  },
}));

vi.mock('../components/BattlePanel', () => ({
  default: function BattlePanelMock() {
    return <div data-testid="battle-panel-mock">Battle</div>;
  },
}));

vi.mock('../components/EvaluationPanel', () => ({
  default: function EvaluationPanelMock() {
    return <div data-testid="evaluation-panel-mock" />;
  },
}));

const blank = (
  id: string,
  round: string,
  bracket: TiBracketMatch['bracket'],
  extras: Partial<TiBracketMatch> = {},
): TiBracketMatch => ({
  id,
  round,
  bracket,
  teamA: '',
  teamB: '',
  winner: '',
  nextWin: null,
  nextWinSlot: null,
  nextLose: null,
  nextLoseSlot: null,
  matchIds: [],
  ...extras,
});

const baseMatches: TiBracketMatch[] = [
  blank('ub_r1_1', 'Upper Bracket Round 1', 'upper', {
    teamA: 'Invictus Gaming',
    teamB: 'Team Spirit',
  }),
  blank('ub_r1_2', 'Upper Bracket Round 1', 'upper', {
    teamA: 'PSG.LGD',
    teamB: 'Evil Geniuses',
    winner: 'PSG.LGD',
  }),
  blank('ub_f', 'Upper Bracket Final', 'upper'),
  blank('lb_r1_1', 'Lower Bracket Round 1', 'lower', {
    teamA: 'Invictus Gaming',
    teamB: 'OG',
    winner: 'Invictus Gaming',
  }),
  blank('gf', 'Grand Final', 'grand'),
];

function tiRun(overrides: Partial<TiRunStateView> = {}): TiRunStateView {
  return {
    id: 'ti-1',
    status: 'PICKING_TEAM',
    bracketId: 'ti-2021',
    leagueName: 'The International 2021',
    year: 2021,
    teams: [
      { name: 'Team Spirit', players: ['Yatoro'], initials: 'TS' },
      { name: 'PSG.LGD', players: ['Ame'], initials: 'LGD' },
    ],
    teamName: null,
    draftId: null,
    currentMatchId: null,
    currentRound: null,
    opponentName: null,
    losses: 0,
    path: [],
    matches: baseMatches,
    ...overrides,
  };
}

function completedDraft() {
  const roles = ['Carry', 'Mid', 'Offlane', 'Soft Support', 'Hard Support'] as const;
  return draftState({
    id: 'draft-ti',
    status: 'COMPLETED',
    mode: 'ti',
    heroes: fiveDraftHeroes().map((h, i) => ({ ...h, assignedRole: roles[i] })),
    pool: [],
    rerollsRemaining: 0,
  });
}

function playingRun(overrides: Partial<TiRunStateView> = {}): TiRunStateView {
  return tiRun({
    status: 'PLAYING',
    teamName: 'Team Spirit',
    draftId: 'draft-ti',
    currentMatchId: 'ub_r1_1',
    currentRound: 'Upper Bracket Round 1',
    opponentName: 'Invictus Gaming',
    ...overrides,
  });
}

describe('TiRunPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.removeItem(TI_RUN_SESSION_KEY);
    vi.mocked(api.startTiRun).mockResolvedValue(tiRun());
    vi.mocked(api.getTiRun).mockResolvedValue(tiRun());
    vi.mocked(api.chooseTiRunTeam).mockResolvedValue(
      tiRun({
        status: 'SHOWING_BRACKET',
        teamName: 'Team Spirit',
      }),
    );
    vi.mocked(api.getDraftPool).mockResolvedValue({ seed: 7, pool: fivePoolHeroes() });
    vi.mocked(api.getDraft).mockResolvedValue(completedDraft());
    vi.mocked(api.getSynergyPreview).mockResolvedValue([]);
    vi.mocked(api.attachTiRunDraft).mockImplementation(async (_runId, draftId) => playingRun({ draftId }));
  });

  afterEach(() => {
    localStorage.removeItem(TI_RUN_SESSION_KEY);
  });

  it('starts a run, persists the id, and lets the player pick a jersey', async () => {
    const user = userEvent.setup();
    renderWithRouter(<TiRunPage />, { route: '/ti-run' });

    await waitFor(() => {
      expect(api.startTiRun).toHaveBeenCalled();
    });
    expect(await screen.findByText('Pick your jersey', { exact: false })).toBeInTheDocument();
    expect(screen.getByTestId('ti-tree-note')).toBeInTheDocument();
    expect(localStorage.getItem(TI_RUN_SESSION_KEY)).toBe('ti-1');

    await user.click(screen.getByRole('button', { name: /Team Spirit/ }));
    await waitFor(() => {
      expect(api.chooseTiRunTeam).toHaveBeenCalledWith('ti-1', 'Team Spirit');
    });
    expect(await screen.findByTestId('ti-bracket')).toBeInTheDocument();
    expect(screen.getByText(/You wear Team Spirit/)).toBeInTheDocument();
  });

  it('resumes from localStorage without starting a new run', async () => {
    localStorage.setItem(TI_RUN_SESSION_KEY, 'ti-live');
    vi.mocked(api.getTiRun).mockResolvedValue(
      tiRun({
        id: 'ti-live',
        status: 'SHOWING_BRACKET',
        teamName: 'Team Spirit',
      }),
    );

    renderWithRouter(<TiRunPage />, { route: '/ti-run' });

    await waitFor(() => {
      expect(api.getTiRun).toHaveBeenCalledWith('ti-live');
    });
    expect(api.startTiRun).not.toHaveBeenCalled();
    expect(await screen.findByTestId('ti-bracket')).toBeInTheDocument();
  });

  it('resumes from the query param even when localStorage is empty', async () => {
    vi.mocked(api.getTiRun).mockResolvedValue(
      tiRun({
        id: 'ti-resume',
        status: 'SHOWING_BRACKET',
        teamName: 'PSG.LGD',
      }),
    );

    renderWithRouter(<TiRunPage />, { route: '/ti-run?resume=ti-resume' });

    await waitFor(() => {
      expect(api.getTiRun).toHaveBeenCalledWith('ti-resume');
    });
    expect(api.startTiRun).not.toHaveBeenCalled();
    expect(await screen.findByText(/You wear PSG\.LGD/)).toBeInTheDocument();
  });

  it('starts a TI draft pool from the bracket screen', async () => {
    const user = userEvent.setup();
    vi.mocked(api.startTiRun).mockResolvedValue(
      tiRun({
        status: 'SHOWING_BRACKET',
        teamName: 'Team Spirit',
      }),
    );

    renderWithRouter(<TiRunPage />, { route: '/ti-run' });
    await user.click(await screen.findByRole('button', { name: 'Draft your five' }));

    await waitFor(() => {
      expect(api.getDraftPool).toHaveBeenCalled();
    });
    expect(await screen.findAllByTestId('hero-card')).toHaveLength(5);
  });

  it('toggles eval and opens the fight mock from a playing run', async () => {
    const user = userEvent.setup();
    localStorage.setItem(TI_RUN_SESSION_KEY, 'ti-1');
    vi.mocked(api.getTiRun).mockResolvedValue(playingRun());

    renderWithRouter(<TiRunPage />, { route: '/ti-run' });

    expect(await screen.findByRole('button', { name: 'Fight' })).toBeInTheDocument();
    expect(api.startTiRun).not.toHaveBeenCalled();
    expect(api.getDraft).toHaveBeenCalledWith('draft-ti');

    await user.click(screen.getByRole('button', { name: 'Evaluate draft' }));
    const evalScreen = await screen.findByTestId('ti-eval-screen');
    expect(evalScreen).toBeVisible();
    expect(within(evalScreen).getByTestId('evaluation-panel-mock')).toBeInTheDocument();

    await user.click(within(evalScreen).getByRole('button', { name: 'Back to TI Run' }));
    await waitFor(() => {
      expect(screen.getByTestId('ti-eval-screen')).not.toBeVisible();
    });

    await user.click(screen.getByRole('button', { name: 'Fight' }));
    expect(await screen.findByTestId('ti-fight-screen')).toBeInTheDocument();
    expect(screen.getByTestId('battle-panel-mock')).toBeInTheDocument();
    expect(screen.queryByTestId('ti-bracket')).not.toBeInTheDocument();
  });

  it('marks the bracket champion and can start another run', async () => {
    const user = userEvent.setup();
    const champion = tiRun({
      status: 'CHAMPION',
      teamName: 'Team Spirit',
      currentMatchId: null,
      opponentName: null,
      path: [
        {
          matchId: 'gf',
          round: 'Grand Final',
          opponent: 'PSG.LGD',
          outcome: 'Win',
          advantageDirection: 'A',
          confidenceTier: 'High',
        },
      ],
      matches: baseMatches.map((match) =>
        match.id === 'gf'
          ? { ...match, teamA: 'PSG.LGD', teamB: 'Team Spirit', winner: 'Team Spirit' }
          : match,
      ),
    });
    vi.mocked(api.startTiRun).mockResolvedValueOnce(champion).mockResolvedValueOnce(tiRun());

    renderWithRouter(<TiRunPage />, { route: '/ti-run' });

    const bracket = await screen.findByTestId('ti-bracket');
    expect(bracket).toHaveAttribute('data-finale', 'champion');
    expect(screen.getByText('You lifted the Aegis.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Another TI' }));
    await waitFor(() => {
      expect(api.startTiRun).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText('Pick your jersey', { exact: false })).toBeInTheDocument();
  });

  it('marks the bracket eliminated on a grand-final loss', async () => {
    vi.mocked(api.startTiRun).mockResolvedValue(
      tiRun({
        status: 'ELIMINATED',
        teamName: 'Team Spirit',
        currentMatchId: null,
        opponentName: null,
        path: [
          {
            matchId: 'gf',
            round: 'Grand Final',
            opponent: 'PSG.LGD',
            outcome: 'Lose',
            advantageDirection: 'B',
            confidenceTier: 'High',
          },
        ],
        matches: baseMatches.map((match) =>
          match.id === 'gf' ? { ...match, teamA: 'PSG.LGD', teamB: 'Team Spirit', winner: 'PSG.LGD' } : match,
        ),
      }),
    );

    renderWithRouter(<TiRunPage />, { route: '/ti-run' });

    expect(await screen.findByTestId('ti-bracket')).toHaveAttribute('data-finale', 'eliminated');
    expect(screen.getByText('Eliminated.')).toBeInTheDocument();
  });
});
