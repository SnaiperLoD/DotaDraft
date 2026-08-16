import { expect, test, type Page } from '@playwright/test';
import {
  assignRolesInOrder,
  enterBattle,
  evaluateDraft,
  mockBattle,
  pickFiveHeroes,
  seedClientPrefs,
} from './helpers';

async function attachScreenshot(page: Page, name: string) {
  const body = await page.screenshot({ fullPage: true, animations: 'disabled' });
  await test.info().attach(name, { body, contentType: 'image/png' });
  expect(body.byteLength).toBeGreaterThan(1000);
}

async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.evaluate((choice) => {
    localStorage.setItem('dotadraft-theme', choice);
    document.documentElement.dataset.theme = choice;
  }, theme);
}

const viewports = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

for (const viewport of viewports) {
  for (const theme of ['light', 'dark'] as const) {
    test.describe(`${viewport.name} ${theme}`, () => {
      test.use({ viewport: { width: viewport.width, height: viewport.height } });

      test.beforeEach(async ({ page }) => {
        await seedClientPrefs(page, theme);
      });

      test('Landing', async ({ page }) => {
        await page.goto('/');
        await setTheme(page, theme);
        await expect(page.getByRole('heading', { name: /Dota/ })).toBeVisible();
        await attachScreenshot(page, `landing-${viewport.name}-${theme}`);
      });

      test('Draft, Evaluation and Battle', async ({ page }) => {
        await mockBattle(page);
        await page.goto('/draft');
        await expect(page.getByTestId('hero-card')).toHaveCount(5);
        await setTheme(page, theme);
        await attachScreenshot(page, `draft-${viewport.name}-${theme}`);

        await pickFiveHeroes(page);
        await assignRolesInOrder(page);
        await evaluateDraft(page);
        await attachScreenshot(page, `evaluation-${viewport.name}-${theme}`);

        await enterBattle(page);
        await attachScreenshot(page, `battle-${viewport.name}-${theme}`);
      });
    });
  }
}
