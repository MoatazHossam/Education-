import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { createDatabase, withSystemContext } from '../../src/db/index.js';
import { heartbeat } from '../../src/jobs/tasks.js';
import { AlertMonitor, evaluate, notify, ServerErrorCounter, type AlertChannels } from '../../src/ops/alerts.js';
import { createHarness, createPlatformAdmin, resetData, signUp, type Harness } from '../helpers/harness.js';

let h: Harness;
let hook: Server;
let hookUrl: string;
let hookStatus = 200;
const posts: Record<string, unknown>[] = [];

beforeAll(async () => {
  h = await createHarness();
  hook = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      posts.push(JSON.parse(body));
      res.statusCode = hookStatus;
      res.end();
    });
  });
  await new Promise<void>((r) => hook.listen(0, '127.0.0.1', r));
  hookUrl = `http://127.0.0.1:${(hook.address() as AddressInfo).port}/hook`;
});
afterAll(async () => {
  await h.close();
  await new Promise((r) => hook.close(r));
});
beforeEach(async () => {
  await resetData(h.ownerDb);
  posts.length = 0;
  hookStatus = 200;
});

/** One app instance's monitor, with captured email and log output. */
function instance(overrides: Partial<AlertChannels> = {}, deps: { db?: typeof h.db; clock?: () => number; errors?: ServerErrorCounter } = {}) {
  const mails: { to: string; subject: string; text: string }[] = [];
  const logs: string[] = [];
  const log = { warn: (...a: unknown[]) => void logs.push(JSON.stringify(a)), error: (...a: unknown[]) => void logs.push(JSON.stringify(a)), info: () => {} };
  const channels: AlertChannels = { mailer: { send: async (m) => void mails.push(m) }, emails: ['ops@example.test'], webhookUrl: hookUrl, ...overrides };
  const all = { db: deps.db ?? h.db, config: h.config, log, errors: deps.errors ?? new ServerErrorCounter(), channels, clock: deps.clock };
  return { monitor: new AlertMonitor(all), deps: all, mails, logs };
}
const staleWorker = (minutes: number) =>
  sql`INSERT INTO worker_heartbeats (name, last_beat_at, details) VALUES ('worker', now() - make_interval(mins => ${minutes}::int), '{}')
      ON CONFLICT (name) DO UPDATE SET last_beat_at = EXCLUDED.last_beat_at`.execute(h.ownerDb);

