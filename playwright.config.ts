import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:5175',
    trace: 'on-first-retry',
    locale: 'en-US',
  },
  webServer: [
    {
      command: 'node e2e/start-server.cjs',
      url: 'http://127.0.0.1:3012/heroes',
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ...process.env,
        PORT: '3012',
        POOL_DATABASE_URL: process.env.POOL_DATABASE_URL ?? '',
      },
    },
    {
      command: 'npx vite --host 127.0.0.1 --port 5175 --strictPort',
      cwd: 'client',
      url: 'http://127.0.0.1:5175',
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ...process.env,
        E2E_API_ORIGIN: 'http://127.0.0.1:3012',
      },
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
});
