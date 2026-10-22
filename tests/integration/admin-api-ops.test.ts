import { authenticator } from 'otplib';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '../../src/auth/password.js';
import { withSystemContext } from '../../src/db/index.js';
import { heartbeat, processOutbox, runCleanup } from '../../src/jobs/tasks.js';
import { encryptSecret } from '../../src/lib/crypto.js';
import { Client, createHarness, PASSWORD, publishedVersionId, resetData, signUp, someMaterialIds, uniqueEmail, type Harness } from '../helpers/harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());
beforeEach(async () => resetData(h.ownerDb));

async function platformAdmin(opts: { mfa: boolean } = { mfa: true }) {
  const email = uniqueEmail('admin');
  const secret = authenticator.generateSecret();
  await h.ownerDb
    .insertInto('users')
    .values({
      email,
      name: 'Ops',
      password_hash: await hashPassword(PASSWORD),
      email_verified_at: new Date(),
      is_platform_admin: true,
      mfa_enabled: opts.mfa,
      mfa_secret_enc: opts.mfa ? encryptSecret(h.config.DATA_ENCRYPTION_KEY, secret) : null,
    })
    .execute();
  const client = new Client(h.app);
  const login = await client.post('/api/auth/login', { email, password: PASSWORD });
  expect(login.statusCode).toBe(200);
  await client.refresh();
  if (opts.mfa) {
    expect((await client.post('/api/auth/mfa/verify', { code: authenticator.generate(secret) })).statusCode).toBe(200);
    await client.refresh();
  }
  return client;
}

