import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withSystemContext } from '../../src/db/index.js';
import { createHarness, createPlatformAdmin, publishedVersionId, resetData, signUp, type Harness } from '../helpers/harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());
beforeEach(async () => resetData(h.ownerDb));

interface Mark { status: string; source: string | null; url: string | null; note: string | null; reviewedAt: string }
interface Material { id: string; title: string; verification: Mark | null }
interface Subject { id: string; grade: number; track: string; code: string; nameEn: string; verification: Mark | null; materials: Material[] }

type AdminClient = Awaited<ReturnType<typeof createPlatformAdmin>>;
const mark = (admin: AdminClient, versionId: string, body: object) => admin.post(`/api/admin/catalog/versions/${versionId}/verification`, body);
const adminTree = async (admin: AdminClient, versionId: string) => (await admin.get(`/api/admin/catalog/versions/${versionId}`)).json() as { subjects: Subject[]; counts: { verification: Record<string, number> } };
const withMaterials = (subjects: Subject[], n = 2) => subjects.find((s) => s.materials.length >= n)!;
const DECREE = { status: 'verified', source: 'Ministerial Decree 123/2026', url: 'https://moe.gov.eg/decrees/123' };

describe('catalogue verification marks', () => {
  it('marks entries of the published catalogue; customers see the mark and coverage, not the reviewer', async () => {
    const admin = await createPlatformAdmin(h);
    const owner = await signUp(h);
    const versionId = await publishedVersionId(h);
    const before = await owner.client.get(`/api/catalog/versions/${versionId}`);
    const subject = withMaterials(before.json().subjects);
    const materialIds = subject.materials.map((m) => m.id);

    const res = await mark(admin, versionId, { subjectIds: [subject.id], materialIds, ...DECREE });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ status: 'verified', subjects: 1, materials: materialIds.length });

    // A new ETag: clients holding the old one get the updated catalogue.
    const after = await owner.client.get(`/api/catalog/versions/${versionId}`, { 'if-none-match': before.headers.etag as string });
    expect(after.statusCode).toBe(200);
    const s = (after.json().subjects as Subject[]).find((x) => x.id === subject.id)!;
    expect(s.verification).toMatchObject({ status: 'verified', source: DECREE.source, url: DECREE.url, note: null });
    expect(Date.parse(s.verification!.reviewedAt)).toBeGreaterThan(Date.now() - 60_000);
    expect(s.materials.every((m) => m.verification?.status === 'verified')).toBe(true);
    expect(after.json().counts.verification).toEqual({ subjectsVerified: 1, subjectsNeedReview: 0, materialsVerified: materialIds.length, materialsNeedReview: 0 });
    expect(after.body).not.toMatch(/reviewed_?by/i);

    const versions = (await admin.get('/api/admin/catalog/versions')).json().versions as { id: string; subjectsVerified: number }[];
    expect(versions.find((v) => v.id === versionId)!.subjectsVerified).toBe(1);
    const audit = await withSystemContext(h.ownerDb, (trx) => trx.selectFrom('audit_logs').select(['action', 'target_id', 'metadata']).where('action', '=', 'admin.catalog_verification_set').execute());
    expect(audit).toEqual([{ action: 'admin.catalog_verification_set', target_id: versionId, metadata: { status: 'verified', source: DECREE.source, subjects: 1, materials: materialIds.length } }]);
  });

  it('records entries that need review with a public note, and resets marks to unverified', async () => {
    const admin = await createPlatformAdmin(h);
    const versionId = await publishedVersionId(h);
    const subject = withMaterials((await adminTree(admin, versionId)).subjects);
    const material = subject.materials[0]!;

    expect((await mark(admin, versionId, { materialIds: [material.id], status: 'needs_review', note: '2026/27 edition not yet announced by the publisher' })).statusCode).toBe(200);
    let tree = await adminTree(admin, versionId);
    let m = tree.subjects.find((x) => x.id === subject.id)!.materials.find((x) => x.id === material.id)!;
    expect(m.verification).toMatchObject({ status: 'needs_review', note: '2026/27 edition not yet announced by the publisher', source: null });
    expect(tree.counts.verification.materialsNeedReview).toBe(1);

    expect((await mark(admin, versionId, { materialIds: [material.id], status: 'unverified' })).statusCode).toBe(200);
    tree = await adminTree(admin, versionId);
    m = tree.subjects.find((x) => x.id === subject.id)!.materials.find((x) => x.id === material.id)!;
    expect(m.verification).toBeNull();
    expect(tree.counts.verification.materialsNeedReview).toBe(0);
  });

  it('validates the request and the targets', async () => {
    const admin = await createPlatformAdmin(h);
    const versionId = await publishedVersionId(h);
    const subject = (await adminTree(admin, versionId)).subjects[0]!;
    const one = { subjectIds: [subject.id] };

    for (const body of [
      { ...one, status: 'verified' },
      { ...one, status: 'needs_review' },
      { ...one, ...DECREE, url: 'javascript:alert(1)' },
      { ...one, ...DECREE, url: 'ftp://example.com/x' },
      { ...one, status: 'approved' },
      { subjectIds: [], materialIds: [], ...DECREE },
    ]) {
      const res = await mark(admin, versionId, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
    }

    // Ids from another version are refused, and nothing is written.
    const draft = await admin.post('/api/admin/catalog/versions', { fromVersionId: versionId, academicYear: '2027/2028', label: 'Draft' });
    const draftSubject = (await adminTree(admin, draft.json().id)).subjects[0]!;
    const cross = await mark(admin, versionId, { subjectIds: [subject.id, draftSubject.id], ...DECREE });
    expect(cross.statusCode).toBe(400);
    expect((await adminTree(admin, versionId)).counts.verification.subjectsVerified).toBe(0);
    expect((await mark(admin, '00000000-0000-4000-8000-000000000000', { ...one, ...DECREE })).statusCode).toBe(404);
  });

  it('is admin-only and refuses archived versions', async () => {
    const admin = await createPlatformAdmin(h);
    const owner = await signUp(h);
    const versionId = await publishedVersionId(h);
    const subject = (await adminTree(admin, versionId)).subjects[0]!;
    expect((await owner.client.post(`/api/admin/catalog/versions/${versionId}/verification`, { subjectIds: [subject.id], ...DECREE })).statusCode).toBe(404);

    const next = (await admin.post('/api/admin/catalog/versions', { fromVersionId: versionId, academicYear: '2027/2028', label: 'Next' })).json().id as string;
    expect((await admin.post(`/api/admin/catalog/versions/${next}/publish`)).statusCode).toBe(200);
    expect((await admin.post(`/api/admin/catalog/versions/${next}/archive`)).statusCode).toBe(200);
    const archivedSubject = (await adminTree(admin, next)).subjects[0]!;
    const res = await mark(admin, next, { subjectIds: [archivedSubject.id], ...DECREE });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('VERSION_ARCHIVED');
  });

  it('copies marks into a draft of the same academic year only; content edits reset them, unchanged saves do not', async () => {
    const admin = await createPlatformAdmin(h);
    const versionId = await publishedVersionId(h);
    const subjects = (await adminTree(admin, versionId)).subjects;
    const a = withMaterials(subjects);
    const b = subjects.find((s) => s.id !== a.id && s.materials.length >= 2)!;
    await mark(admin, versionId, { subjectIds: [a.id, b.id], materialIds: [...a.materials, ...b.materials].map((m) => m.id), ...DECREE });

    const newYear = (await admin.post('/api/admin/catalog/versions', { fromVersionId: versionId, academicYear: '2027/2028', label: 'Next year' })).json().id as string;
    expect((await adminTree(admin, newYear)).counts.verification).toEqual({ subjectsVerified: 0, subjectsNeedReview: 0, materialsVerified: 0, materialsNeedReview: 0 });

    const correction = (await admin.post('/api/admin/catalog/versions', { fromVersionId: versionId, academicYear: '2026/2027', label: 'Correction' })).json().id as string;
    let tree = await adminTree(admin, correction);
    const key = (s: Subject) => `${s.grade}|${s.track}|${s.code}|${s.nameEn}`;
    const find = (t: { subjects: Subject[] }, like: Subject) => t.subjects.find((s) => key(s) === key(like))!;
    const ca = find(tree, a);
    const cb = find(tree, b);
    expect(ca.verification).toMatchObject({ status: 'verified', source: DECREE.source });
    expect(ca.materials.every((m) => m.verification?.status === 'verified')).toBe(true);

    // Saving the subject unchanged (as the editor dialog does) or reordering keeps the mark.
    const same = { grade: ca.grade, track: ca.track, code: ca.code, nameEn: ca.nameEn, sortOrder: 5 };
    expect((await admin.patch(`/api/admin/catalog/subjects/${ca.id}`, same)).statusCode).toBe(200);
    expect((await admin.patch(`/api/admin/catalog/materials/${ca.materials[0]!.id}`, { title: ca.materials[0]!.title, sortOrder: 3 })).statusCode).toBe(200);
    tree = await adminTree(admin, correction);
    expect(find(tree, a).verification?.status).toBe('verified');
    expect(find(tree, a).materials.find((m) => m.id === ca.materials[0]!.id)!.verification?.status).toBe('verified');

    // Changing content resets only the edited entry.
    expect((await admin.patch(`/api/admin/catalog/subjects/${ca.id}`, { note: 'Changed by decree 140/2026' })).statusCode).toBe(200);
    expect((await admin.patch(`/api/admin/catalog/materials/${cb.materials[0]!.id}`, { title: `${cb.materials[0]!.title} (2nd ed.)` })).statusCode).toBe(200);
    tree = await adminTree(admin, correction);
    expect(find(tree, a).verification).toBeNull();
    expect(find(tree, a).materials.every((m) => m.verification?.status === 'verified')).toBe(true);
    expect(find(tree, b).verification?.status).toBe('verified');
    expect(find(tree, b).materials.find((m) => m.id === cb.materials[0]!.id)!.verification).toBeNull();
  });

  it('scope exports carry the marks', async () => {
    const admin = await createPlatformAdmin(h);
    const owner = await signUp(h);
    const versionId = await publishedVersionId(h);
    const subject = withMaterials((await adminTree(admin, versionId)).subjects);
    const [verified, unverified] = subject.materials;
    await mark(admin, versionId, { subjectIds: [subject.id], materialIds: [verified!.id], ...DECREE });

    const scope = (await owner.client.post(`/api/orgs/${owner.orgId}/scopes`, { name: 'Verified check', catalogVersionId: versionId })).json().scope;
    await owner.client.post(`/api/orgs/${owner.orgId}/scopes/${scope.id}/items`, { add: [verified!.id, unverified!.id] });

    const json = (await owner.client.get(`/api/orgs/${owner.orgId}/scopes/${scope.id}/export?format=json`)).json();
    const items = json.items as { materialId: string; subjectVerification: string; subjectVerificationSource: string | null; materialVerification: string; materialReviewedAt: string | null }[];
    expect(items.find((i) => i.materialId === verified!.id)).toMatchObject({ subjectVerification: 'verified', subjectVerificationSource: DECREE.source, materialVerification: 'verified' });
    expect(items.find((i) => i.materialId === unverified!.id)).toMatchObject({ materialVerification: 'unverified', materialReviewedAt: null });

    const csv = (await owner.client.get(`/api/orgs/${owner.orgId}/scopes/${scope.id}/export?format=csv`)).body;
    expect(csv).toContain('subject_verification,subject_verification_source,subject_reviewed_at,material_verification');
    expect(csv).toContain(`,verified,${DECREE.source},`);
  });
});
