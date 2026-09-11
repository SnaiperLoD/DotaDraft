import { expect, test } from '@playwright/test';
import { seedClientPrefs } from './helpers';

test.beforeEach(async ({ page }) => {
  await seedClientPrefs(page, 'dark');
});

test('register claims this browser, logout keeps the token, login returns', async ({ page }) => {
  await page.goto('/account');
  await expect(page.getByTestId('header-sign-in')).toBeVisible();
  await expect(page.getByTestId('account-google')).toHaveCount(0);

  const before = await page.evaluate(() => localStorage.getItem('dotadraft.submitterToken'));
  expect(before).toBeTruthy();

  const email = `e2e-${Date.now()}@example.com`;
  await page.getByTestId('account-register-email').fill(email);
  await page.getByTestId('account-register-password').fill('password1');
  await page.getByTestId('account-register-submit').click();

  await expect(page.getByTestId('account-email')).toHaveText(email);
  await expect(page.getByTestId('header-account')).toHaveText(email);
  const cookies = await page.context().cookies();
  expect(cookies.some((c) => c.name === 'dotadraft.sid' && c.httpOnly)).toBeTruthy();
  const afterRegister = await page.evaluate(() => localStorage.getItem('dotadraft.submitterToken'));
  expect(afterRegister).toBe(before);

  await page.getByTestId('header-sign-out').click();
  await expect(page.getByTestId('header-sign-in')).toBeVisible();
  await expect(page.getByTestId('account-login-email')).toBeVisible();
  const afterLogout = await page.evaluate(() => localStorage.getItem('dotadraft.submitterToken'));
  expect(afterLogout).toBe(before);

  await page.getByTestId('account-login-email').fill(email);
  await page.getByTestId('account-login-password').fill('password1');
  await page.getByTestId('account-login-submit').click();
  await expect(page.getByTestId('account-email')).toHaveText(email);
});
