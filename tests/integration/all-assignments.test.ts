import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withSystemContext } from '../../src/db/index.js';
import { addMember, Client, createHarness, createStudent, distinctTitleMaterialIds, enableStudents, publishedVersionId, resetData, signUp, studentLogin, type Harness } from '../helpers/harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness({ RATE_LIMIT_ENABLED: 'false' });
});
afterAll(async () => h.close());
beforeEach(async () => resetData(h.ownerDb));

/** An organization with a scope of four books. */
async function org(name: string) {
  const owner = await signUp(h, { org: name, name: `Owner of ${name}` });
  const versionId = await publishedVersionId(h);
  const books = await distinctTitleMaterialIds(h, versionId, 4);
  const scopeId = (await owner.client.post(`/api/orgs/${owner.orgId}/scopes`, { name: `${name} plan`, catalogVersionId: versionId })).json().scope.id as string;
  expect((await owner.client.post(`/api/orgs/${owner.orgId}/scopes/${scopeId}/items`, { add: books })).statusCode).toBe(200);
  const base = `/api/orgs/${owner.orgId}/scopes/${scopeId}`;
  const track = async (book: string, body: Record<string, unknown>) => {
    const res = await owner.client.patch(`${base}/items/${book}`, body);
    expect(res.statusCode, res.body).toBe(200);
  };
  return { owner, books, scopeId, base, track };
}

/** Adds an existing account to another organization (as accepting an invitation would). */
const join = (orgId: string, userId: string, role: 'admin' | 'editor' | 'viewer') =>
  withSystemContext(h.ownerDb, (trx) => trx.insertInto('memberships').values({ org_id: orgId, user_id: userId, role }).execute());

