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
  await expect(page.getByTestId('cm-draft')).toBeVisible();
  await expect(page.getByTestId('cm-seq')).toBeVisible();
  await expect(page.getByTestId('cm-hero-grid')).toBeVisible();
  await expect(page.locator('.cm-attr-head')).toHaveCount(4);
  await expect(page.locator('.cm-hero img').first()).toHaveAttribute('src', /\/icons\//);
  await expect(page.locator('.cm-hero[tabindex="0"]')).toHaveCount(1);
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

test('F5 resumes the same Captains session instead of starting a new draft', async ({ page }) => {
  await page.goto('/captains');
  await expect(page.getByTestId('cm-board')).toBeVisible({ timeout: 20_000 });
  const hero = page.locator('.cm-hero:not(:disabled)').first();
  const testId = await hero.getAttribute('data-testid');
  await hero.click();
  await expect(page.locator(`[data-testid="${testId}"]`)).toHaveClass(/is-banned/);
  await page.reload();
  await expect(page.getByTestId('cm-board')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('cm-splash')).toHaveCount(0);
  await expect(page.locator(`[data-testid="${testId}"]`)).toHaveClass(/is-banned/);
});

test('Captains hero grid is one tab stop; arrows move, Escape focuses exit', async ({ page }) => {
  await page.goto('/captains');
  await expect(page.getByTestId('cm-board')).toBeVisible({ timeout: 20_000 });
  const cursor = page.locator('.cm-hero[tabindex="0"]');
  await expect(cursor).toHaveCount(1);
  await cursor.focus();
  const from = await cursor.getAttribute('data-testid');
  expect(from).toMatch(/^cm-hero-\d+$/);
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.cm-hero:focus')).not.toHaveAttribute('data-testid', from!);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('link', { name: 'Leave Captains Mode' })).toBeFocused();
});
