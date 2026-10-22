import { authenticator } from 'otplib';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client, createHarness, PASSWORD, resetData, signUp, totp, type Harness } from '../helpers/harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness({ RATE_LIMIT_ENABLED: 'false' });
});
afterAll(async () => h.close());
beforeEach(async () => resetData(h.ownerDb));

const RANDOM_ID = '7d3c6c1e-9a39-4f0b-8f43-0d1f7c2b9a11';
const fill = (url: string, orgId?: string) => url.replace(':orgId', orgId ?? RANDOM_ID).replace(/:\w+/g, RANDOM_ID);

// Every route outside /api/admin, /api/orgs/:orgId and /api/v1 must be listed
// here deliberately. A new route that is not added fails this test until reviewed.
const PUBLIC_OR_SELF: string[] = [
  'GET /healthz', 'GET /readyz',
  'POST /api/auth/register', 'POST /api/auth/verify-email', 'POST /api/auth/resend-verification', 'POST /api/auth/login',
  'POST /api/auth/mfa/verify', 'POST /api/auth/logout', 'POST /api/auth/logout-others', 'GET /api/auth/me',
  'POST /api/auth/password/forgot', 'POST /api/auth/password/reset', 'POST /api/auth/password/change', 'PATCH /api/auth/profile',
  'GET /api/auth/sessions', 'DELETE /api/auth/sessions/:id', 'GET /api/auth/account/export', 'DELETE /api/auth/account', 'POST /api/auth/mfa/setup', 'POST /api/auth/mfa/enable',
  'POST /api/auth/mfa/disable', 'POST /api/auth/mfa/recovery-codes', 'GET /api/invitations/:token', 'POST /api/invitations/accept',
  'GET /api/notifications', 'POST /api/notifications/read', 'POST /api/orgs', 'GET /api/catalog/versions', 'GET /api/catalog/versions/:id',
  'GET /api/billing/plans', 'POST /api/billing/webhooks/:provider', 'GET /api/billing/sandbox/checkout', 'POST /api/billing/sandbox/complete',
];

describe('authorization coverage (all registered routes)', () => {
  const routes = () => h.app.routeList.filter((r) => r.url.startsWith('/api/') || r.url.startsWith('/health') || r.url.startsWith('/ready'));

  it('every route is either admin-only, org-scoped, API-key-only, or explicitly allow-listed', () => {
    const unknown = routes()
      .filter((r) => !r.url.startsWith('/api/admin/') && !r.url.startsWith('/api/orgs/:orgId') && !r.url.startsWith('/api/v1/'))
      .map((r) => `${r.method} ${r.url}`)
      .filter((k) => !PUBLIC_OR_SELF.includes(k));
    expect(unknown).toEqual([]);
  });

  it('admin routes: 401 when anonymous, 404 for ordinary users (surface not disclosed)', async () => {
    const user = await signUp(h);
    const admin = routes().filter((r) => r.url.startsWith('/api/admin/'));
    expect(admin.length).toBeGreaterThan(25);
    for (const r of admin) {
      const url = fill(r.url);
      const anon = await h.app.inject({ method: r.method as 'GET', url, headers: r.method === 'GET' ? {} : { 'content-type': 'application/json' }, payload: r.method === 'GET' ? undefined : '{}' });
      expect(anon.statusCode, `anonymous ${r.method} ${r.url}`).toBe(401);
      const res = await user.client.request(r.method as 'GET', url, r.method === 'GET' ? undefined : {});
      expect(res.statusCode, `user ${r.method} ${r.url}`).toBe(404);
    }
  });

  it('org routes: 401 when anonymous, 404 for members of another organization', async () => {
    const victim = await signUp(h, { org: 'Victim' });
    const attacker = await signUp(h, { org: 'Attacker' });
    const orgRoutes = routes().filter((r) => r.url.startsWith('/api/orgs/:orgId'));
    expect(orgRoutes.length).toBeGreaterThan(30);
    for (const r of orgRoutes) {
      const url = fill(r.url, victim.orgId);
      const anon = await h.app.inject({ method: r.method as 'GET', url, headers: r.method === 'GET' ? {} : { 'content-type': 'application/json' }, payload: r.method === 'GET' ? undefined : '{}' });
      expect([401, 400], `anonymous ${r.method} ${r.url}`).toContain(anon.statusCode);
      const res = await attacker.client.request(r.method as 'GET', url, r.method === 'GET' ? undefined : {});
      expect([404, 400], `attacker ${r.method} ${r.url}`).toContain(res.statusCode);
      // 400 is only acceptable when request validation fails before any data access.
      if (res.statusCode === 400) expect(res.json().error.code, `${r.method} ${r.url}`).toBe('VALIDATION_ERROR');
    }
  });

  it('public API routes require an API key', async () => {
    for (const r of routes().filter((x) => x.url.startsWith('/api/v1/') && !x.url.endsWith('*'))) {
      const res = await h.app.inject({ method: r.method as 'GET', url: fill(r.url) });
      expect(res.statusCode, `${r.method} ${r.url}`).toBe(401);
    }
  });
});

describe('second-factor brute force', () => {
  it('locks the account after repeated wrong codes and ends the pending session', async () => {
    const { client, email } = await signUp(h);
    const setup = (await client.post('/api/auth/mfa/setup')).json();
    await client.post('/api/auth/mfa/enable', { code: totp(setup.secret) });
    const c = new Client(h.app);
    await c.post('/api/auth/login', { email, password: PASSWORD });
    await c.refresh();
    const wrong = String((Number(authenticator.generate(setup.secret)) + 500_000) % 1_000_000).padStart(6, '0');
    for (let i = 0; i < 5; i++) expect((await c.post('/api/auth/mfa/verify', { code: wrong })).statusCode).toBe(401);
    // Pending session is gone and the password alone no longer works during the lockout.
    expect((await c.post('/api/auth/mfa/verify', { code: totp(setup.secret) })).statusCode).toBe(401);
    const again = await new Client(h.app).post('/api/auth/login', { email, password: PASSWORD });
    expect(again.json().error.code).toBe('INVALID_CREDENTIALS');
  });
});