describe('My assignments across all organizations', () => {
  it('lists the member’s books from every organization in one order, with counts per organization and in total', async () => {
    const alpha = await org('Alpha School');
    const hana = await addMember(h, alpha.owner.client, alpha.owner.orgId, 'editor');
    const beta = await org('Beta School');
    await join(beta.owner.orgId, hana.userId, 'viewer');

    await alpha.track(alpha.books[0]!, { assigneeId: hana.userId, dueOn: '2100-01-10' });
    await alpha.track(alpha.books[1]!, { assigneeId: hana.userId });
    await alpha.track(alpha.books[2]!, { assigneeId: hana.userId, dueOn: '2000-01-05', status: 'in_progress' });
    await alpha.track(alpha.books[3]!, { assigneeId: hana.userId, status: 'done' });
    await beta.track(beta.books[0]!, { assigneeId: hana.userId, dueOn: '2100-01-01', note: 'Other school' });
    // Someone else's book in Beta is not Hana's.
    await beta.track(beta.books[1]!, { assigneeId: beta.owner.userId, dueOn: '2000-01-01' });

    const res = await hana.client.get('/api/assignments');
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.items.map((i: { orgName: string; materialId: string }) => [i.orgName, i.materialId])).toEqual([
      ['Alpha School', alpha.books[2]], ['Beta School', beta.books[0]], ['Alpha School', alpha.books[0]], ['Alpha School', alpha.books[1]],
    ]);
    expect(body.items[0]).toMatchObject({ orgId: alpha.owner.orgId, scopeId: alpha.scopeId, scopeName: 'Alpha School plan', overdue: true, status: 'in_progress', readOnly: false });
    expect(body.items[1]).toMatchObject({ orgId: beta.owner.orgId, note: 'Other school', overdue: false });
    expect(body.counts).toEqual({ open: 4, overdue: 1, dueSoon: 0 });
    expect(body.organizations).toEqual([
      { id: alpha.owner.orgId, name: 'Alpha School', open: 3, overdue: 1, dueSoon: 0 },
      { id: beta.owner.orgId, name: 'Beta School', open: 1, overdue: 0, dueSoon: 0 },
    ]);
    expect(body.unavailable).toEqual([]);

    const done = (await hana.client.get('/api/assignments?show=done')).json().items;
    expect(done.map((i: { materialId: string }) => i.materialId)).toEqual([alpha.books[3]]);
    expect((await hana.client.get('/api/assignments?show=all')).json().items).toHaveLength(5);
    expect((await hana.client.get('/api/assignments?show=everything')).statusCode).toBe(400);

    // The Beta owner sees only their own book, and nothing of Alpha.
    const betaOwner = (await beta.owner.client.get('/api/assignments')).json();
    expect(betaOwner.items.map((i: { materialId: string; orgId: string }) => [i.orgId, i.materialId])).toEqual([[beta.owner.orgId, beta.books[1]]]);
    expect(betaOwner.organizations.map((o: { name: string }) => o.name)).toEqual(['Beta School']);
  });

  it('the member updates a book’s status through its own organization, even as a viewer there', async () => {
    const alpha = await org('Alpha School');
    const hana = await addMember(h, alpha.owner.client, alpha.owner.orgId, 'viewer');
    const beta = await org('Beta School');
    await join(beta.owner.orgId, hana.userId, 'viewer');
    await beta.track(beta.books[0]!, { assigneeId: hana.userId });
    const [item] = (await hana.client.get('/api/assignments')).json().items;
    expect((await hana.client.patch(`/api/orgs/${item.orgId}/scopes/${item.scopeId}/items/${item.materialId}`, { status: 'done' })).statusCode).toBe(200);
    expect((await hana.client.get('/api/assignments')).json().items).toEqual([]);
    expect((await hana.client.get('/api/assignments?show=done')).json().items).toHaveLength(1);
  });

  it('suspended organizations, and ones asking this member for two-factor sign-in, are listed as unavailable and not read', async () => {
    const alpha = await org('Alpha School');
    const hana = await addMember(h, alpha.owner.client, alpha.owner.orgId, 'editor');
    const beta = await org('Beta School');
    const gamma = await org('Gamma School');
    await join(beta.owner.orgId, hana.userId, 'viewer');
    await join(gamma.owner.orgId, hana.userId, 'admin');
    for (const o of [alpha, beta, gamma]) await o.track(o.books[0]!, { assigneeId: hana.userId });
    await h.ownerDb.updateTable('organizations').set({ status: 'suspended' }).where('id', '=', beta.owner.orgId).execute();
    await h.ownerDb.updateTable('organizations').set({ require_mfa_for_admins: true }).where('id', '=', gamma.owner.orgId).execute();

    const body = (await hana.client.get('/api/assignments')).json();
    expect(body.items.map((i: { orgName: string }) => i.orgName)).toEqual(['Alpha School']);
    expect(body.organizations.map((o: { name: string }) => o.name)).toEqual(['Alpha School']);
    expect(body.unavailable).toEqual([
      { id: beta.owner.orgId, name: 'Beta School', reason: 'ORG_SUSPENDED' },
      { id: gamma.owner.orgId, name: 'Gamma School', reason: 'MFA_REQUIRED_BY_ORG' },
    ]);
    expect(body.counts).toEqual({ open: 1, overdue: 0, dueSoon: 0 });
  });

  it('a member of one organization gets the same books as on its own page; signed-out callers and students are refused', async () => {
    const alpha = await org('Alpha School');
    await alpha.track(alpha.books[0]!, { assigneeId: alpha.owner.userId, dueOn: '2100-01-10' });
    const all = (await alpha.owner.client.get('/api/assignments')).json();
    const own = (await alpha.owner.client.get(`/api/orgs/${alpha.owner.orgId}/assignments`)).json();
    expect(all.items.map(({ orgId: _o, orgName: _n, ...rest }: Record<string, unknown>) => rest)).toEqual(own.items);

    expect((await new Client(h.app).get('/api/assignments')).statusCode).toBe(401);
    await enableStudents(h, alpha.owner.orgId);
    const student = await studentLogin(h, await createStudent(h, alpha.owner.client, alpha.owner.orgId));
    const res = await student.get('/api/assignments');
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('STAFF_ONLY');
  });
});
