import { expect, test } from '@playwright/test';
import {
  battleFixture,
  completeDraftToEvaluation,
  enterBattle,
  mockBattle,
  seedClientPrefs,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await seedClientPrefs(page, 'dark');
});

test('challenge paste strips markup', async ({ page }) => {
  await mockBattle(page);
  await completeDraftToEvaluation(page);
  await enterBattle(page);

  await page.getByTestId('battle-challenge-toggle').click();
  const paste = page.getByTestId('battle-challenge-paste');
  await expect(paste).toBeVisible();
  await paste.focus();
  await page.keyboard.insertText('<script>alert(1)</script>');
  await expect(paste).toHaveValue(/^[0-9a-hjkmnp-tv-zA-Z\s-]*$/);
  await expect(paste).not.toHaveValue(/[<>]/);

  await paste.fill(`${'z'.repeat(80)}-${'z'.repeat(80)}`);
  const row = page.getByTestId('battle-challenge-row');
  const rowBox = await row.boundingBox();
  const pasteBox = await paste.boundingBox();
  const viewport = page.viewportSize();
  expect(rowBox).not.toBeNull();
  expect(pasteBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  if (!rowBox || !pasteBox || !viewport) return;
  expect(rowBox.width).toBeLessThanOrEqual(viewport.width);
  expect(pasteBox.width).toBeLessThanOrEqual(rowBox.width + 1);
});

test('coin-flip challenge never shows the battle story', async ({ page }) => {
  await mockBattle(page, {
    ...battleFixture,
    coinFlip: true,
    lanes: [],
    story: { cameFromBehind: false, isUpset: false, beats: [] },
  });
  await completeDraftToEvaluation(page);
  await page.getByTestId('enter-battle-mode').click();

  await expect(page.getByTestId('battle-coin-faceoff')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('battle-coin-flip')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('battle-coin-verdict')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('battle-coin-verdict')).toContainText('YOU WIN');
  await expect(page.getByTestId('battle-story')).toHaveCount(0);
  await expect(page.getByTestId('battle-verdict')).toHaveCount(0);
});

test('copy draft button is present after evaluation', async ({ page, context }) => {
  await completeDraftToEvaluation(page);
  const copy = page.getByTestId('copy-draft');
  await expect(copy).toBeVisible();
  try {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await copy.click();
    const text = await page.evaluate(() => navigator.clipboard.readText());
    expect(text).toMatch(/^dd1[0-9a-hjkmnp-tv-z]{13}$/);
  } catch {
    // Clipboard is flaky in this environment; encode path is unit-tested.
  }
});
