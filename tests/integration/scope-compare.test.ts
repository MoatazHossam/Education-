import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withSystemContext } from '../../src/db/index.js';
import { parseCsv } from '../../src/lib/csv.js';
import { addMember, createHarness, createPlatformAdmin, publishedVersionId, resetData, signUp, type Harness } from '../helpers/harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());
beforeEach(async () => resetData(h.ownerDb));

interface Material { id: string; title: string }
interface Subject { id: string; grade: number; track: string; block: string; code: string; materials: Material[] }
type Owner = Awaited<ReturnType<typeof signUp>>;
const treeOf = async (c: Owner['client'], versionId: string) => (await c.get(`/api/catalog/versions/${versionId}`)).json() as { subjects: Subject[] };

async function scopeWith(owner: Owner, name: string, versionId: string, materialIds: string[]) {
  const scope = (await owner.client.post(`/api/orgs/${owner.orgId}/scopes`, { name, catalogVersionId: versionId })).json().scope as { id: string };
  if (materialIds.length) expect((await owner.client.post(`/api/orgs/${owner.orgId}/scopes/${scope.id}/items`, { add: materialIds })).statusCode).toBe(200);
  return scope.id;
}
const compare = (owner: Owner, a: string, b: string, format = '') => owner.client.get(`/api/orgs/${owner.orgId}/scopes/compare?a=${a}&b=${b}${format ? `&format=${format}` : ''}`);
async function setPlan(orgId: string, planId: string) {
  await withSystemContext(h.ownerDb, (trx) =>
    trx.updateTable('subscriptions').set({ plan_id: planId, status: 'active', trial_ends_at: null, current_period_start: new Date(), current_period_end: planId === 'free' ? null : new Date(Date.now() + 30 * 86_400_000) }).where('org_id', '=', orgId).execute());
}

