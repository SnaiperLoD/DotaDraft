import { expect, test } from '@playwright/test';
import { seedClientPrefs } from './helpers';

test.beforeEach(async ({ page }) => {
  await seedClientPrefs(page, 'dark');
});

test('CM board uses portraits, five pick slots and seven ban portraits per side', async ({ page }) => {
  await page.goto('/captains');
  await expect(page.getByTestId('cm-splash')).toBeVisible();
  const board = page.getByTestId('cm-board');
  await expect(board).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('cm-hero-grid')).toBeVisible();
  await expect(page.locator('.cm-attr-head')).toHaveCount(4);
  await expect(page.locator('.cm-hero img').first()).toHaveAttribute('src', /\/heroes\//);
  await expect(page.locator('.cm-col--radiant .cm-pick')).toHaveCount(5);
  await expect(page.locator('.cm-col--dire .cm-pick')).toHaveCount(5);
  await expect(page.locator('.cm-col--radiant .cm-ban')).toHaveCount(7);
  await expect(page.locator('.cm-col--dire .cm-ban')).toHaveCount(7);

  const hero = page.locator('.cm-hero:not(:disabled)').first();
  await expect(hero).toBeVisible();
  const testId = await hero.getAttribute('data-testid');
  expect(testId).toMatch(/^cm-hero-\d+$/);
  await hero.click();
  await expect(page.locator(`[data-testid="${testId}"]`)).toHaveClass(/is-banned/);
  await expect(page.getByTestId('cm-hero-grid').locator(`[data-testid="${testId}"]`)).toBeVisible();
});
