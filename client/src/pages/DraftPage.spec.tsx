import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { renderWithRouter } from '../test/render';
import { draftState, fiveDraftHeroes, fivePoolHeroes } from '../test/fixtures/draft';
import DraftPage from './DraftPage';

vi.mock('../api/client', () => ({
  api: {
    getDraftPool: vi.fn(),
    createDraft: vi.fn(),
    getDraft: vi.fn(),
    pickHero: vi.fn(),
    reroll: vi.fn(),
    assignRoles: vi.fn(),
    getTiForm: vi.fn(),
    getSynergyPreview: vi.fn(),
  },
}));

vi.mock('../telemetry', () => ({
  track: vi.fn(),
}));

vi.mock('../components/BattlePanel', () => ({
  default: function BattlePanelMock({ active, onBack }: { active?: boolean; onBack?: () => void }) {
    if (!active) return null;
    return (
      <div data-testid="battle-panel-mock">
        <button type="button" onClick={onBack}>
          Back
        </button>
      </div>
    );
  },
}));

vi.mock('../components/TapalkaWidget', () => ({
  default: () => null,
}));

const SEED = 42;
const POOL = fivePoolHeroes();

function completedBattleDraft() {
  const roles = ['Carry', 'Mid', 'Offlane', 'Soft Support', 'Hard Support'] as const;
  return draftState({
    id: 'draft-1',
    status: 'COMPLETED',
    mode: 'battle',
    heroes: fiveDraftHeroes().map((h, i) => ({ ...h, assignedRole: roles[i] })),
    pool: [],
    rerollsRemaining: 0,
  });
}

function visibleByTestId(testId: string): HTMLElement {
  const match = screen.getAllByTestId(testId).find((el) => !el.closest('[hidden]'));
  if (!match) throw new Error(`No visible element with testid ${testId}`);
  return match;
}

describe('DraftPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getDraftPool).mockResolvedValue({ seed: SEED, pool: POOL });
    vi.mocked(api.createDraft).mockResolvedValue(
      draftState({
        id: 'draft-1',
        status: 'PICKING',
        heroes: [fiveDraftHeroes()[0]],
        pool: POOL.slice(1),
      }),
    );
    vi.mocked(api.getDraft).mockResolvedValue(draftState({ id: 'draft-1' }));
    vi.mocked(api.getTiForm).mockRejectedValue(new Error('no ti form'));
    vi.mocked(api.getSynergyPreview).mockResolvedValue([]);
  });

  it('loads a fresh pool and renders five hero cards', async () => {
    renderWithRouter(<DraftPage />, { route: '/draft' });

    await waitFor(() => {
      expect(api.getDraftPool).toHaveBeenCalled();
    });
    expect(await screen.findAllByTestId('hero-card')).toHaveLength(5);
  });

  it('creates a draft on the first pick', async () => {
    const user = userEvent.setup();
    renderWithRouter(<DraftPage />, { route: '/draft' });
    const cards = await screen.findAllByTestId('hero-card');

    await user.click(cards[0]);

    await waitFor(() => {
      expect(api.createDraft).toHaveBeenCalledWith(SEED, POOL[0].id, false);
    });
  });

  it('resumes an existing draft without fetching a new pool', async () => {
    renderWithRouter(<DraftPage />, { route: '/draft?resume=draft-1' });

    await waitFor(() => {
      expect(api.getDraft).toHaveBeenCalledWith('draft-1');
    });
    expect(api.getDraftPool).not.toHaveBeenCalled();
  });

  it('opens the battle mock and hides evaluation when resuming a completed fight', async () => {
    vi.mocked(api.getDraft).mockResolvedValue(completedBattleDraft());
    renderWithRouter(<DraftPage />, { route: '/draft?resume=draft-1&fight=1' });

    await waitFor(() => {
      expect(screen.getByTestId('battle-panel-mock')).toBeVisible();
    });
    expect(screen.getByTestId('evaluate-draft')).not.toBeVisible();
  });

  it('toggles battle mock from enter-battle-mode and returns to evaluation on Back', async () => {
    const user = userEvent.setup();
    vi.mocked(api.getDraft).mockResolvedValue(completedBattleDraft());
    renderWithRouter(<DraftPage />, { route: '/draft?resume=draft-1' });

    await waitFor(() => {
      expect(screen.getByTestId('evaluate-draft')).toBeVisible();
    });
    expect(screen.queryByTestId('battle-panel-mock')).not.toBeInTheDocument();

    await user.click(visibleByTestId('enter-battle-mode'));

    await waitFor(() => {
      expect(screen.getByTestId('battle-panel-mock')).toBeVisible();
    });
    expect(screen.getByTestId('evaluate-draft')).not.toBeVisible();

    await user.click(within(screen.getByTestId('battle-panel-mock')).getByRole('button', { name: 'Back' }));

    await waitFor(() => {
      expect(screen.getByTestId('evaluate-draft')).toBeVisible();
    });
    expect(screen.queryByTestId('battle-panel-mock')).not.toBeInTheDocument();
  });
});
