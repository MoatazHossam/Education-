import { defineConfig, devices } from '@playwright/test';

// Records the showcase video's product demonstrations from the real application on a fresh test
// database: `npm run capture` in marketing/product-showcase/video-project (runs from the repository root).
// Same server and database setup as the end-to-end tests; not part of `npm run test:e2e`.
export default defineConfig({
  testDir: '.',
  testMatch: /showcase\.spec\.ts$/,
  globalSetup: '../../../../tests/e2e/global-setup.ts',
  globalTeardown: '../../../../tests/e2e/global-teardown.ts',
  outputDir: '../../../../test-results/showcase-capture',
  workers: 1,
  retries: 0,
  timeout: 1_800_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3100',
    locale: 'ar-EG',
    timezoneId: 'Africa/Cairo',
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
  },
});
