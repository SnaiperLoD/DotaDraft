import { expect, test } from '@playwright/test';
import type { HistoryEntry } from 'shared';
import { fetchHeroes, mockBattle, ROLES, seedClientPrefs } from './helpers';

test.beforeEach(async ({ page }) => {
  await seedClientPrefs(page, 'dark');
});

test('Battle History row opens the fight screen; Captains does not offer rematch', async ({ page }) => {
  const heroes = (await fetchHeroes(page)).slice(0, 5);
  expect(heroes).toHaveLength(5);

  const battleId = 'e2e-history-fight';
  const battleDraft = {
    id: battleId,
    status: 'COMPLETED',
    mode: 'battle',
    heroes: heroes.map((hero, i) => ({
      heroId: hero.id,
      hero,
      assignedRole: ROLES[i],
      pickOrder: i + 1,
    })),
    pool: [],
    createdAt: new Date().toISOString(),
    rerollsRemaining: 0,
  };

  const history: HistoryEntry[] = [
    {
      id: battleId,
      mode: 'battle',
      createdAt: new Date().toISOString(),
      evaluation: null,
      battles: [
        {
          id: 1,
          resolvedOutcome: 'Win',
          advantageDirection: 'A',
          confidenceTier: 'Low',
          opponentSource: 'pro',
          opponentTeamName: 'TEAM VISION',
          opponentLeagueName: 'The International 2026',
          opponentHeroIds: heroes.map((h) => h.id),
          stage: null,
          opponentMatchId: '8960991322',
          createdAt: new Date().toISOString(),
        },
      ],
      ti: null,
      heroes: heroes.map((hero, i) => ({
        heroId: hero.id,
        heroName: hero.name,
        assignedRole: ROLES[i],
        pickOrder: i + 1,
      })),
    },
    {
      id: 'e2e-history-captains',
      mode: 'captains',
      createdAt: new Date().toISOString(),
      evaluation: null,
      battles: [],
      ti: null,
      heroes: heroes.map((hero, i) => ({
        heroId: hero.id,
        heroName: hero.name,
        assignedRole: ROLES[i],
        pickOrder: i + 1,
      })),
    },
    {
      id: 'e2e-history-ti',
      mode: 'ti',
      createdAt: new Date().toISOString(),
      evaluation: null,
      battles: [],
      ti: {
        runId: 'e2e-ti-run',
        leagueName: 'The International 2026',
        teamName: 'Team Spirit',
        status: 'PLAYING',
        placement: 'playing',
        lastRound: null,
      },
      heroes: heroes.map((hero, i) => ({
        heroId: hero.id,
        heroName: hero.name,
        assignedRole: ROLES[i],
        pickOrder: i + 1,
      })),
    },
  ];

  await page.route('**/api/history', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    await route.fulfill({ json: history });
  });
  await page.route(`**/api/draft/${battleId}`, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    await route.fulfill({ json: battleDraft });
  });
  await mockBattle(page);

  await page.goto('/history');
  const entries = page.locator('.history-entry');
  await expect(entries).toHaveCount(3);
  await expect(entries.nth(0).getByTestId('history-refight')).toBeVisible();
  await expect(entries.nth(1).getByTestId('history-refight')).toHaveCount(0);
  await expect(entries.nth(2).getByTestId('history-refight')).toHaveCount(0);
  await expect(entries.nth(2).getByTestId('history-continue-ti')).toBeVisible();

  await entries.nth(0).locator('summary').click();
  await expect(entries.nth(0).getByText('TI Finals')).toBeVisible();
  await expect(entries.nth(0).getByRole('link', { name: /OpenDota/ })).toHaveAttribute(
    'href',
    'https://www.opendota.com/matches/8960991322',
  );

  await page.getByRole('tab', { name: 'All' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Battle' })).toHaveAttribute('aria-selected', 'true');
  await expect(entries).toHaveCount(1);

  await page.getByRole('tab', { name: 'Battle' }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true');

  await entries.nth(0).getByTestId('history-refight').click();
  await expect(page).toHaveURL(new RegExp(`/draft\\?resume=${battleId}&fight=1`));
  await expect(page.getByTestId('battle-verdict')).toBeVisible({ timeout: 20_000 });
});
