import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withOrgContext, withSystemContext } from '../../src/db/index.js';
import { addMember, Client, createHarness, publishedVersionId, resetData, signUp, someMaterialIds, type Harness } from '../helpers/harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());
beforeEach(async () => resetData(h.ownerDb));

async function twoTenants() {
  const a = await signUp(h, { org: 'Tenant A' });
  const b = await signUp(h, { org: 'Tenant B' });
  const versionId = await publishedVersionId(h);
  const scopeA = (await a.client.post(`/api/orgs/${a.orgId}/scopes`, { name: 'A scope', catalogVersionId: versionId })).json().scope;
  const mats = await someMaterialIds(h, versionId, 5);
  await a.client.post(`/api/orgs/${a.orgId}/scopes/${scopeA.id}/items`, { add: mats });
  return { a, b, versionId, scopeA, mats };
}

describe('cross-tenant isolation over the API', () => {
  it('a member of org B cannot read, modify, export or delete org A data', async () => {
    const { a, b, scopeA } = await twoTenants();
    const urls = [
      `/api/orgs/${a.orgId}`,
      `/api/orgs/${a.orgId}/scopes`,
      `/api/orgs/${a.orgId}/scopes/${scopeA.id}`,
      `/api/orgs/${a.orgId}/scopes/${scopeA.id}/export`,
      `/api/orgs/${a.orgId}/members`,
      `/api/orgs/${a.orgId}/billing`,
      `/api/orgs/${a.orgId}/audit-logs`,
    ];
    for (const url of urls) {
      const res = await b.client.get(url);
      expect(res.statusCode, url).toBe(404); // existence is not disclosed
    }
    expect((await b.client.post(`/api/orgs/${a.orgId}/scopes/${scopeA.id}/items`, { remove: [] , add: [] })).statusCode).toBeGreaterThanOrEqual(400);
    expect((await b.client.delete(`/api/orgs/${a.orgId}/scopes/${scopeA.id}`)).statusCode).toBe(404);
    expect((await b.client.post(`/api/orgs/${a.orgId}/invitations`, { email: 'x@example.test', role: 'admin' })).statusCode).toBe(404);
  });

  it('object ids from another tenant are rejected even under the attacker’s own org (BOLA)', async () => {
    const { b, scopeA } = await twoTenants();
    // Org B's own URL with org A's scope id.
    expect((await b.client.get(`/api/orgs/${b.orgId}/scopes/${scopeA.id}`)).statusCode).toBe(404);
    expect((await b.client.patch(`/api/orgs/${b.orgId}/scopes/${scopeA.id}`, { name: 'pwned' })).statusCode).toBe(404);
    expect((await b.client.delete(`/api/orgs/${b.orgId}/scopes/${scopeA.id}`)).statusCode).toBe(404);
    expect((await b.client.get(`/api/orgs/${b.orgId}/scopes/${scopeA.id}/export`)).statusCode).toBe(404);
    expect((await b.client.post(`/api/orgs/${b.orgId}/scopes/${scopeA.id}/duplicate`, { name: 'copy' })).statusCode).toBe(404);
  });

  it('rejects malformed org ids without leaking errors', async () => {
    const { b } = await twoTenants();
    expect((await b.client.get(`/api/orgs/not-a-uuid/scopes`)).statusCode).toBe(404);
    expect((await b.client.get(`/api/orgs/' OR 1=1 --/scopes`)).statusCode).toBe(404);
  });
});

