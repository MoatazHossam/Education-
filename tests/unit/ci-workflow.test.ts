import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// The CI workflow's time limits (docs/TEST_STRATEGY.md §5): a stuck job fails within minutes instead of running for
// GitHub's default six hours. Installing a browser hung twice (WebKit, November 2026) before any test ran.
type Step = { name?: string; run?: string; 'timeout-minutes'?: number };
const jobs = (parse(readFileSync('.github/workflows/ci.yml', 'utf8')) as { jobs: Record<string, { 'timeout-minutes'?: number; steps: Step[] }> }).jobs;

describe('CI time limits', () => {
  it('every job has one, of at most an hour', () => {
    for (const [name, job] of Object.entries(jobs)) {
      expect(job['timeout-minutes'], name).toBeGreaterThan(0);
      expect(job['timeout-minutes'], name).toBeLessThanOrEqual(60);
    }
  });

  it('installing the browser for the end-to-end jobs stops after 10 minutes at most', () => {
    const install = jobs.e2e!.steps.filter((s) => s.run?.includes('playwright install'));
    expect(install).toHaveLength(1);
    expect(install[0]!['timeout-minutes']).toBeGreaterThan(0);
    expect(install[0]!['timeout-minutes']).toBeLessThanOrEqual(10);
  });
});
