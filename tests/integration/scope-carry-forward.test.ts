import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withSystemContext } from '../../src/db/index.js';
import { addMember, createHarness, createPlatformAdmin, publishedVersionId, resetData, signUp, type Harness } from '../helpers/harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());
beforeEach(async () => resetData(h.ownerDb));

interface Material { id: string; title: string; kind: string }
interface Subject { id: string; grade: number; track: string; block: string; code: string; nameEn: string; materials: Material[] }
type Client = Awaited<ReturnType<typeof createPlatformAdmin>>;
const treeOf = async (c: Client, versionId: string) => (await c.get(`/api/catalog/versions/${versionId}`)).json() as { subjects: Subject[] };
const sameSubject = (a: Subject) => (b: Subject) => a.grade === b.grade && a.track === b.track && a.block === b.block && a.code === b.code;

/**
 * Publishes a 2027/2028 catalogue copied from 2026/2027 with realistic changes:
 * in subject A a book gets a new edition title, another is dropped, a new one is added
 * and the note changes; subject B is removed.
 */
async function publishNextYear(admin: Client, currentId: string) {
  const current = (await treeOf(admin, currentId)).subjects;
  const a = current.find((s) => s.materials.length >= 4)!;
  const b = current.find((s) => s.id !== a.id && s.materials.length >= 1 && s.grade === a.grade)!;
  const nextId = (await admin.post('/api/admin/catalog/versions', { fromVersionId: currentId, academicYear: '2027/2028', label: 'Next year' })).json().id as string;
  const draft = (await (await admin.get(`/api/admin/catalog/versions/${nextId}`)).json()) as { subjects: Subject[] };
  const na = draft.subjects.find(sameSubject(a))!;
  const nb = draft.subjects.find(sameSubject(b))!;
  // Source materials and their copies in the draft (same titles).
  const [kept, renamed, dropped] = a.materials as [Material, Material, Material];
  const inDraft = (m: Material) => na.materials.find((x) => x.title === m.title)!;
  expect((await admin.patch(`/api/admin/catalog/materials/${inDraft(renamed).id}`, { title: `${renamed.title} — 2027 edition` })).statusCode).toBe(200);
  expect((await admin.delete(`/api/admin/catalog/materials/${inDraft(dropped).id}`)).statusCode).toBe(200);
  const added = (await admin.post(`/api/admin/catalog/subjects/${na.id}/materials`, { title: 'New workbook 2027', kind: 'ext' })).json().id as string;
  expect((await admin.patch(`/api/admin/catalog/subjects/${na.id}`, { note: 'Revised by the 2027 decree' })).statusCode).toBe(200);
  expect((await admin.delete(`/api/admin/catalog/subjects/${nb.id}`)).statusCode).toBe(200);
  expect((await admin.post(`/api/admin/catalog/versions/${nextId}/publish`)).statusCode).toBe(200);
  return { nextId, a, b, kept, renamed, dropped, addedId: added, keptTargetId: inDraft(kept).id };
}

async function setup() {
  const admin = await createPlatformAdmin(h);
  const owner = await signUp(h);
  const currentId = await publishedVersionId(h);
  const next = await publishNextYear(admin, currentId);
  const scope = (await owner.client.post(`/api/orgs/${owner.orgId}/scopes`, { name: 'Grade plan (2026/2027)', catalogVersionId: currentId })).json().scope as { id: string };
  const picked = [...next.a.materials.slice(0, 4), ...next.b.materials].map((m) => m.id);
  expect((await owner.client.post(`/api/orgs/${owner.orgId}/scopes/${scope.id}/items`, { add: picked })).statusCode).toBe(200);
  return { admin, owner, currentId, scope, picked, ...next };
}

