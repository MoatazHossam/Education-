import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { TEST_ENV } from '../helpers/env.js';

// The real server process (src/server.ts), as a load balancer sees it during a rolling restart.
const PORT = 3197;
const base = `http://127.0.0.1:${PORT}`;

async function until(check: () => Promise<boolean>, ms = 20_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check().catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('condition not met in time');
}

describe('graceful shutdown', () => {
  it('reports draining on SIGTERM, keeps serving during the drain, then exits cleanly', async () => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
      env: { ...process.env, ...TEST_ENV, HOST: '127.0.0.1', PORT: String(PORT), LOG_LEVEL: 'warn', SHUTDOWN_DRAIN_MS: '1500' },
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    try {
      await until(async () => (await fetch(`${base}/readyz`)).ok);
      const exited = once(child, 'exit');
      const signalledAt = Date.now();
      child.kill('SIGTERM');

      await until(async () => (await fetch(`${base}/readyz`)).status === 503, 2_000);
      expect(await (await fetch(`${base}/readyz`)).json()).toEqual({ status: 'draining' });
      // Still serving while the load balancer takes it out of rotation.
      expect((await fetch(`${base}/healthz`)).status).toBe(200);
      expect((await fetch(`${base}/api/auth/me`)).status).toBe(401);

      const [code] = await exited;
      expect(code).toBe(0);
      expect(Date.now() - signalledAt).toBeGreaterThanOrEqual(1_500);
      await expect(fetch(`${base}/healthz`)).rejects.toThrow();
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL');
    }
  }, 40_000);
});