describe('Row-Level Security (database layer)', () => {
  it('every table with an org_id column has forced RLS, apart from the documented exceptions', async () => {
    // billing_events: system-only webhook receipts; notifications: scoped by user_id (DATABASE_DESIGN.md).
    const { rows } = await sql<{ relname: string; rls: boolean; forced: boolean }>`
      SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced
      FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'org_id' AND NOT a.attisdropped
      WHERE c.relkind = 'r' AND c.relnamespace = 'public'::regnamespace`.execute(h.ownerDb);
    const unprotected = rows.filter((r) => !(r.rls && r.forced)).map((r) => r.relname).sort();
    expect(unprotected).toEqual(['billing_events', 'notifications']);
    expect(rows.map((r) => r.relname)).toContain('checkout_sessions');
  });

  it('returns no tenant rows without a tenant context, even for an unscoped query', async () => {
    await twoTenants();
    const rows = await h.db.selectFrom('scopes').selectAll().execute();
    expect(rows).toHaveLength(0);
    expect(await h.db.selectFrom('scope_items').selectAll().execute()).toHaveLength(0);
    expect(await h.db.selectFrom('subscriptions').selectAll().execute()).toHaveLength(0);
  });

  it('only exposes the current tenant’s rows inside a tenant context', async () => {
    const { a, b } = await twoTenants();
    const seenByB = await withOrgContext(h.db, { orgId: b.orgId }, (trx) => trx.selectFrom('scopes').selectAll().execute());
    expect(seenByB).toHaveLength(0);
    const seenByA = await withOrgContext(h.db, { orgId: a.orgId }, (trx) => trx.selectFrom('scopes').selectAll().execute());
    expect(seenByA).toHaveLength(1);
    const all = await withSystemContext(h.db, (trx) => trx.selectFrom('scopes').selectAll().execute());
    expect(all).toHaveLength(1);
  });

  it('blocks writing rows for another tenant (WITH CHECK)', async () => {
    const { a, b, versionId } = await twoTenants();
    await expect(
      withOrgContext(h.db, { orgId: b.orgId }, (trx) => trx.insertInto('scopes').values({ org_id: a.orgId, catalog_version_id: versionId, name: 'smuggled' }).execute()),
    ).rejects.toThrow(/row-level security/);
    const updated = await withOrgContext(h.db, { orgId: b.orgId }, (trx) => trx.updateTable('scopes').set({ name: 'x' }).where('org_id', '=', a.orgId).executeTakeFirst());
    expect(Number(updated.numUpdatedRows)).toBe(0);
  });

  it('the application role cannot bypass RLS or rewrite audit history', async () => {
    const role = await sql<{ rolsuper: boolean; rolbypassrls: boolean }>`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`.execute(h.db);
    expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    await expect(withSystemContext(h.db, (trx) => sql`UPDATE audit_logs SET action = 'tampered'`.execute(trx))).rejects.toThrow(/permission denied/);
    await expect(sql`ALTER TABLE scopes DISABLE ROW LEVEL SECURITY`.execute(h.db)).rejects.toThrow(/must be owner/);
  });

  it('composite keys stop items pointing at another tenant’s scope or another catalogue version', async () => {
    const { a, b, scopeA, versionId } = await twoTenants();
    const mat = (await someMaterialIds(h, versionId, 1, 100))[0]!;
    await expect(
      withSystemContext(h.db, (trx) => trx.insertInto('scope_items').values({ scope_id: scopeA.id, org_id: b.orgId, catalog_version_id: versionId, material_id: mat }).execute()),
    ).rejects.toThrow(/foreign key/);
    void a;
  });
});

