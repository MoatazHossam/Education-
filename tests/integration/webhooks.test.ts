import { createHmac } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withOrgContext, withSystemContext } from '../../src/db/index.js';
import { runCleanup } from '../../src/jobs/tasks.js';
import { parseCsv, UTF8_BOM } from '../../src/lib/csv.js';
import { postWebhook } from '../../src/webhooks/net.js';
import { DISABLE_AFTER_FAILURES, MAX_ATTEMPTS, processWebhookDeliveries } from '../../src/webhooks/service.js';
import { addMember, createHarness, publishedVersionId, resetData, signUp, someMaterialIds, type Harness } from '../helpers/harness.js';

// Deliveries go to a local receiver, so this harness allows http and loopback
// targets (WEBHOOK_ALLOW_INSECURE_TARGETS, refused in production). The default
// rules are tested with a second harness at the end.
let h: Harness;
beforeAll(async () => {
  h = await createHarness({ RATE_LIMIT_ENABLED: 'false', WEBHOOK_ALLOW_INSECURE_TARGETS: 'true' });
});
afterAll(async () => h.close());
beforeEach(async () => resetData(h.ownerDb));

interface WebhookEvent { id: string; type: string; createdAt: string; organizationId: string; data: { scope?: { id: string; name: string; itemCount?: number }; endpointId?: string; materialIds?: string[] } }
interface Received { headers: http.IncomingHttpHeaders; body: string; json: WebhookEvent }

/** A local HTTP receiver answering `status` (or not at all, or with a redirect). */
async function receiver() {
  const received: Received[] = [];
  let reply: number | 'hang' = 200;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ headers: req.headers, body, json: JSON.parse(body) });
      if (reply === 'hang') return;
      if (reply === 302) res.writeHead(302, { location: `${url}/elsewhere` }).end();
      else res.writeHead(reply).end('ok');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
  return {
    url,
    received,
    reply: (r: number | 'hang') => (reply = r),
    close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }),
  };
}

const receivers: Awaited<ReturnType<typeof receiver>>[] = [];
afterAll(async () => { for (const r of receivers) await r.close(); });
const newReceiver = async () => { const r = await receiver(); receivers.push(r); return r; };

const ALL = ['scope.created', 'scope.updated', 'scope.deleted', 'scope.items_changed'];
const deliver = () => processWebhookDeliveries(h.db, h.config, { timeoutMs: 2000 });
const deliveries = () => withSystemContext(h.ownerDb, (trx) => trx.selectFrom('webhook_deliveries').selectAll().orderBy('created_at').execute());
const dueNow = () => withSystemContext(h.ownerDb, (trx) => sql`UPDATE webhook_deliveries SET next_attempt_at = now() WHERE status = 'pending'`.execute(trx));

function verify(r: Received, secret: string) {
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(String(r.headers['x-midad-signature']));
  expect(m, 'signature header').not.toBeNull();
  const [, t, v1] = m!;
  expect(Math.abs(Date.now() / 1000 - Number(t))).toBeLessThan(60);
  expect(v1).toBe(createHmac('sha256', secret).update(`${t}.${r.body}`).digest('hex'));
}

async function school() {
  const owner = await signUp(h, { org: 'Hook School', name: 'Owner Olfat' });
  const versionId = await publishedVersionId(h);
  const books = await someMaterialIds(h, versionId, 4);
  const base = `/api/orgs/${owner.orgId}`;
  const addHook = async (url: string, events = ALL) => {
    const res = await owner.client.post(`${base}/webhooks`, { url, events, description: 'Content pipeline' });
    expect(res.statusCode, res.body).toBe(201);
    return res.json() as { webhook: { id: string; secretPrefix: string }; secret: string };
  };
  const newScope = async (name = 'Plan') => {
    const res = await owner.client.post(`${base}/scopes`, { name, catalogVersionId: versionId });
    expect(res.statusCode, res.body).toBe(201);
    return res.json().scope.id as string;
  };
  return { owner, versionId, books, base, addHook, newScope };
}

