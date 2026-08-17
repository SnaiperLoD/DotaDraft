import { expect, test } from '@playwright/test';
import { seedClientPrefs } from './helpers';

test.beforeEach(async ({ page }) => {
  await seedClientPrefs(page, 'dark');
});

test('skip link moves focus into main content', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('skip-link')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
});

test('mobile nav opens, then Escape returns focus to the burger', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const burger = page.getByTestId('nav-burger');
  await expect(burger).toBeVisible();
  await expect(page.getByTestId('primary-nav')).not.toHaveClass(/command-nav--open/);

  await burger.click();
  await expect(burger).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('primary-nav')).toHaveClass(/command-nav--open/);
  await expect(
    page.getByTestId('primary-nav').getByRole('link', { name: 'Draft', exact: true }),
  ).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(burger).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('primary-nav')).not.toHaveClass(/command-nav--open/);
  await expect(burger).toBeFocused();
});

test('History and Leaderboard shells render on a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/history');
  await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();

  await page.goto('/leaderboard');
  await expect(page.getByRole('heading', { name: 'Leaderboard' })).toBeVisible();
  await expect(page.locator('.leaderboard-scroll')).toHaveCount(0);
});
