import { expect, test, type Page } from '@playwright/test';
import type { TiBracketMatch, TiRunStateView } from 'shared';
import { seedClientPrefs } from './helpers';

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

function mockView(overrides: Partial<TiRunStateView>): TiRunStateView {
  return {
    id: 'e2e-ti',
    status: 'SHOWING_BRACKET',
    bracketId: 'ti-2021',
    leagueName: 'The International 2021',
    year: 2021,
    teams: [],
    teamName: 'Team Spirit',
    draftId: null,
    currentMatchId: 'ub_r1_1',
    currentRound: 'Upper Bracket Round 1',
    opponentName: 'Invictus Gaming',
    losses: 0,
    path: [],
    matches: baseMatches,
    ...overrides,
  };
}

async function mountTiRun(page: Page, view: TiRunStateView) {
  await seedClientPrefs(page, 'dark');
  await page.addInitScript(() => sessionStorage.removeItem('ti-run-id'));
  await page.route(/\/api\/ti-run/, async (route) => {
    await route.fulfill({ json: view });
  });
  await page.goto('/ti-run');
  await expect(page.getByTestId('ti-bracket')).toBeVisible();
}

test('TI bracket keeps original pairings on other branches', async ({ page }) => {
  await mountTiRun(page, mockView({}));
  await expect(page.getByTestId('ti-bracket')).toBeVisible();
  await expect(page.locator('.ti-match.is-current')).toHaveCount(1);
  await expect(page.locator('.ti-match.is-played')).toHaveCount(2);
  await expect(page.locator('.ti-match.is-empty')).toHaveCount(2);
  await expect(page.locator('[data-match-id="ub_r1_1"]')).toContainText('Team Spirit');
  await expect(page.locator('[data-match-id="ub_r1_2"]')).toContainText('PSG.LGD');
  await expect(page.locator('[data-match-id="gf"]')).toContainText('TBD');
  await expect(page.getByTestId('ti-tree-note')).toBeVisible();
  await expect(page.getByTestId('ti-tree-note')).toContainText('stay empty until you play them');
});

test('TI upper-bracket win paints the next upper slot with the player jersey', async ({ page }) => {
  await mountTiRun(
    page,
    mockView({
      currentMatchId: 'ub_f',
      currentRound: 'Upper Bracket Final',
      opponentName: 'PSG.LGD',
      path: [
        {
          matchId: 'ub_r1_1',
          round: 'Upper Bracket Round 1',
          opponent: 'Invictus Gaming',
          outcome: 'Win',
          advantageDirection: 'A',
          confidenceTier: 'Moderate',
        },
      ],
      matches: baseMatches.map((match) =>
        match.id === 'ub_r1_1'
          ? { ...match, winner: 'Team Spirit' }
          : match.id === 'ub_f'
            ? { ...match, teamA: 'Team Spirit', teamB: 'PSG.LGD' }
            : match,
      ),
    }),
  );
  await expect(page.locator('[data-match-id="ub_r1_1"]')).toHaveClass(/is-played/);
  await expect(page.locator('[data-match-id="ub_f"]')).toContainText('Team Spirit');
  await expect(page.locator('[data-match-id="ub_f"]')).toHaveClass(/is-current/);
});

test('TI upper-bracket loss drops the player into the lower bracket slot', async ({ page }) => {
  await mountTiRun(
    page,
    mockView({
      currentMatchId: 'lb_r1_1',
      currentRound: 'Lower Bracket Round 1',
      opponentName: 'OG',
      losses: 1,
      path: [
        {
          matchId: 'ub_r1_1',
          round: 'Upper Bracket Round 1',
          opponent: 'Invictus Gaming',
          outcome: 'Lose',
          advantageDirection: 'B',
          confidenceTier: 'Moderate',
        },
      ],
      matches: baseMatches.map((match) =>
        match.id === 'ub_r1_1'
          ? { ...match, winner: 'Invictus Gaming' }
          : match.id === 'lb_r1_1'
            ? { ...match, teamA: 'Team Spirit', teamB: 'OG', winner: '' }
            : match,
      ),
    }),
  );
  await expect(page.locator('[data-match-id="lb_r1_1"]')).toContainText('Team Spirit');
  await expect(page.locator('[data-match-id="lb_r1_1"]')).toHaveClass(/is-current/);
});

test('TI grand-final win marks the bracket as champion', async ({ page }) => {
  await mountTiRun(
    page,
    mockView({
      status: 'CHAMPION',
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
    }),
  );
  await expect(page.getByTestId('ti-bracket')).toHaveAttribute('data-finale', 'champion');
  await expect(page.locator('[data-match-id="gf"]')).toHaveClass(/is-trophy/);
});

test('TI grand-final loss marks the bracket as eliminated', async ({ page }) => {
  await mountTiRun(
    page,
    mockView({
      status: 'ELIMINATED',
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
  await expect(page.getByTestId('ti-bracket')).toHaveAttribute('data-finale', 'eliminated');
  await expect(page.locator('[data-match-id="gf"] .is-winner')).toContainText('PSG.LGD');
});
