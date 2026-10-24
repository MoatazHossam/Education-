import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withSystemContext } from '../../src/db/index.js';
import { addMember, createHarness, publishedVersionId, resetData, signUp, someMaterialIds, type Harness } from '../helpers/harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());
beforeEach(async () => resetData(h.ownerDb));

async function setPlan(orgId: string, planId: string) {
  await withSystemContext(h.ownerDb, (trx) =>
    trx.updateTable('subscriptions').set({ plan_id: planId, status: 'active', trial_ends_at: null, current_period_start: new Date(), current_period_end: planId === 'free' ? null : new Date(Date.now() + 30 * 86_400_000) }).where('org_id', '=', orgId).execute(),
  );
}

describe('catalogue API', () => {
  it('serves the published 2026/2027 catalogue with ETag caching', async () => {
    const { client } = await signUp(h);
    const versions = (await client.get('/api/catalog/versions')).json().versions;
    expect(versions[0].academicYear).toBe('2026/2027');
    const res = await client.get(`/api/catalog/versions/${versions[0].id}`);
    expect(res.statusCode).toBe(200);
    const tree = res.json();
    expect(tree.counts).toMatchObject({ subjects: 231, materials: 1038, verification: { subjectsVerified: 0, materialsVerified: 0 } });
    expect(tree.grades).toHaveLength(12);
    expect(tree.sources).toHaveLength(10);
    expect(tree.version.gradeNotes['10']).toMatch(/Bakaloria/);
    const again = await client.get(`/api/catalog/versions/${versions[0].id}`, { 'if-none-match': res.headers.etag as string });
    expect(again.statusCode).toBe(304);
  });

  it('requires authentication', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/catalog/versions' });
    expect(res.statusCode).toBe(401);
  });
});

describe('content scopes (persisted selections)', () => {
  it('creates a scope, toggles materials in batches, and persists across sessions', async () => {
    const owner = await signUp(h);
    const versionId = await publishedVersionId(h);
    const create = await owner.client.post(`/api/orgs/${owner.orgId}/scopes`, { name: 'Grade 4 science', description: 'Pilot', catalogVersionId: versionId });
    expect(create.statusCode).toBe(201);
    const scopeId = create.json().scope.id;
    const mats = await someMaterialIds(h, versionId, 12);

    const add = await owner.client.post(`/api/orgs/${owner.orgId}/scopes/${scopeId}/items`, { add: mats });
    expect(add.json().itemCount).toBe(12);
    // idempotent re-add, partial removal
    const upd = await owner.client.post(`/api/orgs/${owner.orgId}/scopes/${scopeId}/items`, { add: mats.slice(0, 3), remove: mats.slice(10) });
    expect(upd.json().itemCount).toBe(10);

    const editor = await addMember(h, owner.client, owner.orgId, 'editor');
    const read = await editor.client.get(`/api/orgs/${owner.orgId}/scopes/${scopeId}`);
    expect(read.json().materialIds.sort()).toEqual(mats.slice(0, 10).sort());

    const list = (await owner.client.get(`/api/orgs/${owner.orgId}/scopes`)).json();
    expect(list.scopes[0]).toMatchObject({ name: 'Grade 4 science', itemCount: 10, academicYear: '2026/2027', readOnly: false });

    expect((await owner.client.delete(`/api/orgs/${owner.orgId}/scopes/${scopeId}/items`)).json().itemCount).toBe(0);
  });

  it('rejects materials from another catalogue version or unknown ids', async () => {
    const owner = await signUp(h);
    const versionId = await publishedVersionId(h);
    const scopeId = (await owner.client.post(`/api/orgs/${owner.orgId}/scopes`, { name: 'S', catalogVersionId: versionId })).json().scope.id;
    const res = await owner.client.post(`/api/orgs/${owner.orgId}/scopes/${scopeId}/items`, { add: ['00000000-0000-4000-8000-000000000000'] });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_MATERIALS');
  });

  it('enforces unique names per organization and draft-version restrictions', async () => {
    const owner = await signUp(h);
    const versionId = await publishedVersionId(h);
    await owner.client.post(`/api/orgs/${owner.orgId}/scopes`, { name: 'Dup', catalogVersionId: versionId });
    const dup = await owner.client.post(`/api/orgs/${owner.orgId}/scopes`, { name: 'Dup', catalogVersionId: versionId });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('SCOPE_NAME_TAKEN');
    const draft = await h.ownerDb.insertInto('catalog_versions').values({ academic_year: '2027/2028', label: 'Draft', status: 'draft' }).returning('id').executeTakeFirstOrThrow();
    expect((await owner.client.post(`/api/orgs/${owner.orgId}/scopes`, { name: 'On draft', catalogVersionId: draft.id })).statusCode).toBe(400);
  });

  it('duplicates a scope with its items', async () => {
    const owner = await signUp(h);
    const versionId = await publishedVersionId(h);
    const id = (await owner.client.post(`/api/orgs/${owner.orgId}/scopes`, { name: 'Original', catalogVersionId: versionId })).json().scope.id;
    await owner.client.post(`/api/orgs/${owner.orgId}/scopes/${id}/items`, { add: await someMaterialIds(h, versionId, 7) });
    const copy = await owner.client.post(`/api/orgs/${owner.orgId}/scopes/${id}/duplicate`, { name: 'Copy' });
    expect(copy.statusCode).toBe(201);
    expect((await owner.client.get(`/api/orgs/${owner.orgId}/scopes/${copy.json().scope.id}`)).json().materialIds).toHaveLength(7);
  });
});

