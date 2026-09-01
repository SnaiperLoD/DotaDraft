import { expect, test } from '@playwright/test';
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

const liveView: TiRunStateView = {
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
  matches: [
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
  ],
};

test.beforeEach(async ({ page }) => {
  await seedClientPrefs(page, 'dark');
  await page.addInitScript(() => sessionStorage.removeItem('ti-run-id'));
  await page.route(/\/api\/ti-run/, async (route) => {
    await route.fulfill({ json: liveView });
  });
});

test('TI bracket keeps original pairings on other branches', async ({ page }) => {
  await page.goto('/ti-run');
  const tree = page.getByTestId('ti-bracket');
  await expect(tree).toBeVisible();
  await expect(page.locator('.ti-match.is-current')).toHaveCount(1);
  await expect(page.locator('.ti-match.is-played')).toHaveCount(2);
  await expect(page.locator('.ti-match.is-empty')).toHaveCount(2);
  await expect(page.locator('[data-match-id="ub_r1_1"]')).toContainText('Team Spirit');
  await expect(page.locator('[data-match-id="ub_r1_2"]')).toContainText('PSG.LGD');
  await expect(page.locator('[data-match-id="gf"]')).toContainText('TBD');
  await expect(page.getByTestId('ti-tree-note')).toBeVisible();
  await expect(page.getByTestId('ti-tree-note')).toContainText('stay empty until you play them');
});