describe('platform administration', () => {
  it('is invisible to ordinary users and requires MFA for admins', async () => {
    const user = await signUp(h);
    expect((await user.client.get('/api/admin/overview')).statusCode).toBe(404);
    const noMfa = await platformAdmin({ mfa: false });
    const res = await noMfa.get('/api/admin/overview');
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('MFA_ENROLLMENT_REQUIRED');
    const admin = await platformAdmin();
    const ok = await admin.get('/api/admin/overview');
    expect(ok.statusCode).toBe(200);
    expect(ok.json().subscriptions.byState.trialing).toBe(1);
  });

  it('sees customer metadata but not scope contents without a support grant', async () => {
    const owner = await signUp(h, { org: 'Customer Co' });
    const versionId = await publishedVersionId(h);
    const scope = (await owner.client.post(`/api/orgs/${owner.orgId}/scopes`, { name: 'Confidential plan', catalogVersionId: versionId })).json().scope;
    await owner.client.post(`/api/orgs/${owner.orgId}/scopes/${scope.id}/items`, { add: await someMaterialIds(h, versionId, 3) });
    const admin = await platformAdmin();

    const orgs = (await admin.get('/api/admin/orgs?q=Customer')).json().organizations;
    expect(orgs[0]).toMatchObject({ name: 'Customer Co', scopes: 1, members: 1, planId: 'professional', billingState: 'trialing' });
    const detail = (await admin.get(`/api/admin/orgs/${owner.orgId}`)).json();
    expect(JSON.stringify(detail)).not.toContain('Confidential plan');

    const denied = await admin.get(`/api/admin/support/orgs/${owner.orgId}/scopes`);
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('SUPPORT_ACCESS_REQUIRED');

    const grant = await owner.client.post(`/api/orgs/${owner.orgId}/support-access`, { reason: 'Ticket #42: export looks wrong', hours: 2 });
    expect(grant.statusCode).toBe(201);
    const allowed = await admin.get(`/api/admin/support/orgs/${owner.orgId}/scopes/${scope.id}`);
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().items).toHaveLength(3);

    // The customer sees that support looked at their data.
    const log = (await owner.client.get(`/api/orgs/${owner.orgId}/audit-logs?action=support_access`)).json().entries;
    expect(log.map((e: { action: string }) => e.action)).toEqual(expect.arrayContaining(['support_access.used', 'support_access.granted']));

    await owner.client.delete(`/api/orgs/${owner.orgId}/support-access/${grant.json().grant.id}`);
    expect((await admin.get(`/api/admin/support/orgs/${owner.orgId}/scopes`)).statusCode).toBe(403);
  });

  it('suspends and restores organizations and users', async () => {
    const owner = await signUp(h);
    const admin = await platformAdmin();
    expect((await admin.post(`/api/admin/orgs/${owner.orgId}/suspend`, { reason: 'Chargeback investigation' })).statusCode).toBe(200);
    const blocked = await owner.client.get(`/api/orgs/${owner.orgId}/scopes`);
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe('ORG_SUSPENDED');
    await admin.post(`/api/admin/orgs/${owner.orgId}/unsuspend`);
    expect((await owner.client.get(`/api/orgs/${owner.orgId}/scopes`)).statusCode).toBe(200);

    const userId = (await owner.client.get('/api/auth/me')).json().user.id;
    await admin.post(`/api/admin/users/${userId}/suspend`, { reason: 'abuse' });
    expect((await owner.client.get('/api/auth/me')).statusCode).toBe(401);
    const relogin = await new Client(h.app).post('/api/auth/login', { email: owner.email, password: PASSWORD });
    expect(relogin.json().error.code).toBe('ACCOUNT_SUSPENDED');
  });

  it('assigns an enterprise plan manually with custom limits', async () => {
    const owner = await signUp(h);
    const admin = await platformAdmin();
    const res = await admin.patch(`/api/admin/orgs/${owner.orgId}/subscription`, { planId: 'enterprise', status: 'active', currentPeriodEnd: null, limitOverrides: { max_members: 500 } });
    expect(res.statusCode).toBe(200);
    const org = (await owner.client.get(`/api/orgs/${owner.orgId}`)).json();
    expect(org.plan).toMatchObject({ id: 'enterprise', state: 'active' });
    expect(org.plan.limits.max_members).toBe(500);
    const inv = await admin.post(`/api/admin/orgs/${owner.orgId}/invoices`, { planId: 'enterprise', interval: 'year', amountCents: 12_000_000, markPaid: true });
    expect(inv.statusCode).toBe(201);
  });

  it('manages catalogue versions: clone to draft, edit, publish; published is read-only', async () => {
    const admin = await platformAdmin();
    const versionId = await publishedVersionId(h);
    const clone = await admin.post('/api/admin/catalog/versions', { fromVersionId: versionId, academicYear: '2027/2028', label: 'Draft 2027/28' });
    expect(clone.statusCode).toBe(201);
    const draftId = clone.json().id;
    const tree = (await admin.get(`/api/admin/catalog/versions/${draftId}`)).json();
    expect(tree.counts).toEqual({ subjects: 231, materials: 1038 });

    const subj = await admin.post(`/api/admin/catalog/versions/${draftId}/subjects`, {
      grade: 10, track: 'sec', block: 'Foundation year', code: 'ai', nameEn: 'Artificial Intelligence', nameAr: 'الذكاء الاصطناعي', status: 'pass', materials: [{ kind: 'moe', title: 'Ministry AI course' }],
    });
    expect(subj.statusCode).toBe(201);
    const firstSubject = tree.subjects[0].id;
    expect((await admin.patch(`/api/admin/catalog/subjects/${firstSubject}`, { note: 'Updated for 2027/28' })).statusCode).toBe(200);
    expect((await admin.patch(`/api/admin/catalog/versions/${draftId}`, { notice: 'Draft — not yet confirmed' })).statusCode).toBe(200);

    // Customers cannot see drafts.
    const owner = await signUp(h);
    expect((await owner.client.get(`/api/catalog/versions/${draftId}`)).statusCode).toBe(404);

    expect((await admin.post(`/api/admin/catalog/versions/${draftId}/publish`)).statusCode).toBe(200);
    expect((await owner.client.get(`/api/catalog/versions/${draftId}`)).json().counts.subjects).toBe(232);
    const edit = await admin.patch(`/api/admin/catalog/subjects/${firstSubject}`, { note: 'too late' });
    expect(edit.json().error.code).toBe('VERSION_NOT_DRAFT');
    // Original version untouched
    const original = (await owner.client.get(`/api/catalog/versions/${versionId}`)).json();
    expect(original.counts.subjects).toBe(231);
  });

  it('updates plan prices and limits with audit', async () => {
    const admin = await platformAdmin();
    const res = await admin.patch('/api/admin/plans/starter', { priceMonthlyCents: 120_000 });
    expect(res.statusCode).toBe(200);
    expect((await h.app.inject({ method: 'GET', url: '/api/billing/plans' })).json().plans.find((p: { id: string }) => p.id === 'starter').priceMonthlyCents).toBe(120_000);
    await admin.patch('/api/admin/plans/starter', { priceMonthlyCents: 99_000 });
    const log = (await admin.get('/api/admin/audit-logs?action=admin.plan')).json().entries;
    expect(log).toHaveLength(2);
    expect((await admin.patch('/api/admin/plans/free', { active: false })).statusCode).toBe(400);
  });
});