describe('roles and permissions', () => {
  it('enforces the permission matrix server-side', async () => {
    const owner = await signUp(h);
    const versionId = await publishedVersionId(h);
    const admin = await addMember(h, owner.client, owner.orgId, 'admin');
    const editor = await addMember(h, owner.client, owner.orgId, 'editor');
    const viewer = await addMember(h, owner.client, owner.orgId, 'viewer');
    const scope = (await editor.client.post(`/api/orgs/${owner.orgId}/scopes`, { name: 'Editor scope', catalogVersionId: versionId })).json().scope;
    expect(scope.id).toBeTruthy();

    // viewer: read and export only
    expect((await viewer.client.get(`/api/orgs/${owner.orgId}/scopes/${scope.id}`)).statusCode).toBe(200);
    expect((await viewer.client.get(`/api/orgs/${owner.orgId}/scopes/${scope.id}/export?format=txt`)).statusCode).toBe(200);
    expect((await viewer.client.post(`/api/orgs/${owner.orgId}/scopes`, { name: 'v', catalogVersionId: versionId })).statusCode).toBe(403);
    expect((await viewer.client.post(`/api/orgs/${owner.orgId}/scopes/${scope.id}/items`, { add: await someMaterialIds(h, versionId, 1) })).statusCode).toBe(403);
    expect((await viewer.client.get(`/api/orgs/${owner.orgId}/invitations`)).statusCode).toBe(403);

    // editor: cannot manage members or billing
    expect((await editor.client.post(`/api/orgs/${owner.orgId}/invitations`, { email: 'z@example.test', role: 'viewer' })).statusCode).toBe(403);
    expect((await editor.client.get(`/api/orgs/${owner.orgId}/billing`)).statusCode).toBe(403);

    // admin: manages editors/viewers, but not admins, owner or billing changes
    expect((await admin.client.patch(`/api/orgs/${owner.orgId}/members/${viewer.userId}`, { role: 'editor' })).statusCode).toBe(200);
    expect((await admin.client.patch(`/api/orgs/${owner.orgId}/members/${editor.userId}`, { role: 'admin' })).statusCode).toBe(403);
    expect((await admin.client.patch(`/api/orgs/${owner.orgId}/members/${owner.userId}`, { role: 'viewer' })).statusCode).toBe(403);
    expect((await admin.client.post(`/api/orgs/${owner.orgId}/invitations`, { email: 'adm@example.test', role: 'admin' })).statusCode).toBe(403);
    expect((await admin.client.post(`/api/orgs/${owner.orgId}/billing/checkout`, { planId: 'starter' })).statusCode).toBe(403);
    expect((await admin.client.get(`/api/orgs/${owner.orgId}/billing`)).statusCode).toBe(200);

    // nobody can grant themselves owner through role changes
    expect((await owner.client.patch(`/api/orgs/${owner.orgId}/members/${admin.userId}`, { role: 'owner' })).statusCode).toBe(400);
  });

  it('transfers ownership with password confirmation and keeps a single owner', async () => {
    const owner = await signUp(h);
    const admin = await addMember(h, owner.client, owner.orgId, 'admin');
    expect((await owner.client.post(`/api/orgs/${owner.orgId}/transfer-ownership`, { userId: admin.userId, password: 'wrong-password' })).statusCode).toBe(400);
    const res = await owner.client.post(`/api/orgs/${owner.orgId}/transfer-ownership`, { userId: admin.userId, password: 'correct-horse-battery-staple' });
    expect(res.statusCode).toBe(200);
    const members = (await admin.client.get(`/api/orgs/${owner.orgId}/members`)).json().members;
    expect(members.filter((m: { role: string }) => m.role === 'owner')).toHaveLength(1);
    expect(members.find((m: { userId: string }) => m.userId === admin.userId).role).toBe('owner');
    expect(members.find((m: { userId: string }) => m.userId === owner.userId).role).toBe('admin');
    // former owner lost billing rights
    expect((await owner.client.post(`/api/orgs/${owner.orgId}/billing/cancel`)).statusCode).toBe(403);
  });

  it('member removal rules: owner cannot be removed, members can leave, removed users lose access', async () => {
    const owner = await signUp(h);
    const admin = await addMember(h, owner.client, owner.orgId, 'admin');
    const editor = await addMember(h, owner.client, owner.orgId, 'editor');
    expect((await admin.client.delete(`/api/orgs/${owner.orgId}/members/${owner.userId}`)).statusCode).toBe(403);
    expect((await owner.client.delete(`/api/orgs/${owner.orgId}/members/${owner.userId}`)).statusCode).toBe(403);
    expect((await admin.client.delete(`/api/orgs/${owner.orgId}/members/${editor.userId}`)).statusCode).toBe(200);
    expect((await editor.client.get(`/api/orgs/${owner.orgId}`)).statusCode).toBe(404);
    expect((await admin.client.delete(`/api/orgs/${owner.orgId}/members/${admin.userId}`)).statusCode).toBe(200);
  });
});

describe('invitations', () => {
  it('existing users accept with their own account; email must match', async () => {
    const owner = await signUp(h, { org: 'Inviter' });
    const other = await signUp(h, { org: 'Their own org' });
    const inv = await owner.client.post(`/api/orgs/${owner.orgId}/invitations`, { email: other.email, role: 'editor' });
    expect(inv.statusCode).toBe(201);
    const { latestEmail, tokenFrom } = await import('../helpers/harness.js');
    const token = tokenFrom((await latestEmail(h, other.email, 'invitation'))!.text_body);

    const preview = await other.client.get(`/api/invitations/${token}`);
    expect(preview.json()).toMatchObject({ orgName: 'Inviter', role: 'editor', hasAccount: true });

    const stranger = await signUp(h);
    expect((await stranger.client.post('/api/invitations/accept', { token })).statusCode).toBe(403);
    expect((await other.client.post('/api/invitations/accept', { token })).statusCode).toBe(200);
    expect((await other.client.post('/api/invitations/accept', { token })).statusCode).toBe(400); // single use
    const me = (await other.client.get('/api/auth/me')).json();
    expect(me.organizations.map((o: { id: string }) => o.id)).toContain(owner.orgId);
  });

  it('revoked invitations cannot be used and duplicate members are refused', async () => {
    const owner = await signUp(h);
    const member = await addMember(h, owner.client, owner.orgId, 'viewer');
    expect((await owner.client.post(`/api/orgs/${owner.orgId}/invitations`, { email: member.email, role: 'viewer' })).json().error.code).toBe('ALREADY_MEMBER');
    const inv = (await owner.client.post(`/api/orgs/${owner.orgId}/invitations`, { email: 'later@example.test', role: 'viewer' })).json().invitation;
    expect((await owner.client.delete(`/api/orgs/${owner.orgId}/invitations/${inv.id}`)).statusCode).toBe(200);
    const { latestEmail, tokenFrom, Client, PASSWORD } = await import('../helpers/harness.js');
    const token = tokenFrom((await latestEmail(h, 'later@example.test', 'invitation'))!.text_body);
    const c = new Client(h.app);
    const reg = await c.post('/api/auth/register', { name: 'Late', email: 'later@example.test', password: PASSWORD, inviteToken: token });
    expect(reg.statusCode).toBe(400);
    expect(reg.json().error.code).toBe('INVITATION_INVALID');
  });
});