describe('carrying a scope to the next academic year', () => {
  it('previews what carries over, what is missing, what changed and what is new', async () => {
    const s = await setup();
    const res = await s.owner.client.get(`/api/orgs/${s.owner.orgId}/scopes/${s.scope.id}/carry-forward?to=${s.nextId}`);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.from.academicYear).toBe('2026/2027');
    expect(body.to.academicYear).toBe('2027/2028');
    expect(body.suggestedName).toBe('Grade plan (2027/2028)');

    const a = body.plan.subjects.find((x: { source: { id: string } }) => x.source.id === s.a.id);
    expect(a.target).not.toBeNull();
    expect(a.carried.map((c: { title: string }) => c.title)).toEqual([s.kept.title, s.a.materials[3]!.title]);
    expect(a.missing.map((m: { title: string }) => m.title).sort()).toEqual([s.renamed.title, s.dropped.title].sort());
    expect(a.added.map((m: { title: string }) => m.title).sort()).toEqual([`${s.renamed.title} — 2027 edition`, 'New workbook 2027'].sort());
    expect(a.changes).toHaveLength(1);
    expect(a.changes[0]).toMatchObject({ field: 'note', to: 'Revised by the 2027 decree' });

    const b = body.plan.subjects.find((x: { source: { id: string } }) => x.source.id === s.b.id);
    expect(b.target).toBeNull();
    expect(b.missing).toHaveLength(s.b.materials.length);
    expect(body.plan.summary).toMatchObject({ selected: s.picked.length, carried: 2, missing: 2 + s.b.materials.length, subjectsRemoved: 1, subjectsChanged: 1 });
  });

  it('copies into a new scope for the new year, with chosen replacements; the old scope is untouched', async () => {
    const s = await setup();
    const a = (await s.owner.client.get(`/api/orgs/${s.owner.orgId}/scopes/${s.scope.id}/carry-forward?to=${s.nextId}`)).json().plan.subjects.find((x: { source: { id: string } }) => x.source.id === s.a.id);
    const replacement = a.added.find((m: { title: string }) => m.title.endsWith('2027 edition')).id as string;
    const skipped = a.carried[1].toId as string;

    const res = await s.owner.client.post(`/api/orgs/${s.owner.orgId}/scopes/${s.scope.id}/carry-forward`, { targetVersionId: s.nextId, add: [replacement], skip: [skipped] });
    expect(res.statusCode, res.body).toBe(201);
    const out = res.json();
    expect(out).toMatchObject({ mode: 'copy', itemCount: 2, carried: 1, added: 1, skipped: 1, fromVersion: '2026/2027', toVersion: '2027/2028' });
    expect(out.scope).toMatchObject({ name: 'Grade plan (2027/2028)', catalogVersionId: s.nextId });

    const created = (await s.owner.client.get(`/api/orgs/${s.owner.orgId}/scopes/${out.scope.id}`)).json();
    expect(created.materialIds.sort()).toEqual([a.carried[0].toId, replacement].sort());
    const original = (await s.owner.client.get(`/api/orgs/${s.owner.orgId}/scopes/${s.scope.id}`)).json();
    expect(original.scope.catalogVersionId).toBe(s.currentId);
    expect(original.materialIds.sort()).toEqual([...s.picked].sort());

    const audit = await withSystemContext(h.ownerDb, (trx) => trx.selectFrom('audit_logs').select(['action', 'target_id', 'metadata']).where('action', '=', 'scope.carried_forward').execute());
    expect(audit).toEqual([{ action: 'scope.carried_forward', target_id: out.scope.id, metadata: expect.objectContaining({ mode: 'copy', from: s.scope.id, carried: 1, added: 1, skipped: 1 }) }]);

    // Same default name again → conflict.
    const again = await s.owner.client.post(`/api/orgs/${s.owner.orgId}/scopes/${s.scope.id}/carry-forward`, { targetVersionId: s.nextId });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('SCOPE_NAME_TAKEN');
  });

  it('moves a scope in place, which also works at the Free plan scope limit', async () => {
    const s = await setup();
    const second = (await s.owner.client.post('/api/orgs', { name: 'Free org' })).json().organization.id as string;
    const freeScope = (await s.owner.client.post(`/api/orgs/${second}/scopes`, { name: 'Only scope', catalogVersionId: s.currentId })).json().scope.id as string;
    await s.owner.client.post(`/api/orgs/${second}/scopes/${freeScope}/items`, { add: [s.kept.id, s.dropped.id] });

    const copy = await s.owner.client.post(`/api/orgs/${second}/scopes/${freeScope}/carry-forward`, { targetVersionId: s.nextId });
    expect(copy.statusCode).toBe(402);
    expect(copy.json().error.code).toBe('PLAN_LIMIT_REACHED');

    const move = await s.owner.client.post(`/api/orgs/${second}/scopes/${freeScope}/carry-forward`, { targetVersionId: s.nextId, mode: 'move' });
    expect(move.statusCode, move.body).toBe(200);
    expect(move.json()).toMatchObject({ mode: 'move', scope: { id: freeScope, name: 'Only scope', catalogVersionId: s.nextId }, itemCount: 1, carried: 1, missing: 1 });
    const moved = (await s.owner.client.get(`/api/orgs/${second}/scopes/${freeScope}`)).json();
    expect(moved.scope.catalogVersionId).toBe(s.nextId);
    expect(moved.materialIds).toEqual([s.keptTargetId]);
  });

  it('validates the target and the materials, and requires an editor to apply', async () => {
    const s = await setup();
    const url = `/api/orgs/${s.owner.orgId}/scopes/${s.scope.id}/carry-forward`;
    expect((await s.owner.client.get(`${url}?to=${s.currentId}`)).statusCode).toBe(400);
    const draft = (await s.admin.post('/api/admin/catalog/versions', { fromVersionId: s.nextId, academicYear: '2028/2029', label: 'Draft' })).json().id as string;
    expect((await s.owner.client.get(`${url}?to=${draft}`)).statusCode).toBe(400);
    expect((await s.owner.client.post(url, { targetVersionId: draft })).statusCode).toBe(400);
    const wrong = await s.owner.client.post(url, { targetVersionId: s.nextId, add: [s.kept.id] });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error.code).toBe('INVALID_MATERIALS');

    const viewer = await addMember(h, s.owner.client, s.owner.orgId, 'viewer');
    expect((await viewer.client.get(`${url}?to=${s.nextId}`)).statusCode).toBe(200);
    expect((await viewer.client.post(url, { targetVersionId: s.nextId })).statusCode).toBe(403);

    const outsider = await signUp(h);
    expect((await outsider.client.get(`${url}?to=${s.nextId}`)).statusCode).toBe(404);
  });
});
