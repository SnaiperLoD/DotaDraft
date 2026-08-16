import { expect, test } from '@playwright/test';
import {
  completeDraftToEvaluation,
  enterBattle,
  fetchHeroes,
  mockBattle,
  ROLES,
  seedClientPrefs,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await seedClientPrefs(page, 'dark');
});

test('five picks, roles, evaluation, then battle story', async ({ page }) => {
  await mockBattle(page);
  await completeDraftToEvaluation(page);
  await enterBattle(page);
  await expect(page.getByTestId('battle-verdict')).toHaveAttribute('data-outcome', 'Win');
});

test('role tooltip stays inside the viewport', async ({ page }) => {
  await page.goto('/draft');
  await expect(page.getByTestId('hero-card')).toHaveCount(5);
  await page.getByTestId('hero-card').first().click();
  const tooltip = page.getByTestId('role-tooltip').first();
  await tooltip.hover();
  const panel = page.getByTestId('role-tooltip-panel').first();
  await expect(panel).toBeVisible();
  const box = await panel.boundingBox();
  expect(box).not.toBeNull();
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  if (!box || !viewport) return;
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.y).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
});

test('run streak updates only after the result reveal', async ({ page }) => {
  await mockBattle(page);
  await completeDraftToEvaluation(page);
  await enterBattle(page);

  await expect(page.getByTestId('battle-run-chip')).toBeVisible();
  await expect(page.getByTestId('battle-run-chip')).not.toContainText('Win streak');

  await page.getByRole('button', { name: 'Fight Again' }).click();
  await expect(page.getByTestId('battle-verdict')).toBeHidden();
  await expect(page.getByTestId('battle-run-chip')).not.toContainText('Win streak');
  await expect(page.getByTestId('battle-verdict')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('battle-run-chip')).toContainText('Win streak 2');
});

test('hidden custom tags stay hidden; revealable tags appear at min count', async ({ page }) => {
  const heroes = await fetchHeroes(page);
  const silencer = heroes.find((hero) => hero.name === 'Silencer');
  const slark = heroes.find((hero) => hero.name === 'Slark');
  expect(silencer).toBeTruthy();
  expect(slark).toBeTruthy();
  if (!silencer || !slark) return;

  const fillers = heroes.filter((hero) => hero.id !== silencer.id && hero.id !== slark.id);
  const pool1 = [silencer, ...fillers.slice(0, 4)];
  const pool2 = [slark, ...fillers.slice(4, 8)];

  await page.route(/\/api\/draft(\/|$)/, async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (method === 'POST' && url.endsWith('/draft/pool')) {
      await route.fulfill({ json: { seed: 1, pool: pool1 } });
      return;
    }
    if (method === 'POST' && /\/api\/draft$/.test(new URL(url).pathname)) {
      await route.fulfill({
        json: {
          id: 'e2e-tags',
          status: 'PICKING',
          heroes: [{ heroId: silencer.id, hero: silencer, assignedRole: null, pickOrder: 1 }],
          pool: pool2,
          createdAt: new Date().toISOString(),
          rerollsRemaining: 1,
        },
      });
      return;
    }
    if (method === 'POST' && url.includes('/pick')) {
      await route.fulfill({
        json: {
          id: 'e2e-tags',
          status: 'PICKING',
          heroes: [
            { heroId: silencer.id, hero: silencer, assignedRole: null, pickOrder: 1 },
            { heroId: slark.id, hero: slark, assignedRole: null, pickOrder: 2 },
          ],
          pool: fillers.slice(8, 13),
          createdAt: new Date().toISOString(),
          rerollsRemaining: 1,
        },
      });
      return;
    }
    await route.continue();
  });

  await page.goto('/draft');
  await expect(page.getByTestId('hero-card')).toHaveCount(5);
  await page.getByTestId('hero-card').filter({ hasText: 'Silencer' }).click();

  const ledger = page.locator('.ledger');
  await expect(ledger.locator('.slot-name', { hasText: 'Silencer' })).toBeVisible();
  await expect(ledger.getByTestId('hero-tag-badge').filter({ hasText: 'Statstealer' })).toHaveCount(0);
  await expect(page.getByTestId('hero-tag-badge').filter({ hasText: 'Tempo Monster' })).toHaveCount(0);
  await expect(page.getByTestId('hero-tag-badge').filter({ hasText: 'Summoning Sickness' })).toHaveCount(0);
  await expect(page.getByTestId('hero-tag-badge').filter({ hasText: 'Disable Battery' })).toHaveCount(0);
  await expect(page.getByTestId('hero-tag-badge').filter({ hasText: 'Raid Boss' })).toHaveCount(0);

  const slarkCard = page.getByTestId('hero-card').filter({ hasText: 'Slark' });
  await expect(slarkCard).toBeVisible();
  await expect(slarkCard.getByTestId('hero-tag-badge').filter({ hasText: 'Statstealer' })).toBeVisible();

  await slarkCard.click();
  const ledgerStatstealer = ledger.getByTestId('hero-tag-badge').filter({ hasText: 'Statstealer' });
  await expect(ledgerStatstealer).toHaveCount(2);
  await expect(page.getByTestId('hero-tag-badge').filter({ hasText: 'Tempo Monster' })).toHaveCount(0);
  await expect(page.getByTestId('hero-tag-badge').filter({ hasText: 'Summoning Sickness' })).toHaveCount(0);
  await expect(page.getByTestId('hero-tag-badge').filter({ hasText: 'Disable Battery' })).toHaveCount(0);
  await expect(page.getByTestId('hero-tag-badge').filter({ hasText: 'Raid Boss' })).toHaveCount(0);
});

test('keyboard can walk draft through evaluation into battle', async ({ page }) => {
  await mockBattle(page);
  await page.goto('/draft');
  for (let round = 0; round < 5; round += 1) {
    const cards = page.getByTestId('hero-card');
    await expect(cards).toHaveCount(5);
    await expect(cards.first()).toBeEnabled();
    await cards.first().focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.draft-progress-count')).toHaveText(`${round + 1} of 5 picked`);
  }

  const roleCards = page.locator('.role-assignment-card');
  await expect(roleCards).toHaveCount(5);
  for (let i = 0; i < ROLES.length; i += 1) {
    await roleCards.nth(i).getByTestId('role-cell').nth(i).press('Enter');
  }
  await page.getByTestId('confirm-roles').press('Enter');
  await page.getByTestId('evaluate-draft').press('Enter');
  await expect(page.getByTestId('evaluation-result')).toBeVisible();
  await page.getByTestId('enter-battle-mode').press('Enter');
  await expect(page.getByTestId('battle-verdict')).toBeVisible({ timeout: 20_000 });
});

test('Tapalka stays static on a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/draft');
  await expect(page.getByTestId('hero-card')).toHaveCount(5);
  await expect(page.getByTestId('tapalka-static')).toBeVisible();
  await expect(page.getByTestId('tapalka-3d')).toHaveCount(0);
});

test('Tapalka stays static when reduced motion is preferred', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/draft');
  await expect(page.getByTestId('hero-card')).toHaveCount(5);
  await expect(page.getByTestId('tapalka-static')).toBeVisible();
  await expect(page.getByTestId('tapalka-3d')).toHaveCount(0);
});
