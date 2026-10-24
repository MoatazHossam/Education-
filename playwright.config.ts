import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3100',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // The accessibility audit runs after the journeys, so pages carry realistic data
  // (verification badges, notifications, a newer catalogue to carry scopes to).
  projects: [
    { name: 'journeys', testMatch: /journeys\.spec\.ts$/, use: { ...devices['Desktop Chrome'] } },
    { name: 'accessibility', testMatch: /accessibility\.spec\.ts$/, dependencies: ['journeys'], use: { ...devices['Desktop Chrome'] } },
  ],
});
