import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withSystemContext } from '../../src/db/index.js';
import { parseCsv, toCsv, unguardCell } from '../../src/lib/csv.js';
import { createHarness, createPlatformAdmin, publishedVersionId, resetData, signUp, type Harness } from '../helpers/harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());
beforeEach(async () => resetData(h.ownerDb));

type Admin = Awaited<ReturnType<typeof createPlatformAdmin>>;
interface Mark { status: string; source: string | null; note: string | null; reviewedAt: string }
interface Subject { id: string; nameEn: string; verification: Mark | null; materials: { id: string; title: string; verification: Mark | null }[] }

async function download(admin: Admin, versionId: string) {
  const res = await admin.get(`/api/admin/catalog/versions/${versionId}/sheet`);
  expect(res.statusCode).toBe(200);
  expect(res.headers['content-type']).toContain('text/csv');
  return parseCsv(res.body).map((r) => r.map(unguardCell));
}
/** Sets cells by entity id (subject or material) and column name. */
function edit(records: string[][], changes: [id: string, column: string, value: string][]) {
  const col = (c: string) => records[0]!.indexOf(c);
  for (const [id, column, value] of changes) {
    const row = records.find((r) => (r[col('material_id')] || r[col('subject_id')]) === id && (r[col('row_type')] === 'material' ? r[col('material_id')] === id : true));
    if (!row) throw new Error(`no row for ${id}`);
    row[col(column)] = value;
  }
  return toCsv(records);
}
const upload = (admin: Admin, versionId: string, csv: string, apply: boolean) => admin.post(`/api/admin/catalog/versions/${versionId}/sheet`, { csv, apply });
const treeOf = async (admin: Admin, versionId: string) => ((await admin.get(`/api/admin/catalog/versions/${versionId}`)).json() as { subjects: Subject[] }).subjects;

