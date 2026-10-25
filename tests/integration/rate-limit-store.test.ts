import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { createDatabase } from '../../src/db/index.js';
import { PostgresWindows, rateLimitStore } from '../../src/http/rate-limit-store.js';
import { runCleanup } from '../../src/jobs/tasks.js';
import { createHarness, resetData, type Harness } from '../helpers/harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());
beforeEach(async () => resetData(h.ownerDb));

/** A second app process: its own app and its own connection pool on the same database. */
async function secondInstance() {
  const db = createDatabase(h.config.DATABASE_URL, { poolMax: 5 });
  const app = await buildApp({ config: h.config, db, logger: false });
  await app.ready();
  return { app, async close() { await app.close(); await db.destroy(); } };
}

const login = (app: FastifyInstance, ip: string, email: string) =>
  app.inject({ method: 'POST', url: '/api/auth/login', remoteAddress: ip, headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ email, password: 'wrong-password-123' }) });
const counters = async () => (await sql<{ key: string; count: number }>`SELECT key, count FROM rate_limits ORDER BY key`.execute(h.ownerDb)).rows;

describe('shared rate limits (PostgreSQL)', () => {
  it('two app instances enforce one login limit, and a restarted instance still enforces it', async () => {
    const b = await secondInstance();
    const ip = '10.200.0.1';
    const email = `shared.${Date.now()}@example.test`;
    const codes: number[] = [];
    // Alternate between the instances: with per-process counters each would allow 10.
    for (let i = 0; i < 12; i++) codes.push((await login(i % 2 ? b.app : h.app, ip, email)).statusCode);
    expect(codes).toEqual([...Array(10).fill(401), 429, 429]);
    await b.close();

    const restarted = await secondInstance();
    const res = await login(restarted.app, ip, email);
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe('RATE_LIMITED');
    const retryAfter = Number(res.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(800);
    expect(retryAfter).toBeLessThanOrEqual(900);
    // Another client address, and the same address with another account, are counted separately.
    expect((await login(restarted.app, '10.200.0.2', email)).statusCode).toBe(401);
    expect((await login(restarted.app, ip, `other.${email}`)).statusCode).toBe(401);
    await restarted.close();
  });

  it('stores keyed hashes only: no IP address or email', async () => {
    const email = `hashed.${Date.now()}@example.test`;
    await login(h.app, '10.200.0.3', email);
    await login(h.app, '10.200.0.3', email);
    const rows = await counters();
    expect(rows).toEqual([{ key: expect.stringMatching(/^[0-9a-f]{64}$/), count: 2 }]);
  });

  it('the global flood guard stays per process: it limits at 600 a minute and writes nothing to the database', async () => {
    const ip = '10.200.0.4';
    const codes: number[] = [];
    for (let i = 0; i < 601; i++) codes.push((await h.app.inject({ method: 'GET', url: '/api/auth/me', remoteAddress: ip })).statusCode);
    expect(codes.slice(0, 600).every((c) => c === 401)).toBe(true);
    expect(codes[600]).toBe(429);
    expect(await counters()).toEqual([]);
  });

  it('counts concurrent requests from several instances exactly', async () => {
    const other = createDatabase(h.config.DATABASE_URL, { poolMax: 5 });
    const [a, b] = [new PostgresWindows(h.db, h.config.SESSION_SECRET, 'test'), new PostgresWindows(other, h.config.SESSION_SECRET, 'test')];
    const results = await Promise.all(Array.from({ length: 60 }, (_, i) => (i % 2 ? a : b).incr('10.0.0.9', 60_000)));
    expect(results.map((r) => r.current).sort((x, y) => x - y)).toEqual(Array.from({ length: 60 }, (_, i) => i + 1));
    expect(results.every((r) => r.ttl > 0 && r.ttl <= 60_000)).toBe(true);
    await other.destroy();
  });

  it('starts a new window when the old one ends; reading does not count; namespaces are separate', async () => {
    const w = new PostgresWindows(h.db, h.config.SESSION_SECRET, 'POST /a');
    expect((await w.incr('k', 300)).current).toBe(1);
    expect((await w.incr('k', 300)).current).toBe(2);
    expect((await new PostgresWindows(h.db, h.config.SESSION_SECRET, 'POST /b').incr('k', 300)).current).toBe(1);
    const peek = await w.read('k');
    expect(peek.current).toBe(2);
    expect(peek.ttl).toBeGreaterThan(0);
    expect(peek.ttl).toBeLessThanOrEqual(300);
    expect((await w.read('k')).current).toBe(2);
    await new Promise((r) => setTimeout(r, 350));
    expect(await w.read('k')).toEqual({ current: 0, ttl: 0 });
    expect((await w.incr('k', 300)).current).toBe(1);
    const Store = rateLimitStore(h.db, h.config.SESSION_SECRET);
    expect(() => new Store({ continueExceeding: true })).toThrow(/fixed windows only/);
  });

  it('the worker deletes expired counters and keeps live ones', async () => {
    await sql`INSERT INTO rate_limits (key, count, expires_at) VALUES ('expired', 3, now() - interval '1 second'), ('live', 1, now() + interval '1 minute')`.execute(h.ownerDb);
    expect(await runCleanup(h.db, h.config)).toMatchObject({ rateLimits: 1 });
    expect((await counters()).map((r) => r.key)).toEqual(['live']);
  });
});
