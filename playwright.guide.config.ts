import { defineConfig, devices } from '@playwright/test';

// Captures the screenshots of docs/USER_GUIDE.md: `npm run docs:screenshots`.
// Same server and fresh database as the end-to-end tests; not part of `npm run test:e2e`.
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: /user-guide\.spec\.ts$/,
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
  workers: 1,
  retries: 0,
  timeout: 900_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3100',
    viewport: { width: 1280, height: 860 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    locale: 'en-GB',
    timezoneId: 'Africa/Cairo',
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
  },
});