describe('catalogue spreadsheet export and import', () => {
  it('exports the whole catalogue with ids and marks', async () => {
    const admin = await createPlatformAdmin(h);
    const versionId = await publishedVersionId(h);
    const records = await download(admin, versionId);
    const type = records[0]!.indexOf('row_type');
    expect(records.filter((r) => r[type] === 'subject')).toHaveLength(231);
    expect(records.filter((r) => r[type] === 'material')).toHaveLength(1038);
    const res = await admin.get(`/api/admin/catalog/versions/${versionId}/sheet`);
    expect(res.headers['content-disposition']).toBe('attachment; filename="catalogue-2026-2027-published.csv"');
    expect(res.body.startsWith('﻿')).toBe(true);
  });

  it('previews then applies verification marks on the published catalogue, notifying customers of new flags', async () => {
    const admin = await createPlatformAdmin(h);
    const versionId = await publishedVersionId(h);
    const subjects = await treeOf(admin, versionId);
    const s = subjects.find((x) => x.materials.length >= 3)!;
    const [m1, m2, m3] = s.materials;
    const owner = await signUp(h);
    const scope = (await owner.client.post(`/api/orgs/${owner.orgId}/scopes`, { name: 'Sheet plan', catalogVersionId: versionId })).json().scope;
    await owner.client.post(`/api/orgs/${owner.orgId}/scopes/${scope.id}/items`, { add: [m3!.id] });

    const csv = edit(await download(admin, versionId), [
      [s.id, 'verification_status', 'verified'], [s.id, 'verification_source', 'Ministerial Decree 123/2026'],
      [m1!.id, 'verification_status', 'verified'], [m1!.id, 'verification_source', 'Publisher catalogue 2026'], [m1!.id, 'verification_url', 'https://publisher.example/2026'],
      [m3!.id, 'verification_status', 'needs_review'], [m3!.id, 'verification_note', 'Edition for 2026/27 not announced'],
    ]);
    const preview = await upload(admin, versionId, csv, false);
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json().plan.errors).toEqual([]);
    expect(preview.json().plan.summary).toMatchObject({ rows: 1269, marksChanged: 3, subjectsChanged: 0, materialsChanged: 0, materialsAdded: 0 });
    // A preview writes nothing.
    expect((await treeOf(admin, versionId)).find((x) => x.id === s.id)!.verification).toBeNull();

    const before = await owner.client.get(`/api/catalog/versions/${versionId}`);
    const applied = await upload(admin, versionId, csv, true);
    expect(applied.statusCode, applied.body).toBe(200);
    expect(applied.json()).toMatchObject({ applied: true, summary: { marksChanged: 3 } });

    const after = (await treeOf(admin, versionId)).find((x) => x.id === s.id)!;
    expect(after.verification).toMatchObject({ status: 'verified', source: 'Ministerial Decree 123/2026' });
    expect(after.materials.find((m) => m.id === m1!.id)!.verification).toMatchObject({ status: 'verified', source: 'Publisher catalogue 2026' });
    expect(after.materials.find((m) => m.id === m2!.id)!.verification).toBeNull();
    expect(after.materials.find((m) => m.id === m3!.id)!.verification).toMatchObject({ status: 'needs_review', note: 'Edition for 2026/27 not announced' });
    expect((await owner.client.get(`/api/catalog/versions/${versionId}`, { 'if-none-match': before.headers.etag as string })).statusCode).toBe(200);

    const notes = await h.ownerDb.selectFrom('notifications').select(['kind', 'body']).where('user_id', '=', owner.userId).where('kind', '=', 'catalog_review').execute();
    expect(notes).toEqual([{ kind: 'catalog_review', body: 'Edition for 2026/27 not announced — “Sheet plan”' }]);
    const audit = await withSystemContext(h.ownerDb, (trx) => trx.selectFrom('audit_logs').select(['action', 'metadata']).where('action', '=', 'admin.catalog_imported').execute());
    expect(audit).toEqual([{ action: 'admin.catalog_imported', metadata: expect.objectContaining({ marksChanged: 3, warnings: 0 }) }]);

    // The same sheet again changes nothing and notifies no one.
    expect((await upload(admin, versionId, csv, true)).json().summary).toMatchObject({ marksChanged: 0, unchanged: 1269 });
    expect(await h.ownerDb.selectFrom('notifications').select('id').where('user_id', '=', owner.userId).where('kind', '=', 'catalog_review').execute()).toHaveLength(1);
  });

  it('refuses content changes on a published version as a whole: nothing is written', async () => {
    const admin = await createPlatformAdmin(h);
    const versionId = await publishedVersionId(h);
    const s = (await treeOf(admin, versionId))[0]!;
    const csv = edit(await download(admin, versionId), [
      [s.materials[0]!.id, 'title', 'Changed title'],
      [s.materials[1]!.id, 'verification_status', 'verified'], [s.materials[1]!.id, 'verification_source', 'Decree'],
    ]);
    const preview = (await upload(admin, versionId, csv, false)).json().plan;
    expect(preview.errors).toEqual([{ row: expect.any(Number), message: 'Published versions are read-only: only the verification columns can change (title changed)' }]);
    const applied = await upload(admin, versionId, csv, true);
    expect(applied.statusCode).toBe(400);
    expect(applied.json().error.code).toBe('IMPORT_INVALID');
    const after = (await treeOf(admin, versionId))[0]!;
    expect(after.materials[1]!.verification).toBeNull();
    expect(after.materials[0]!.title).toBe(s.materials[0]!.title);
  });

  it('applies corrections and new materials to a draft; a correction clears a mark left untouched', async () => {
    const admin = await createPlatformAdmin(h);
    const versionId = await publishedVersionId(h);
    const s = (await treeOf(admin, versionId)).find((x) => x.materials.length >= 2)!;
    await admin.post(`/api/admin/catalog/versions/${versionId}/verification`, { materialIds: s.materials.map((m) => m.id), status: 'verified', source: 'Decree 1' });
    const draftId = (await admin.post('/api/admin/catalog/versions', { fromVersionId: versionId, academicYear: '2026/2027', label: 'Correction' })).json().id as string;
    const ds = (await treeOf(admin, draftId)).find((x) => x.nameEn === s.nameEn && x.materials.length === s.materials.length)!;
    const [a, b] = ds.materials;
    expect(a!.verification?.status).toBe('verified');

    const records = await download(admin, draftId);
    const col = (c: string) => records[0]!.indexOf(c);
    const subjectRow = records.find((r) => r[col('row_type')] === 'subject' && r[col('subject_id')] === ds.id)!;
    const added = [...subjectRow];
    added[col('row_type')] = 'material';
    added[col('kind')] = 'ext';
    added[col('title')] = 'New workbook 2026';
    added[col('verification_status')] = 'verified';
    added[col('verification_source')] = 'Publisher list';
    added[col('status')] = '';
    records.push(added);
    const csv = edit(records, [
      [a!.id, 'title', `${a!.title} (revised)`], // mark left as exported → cleared
      [b!.id, 'title', `${b!.title} (revised)`], [b!.id, 'verification_source', 'Decree 2'], // mark updated → kept
    ]);
    const plan = (await upload(admin, draftId, csv, false)).json().plan;
    expect(plan.errors).toEqual([]);
    expect(plan.summary).toMatchObject({ materialsChanged: 2, materialsAdded: 1, marksCleared: 1, marksChanged: 2 });
    expect((await upload(admin, draftId, csv, true)).statusCode).toBe(200);

    const after = (await treeOf(admin, draftId)).find((x) => x.id === ds.id)!;
    expect(after.materials.find((m) => m.id === a!.id)).toMatchObject({ title: `${a!.title} (revised)`, verification: null });
    expect(after.materials.find((m) => m.id === b!.id)).toMatchObject({ title: `${b!.title} (revised)`, verification: { status: 'verified', source: 'Decree 2' } });
    expect(after.materials.at(-1)).toMatchObject({ title: 'New workbook 2026', verification: { status: 'verified', source: 'Publisher list' } });
  });

  it('is admin-only, refuses archived versions and explains encoding problems', async () => {
    const admin = await createPlatformAdmin(h);
    const owner = await signUp(h);
    const versionId = await publishedVersionId(h);
    expect((await owner.client.get(`/api/admin/catalog/versions/${versionId}/sheet`)).statusCode).toBe(404);
    expect((await owner.client.post(`/api/admin/catalog/versions/${versionId}/sheet`, { csv: 'x', apply: false })).statusCode).toBe(404);

    const bad = (await upload(admin, versionId, 'row_type,subject_id\nsubject,�', false)).json().plan;
    expect(bad.errors[0].message).toMatch(/not UTF-8/);

    const next = (await admin.post('/api/admin/catalog/versions', { fromVersionId: versionId, academicYear: '2027/2028', label: 'Next' })).json().id as string;
    await admin.post(`/api/admin/catalog/versions/${next}/publish`);
    await admin.post(`/api/admin/catalog/versions/${next}/archive`);
    const archived = await upload(admin, next, toCsv([['row_type']]), false);
    expect(archived.statusCode).toBe(409);
    expect(archived.json().error.code).toBe('VERSION_ARCHIVED');
  });
});