describe('comparing scopes', () => {
  it('on one catalogue: only in each and in both; the CSV download is counted and audited', async () => {
    const owner = await signUp(h);
    const versionId = await publishedVersionId(h);
    const s = (await treeOf(owner.client, versionId)).subjects.find((x) => x.materials.length >= 3)!;
    const [m1, m2, m3] = s.materials as [Material, Material, Material];
    const a = await scopeWith(owner, 'Campus North', versionId, [m1.id, m2.id]);
    const b = await scopeWith(owner, 'Campus South', versionId, [m2.id, m3.id]);

    const res = await compare(owner, a, b);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ a: { id: a, name: 'Campus North', academicYear: '2026/2027' }, b: { id: b, name: 'Campus South' }, sameVersion: true, summary: { onlyA: 1, onlyB: 1, both: 1 } });
    expect(body.subjects).toHaveLength(1);
    expect(body.subjects[0].materials.map((m: { title: string; side: string }) => [m.title, m.side])).toEqual([[m1.title, 'a'], [m2.title, 'both'], [m3.title, 'b']]);

    const csv = await compare(owner, a, b, 'csv');
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toBe('attachment; filename="compare-Campus-North-Campus-South.csv"');
    const rows = parseCsv(csv.body);
    expect(rows[0]).toEqual(['grade', 'track', 'block', 'subject', 'subject_ar', 'material', 'kind', 'Campus North (2026/2027)', 'Campus South (2026/2027)', 'note']);
    expect(rows.slice(1).map((r) => [r[5], r[7], r[8]])).toEqual([[m1.title, 'yes', 'no'], [m2.title, 'yes', 'yes'], [m3.title, 'no', 'yes']]);
    const audit = await withSystemContext(h.ownerDb, (trx) => trx.selectFrom('audit_logs').select(['action', 'target_id', 'metadata']).where('action', '=', 'scope.comparison_exported').execute());
    expect(audit).toEqual([{ action: 'scope.comparison_exported', target_id: a, metadata: { with: b, onlyA: 1, onlyB: 1, both: 1 } }]);
    const usage = await withSystemContext(h.ownerDb, (trx) => trx.selectFrom('usage_counters').select('quantity').where('org_id', '=', owner.orgId).where('metric', '=', 'exports').executeTakeFirst());
    expect(usage?.quantity).toBe(1);
  });

  it("compares last year's scope with this year's: books matched by subject and title, renamed and missing ones marked", async () => {
    const admin = await createPlatformAdmin(h);
    const owner = await signUp(h);
    const currentId = await publishedVersionId(h);
    const s = (await treeOf(owner.client, currentId)).subjects.find((x) => x.materials.length >= 3)!;
    const [renamed, dropped, kept] = s.materials as [Material, Material, Material];
    const nextId = (await admin.post('/api/admin/catalog/versions', { fromVersionId: currentId, academicYear: '2027/2028', label: 'Next year' })).json().id as string;
    const draft = (await admin.get(`/api/admin/catalog/versions/${nextId}`)).json() as { subjects: Subject[] };
    const ns = draft.subjects.find((x) => x.grade === s.grade && x.track === s.track && x.block === s.block && x.code === s.code)!;
    const copy = (m: Material) => ns.materials.find((x) => x.title === m.title)!;
    expect((await admin.patch(`/api/admin/catalog/materials/${copy(renamed).id}`, { title: renamed.title.toUpperCase() })).statusCode).toBe(200);
    expect((await admin.delete(`/api/admin/catalog/materials/${copy(dropped).id}`)).statusCode).toBe(200);
    const added = (await admin.post(`/api/admin/catalog/subjects/${ns.id}/materials`, { title: 'New workbook 2027', kind: 'ext' })).json().id as string;
    expect((await admin.post(`/api/admin/catalog/versions/${nextId}/publish`)).statusCode).toBe(200);

    const last = await scopeWith(owner, 'Plan 2026/2027', currentId, [renamed.id, dropped.id, kept.id]);
    const next = await scopeWith(owner, 'Plan 2027/2028', nextId, [copy(renamed).id, copy(kept).id, added]);
    const body = (await compare(owner, last, next)).json();
    expect(body).toMatchObject({ sameVersion: false, a: { academicYear: '2026/2027' }, b: { academicYear: '2027/2028' }, summary: { onlyA: 1, onlyB: 1, both: 2 } });
    const rows = body.subjects[0].materials as { title: string; side: string; titleInB?: string; notInOtherCatalog?: boolean }[];
    expect(rows.find((m) => m.title === renamed.title)).toMatchObject({ side: 'both', titleInB: renamed.title.toUpperCase() });
    expect(rows.find((m) => m.title === dropped.title)).toMatchObject({ side: 'a', notInOtherCatalog: true });
    expect(rows.find((m) => m.title === kept.title)).toMatchObject({ side: 'both' });
    expect(rows.find((m) => m.title === 'New workbook 2027')).toMatchObject({ side: 'b', notInOtherCatalog: true });

    const csv = parseCsv((await compare(owner, last, next, 'csv')).body);
    expect(csv.find((r) => r[5] === dropped.title)![9]).toBe('Not in the 2027/2028 catalogue');
    expect(csv.find((r) => r[5] === renamed.title)![9]).toBe(`Titled "${renamed.title.toUpperCase()}" in Plan 2027/2028`);
  });

  it('only within one organization; viewers can compare; the CSV needs CSV export on the plan', async () => {
    const owner = await signUp(h);
    const other = await signUp(h);
    const versionId = await publishedVersionId(h);
    const m = (await treeOf(owner.client, versionId)).subjects[0]!.materials[0]!;
    const a = await scopeWith(owner, 'Mine A', versionId, [m.id]);
    const b = await scopeWith(owner, 'Mine B', versionId, []);
    const theirs = await scopeWith(other, 'Theirs', versionId, [m.id]);

    expect((await compare(owner, a, theirs)).statusCode).toBe(404);
    expect((await other.client.get(`/api/orgs/${owner.orgId}/scopes/compare?a=${a}&b=${b}`)).statusCode).toBe(404);
    const same = await compare(owner, a, a);
    expect(same.statusCode).toBe(400);
    expect(same.json().error.message).toBe('Choose two different scopes');
    expect((await owner.client.get(`/api/orgs/${owner.orgId}/scopes/compare?a=${a}&b=not-a-uuid`)).statusCode).toBe(400);

    const viewer = await addMember(h, owner.client, owner.orgId, 'viewer');
    expect((await viewer.client.get(`/api/orgs/${owner.orgId}/scopes/compare?a=${a}&b=${b}`)).json().summary).toEqual({ onlyA: 1, onlyB: 0, both: 0 });

    await setPlan(owner.orgId, 'free');
    expect((await compare(owner, a, b)).statusCode).toBe(200);
    const csv = await compare(owner, a, b, 'csv');
    expect(csv.statusCode).toBe(402);
    expect(csv.json().error.code).toBe('FEATURE_NOT_IN_PLAN');
  });
});
