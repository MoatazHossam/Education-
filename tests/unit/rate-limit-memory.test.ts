import { describe, expect, it } from 'vitest';
import { MemoryWindows } from '../../src/http/rate-limit-store.js';

describe('in-memory flood guard windows', () => {
  it('counts within a window and starts again when it ends', async () => {
    let now = 1_000;
    const w = new MemoryWindows(10, () => now);
    expect(await w.incr('a', 100)).toEqual({ current: 1, ttl: 100 });
    now += 40;
    expect(await w.incr('a', 100)).toEqual({ current: 2, ttl: 60 });
    expect(await w.read('a')).toEqual({ current: 2, ttl: 60 });
    now += 60;
    expect(await w.read('a')).toEqual({ current: 0, ttl: 0 });
    expect(await w.incr('a', 100)).toEqual({ current: 1, ttl: 100 });
  });

  it('stays bounded, dropping the oldest windows first', async () => {
    let now = 0;
    const w = new MemoryWindows(3, () => now);
    for (const key of ['a', 'b', 'c']) {
      await w.incr(key, 1_000);
      now += 1;
    }
    await w.incr('a', 1_000); // still in its window: counted, not moved
    await w.incr('d', 1_000); // over the bound: the oldest window ('a') goes
    expect((await w.read('a')).current).toBe(0);
    expect((await w.read('b')).current).toBe(1);
    expect((await w.read('d')).current).toBe(1);
  });
});
