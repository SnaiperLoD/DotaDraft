import { expect, test } from '@playwright/test';
import { seedClientPrefs } from './helpers';

test.beforeEach(async ({ page }) => {
  await seedClientPrefs(page, 'dark');
});

test('footer and About expose the tip jar link', async ({ page }) => {
  await page.goto('/');
  const footerTip = page.getByTestId('footer-tip-jar');
  await expect(footerTip).toBeVisible();
  await expect(footerTip).toHaveAttribute('href', /^https:\/\/ko-fi\.com\//);

  await page.goto('/about');
  const aboutTip = page.getByTestId('about-tip-jar');
  await expect(aboutTip).toBeVisible();
  await expect(aboutTip).toHaveAttribute('href', /^https:\/\/ko-fi\.com\//);
});

test('landing pitch names statistical matchup not replay', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.landing-pitch')).toContainText(/statistical matchup/i);
});
