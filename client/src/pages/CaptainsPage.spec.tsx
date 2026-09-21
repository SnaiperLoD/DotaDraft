import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CM_RESERVE_MS, CM_STEPS, type CaptainsStateView, type CmSlot, type Hero } from 'shared';
import { api } from '../api/client';
import { renderWithRouter } from '../test/render';
import { draftState, fiveDraftHeroes, minimalHero } from '../test/fixtures/draft';
import { CAPTAINS_SESSION_KEY } from '../utils/submitterToken';
import CaptainsPage from './CaptainsPage';

vi.mock('../api/client', () => ({
  api: {
    getHeroes: vi.fn(),
    startCaptains: vi.fn(),
    getCaptains: vi.fn(),
    actCaptains: vi.fn(),
    assignCaptainsRoles: vi.fn(),
    getDraft: vi.fn(),
  },
}));

vi.mock('../components/BattlePanel', () => ({
  default: function BattlePanelMock({ active = true }: { active?: boolean }) {
    if (!active) return null;
    return <div data-testid="battle-panel-mock">Battle</div>;
  },
}));

vi.mock('../components/EvaluationPanel', () => ({
  default: function EvaluationPanelMock() {
    return <div data-testid="evaluation-panel-mock" />;
  },
}));

vi.mock('../components/RoleAssignment', () => ({
  default: function RoleAssignmentMock() {
    return <div data-testid="role-assignment-mock" />;
  },
}));

const ROSTER: Hero[] = [
  minimalHero({ id: 2, name: 'Axe', primary_attribute: 'str' }),
  minimalHero({ id: 1, name: 'Anti-Mage', primary_attribute: 'agi' }),
  minimalHero({ id: 5, name: 'Crystal Maiden', primary_attribute: 'int' }),
  minimalHero({ id: 108, name: 'Abaddon', primary_attribute: 'all' }),
];

function emptySlots(): CmSlot[] {
  return CM_STEPS.map((step) => ({ type: step.type, lane: step.lane, heroId: null }));
}

function invertLanes(slots: CmSlot[]): CmSlot[] {
  return slots.map((slot) => ({
    ...slot,
    lane: slot.lane === 'first' ? 'second' : 'first',
  }));
}

function captainsState(overrides: Partial<CaptainsStateView> = {}): CaptainsStateView {
  return {
    id: 'cm-1',
    status: 'DRAFTING',
    stepIndex: 0,
    current: CM_STEPS[0],
    acting: 'player',
    slots: emptySlots(),
    playerHeroIds: [],
    aiHeroIds: [],
    bannedHeroIds: [],
    playerReserveMs: CM_RESERVE_MS,
    aiReserveMs: CM_RESERVE_MS,
    stepEndsAt: new Date(Date.now() + 60_000).toISOString(),
    draftId: null,
    aiDraftId: null,
    ...overrides,
  };
}

function completedSides() {
  const roles = ['Carry', 'Mid', 'Offlane', 'Soft Support', 'Hard Support'] as const;
  return draftState({
    id: 'draft-player',
    status: 'COMPLETED',
    mode: 'captains',
    heroes: fiveDraftHeroes().map((h, i) => ({ ...h, assignedRole: roles[i] })),
    pool: [],
    rerollsRemaining: 0,
  });
}

async function renderCaptains(route = '/captains') {
  renderWithRouter(<CaptainsPage />, { route });
}

async function advanceSplash() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
}

