import { expect, test } from '@playwright/test';
import { seedClientPrefs } from './helpers';

// Exercises the real /api/ti-run stack (no route mocks). Requires the e2e
// server to have seeded the opponent pool — CI sets POOL_DATABASE_URL.
test.describe('TI Run live API', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!process.env.POOL_DATABASE_URL, 'POOL_DATABASE_URL not set — opponent pool required');
    await seedClientPrefs(page, 'dark');
    await page.addInitScript(() => sessionStorage.removeItem('ti-run-id'));
  });

  test('start → pick team → bracket with a current match', async ({ page }) => {
    await page.goto('/ti-run');
    await expect(page.getByTestId('ti-tree-note')).toBeVisible({ timeout: 90_000 });

    const teamCard = page.locator('.ti-team-card').first();
    if (await teamCard.isVisible()) {
      await teamCard.click();
    }

    await expect(page.getByTestId('ti-bracket')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.ti-match.is-current')).toHaveCount(1);
    await expect(page.getByTestId('ti-tree-note')).toContainText(
      /stay empty until you play them|пустые, пока ты их не сыграешь/i,
    );
  });
});
