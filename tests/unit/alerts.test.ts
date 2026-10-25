import { describe, expect, it } from 'vitest';
import { ServerErrorCounter, workerStaleAfterMs } from '../../src/ops/alerts.js';

describe('alert helpers', () => {
  it('counts server errors over the last minutes and forgets older ones', () => {
    let now = 10 * 60_000;
    const c = new ServerErrorCounter(() => now);
    c.record();
    c.record();
    now += 2 * 60_000;
    c.record();
    expect(c.inLast(5)).toBe(3);
    expect(c.inLast(1)).toBe(1);
    now += 4 * 60_000;
    expect(c.inLast(5)).toBe(1);
    now += 20 * 60_000;
    expect(c.inLast(5)).toBe(0);
  });

  it('considers the worker stopped after four intervals, at least two minutes', () => {
    expect(workerStaleAfterMs({ WORKER_INTERVAL_MS: 15_000 })).toBe(120_000);
    expect(workerStaleAfterMs({ WORKER_INTERVAL_MS: 60_000 })).toBe(240_000);
  });
});