describe('exports and plan gating', () => {
  async function scopeWithItems() {
    const owner = await signUp(h);
    const versionId = await publishedVersionId(h);
    const id = (await owner.client.post(`/api/orgs/${owner.orgId}/scopes`, { name: 'Export me', catalogVersionId: versionId })).json().scope.id;
    // first two grade-1 Arabic materials
    const mats = await h.ownerDb
      .selectFrom('catalog_materials as m')
      .innerJoin('catalog_subjects as s', 's.id', 'm.subject_id')
      .select('m.id')
      .where('m.version_id', '=', versionId)
      .where('s.grade', '=', 1)
      .where('s.code', '=', 'ar')
      .where('s.track', '=', 'moe')
      .orderBy('m.sort_order')
      .limit(2)
      .execute();
    await owner.client.post(`/api/orgs/${owner.orgId}/scopes/${id}/items`, { add: mats.map((m) => m.id) });
    return { owner, id };
  }

  it('exports text in the original list format, CSV and JSON during the trial', async () => {
    const { owner, id } = await scopeWithItems();
    const txt = await owner.client.get(`/api/orgs/${owner.orgId}/scopes/${id}/export?format=txt`);
    expect(txt.statusCode).toBe(200);
    expect(txt.headers['content-disposition']).toMatch(/attachment; filename="Export-me-2026-2027.txt"/);
    expect(txt.body).toBe(
      'Primary 1 / الصف الأول الابتدائي\n  • Ministry schools — Arabic, official language, private Arabic & language — Arabic Language\n      - Ministry textbook (Term 1 & Term 2)\n      - Ministry assessments book (weekly tests)',
    );
    const csv = await owner.client.get(`/api/orgs/${owner.orgId}/scopes/${id}/export?format=csv`);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.body.split('\r\n').filter(Boolean)).toHaveLength(3);
    const json = await owner.client.get(`/api/orgs/${owner.orgId}/scopes/${id}/export?format=json`);
    expect(json.json()).toMatchObject({ itemCount: 2, catalogVersion: { academicYear: '2026/2027' } });
  });

  it('Free plan: text export only, monthly export quota, one scope', async () => {
    const { owner, id } = await scopeWithItems();
    await setPlan(owner.orgId, 'free');
    const csv = await owner.client.get(`/api/orgs/${owner.orgId}/scopes/${id}/export?format=csv`);
    expect(csv.statusCode).toBe(402);
    expect(csv.json().error.code).toBe('FEATURE_NOT_IN_PLAN');
    for (let i = 0; i < 5; i++) expect((await owner.client.get(`/api/orgs/${owner.orgId}/scopes/${id}/export`)).statusCode).toBe(200);
    const over = await owner.client.get(`/api/orgs/${owner.orgId}/scopes/${id}/export`);
    expect(over.statusCode).toBe(402);
    expect(over.json().error.code).toBe('PLAN_LIMIT_REACHED');

    const versionId = await publishedVersionId(h);
    const second = await owner.client.post(`/api/orgs/${owner.orgId}/scopes`, { name: 'Second', catalogVersionId: versionId });
    expect(second.statusCode).toBe(402);
    expect(second.json().error.details).toMatchObject({ limit: 'max_scopes', max: 1 });
  });

  it('after a downgrade, scopes beyond the limit become read-only but are not deleted', async () => {
    const owner = await signUp(h);
    const versionId = await publishedVersionId(h);
    const s1 = (await owner.client.post(`/api/orgs/${owner.orgId}/scopes`, { name: 'Oldest', catalogVersionId: versionId })).json().scope.id;
    const s2 = (await owner.client.post(`/api/orgs/${owner.orgId}/scopes`, { name: 'Newer', catalogVersionId: versionId })).json().scope.id;
    await setPlan(owner.orgId, 'free');
    const mats = await someMaterialIds(h, versionId, 1);
    expect((await owner.client.post(`/api/orgs/${owner.orgId}/scopes/${s1}/items`, { add: mats })).statusCode).toBe(200);
    const blocked = await owner.client.post(`/api/orgs/${owner.orgId}/scopes/${s2}/items`, { add: mats });
    expect(blocked.statusCode).toBe(402);
    const list = (await owner.client.get(`/api/orgs/${owner.orgId}/scopes`)).json();
    expect(list.scopes.map((s: { readOnly: boolean }) => s.readOnly)).toEqual([false, true]);
    expect((await owner.client.get(`/api/orgs/${owner.orgId}/scopes/${s2}`)).statusCode).toBe(200);
  });

  it('member limit counts pending invitations and is enforced under concurrency', async () => {
    const owner = await signUp(h);
    await setPlan(owner.orgId, 'free'); // 2 members max
    const results = await Promise.all(
      ['a', 'b', 'c'].map((x) => owner.client.post(`/api/orgs/${owner.orgId}/invitations`, { email: `${x}@seat.test`, role: 'viewer' })),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 402, 402]);
  });
});