describe('webhook endpoints', () => {
  it('admins add endpoints; the secret is shown once and stored encrypted; editors, viewers and plans without API access cannot', async () => {
    const s = await school();
    const r = await newReceiver();
    const created = await s.addHook(r.url);
    expect(created.secret).toMatch(/^whsec_[A-Za-z0-9_-]{32}$/);
    expect(created.webhook.secretPrefix).toBe(created.secret.slice(0, 10));
    const list = (await s.owner.client.get(`${s.base}/webhooks`)).json();
    expect(list.webhooks).toEqual([expect.objectContaining({ url: r.url, events: ALL, description: 'Content pipeline', enabled: true, lastDelivery: null })]);
    expect(JSON.stringify(list)).not.toContain(created.secret);
    const stored = await withSystemContext(h.ownerDb, (trx) => trx.selectFrom('webhook_endpoints').select('secret_enc').executeTakeFirstOrThrow());
    expect(stored.secret_enc).not.toContain(created.secret.slice(6));

    const editor = await addMember(h, s.owner.client, s.owner.orgId, 'editor');
    expect((await editor.client.get(`${s.base}/webhooks`)).statusCode).toBe(403);
    expect((await editor.client.post(`${s.base}/webhooks`, { url: r.url, events: ALL })).statusCode).toBe(403);

    for (const bad of [{ url: r.url, events: [] }, { url: r.url, events: ['scope.nope'] }, { url: 'ftp://127.0.0.1/x', events: ALL }, { url: 'not a url', events: ALL }]) {
      const res = await s.owner.client.post(`${s.base}/webhooks`, bad);
      expect(res.statusCode, JSON.stringify(bad)).toBe(400);
    }
    for (let i = 0; i < 4; i++) await s.addHook(`${r.url}/${i}`);
    const sixth = await s.owner.client.post(`${s.base}/webhooks`, { url: r.url, events: ALL });
    expect(sixth.json().error.code).toBe('WEBHOOK_LIMIT');

    await withSystemContext(h.ownerDb, (trx) => sql`UPDATE subscriptions SET plan_id = 'starter', status = 'active', trial_ends_at = NULL WHERE org_id = ${s.owner.orgId}`.execute(trx));
    await s.owner.client.delete(`${s.base}/webhooks/${created.webhook.id}`);
    const res = await s.owner.client.post(`${s.base}/webhooks`, { url: r.url, events: ALL });
    expect(res.statusCode).toBe(402);
    expect(res.json().error.code).toBe('FEATURE_NOT_IN_PLAN');
  });

  it('scope changes are queued with the change and delivered signed by the worker, to subscribed endpoints only', async () => {
    const s = await school();
    const all = await newReceiver();
    const deletesOnly = await newReceiver();
    const hook = await s.addHook(all.url);
    const hook2 = await s.addHook(deletesOnly.url, ['scope.deleted']);
    const scopeId = await s.newScope();
    expect((await s.owner.client.post(`${s.base}/scopes/${scopeId}/items`, { add: s.books.slice(0, 2) })).statusCode).toBe(200);
    await deliver();
    expect((await s.owner.client.patch(`${s.base}/scopes/${scopeId}`, { name: 'Plan 2026' })).statusCode).toBe(200);
    await deliver();
    expect((await s.owner.client.delete(`${s.base}/scopes/${scopeId}`)).statusCode).toBe(200);
    expect(all.received).toHaveLength(3);
    expect(await deliver()).toEqual({ delivered: 2, retrying: 0, failed: 0 });

    expect(all.received.map((r) => r.json.type).sort()).toEqual(['scope.created', 'scope.deleted', 'scope.items_changed', 'scope.updated']);
    for (const r of all.received) {
      verify(r, hook.secret);
      expect(r.headers['x-midad-event']).toBe(r.json.type);
      expect(r.headers['user-agent']).toBe('Midad-Webhooks/1');
      expect(r.json).toMatchObject({ id: expect.any(String), createdAt: expect.any(String), organizationId: s.owner.orgId });
    }
    const items = all.received.find((r) => r.json.type === 'scope.items_changed')!.json;
    expect(items.data.scope).toEqual({ id: scopeId, name: 'Plan', catalogVersionId: s.versionId, academicYear: expect.stringMatching(/^\d{4}\/\d{4}$/), itemCount: 2, updatedAt: expect.any(String) });
    expect(all.received.find((r) => r.json.type === 'scope.updated')!.json.data.scope?.name).toBe('Plan 2026');
    expect(all.received.find((r) => r.json.type === 'scope.deleted')!.json.data).toEqual({ scope: { id: scopeId, name: 'Plan 2026' } });
    // The body is exactly what was signed, in this key order.
    expect(Object.keys(items)).toEqual(['id', 'type', 'createdAt', 'organizationId', 'data']);

    expect(deletesOnly.received.map((r) => r.json.type)).toEqual(['scope.deleted']);
    verify(deletesOnly.received[0]!, hook2.secret);
    const list = (await s.owner.client.get(`${s.base}/webhooks/${hook.webhook.id}/deliveries`)).json().deliveries;
    expect(list).toHaveLength(4);
    expect(list.every((d: { status: string; statusCode: number }) => d.status === 'delivered' && d.statusCode === 200)).toBe(true);
  });

  it('quick changes to one scope reach the endpoint as one event with the latest state', async () => {
    const s = await school();
    const r = await newReceiver();
    await s.addHook(r.url, ['scope.items_changed']);
    const scopeId = await s.newScope();
    for (const book of s.books.slice(0, 3)) await s.owner.client.post(`${s.base}/scopes/${scopeId}/items`, { add: [book] });
    expect(await deliveries()).toHaveLength(1);
    await deliver();
    expect(r.received).toHaveLength(1);
    expect(r.received[0]!.json.data.scope?.itemCount).toBe(3);
    // Once sent, the next change is a new event.
    await s.owner.client.post(`${s.base}/scopes/${scopeId}/items`, { remove: [s.books[0]] });
    await s.owner.client.delete(`${s.base}/scopes/${scopeId}/items`);
    await deliver();
    expect(r.received.map((x) => x.json.data.scope?.itemCount)).toEqual([3, 0]);
  });

  it('notes, assignees, statuses and due dates are one event per scope naming every book changed, without the notes themselves', async () => {
    const s = await school();
    const r = await newReceiver();
    const hook = await s.addHook(r.url, ['scope.items_annotated']);
    const other = await newReceiver();
    await s.addHook(other.url, ['scope.items_changed']);
    const scopeId = await s.newScope();
    const scopeBase = `${s.base}/scopes/${scopeId}`;
    await s.owner.client.post(`${scopeBase}/items`, { add: s.books });
    const viewer = await addMember(h, s.owner.client, s.owner.orgId, 'viewer');

    // A note on one book, then two books assigned with a due date: one event naming the three.
    expect((await s.owner.client.patch(`${scopeBase}/items/${s.books[0]}`, { note: 'Waiting for the 2027 edition' })).statusCode).toBe(200);
    expect((await s.owner.client.post(`${scopeBase}/items/assign`, { materialIds: s.books.slice(1, 3), assigneeId: viewer.userId, dueOn: '2026-12-01' })).statusCode).toBe(200);
    expect((await deliveries()).filter((d) => d.event_type === 'scope.items_annotated')).toHaveLength(1);
    await deliver();
    const [annotated] = r.received;
    expect(annotated!.json).toMatchObject({ type: 'scope.items_annotated', data: { scope: { id: scopeId, itemCount: 4 }, materialIds: s.books.slice(0, 3).sort() } });
    expect(Object.keys(annotated!.json.data)).toEqual(['scope', 'materialIds']);
    expect(annotated!.body).not.toContain('Waiting for the 2027 edition');
    expect(annotated!.body).not.toContain('Member viewer');
    verify(annotated!, hook.secret);
    expect(other.received.map((x) => x.json.type)).toEqual(['scope.items_changed']);

    // The assignee, a viewer, marks a book done: a new event naming that book.
    expect((await viewer.client.patch(`${scopeBase}/items/${s.books[1]}`, { status: 'done' })).statusCode).toBe(200);
    await deliver();
    expect(r.received[1]!.json).toMatchObject({ type: 'scope.items_annotated', data: { materialIds: [s.books[1]] } });

    // Saving without a change sends nothing.
    await s.owner.client.patch(`${scopeBase}/items/${s.books[0]}`, { note: 'Waiting for the 2027 edition' });
    await s.owner.client.post(`${scopeBase}/items/assign`, { materialIds: s.books.slice(1, 3), assigneeId: viewer.userId });
    expect((await deliveries()).filter((d) => d.status === 'pending')).toEqual([]);
  });

  it('carrying a scope forward and duplicating it are reported too', async () => {
    const s = await school();
    const r = await newReceiver();
    await s.addHook(r.url, ['scope.created']);
    const scopeId = await s.newScope();
    const copy = (await s.owner.client.post(`${s.base}/scopes/${scopeId}/duplicate`, { name: 'Copy' })).json().scope.id;
    await deliver();
    expect(r.received.map((x) => x.json.data.scope?.id).sort()).toEqual([scopeId, copy].sort());
  });

  it('failures are retried with backoff and fail for good after the last attempt', async () => {
    const s = await school();
    const r = await newReceiver();
    r.reply(500);
    await s.addHook(r.url);
    await s.newScope();
    expect(await deliver()).toEqual({ delivered: 0, retrying: 1, failed: 0 });
    let [d] = await deliveries();
    expect(d).toMatchObject({ status: 'pending', attempts: 1, last_status_code: 500, last_error: 'HTTP 500' });
    const wait = (d!.next_attempt_at.getTime() - Date.now()) / 60_000;
    expect(wait).toBeGreaterThan(0.9);
    expect(wait).toBeLessThan(1.1);
    expect(await deliver()).toEqual({ delivered: 0, retrying: 0, failed: 0 });

    for (let i = 2; i <= MAX_ATTEMPTS; i++) {
      await dueNow();
      await deliver();
    }
    [d] = await deliveries();
    expect(d).toMatchObject({ status: 'failed', attempts: MAX_ATTEMPTS });
    expect(r.received).toHaveLength(MAX_ATTEMPTS);

    // A success resets the endpoint's failure count.
    r.reply(204);
    await s.newScope('Second');
    await deliver();
    const endpoint = await withSystemContext(h.ownerDb, (trx) => trx.selectFrom('webhook_endpoints').select(['consecutive_failures', 'enabled']).executeTakeFirstOrThrow());
    expect(endpoint).toEqual({ consecutive_failures: 0, enabled: true });
  });

  it('an endpoint that keeps failing is switched off and the admins are told; switching it on again resumes delivery', async () => {
    const s = await school();
    const r = await newReceiver();
    r.reply(503);
    const hook = await s.addHook(r.url);
    await withSystemContext(h.ownerDb, (trx) => trx.updateTable('webhook_endpoints').set({ consecutive_failures: DISABLE_AFTER_FAILURES - 1 }).execute());
    const scopeId = await s.newScope();
    await deliver();
    const list = (await s.owner.client.get(`${s.base}/webhooks`)).json().webhooks;
    expect(list[0]).toMatchObject({ enabled: false, disabledReason: 'failing', consecutiveFailures: DISABLE_AFTER_FAILURES, lastDelivery: { status: 'pending', statusCode: 503 } });
    const notices = await h.ownerDb.selectFrom('notifications').select(['title', 'link']).where('user_id', '=', s.owner.userId).where('kind', '=', 'webhook_disabled').execute();
    expect(notices).toEqual([{ title: 'A webhook was switched off', link: `/org/${s.owner.orgId}/settings` }]);
    const audit = (await s.owner.client.get(`${s.base}/audit-logs?action=webhook.disabled`)).json().entries;
    expect(audit).toHaveLength(1);

    // While off, nothing new is queued and nothing is sent.
    await s.owner.client.post(`${s.base}/scopes/${scopeId}/items`, { add: s.books.slice(0, 1) });
    await dueNow();
    await deliver();
    expect(await deliveries()).toHaveLength(1);
    expect(r.received).toHaveLength(1);

    r.reply(200);
    const on = await s.owner.client.patch(`${s.base}/webhooks/${hook.webhook.id}`, { enabled: true });
    expect(on.json().webhook).toMatchObject({ enabled: true, disabledReason: null, consecutiveFailures: 0 });
    await dueNow();
    expect(await deliver()).toMatchObject({ delivered: 1 });
  });

  it('redirects are not followed and slow endpoints time out', async () => {
    const r = await newReceiver();
    r.reply(302);
    expect(await postWebhook(r.url, '{}', {}, { allowInsecure: true })).toEqual({ ok: false, statusCode: 302, error: 'Redirects are not followed' });
    expect(r.received.map((x) => x.body)).toEqual(['{}']);
    r.reply('hang');
    const started = Date.now();
    const res = await postWebhook(r.url, '{}', {}, { allowInsecure: true, timeoutMs: 300 });
    expect(res).toEqual({ ok: false, statusCode: null, error: 'No response within 0.3 s' });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('a test sends a ping at once; redelivery queues the same event again; a new secret signs from then on', async () => {
    const s = await school();
    const r = await newReceiver();
    const hook = await s.addHook(r.url);
    const ok = await s.owner.client.post(`${s.base}/webhooks/${hook.webhook.id}/test`);
    expect(ok.json().delivery).toMatchObject({ status: 'delivered', statusCode: 200, error: null });
    expect(r.received[0]!.json).toMatchObject({ type: 'ping', data: { endpointId: hook.webhook.id } });
    verify(r.received[0]!, hook.secret);

    r.reply(500);
    const bad = (await s.owner.client.post(`${s.base}/webhooks/${hook.webhook.id}/test`)).json().delivery;
    expect(bad).toMatchObject({ status: 'failed', statusCode: 500, error: 'HTTP 500' });
    await dueNow();
    await deliver();
    expect(r.received).toHaveLength(2); // a failed test is not retried

    r.reply(200);
    const again = await s.owner.client.post(`${s.base}/webhooks/${hook.webhook.id}/deliveries/${ok.json().delivery.id}/redeliver`);
    expect(again.statusCode).toBe(202);
    const rotated = (await s.owner.client.post(`${s.base}/webhooks/${hook.webhook.id}/rotate-secret`)).json();
    expect(rotated.secret).not.toBe(hook.secret);
    await deliver();
    expect(r.received).toHaveLength(3);
    expect(r.received[2]!.json.id).toBe(r.received[0]!.json.id);
    verify(r.received[2]!, rotated.secret);

    const pending = (await s.owner.client.post(`${s.base}/webhooks/${hook.webhook.id}/test`)).json().delivery;
    await withSystemContext(h.ownerDb, (trx) => trx.updateTable('webhook_deliveries').set({ status: 'pending' }).where('id', '=', pending.id).execute());
    expect((await s.owner.client.post(`${s.base}/webhooks/${hook.webhook.id}/deliveries/${pending.id}/redeliver`)).json().error.code).toBe('DELIVERY_PENDING');
    const audit = (await s.owner.client.get(`${s.base}/audit-logs?action=webhook.`)).json().entries.map((e: { action: string }) => e.action);
    expect(audit).toEqual(expect.arrayContaining(['webhook.created', 'webhook.tested', 'webhook.redelivered', 'webhook.secret_rotated']));
  });

  it('the delivery history downloads as CSV with every kept delivery, newest first; only admins can; it is audited', async () => {
    const s = await school();
    const r = await newReceiver();
    const hook = await s.addHook(r.url);
    const scopeId = await s.newScope('=SUM(A1)');
    await deliver();
    r.reply(500);
    expect((await s.owner.client.post(`${s.base}/webhooks/${hook.webhook.id}/test`)).json().delivery.status).toBe('failed');
    expect((await s.owner.client.patch(`${s.base}/scopes/${scopeId}`, { name: 'Plan, "B"' })).statusCode).toBe(200); // waits for the worker

    const list = (await s.owner.client.get(`${s.base}/webhooks/${hook.webhook.id}/deliveries`)).json();
    expect(list).toMatchObject({ total: 3, keptDays: 30, exportMax: 10_000 });
    expect(list.deliveries).toHaveLength(3);

    const res = await s.owner.client.get(`${s.base}/webhooks/${hook.webhook.id}/deliveries/export`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="webhook-deliveries-127\.0\.0\.1-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(res.body.startsWith(UTF8_BOM)).toBe(true);
    const [header, ...rows] = parseCsv(res.body);
    expect(header).toEqual(['created_at_utc', 'delivery_id', 'event_id', 'event', 'status', 'attempts', 'http_status', 'error', 'delivered_at_utc', 'next_attempt_at_utc', 'scope_id', 'scope_name', 'payload']);
    const byEvent = Object.fromEntries(rows.map((row) => [row[3], Object.fromEntries(header!.map((k, i) => [k, row[i]]))]));
    expect(rows.map((row) => row[3])).toEqual(['scope.updated', 'ping', 'scope.created']);
    expect(rows.map((row) => row[1])).toEqual(list.deliveries.map((d: { id: string }) => d.id));

    expect(byEvent['scope.created']).toMatchObject({ status: 'delivered', attempts: '1', http_status: '200', error: '', next_attempt_at_utc: '', scope_id: scopeId, scope_name: "'=SUM(A1)" });
    expect(new Date(byEvent['scope.created']!.delivered_at_utc!).getTime()).toBeGreaterThan(Date.now() - 60_000);
    // The body column is exactly what was sent.
    expect(byEvent['scope.created']!.payload).toBe(r.received[0]!.body);
    expect(byEvent.ping).toMatchObject({ status: 'failed', http_status: '500', error: 'HTTP 500', scope_id: '', scope_name: '', delivered_at_utc: '' });
    expect(JSON.parse(byEvent.ping!.payload!)).toMatchObject({ type: 'ping', data: { endpointId: hook.webhook.id } });
    expect(byEvent['scope.updated']).toMatchObject({ status: 'pending', attempts: '0', scope_name: 'Plan, "B"', delivered_at_utc: '' });
    expect(byEvent['scope.updated']!.next_attempt_at_utc).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(res.body).not.toContain(hook.secret);

    const editor = await addMember(h, s.owner.client, s.owner.orgId, 'editor');
    expect((await editor.client.get(`${s.base}/webhooks/${hook.webhook.id}/deliveries/export`)).statusCode).toBe(403);
    const audit = await withSystemContext(h.ownerDb, (trx) => trx.selectFrom('audit_logs').select(['target_id', 'metadata']).where('action', '=', 'webhook.deliveries_exported').execute());
    expect(audit).toEqual([{ target_id: hook.webhook.id, metadata: { rows: 3 } }]);

    // Downloading needs no API access on the plan: the history stays readable after a downgrade.
    await withSystemContext(h.ownerDb, (trx) => sql`UPDATE subscriptions SET plan_id = 'free', status = 'active', trial_ends_at = NULL WHERE org_id = ${s.owner.orgId}`.execute(trx));
    expect((await s.owner.client.get(`${s.base}/webhooks/${hook.webhook.id}/deliveries/export`)).statusCode).toBe(200);
  });

  it('the download holds the newest 10,000 deliveries', async () => {
    const s = await school();
    const r = await newReceiver();
    const hook = await s.addHook(r.url);
    await withSystemContext(h.ownerDb, (trx) => sql`
      INSERT INTO webhook_deliveries (org_id, endpoint_id, event_id, event_type, payload, status, attempts, created_at)
      SELECT ${s.owner.orgId}, ${hook.webhook.id}, gen_random_uuid(), 'scope.updated', json_build_object('n', g), 'delivered', 1, now() - make_interval(secs => g)
      FROM generate_series(1, 10_005) AS g`.execute(trx));
    expect((await s.owner.client.get(`${s.base}/webhooks/${hook.webhook.id}/deliveries`)).json().total).toBe(10_005);
    const res = await s.owner.client.get(`${s.base}/webhooks/${hook.webhook.id}/deliveries/export`);
    const [, ...rows] = parseCsv(res.body);
    expect(rows).toHaveLength(10_000);
    expect(JSON.parse(rows[0]![12]!)).toEqual({ n: 1 });
    expect(JSON.parse(rows.at(-1)![12]!)).toEqual({ n: 10_000 });
  });

  it('events stop when the plan no longer includes API access', async () => {
    const s = await school();
    const r = await newReceiver();
    await s.addHook(r.url);
    await withSystemContext(h.ownerDb, (trx) => sql`UPDATE subscriptions SET plan_id = 'free', status = 'active', trial_ends_at = NULL WHERE org_id = ${s.owner.orgId}`.execute(trx));
    await s.newScope();
    expect(await deliveries()).toEqual([]);
  });

  it('another organization cannot see or change them; old deliveries are cleaned up', async () => {
    const s = await school();
    const r = await newReceiver();
    const hook = await s.addHook(r.url);
    await s.newScope();
    await deliver();
    const other = await signUp(h, { org: 'Other School' });
    expect((await other.client.get(`/api/orgs/${s.owner.orgId}/webhooks`)).statusCode).toBe(404);
    expect((await other.client.patch(`/api/orgs/${other.orgId}/webhooks/${hook.webhook.id}`, { enabled: false })).statusCode).toBe(404);
    expect((await other.client.delete(`/api/orgs/${other.orgId}/webhooks/${hook.webhook.id}`)).statusCode).toBe(404);
    for (const table of ['webhook_endpoints', 'webhook_deliveries'] as const) {
      expect(await withOrgContext(h.db, { orgId: other.orgId }, (trx) => trx.selectFrom(table).selectAll().execute())).toEqual([]);
    }
    expect((await runCleanup(h.db, h.config, new Date(Date.now() + 29 * 86_400_000))).webhookDeliveries).toBe(0);
    expect((await runCleanup(h.db, h.config, new Date(Date.now() + 31 * 86_400_000))).webhookDeliveries).toBe(1);
  });
});

describe('webhook targets with the default settings', () => {
  let strict: Harness;
  beforeAll(async () => {
    strict = await createHarness({ RATE_LIMIT_ENABLED: 'false' });
  });
  afterAll(async () => strict.close());

  it('only https URLs to public hosts are accepted, and nothing is sent to a private address', async () => {
    const owner = await signUp(strict, { org: 'Strict School' });
    const add = (url: string) => owner.client.post(`/api/orgs/${owner.orgId}/webhooks`, { url, events: ALL });
    for (const url of ['http://hooks.example.com/x', 'https://127.0.0.1/x', 'https://10.1.2.3/x', 'https://[::1]/x', 'https://169.254.169.254/x', 'https://localhost/x', 'https://intranet/x', 'https://u:p@hooks.example.com/x']) {
      const res = await add(url);
      expect(res.statusCode, url).toBe(400);
      expect(res.json().error.code).toBe('INVALID_WEBHOOK_URL');
    }
    expect((await add('https://hooks.example.com/curriculum')).statusCode).toBe(201);

    const r = await newReceiver();
    const res = await postWebhook(r.url.replace('http:', 'https:'), '{}', {}, { allowInsecure: false });
    expect(res).toMatchObject({ ok: false, statusCode: null, error: 'The URL must point to a public address' });
    expect(r.received).toEqual([]);
  });
});