describe('operational alerts', () => {
  it('sends one alert per problem across instances, a reminder after 6 hours, and one resolution once it clears', async () => {
    await staleWorker(10);
    const [a, b] = [instance(), instance()];
    const first = (await Promise.all([a.monitor.runOnce(), b.monitor.runOnce()])).flat();
    expect(first.map((m) => `${m.kind}:${m.key}`)).toEqual(['firing:worker_stalled']);
    const mail = [...a.mails, ...b.mails];
    expect(mail).toHaveLength(1);
    expect(mail[0]).toMatchObject({ to: 'ops@example.test', subject: '[localhost:3000] ALERT: The background worker has not reported for 10 minutes' });
    expect(mail[0]!.text).toContain('What to check: Check the worker');
    expect(posts).toEqual([expect.objectContaining({ status: 'firing', alert: 'worker_stalled', text: expect.stringContaining('ALERT: The background worker') })]);

    // Still failing: nothing more until the reminder is due.
    expect([...(await a.monitor.runOnce()), ...(await b.monitor.runOnce())]).toEqual([]);
    await sql`UPDATE ops_alerts SET notified_at = now() - interval '7 hours'`.execute(h.ownerDb);
    const reminder = await b.monitor.runOnce();
    expect(reminder.map((m) => m.kind)).toEqual(['reminder']);
    expect(b.mails.at(-1)!.subject).toMatch(/Still failing: The background worker/);

    // The worker recovers: resolved only after the condition has been clear for 5 minutes, by one instance.
    await heartbeat(h.db, 'worker', {});
    expect(await a.monitor.runOnce()).toEqual([]);
    await sql`UPDATE ops_alerts SET last_seen_at = now() - interval '6 minutes'`.execute(h.ownerDb);
    const resolved = (await Promise.all([a.monitor.runOnce(), b.monitor.runOnce()])).flat();
    expect(resolved.map((m) => `${m.kind}:${m.key}`)).toEqual(['resolved:worker_stalled']);
    const row = await h.ownerDb.selectFrom('ops_alerts').select(['status', 'resolved_at']).executeTakeFirstOrThrow();
    expect(row.status).toBe('resolved');
    expect(row.resolved_at).not.toBeNull();
  });

  it('checks email delivery, server errors, payment notifications and migrations; messages carry counts, not addresses', async () => {
    await heartbeat(h.db, 'worker', {});
    await sql`
      INSERT INTO email_outbox (to_email, template, subject, text_body, status, attempts, send_after) VALUES
        ('customer@school.test', 'verify', 's', 'b', 'failed', 5, now()),
        ('late@school.test', 'verify', 's', 'b', 'pending', 0, now() - interval '20 minutes'),
        ('r1@school.test', 'verify', 's', 'b', 'pending', 2, now() + interval '5 minutes'),
        ('r2@school.test', 'verify', 's', 'b', 'pending', 3, now() + interval '5 minutes'),
        ('r3@school.test', 'verify', 's', 'b', 'pending', 2, now() + interval '5 minutes')`.execute(h.ownerDb);
    await sql`INSERT INTO billing_events (provider, event_id, event_type, payload, status, error) VALUES ('sandbox', 'evt-1', 'payment', '{}', 'failed', 'amount mismatch')`.execute(h.ownerDb);
    const errors = new ServerErrorCounter();
    for (let i = 0; i < 9; i++) errors.record();
    expect((await evaluate(h.db, h.config, errors)).map((o) => o.key)).not.toContain('server_errors');
    errors.record();

    const removed = await sql<{ name: string; timestamp: string }>`DELETE FROM kysely_migration WHERE name = '0006_ops_alerts' RETURNING name, timestamp`.execute(h.ownerDb);
    try {
      const a = instance({}, { errors });
      const sent = await a.monitor.runOnce();
      expect(sent.map((m) => m.key).sort()).toEqual(['email_backlog', 'email_failing', 'migrations_pending', 'payment_webhooks_failing', 'server_errors']);
      expect(sent.find((m) => m.key === 'email_failing')!.summary).toBe('Emails are failing to send: 1 gave up in the last hour, 3 being retried');
      expect(sent.find((m) => m.key === 'email_backlog')!.summary).toBe('1 emails have waited more than 15 minutes to be sent');
      expect(sent.find((m) => m.key === 'migrations_pending')!.summary).toBe('Database migrations are pending: 0006_ops_alerts');
      const everything = JSON.stringify([a.mails, posts]);
      expect(everything).not.toMatch(/school\.test|amount mismatch/);
    } finally {
      const r = removed.rows[0]!;
      await sql`INSERT INTO kysely_migration (name, timestamp) VALUES (${r.name}, ${r.timestamp})`.execute(h.ownerDb);
    }
  });

  it('alerts from memory when the database is unreachable, reminds after 6 hours, and resolves when it is back', async () => {
    const down = createDatabase('postgres://cs_test_app:x@127.0.0.1:1/none', { poolMax: 1 });
    let now = Date.parse('2026-10-25T10:00:00Z');
    const a = instance({}, { db: down, clock: () => now });
    try {
      expect(await a.monitor.runOnce()).toEqual([]); // one failed check is not enough
      now += 60_000;
      const fired = await a.monitor.runOnce();
      expect(fired.map((m) => `${m.kind}:${m.key}`)).toEqual(['firing:database_unreachable']);
      expect(a.mails[0]!.subject).toMatch(/ALERT: The database is unreachable from /);
      now += 60_000;
      expect(await a.monitor.runOnce()).toEqual([]);
      now += 7 * 3_600_000;
      expect((await a.monitor.runOnce()).map((m) => m.kind)).toEqual(['reminder']);

      await heartbeat(h.db, 'worker', {});
      a.deps.db = h.db;
      expect((await a.monitor.runOnce()).map((m) => `${m.kind}:${m.key}`)).toEqual(['resolved:database_unreachable']);
      expect(await a.monitor.runOnce()).toEqual([]);
    } finally {
      await down.destroy();
    }
  });

  it('a failing channel does not stop the other; failures are logged without the webhook URL', async () => {
    hookStatus = 500;
    const a = instance({ mailer: { send: async () => { throw new Error('SMTP down'); } } });
    const msg = { kind: 'test' as const, key: 'test' as const, summary: 'Test', details: {} };
    expect(await notify(a.deps.channels, msg, h.config, a.deps.log)).toEqual({ email: 'failed', webhook: 'failed' });
    expect(posts).toHaveLength(1); // the webhook was still tried
    expect(a.logs.join('\n')).toMatch(/alert email failed/);
    expect(a.logs.join('\n')).not.toContain(hookUrl);
    const none = instance({ mailer: null, emails: [], webhookUrl: undefined });
    expect(await notify(none.deps.channels, msg, h.config, none.deps.log)).toEqual({ email: 'off', webhook: 'off' });
    expect(none.logs.join('\n')).toMatch(/operational alert/);
  });

  it('counts 5xx responses, except the health endpoints', async () => {
    const app = await buildApp({ config: h.config, db: h.db, logger: false });
    app.get('/api/test/boom', async () => { throw new Error('boom'); });
    await app.ready();
    expect((await app.inject({ method: 'GET', url: '/api/test/boom' })).statusCode).toBe(500);
    app.lifecycle.draining = true;
    expect((await app.inject({ method: 'GET', url: '/readyz' })).statusCode).toBe(503);
    expect(app.serverErrors.inLast(5)).toBe(1);
    await app.close();
  });

  it('platform admins see alerts and can send a test alert (audited); customers cannot', async () => {
    await staleWorker(10);
    await instance().monitor.runOnce();
    const admin = await createPlatformAdmin(h);
    const list = (await admin.get('/api/admin/alerts')).json();
    expect(list.channels).toEqual({ emails: 0, emailTransport: h.config.EMAIL_TRANSPORT, webhook: false });
    expect(list.alerts).toEqual([expect.objectContaining({ key: 'worker_stalled', status: 'firing', summary: expect.stringContaining('has not reported') })]);
    expect((await admin.post('/api/admin/alerts/test')).json()).toEqual({ result: { email: 'off', webhook: 'off' } });

    const withHook = await createHarness({ ALERT_WEBHOOK_URL: hookUrl });
    try {
      const admin2 = await createPlatformAdmin(withHook);
      expect((await admin2.post('/api/admin/alerts/test')).json()).toEqual({ result: { email: 'off', webhook: 'sent' } });
      expect(posts.at(-1)).toMatchObject({ status: 'test', alert: 'test', text: expect.stringContaining('Test alert: Test alert from Platform admin') });
    } finally {
      await withHook.close();
    }
    const audit = await withSystemContext(h.ownerDb, (trx) => trx.selectFrom('audit_logs').select(['action', 'metadata']).where('action', '=', 'admin.alert_test').orderBy('id').execute());
    expect(audit).toEqual([
      { action: 'admin.alert_test', metadata: { email: 'off', webhook: 'off' } },
      { action: 'admin.alert_test', metadata: { email: 'off', webhook: 'sent' } },
    ]);

    const owner = await signUp(h);
    expect((await owner.client.get('/api/admin/alerts')).statusCode).toBe(404);
    expect((await owner.client.post('/api/admin/alerts/test')).statusCode).toBe(404);
  });
});
