import { defineConfig, devices } from '@playwright/test';

// The journeys run in one browser per run: Chromium (`npm run test:e2e`, this file), Firefox
// (`npm run test:e2e:firefox`, playwright.firefox.config.ts) or WebKit, Safari's engine
// (`npm run test:e2e:webkit`, playwright.webkit.config.ts). Each run starts from a fresh database,
// since the journeys build on each other's data. The accessibility project (axe and the simulated
// screen reader) runs with Chromium.
const DEVICES = { chromium: 'Desktop Chrome', firefox: 'Desktop Firefox', webkit: 'Desktop Safari' } as const;

export function e2eConfig(browser: keyof typeof DEVICES) {
  const device = devices[DEVICES[browser]];
  const suffix = browser === 'chromium' ? '' : `-${browser}`;
  return defineConfig({
    testDir: 'tests/e2e',
    globalSetup: './tests/e2e/global-setup.ts',
    globalTeardown: './tests/e2e/global-teardown.ts',
    fullyParallel: false,
    workers: 1,
    retries: 0,
    timeout: 90_000,
    expect: { timeout: 10_000 },
    reporter: [['list'], ['html', { open: 'never', outputFolder: `playwright-report${suffix}` }]],
    outputDir: `test-results${suffix}`,
    use: {
      baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3100',
      trace: 'retain-on-failure',
      screenshot: 'only-on-failure',
    },
    // The accessibility audit runs after the journeys, so pages carry realistic data
    // (verification badges, notifications, a newer catalogue to carry scopes to).
    projects: [
      { name: `journeys${suffix}`, testMatch: /journeys\.spec\.ts$/, use: { ...device } },
      ...(browser === 'chromium' ? [{ name: 'accessibility', testMatch: /accessibility\.spec\.ts$/, dependencies: ['journeys'], use: { ...device } }] : []),
    ],
  });
}

export default e2eConfig('chromium');