describe('data deletion and export', () => {
  it('owner deletes an organization: its data is gone, other tenants untouched, audit retained', async () => {
    const a = await signUp(h, { org: 'Doomed Org' });
    const b = await signUp(h, { org: 'Survivor Org' });
    const versionId = await publishedVersionId(h);
    for (const t of [a, b]) {
      const s = (await t.client.post(`/api/orgs/${t.orgId}/scopes`, { name: 'S', catalogVersionId: versionId })).json().scope;
      await t.client.post(`/api/orgs/${t.orgId}/scopes/${s.id}/items`, { add: await someMaterialIds(h, versionId, 3) });
    }
    const editor = await addMember(h, a.client, a.orgId, 'editor');
    expect((await editor.client.delete(`/api/orgs/${a.orgId}`)).statusCode).toBe(400);
    expect((await a.client.request('DELETE', `/api/orgs/${a.orgId}`, { password: 'correct-horse-battery-staple', confirmName: 'wrong' })).json().error.code).toBe('CONFIRMATION_MISMATCH');
    expect((await editor.client.request('DELETE', `/api/orgs/${a.orgId}`, { password: 'correct-horse-battery-staple', confirmName: 'Doomed Org' })).statusCode).toBe(403);
    const res = await a.client.request('DELETE', `/api/orgs/${a.orgId}`, { password: 'correct-horse-battery-staple', confirmName: 'Doomed Org' });
    expect(res.statusCode).toBe(200);

    const left = await withSystemContext(h.ownerDb, async (trx) => ({
      scopes: await trx.selectFrom('scopes').select('org_id').execute(),
      items: await trx.selectFrom('scope_items').select('org_id').execute(),
      subs: await trx.selectFrom('subscriptions').select('org_id').execute(),
      audit: await trx.selectFrom('audit_logs').select('action').where('org_id', '=', a.orgId).where('action', '=', 'org.deleted').execute(),
    }));
    expect(new Set(left.scopes.map((r) => r.org_id))).toEqual(new Set([b.orgId]));
    expect(left.items.every((r) => r.org_id === b.orgId)).toBe(true);
    expect(left.subs.map((r) => r.org_id)).toEqual([b.orgId]);
    expect(left.audit).toHaveLength(1);
    expect((await editor.client.get(`/api/orgs/${a.orgId}`)).statusCode).toBe(404);
    expect((await b.client.get(`/api/orgs/${b.orgId}/scopes`)).json().scopes[0].itemCount).toBe(3);
  });

  it('a user can export their data and delete their account unless they own an organization', async () => {
    const owner = await signUp(h, { org: 'Keeps Going' });
    const member = await addMember(h, owner.client, owner.orgId, 'viewer');
    const exp = await member.client.get('/api/auth/account/export');
    expect(exp.statusCode).toBe(200);
    expect(exp.json()).toMatchObject({ profile: { email: member.email }, memberships: [{ organizationId: owner.orgId, role: 'viewer' }] });
    expect(JSON.stringify(exp.json())).not.toMatch(/password_hash|argon2/);

    const blocked = await owner.client.request('DELETE', '/api/auth/account', { password: 'correct-horse-battery-staple' });
    expect(blocked.json().error.code).toBe('OWNS_ORGANIZATIONS');
    expect((await member.client.request('DELETE', '/api/auth/account', { password: 'wrong' })).statusCode).toBe(400);
    expect((await member.client.request('DELETE', '/api/auth/account', { password: 'correct-horse-battery-staple' })).statusCode).toBe(200);
    expect((await member.client.get('/api/auth/me')).statusCode).toBe(401);
    const members = (await owner.client.get(`/api/orgs/${owner.orgId}/members`)).json().members;
    expect(members.map((m: { email: string }) => m.email)).not.toContain(member.email);
    const relogin = await new Client(h.app).post('/api/auth/login', { email: member.email, password: 'correct-horse-battery-staple' });
    expect(relogin.statusCode).toBe(401);
  });
});