describe('CaptainsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.removeItem(CAPTAINS_SESSION_KEY);
    vi.mocked(api.getHeroes).mockResolvedValue(ROSTER);
    vi.mocked(api.startCaptains).mockResolvedValue(captainsState());
    vi.mocked(api.getCaptains).mockResolvedValue(captainsState());
    vi.mocked(api.actCaptains).mockImplementation(async (_id, heroId) =>
      captainsState({
        bannedHeroIds: heroId != null ? [heroId] : [],
        slots: emptySlots().map((slot, i) => (i === 0 && heroId != null ? { ...slot, heroId } : slot)),
      }),
    );
    vi.mocked(api.getDraft).mockResolvedValue(completedSides());
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.removeItem(CAPTAINS_SESSION_KEY);
  });

  it('shows splash, then starts a session after the ceremonial delay', async () => {
    vi.useFakeTimers();
    await renderCaptains();

    expect(screen.getByTestId('cm-splash')).toBeInTheDocument();
    expect(api.startCaptains).not.toHaveBeenCalled();

    await advanceSplash();

    expect(api.startCaptains).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('cm-board')).toBeInTheDocument();
    expect(screen.queryByTestId('cm-splash')).not.toBeInTheDocument();
    expect(localStorage.getItem(CAPTAINS_SESSION_KEY)).toBe('cm-1');
  });

  it('resumes a live session without splash and without starting a new draft', async () => {
    localStorage.setItem(CAPTAINS_SESSION_KEY, 'cm-live');
    await renderCaptains();

    await waitFor(() => {
      expect(api.getCaptains).toHaveBeenCalledWith('cm-live');
    });
    expect(api.startCaptains).not.toHaveBeenCalled();
    expect(screen.queryByTestId('cm-splash')).not.toBeInTheDocument();
    expect(await screen.findByTestId('cm-board')).toBeInTheDocument();
  });

  it('renders Valve HUD: four attributes, 5/7 slots, first pick, bonus, no search box', async () => {
    localStorage.setItem(CAPTAINS_SESSION_KEY, 'cm-1');
    await renderCaptains();

    const board = await screen.findByTestId('cm-board');
    expect(screen.getByTestId('cm-draft')).toBeInTheDocument();
    expect(screen.getByTestId('cm-seq')).toBeInTheDocument();
    expect(screen.getByTestId('cm-hero-grid')).toBeInTheDocument();
    expect(screen.getByTestId('cm-step-clock')).toBeInTheDocument();
    expect(document.querySelectorAll('.cm-attr-head')).toHaveLength(4);
    expect(document.querySelectorAll('.cm-col--radiant .cm-pick')).toHaveLength(5);
    expect(document.querySelectorAll('.cm-col--dire .cm-pick')).toHaveLength(5);
    expect(document.querySelectorAll('.cm-col--radiant .cm-ban')).toHaveLength(7);
    expect(document.querySelectorAll('.cm-col--dire .cm-ban')).toHaveLength(7);
    expect(document.querySelectorAll('.cm-search')).toHaveLength(0);
    expect(screen.getByText('First Pick')).toBeInTheDocument();
    expect(screen.getAllByText(/^Bonus /).length).toBeGreaterThan(0);
    expect(screen.getByTestId('cm-seq')).not.toHaveTextContent('B');
    expect(screen.getByTestId('cm-seq')).not.toHaveTextContent('P');
    expect(document.querySelectorAll('.cm-hero[tabindex="0"]')).toHaveLength(1);
    expect(within(board).getByRole('link', { name: 'Leave Captains Mode' })).toBeInTheDocument();
    expect(screen.getByTestId('cm-hero-2').querySelector('img')?.getAttribute('src')).toMatch(/\/heroes\//);
  });

  it('puts First Pick on Dire when the player is second', async () => {
    localStorage.setItem(CAPTAINS_SESSION_KEY, 'cm-1');
    vi.mocked(api.getCaptains).mockResolvedValue(
      captainsState({
        slots: invertLanes(emptySlots()),
        current: { ...CM_STEPS[0], lane: 'second' },
        acting: 'ai',
      }),
    );
    await renderCaptains();

    const board = await screen.findByTestId('cm-board');
    expect(board.querySelector('.cm-hud-side--dire .cm-hud-fp')).toHaveTextContent('First Pick');
    expect(board.querySelector('.cm-hud-side--radiant .cm-hud-fp')).toBeNull();
  });

  it('acts on a hero click and marks the portrait banned', async () => {
    const user = userEvent.setup();
    localStorage.setItem(CAPTAINS_SESSION_KEY, 'cm-1');
    await renderCaptains();
    await screen.findByTestId('cm-board');

    await user.click(screen.getByTestId('cm-hero-2'));

    await waitFor(() => {
      expect(api.actCaptains).toHaveBeenCalledWith('cm-1', 2, false);
    });
    expect(screen.getByTestId('cm-hero-2')).toHaveClass('is-banned');
  });

  it('type-to-filter dims non-matches; Escape clears then focuses HUD exit', async () => {
    const user = userEvent.setup();
    localStorage.setItem(CAPTAINS_SESSION_KEY, 'cm-1');
    await renderCaptains();
    await screen.findByTestId('cm-board');

    const cursor = document.querySelector('.cm-hero[tabindex="0"]');
    expect(cursor).toBeInstanceOf(HTMLElement);
    (cursor as HTMLElement).focus();
    await user.keyboard('anti');

    expect(await screen.findByTestId('cm-filter')).toHaveTextContent(/anti/i);
    expect(screen.getByTestId('cm-hero-1')).not.toHaveClass('is-dim');
    expect(screen.getByTestId('cm-hero-2')).toHaveClass('is-dim');
    expect(screen.getByTestId('cm-hero-2')).toBeVisible();

    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('cm-filter')).not.toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.getByRole('link', { name: 'Leave Captains Mode' })).toHaveFocus();
  });

  it('opens the one-fight battle mock from READY', async () => {
    const user = userEvent.setup();
    localStorage.setItem(CAPTAINS_SESSION_KEY, 'cm-1');
    vi.mocked(api.getCaptains).mockResolvedValue(
      captainsState({
        status: 'READY',
        acting: null,
        current: null,
        draftId: 'draft-player',
        aiDraftId: 'draft-ai',
      }),
    );
    vi.mocked(api.getDraft).mockImplementation(async (id) =>
      draftState({
        ...completedSides(),
        id,
        mode: 'captains',
      }),
    );

    await renderCaptains();
    expect(await screen.findAllByTestId('evaluation-panel-mock')).toHaveLength(2);
    expect(screen.queryByTestId('battle-panel-mock')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Fight the AI' }));
    expect(await screen.findByTestId('battle-panel-mock')).toBeInTheDocument();
  });

  it('shows the one-fight History note on COMPLETED and does not offer rematch', async () => {
    vi.useFakeTimers();
    vi.mocked(api.startCaptains).mockResolvedValue(
      captainsState({
        status: 'COMPLETED',
        acting: null,
        current: null,
        draftId: 'draft-player',
        aiDraftId: 'draft-ai',
      }),
    );

    await renderCaptains();
    await advanceSplash();
    vi.useRealTimers();
    expect(await screen.findByText(/This match is in History/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Fight the AI' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'History' })).toBeInTheDocument();
  });
});