describe('public API (API keys)', () => {
  it('requires a plan with API access, authenticates by key, meters usage and honours revocation', async () => {
    const owner = await signUp(h);
    const versionId = await publishedVersionId(h);
    const scope = (await owner.client.post(`/api/orgs/${owner.orgId}/scopes`, { name: 'API scope', catalogVersionId: versionId })).json().scope;
    await owner.client.post(`/api/orgs/${owner.orgId}/scopes/${scope.id}/items`, { add: await someMaterialIds(h, versionId, 4) });

    const created = await owner.client.post(`/api/orgs/${owner.orgId}/api-keys`, { name: 'Content pipeline' });
    expect(created.statusCode).toBe(201);
    const key: string = created.json().key;
    expect(key).toMatch(/^cs_live_/);
    const listed = (await owner.client.get(`/api/orgs/${owner.orgId}/api-keys`)).json().apiKeys;
    expect(JSON.stringify(listed)).not.toContain(key); // shown once only

    const auth = { authorization: `Bearer ${key}` };
    expect((await h.app.inject({ method: 'GET', url: '/api/v1/scopes' })).statusCode).toBe(401);
    expect((await h.app.inject({ method: 'GET', url: '/api/v1/scopes', headers: { authorization: 'Bearer cs_live_' + 'x'.repeat(43) } })).statusCode).toBe(401);
    const list = await h.app.inject({ method: 'GET', url: '/api/v1/scopes', headers: auth });
    expect(list.json().scopes).toHaveLength(1);
    const exp = await h.app.inject({ method: 'GET', url: `/api/v1/scopes/${scope.id}`, headers: auth });
    expect(exp.json().itemCount).toBe(4);
    const usage = (await owner.client.get(`/api/orgs/${owner.orgId}`)).json().usage;
    expect(usage.api_requests).toBe(2);

    // Another tenant's scope id is not reachable with this key.
    const other = await signUp(h);
    const otherScope = (await other.client.post(`/api/orgs/${other.orgId}/scopes`, { name: 'Theirs', catalogVersionId: versionId })).json().scope;
    expect((await h.app.inject({ method: 'GET', url: `/api/v1/scopes/${otherScope.id}`, headers: auth })).statusCode).toBe(404);

    // Downgrade removes API access.
    await withSystemContext(h.ownerDb, (trx) => trx.updateTable('subscriptions').set({ plan_id: 'starter', status: 'active', trial_ends_at: null, current_period_end: new Date(Date.now() + 86_400_000) }).where('org_id', '=', owner.orgId).execute());
    expect((await h.app.inject({ method: 'GET', url: '/api/v1/scopes', headers: auth })).statusCode).toBe(402);
    await withSystemContext(h.ownerDb, (trx) => trx.updateTable('subscriptions').set({ plan_id: 'professional' }).where('org_id', '=', owner.orgId).execute());

    await owner.client.delete(`/api/orgs/${owner.orgId}/api-keys/${created.json().apiKey.id}`);
    expect((await h.app.inject({ method: 'GET', url: '/api/v1/scopes', headers: auth })).statusCode).toBe(401);
  });
});

describe('operations', () => {
  it('health and readiness endpoints', async () => {
    const live = await h.app.inject({ method: 'GET', url: '/healthz' });
    expect(live.json().status).toBe('ok');
    const ready = await h.app.inject({ method: 'GET', url: '/readyz' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json().checks).toMatchObject({ database: { status: 'ok' }, migrations: { status: 'ok' } });
  });

  it('sets security headers and a strict CSP', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/healthz' });
    expect(res.headers['content-security-policy']).toContain("script-src 'self'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  it('never leaks internals in error responses', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/does-not-exist' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Not found' } });
  });

  it('worker delivers queued email, retries failures with backoff, and redacts bodies after sending', async () => {
    await signUp(h);
    const sent: string[] = [];
    const r1 = await processOutbox(h.db, { send: async (m) => void sent.push(m.to) });
    expect(r1.sent).toBeGreaterThan(0);
    const rows = await h.ownerDb.selectFrom('email_outbox').select(['status', 'text_body']).execute();
    expect(rows.every((r) => r.status === 'sent' && r.text_body === '[redacted after delivery]')).toBe(true);

    await h.ownerDb.insertInto('email_outbox').values({ to_email: 'x@example.test', template: 't', subject: 's', text_body: 'b' }).execute();
    const r2 = await processOutbox(h.db, { send: async () => { throw new Error('SMTP down'); } });
    expect(r2.failed).toBe(1);
    const failed = await h.ownerDb.selectFrom('email_outbox').selectAll().where('to_email', '=', 'x@example.test').executeTakeFirstOrThrow();
    expect(failed).toMatchObject({ status: 'pending', attempts: 1, last_error: 'SMTP down' });
    expect(failed.send_after.getTime()).toBeGreaterThan(Date.now());
  });

  it('cleanup applies retention and heartbeat is visible to admins', async () => {
    const owner = await signUp(h);
    await h.ownerDb.updateTable('sessions').set({ expires_at: new Date(Date.now() - 1000) }).execute();
    const res = await runCleanup(h.db, h.config);
    expect(res.sessions).toBeGreaterThan(0);
    expect((await owner.client.get('/api/auth/me')).statusCode).toBe(401);
    await heartbeat(h.db, 'worker', { ok: true });
    const admin = await platformAdmin();
    const health = (await admin.get('/api/admin/health')).json();
    expect(health.workers[0]).toMatchObject({ name: 'worker' });
    expect(health.database.ok).toBe(true);
  });
});
