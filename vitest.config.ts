import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    globalSetup: ['tests/helpers/global-setup.ts'],
    // Integration test files share one database; run files sequentially to keep
    // truncation between files deterministic.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 60000,
  },
});
