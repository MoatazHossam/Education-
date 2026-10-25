import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withSystemContext } from '../../src/db/index.js';
import { parseCsv } from '../../src/lib/csv.js';
import { addMember, createHarness, createPlatformAdmin, publishedVersionId, resetData, signUp, someMaterialIds, type Harness } from '../helpers/harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness({ RATE_LIMIT_ENABLED: 'false' });
});
afterAll(async () => h.close());
beforeEach(async () => resetData(h.ownerDb));

/** An owner with a scope holding four books, plus an editor and a viewer. */
async function team() {
  const owner = await signUp(h, { org: 'Notes School', name: 'Owner Olfat' });
  const editor = await addMember(h, owner.client, owner.orgId, 'editor');
  const viewer = await addMember(h, owner.client, owner.orgId, 'viewer');
  const versionId = await publishedVersionId(h);
  const books = await someMaterialIds(h, versionId, 4);
  const scopeId = (await owner.client.post(`/api/orgs/${owner.orgId}/scopes`, { name: 'Plan', catalogVersionId: versionId })).json().scope.id as string;
  expect((await owner.client.post(`/api/orgs/${owner.orgId}/scopes/${scopeId}/items`, { add: books })).statusCode).toBe(200);
  const base = `/api/orgs/${owner.orgId}/scopes/${scopeId}`;
  return { owner, editor, viewer, versionId, books, scopeId, base };
}

const notifications = (userId: string) =>
  h.ownerDb.selectFrom('notifications').select(['kind', 'title', 'body', 'link']).where('user_id', '=', userId).where('kind', '=', 'item_assigned').execute();

describe('notes and assignees on selected books', () => {
  it('an editor sets a note and an assignee; everyone in the organization sees them', async () => {
    const t = await team();
    const res = await t.editor.client.patch(`${t.base}/items/${t.books[0]}`, { note: '  Waiting for the 2027 edition ', assigneeId: t.owner.userId });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().annotation).toMatchObject({ materialId: t.books[0], note: 'Waiting for the 2027 edition', assigneeId: t.owner.userId, assigneeName: 'Owner Olfat', annotatedBy: 'Member editor' });
    const seen = (await t.viewer.client.get(t.base)).json();
    expect(seen.annotations).toEqual([expect.objectContaining({ materialId: t.books[0], note: 'Waiting for the 2027 edition', assigneeName: 'Owner Olfat' })]);
    expect(seen.materialIds).toHaveLength(4);
  });

  it('viewers cannot change them; books that are not selected, long notes and empty requests are refused', async () => {
    const t = await team();
    expect((await t.viewer.client.patch(`${t.base}/items/${t.books[0]}`, { note: 'x' })).statusCode).toBe(403);
    expect((await t.viewer.client.post(`${t.base}/items/assign`, { materialIds: [t.books[0]], assigneeId: t.viewer.userId })).statusCode).toBe(403);
    const other = (await someMaterialIds(h, t.versionId, 1, 50))[0]!;
    expect((await t.editor.client.patch(`${t.base}/items/${other}`, { note: 'x' })).statusCode).toBe(404);
    expect((await t.editor.client.patch(`${t.base}/items/${t.books[0]}`, { note: 'x'.repeat(501) })).json().error.code).toBe('VALIDATION_ERROR');
    expect((await t.editor.client.patch(`${t.base}/items/${t.books[0]}`, {})).json().error.code).toBe('VALIDATION_ERROR');
  });

  it('the assignee must be a member of the organization', async () => {
    const t = await team();
    const outsider = await signUp(h, { org: 'Elsewhere' });
    const res = await t.editor.client.patch(`${t.base}/items/${t.books[0]}`, { assigneeId: outsider.userId });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('ASSIGNEE_NOT_MEMBER');
    expect((await t.editor.client.post(`${t.base}/items/assign`, { materialIds: t.books, assigneeId: outsider.userId })).json().error.code).toBe('ASSIGNEE_NOT_MEMBER');
    // The database holds the same rule.
    await expect(
      withSystemContext(h.ownerDb, (trx) => trx.updateTable('scope_items').set({ assignee_id: outsider.userId }).where('scope_id', '=', t.scopeId).execute()),
    ).rejects.toThrow(/scope_items_assignee_member/);
  });

  it('clearing both note and assignee clears the item; the note text never reaches the audit log', async () => {
    const t = await team();
    await t.editor.client.patch(`${t.base}/items/${t.books[1]}`, { note: 'Confidential supplier remark', assigneeId: t.editor.userId });
    const cleared = await t.editor.client.patch(`${t.base}/items/${t.books[1]}`, { note: '', assigneeId: null });
    expect(cleared.json().annotation).toMatchObject({ note: null, assigneeId: null, annotatedAt: null });
    expect((await t.owner.client.get(t.base)).json().annotations).toEqual([]);
    const audit = (await t.owner.client.get(`/api/orgs/${t.owner.orgId}/audit-logs?action=scope.item_annotated`)).json().entries;
    expect(audit).toHaveLength(2);
    expect(audit[1].metadata).toMatchObject({ materialId: t.books[1], note: 'set', assigneeId: t.editor.userId });
    expect(audit[0].metadata).toMatchObject({ note: 'removed', assigneeId: null });
    expect(JSON.stringify(audit)).not.toContain('Confidential');
  });

  it('a new assignee is told in their own language, once; assigning yourself sends nothing', async () => {
    const t = await team();
    await t.owner.client.patch('/api/auth/profile', { locale: 'ar' });
    await t.editor.client.patch(`${t.base}/items/${t.books[0]}`, { assigneeId: t.owner.userId });
    await t.editor.client.patch(`${t.base}/items/${t.books[0]}`, { note: 'still the same assignee' });
    const got = await notifications(t.owner.userId);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ title: 'أسند إليك Member editor كتبًا للمتابعة (1)', body: 'في النطاق «Plan».', link: `/org/${t.owner.orgId}/scopes/${t.scopeId}/items?show=mine` });
    await t.editor.client.patch(`${t.base}/items/${t.books[1]}`, { assigneeId: t.editor.userId });
    expect(await notifications(t.editor.userId)).toEqual([]);
  });

  it('assigns several books at once: one notice with the count, notes kept, unknown books refuse the whole request', async () => {
    const t = await team();
    await t.owner.client.patch(`${t.base}/items/${t.books[2]}`, { note: 'Keep this note' });
    const other = (await someMaterialIds(h, t.versionId, 1, 50))[0]!;
    const bad = await t.owner.client.post(`${t.base}/items/assign`, { materialIds: [t.books[0], other], assigneeId: t.editor.userId });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toMatchObject({ code: 'INVALID_MATERIALS', details: { invalid: [other] } });
    expect((await t.owner.client.get(t.base)).json().annotations).toHaveLength(1);

    const res = await t.owner.client.post(`${t.base}/items/assign`, { materialIds: t.books.slice(0, 3), assigneeId: t.editor.userId });
    expect(res.json()).toEqual({ updated: 3 });
    const notes = await notifications(t.editor.userId);
    expect(notes.map((n) => n.title)).toEqual(['Owner Olfat assigned you 3 books']);
    const again = await t.owner.client.post(`${t.base}/items/assign`, { materialIds: t.books.slice(0, 3), assigneeId: t.editor.userId });
    expect(again.json()).toEqual({ updated: 0 });
    expect(await notifications(t.editor.userId)).toHaveLength(1);

    // Unassigning keeps the note; a book with neither note nor assignee disappears from the list.
    expect((await t.owner.client.post(`${t.base}/items/assign`, { materialIds: t.books.slice(0, 3), assigneeId: null })).json()).toEqual({ updated: 3 });
    expect((await t.owner.client.get(t.base)).json().annotations).toEqual([expect.objectContaining({ materialId: t.books[2], note: 'Keep this note', assigneeId: null })]);
  });

  it('removing a member clears their assignments and keeps the notes', async () => {
    const t = await team();
    await t.owner.client.patch(`${t.base}/items/${t.books[0]}`, { note: 'Order 30 copies', assigneeId: t.editor.userId });
    await t.owner.client.patch(`${t.base}/items/${t.books[1]}`, { assigneeId: t.editor.userId });
    expect((await t.owner.client.delete(`/api/orgs/${t.owner.orgId}/members/${t.editor.userId}`)).statusCode).toBe(200);
    expect((await t.owner.client.get(t.base)).json().annotations).toEqual([expect.objectContaining({ materialId: t.books[0], note: 'Order 30 copies', assigneeId: null })]);
  });

  it('the scopes list counts notes, assignments and what is assigned to me', async () => {
    const t = await team();
    await t.owner.client.patch(`${t.base}/items/${t.books[0]}`, { note: 'a', assigneeId: t.editor.userId });
    await t.owner.client.patch(`${t.base}/items/${t.books[1]}`, { assigneeId: t.editor.userId });
    await t.owner.client.patch(`${t.base}/items/${t.books[2]}`, { assigneeId: t.owner.userId });
    const forEditor = (await t.editor.client.get(`/api/orgs/${t.owner.orgId}/scopes`)).json().scopes[0];
    expect(forEditor).toMatchObject({ notes: 1, assigned: 3, assignedToMe: 2 });
    expect((await t.owner.client.get(`/api/orgs/${t.owner.orgId}/scopes`)).json().scopes[0]).toMatchObject({ assignedToMe: 1 });
  });

  it('a read-only scope (over the plan limit) cannot be annotated', async () => {
    const t = await team();
    const second = (await t.owner.client.post(`/api/orgs/${t.owner.orgId}/scopes`, { name: 'Second', catalogVersionId: t.versionId })).json().scope.id as string;
    await t.owner.client.post(`/api/orgs/${t.owner.orgId}/scopes/${second}/items`, { add: t.books.slice(0, 1) });
    await withSystemContext(h.ownerDb, (trx) => trx.updateTable('subscriptions').set({ limit_overrides: JSON.stringify({ max_scopes: 1 }) }).where('org_id', '=', t.owner.orgId).execute());
    const res = await t.owner.client.patch(`/api/orgs/${t.owner.orgId}/scopes/${second}/items/${t.books[0]}`, { note: 'x' });
    expect(res.statusCode).toBe(402);
    expect((await t.owner.client.patch(`${t.base}/items/${t.books[0]}`, { note: 'x' })).statusCode).toBe(200);
  });

  it('deselecting a book drops its note with it', async () => {
    const t = await team();
    await t.owner.client.patch(`${t.base}/items/${t.books[0]}`, { note: 'gone soon' });
    await t.owner.client.post(`${t.base}/items`, { remove: [t.books[0]] });
    await t.owner.client.post(`${t.base}/items`, { add: [t.books[0]] });
    expect((await t.owner.client.get(t.base)).json().annotations).toEqual([]);
  });
});

describe('notes travel with the scope', () => {
  it('a duplicate keeps notes and assignees', async () => {
    const t = await team();
    await t.owner.client.patch(`${t.base}/items/${t.books[0]}`, { note: 'Copied note', assigneeId: t.editor.userId });
    const copy = (await t.owner.client.post(`${t.base}/duplicate`, { name: 'Plan copy' })).json().scope.id as string;
    expect((await t.owner.client.get(`/api/orgs/${t.owner.orgId}/scopes/${copy}`)).json().annotations).toEqual([
      expect.objectContaining({ materialId: t.books[0], note: 'Copied note', assigneeId: t.editor.userId }),
    ]);
  });

  it('carrying forward keeps notes on carried books and reports those on books that cannot be carried', async () => {
    const t = await team();
    const admin = await createPlatformAdmin(h);
    const nextId = (await admin.post('/api/admin/catalog/versions', { fromVersionId: t.versionId, academicYear: '2027/2028', label: 'Next year' })).json().id as string;
    const titles = await h.ownerDb.selectFrom('catalog_materials').select(['id', 'title', 'subject_id']).where('id', 'in', t.books).execute();
    const dropped = titles.find((m) => m.id === t.books[1])!;
    const kept = titles.find((m) => m.id === t.books[0])!;
    const draftCopy = async (m: typeof kept) => {
      const subj = await h.ownerDb.selectFrom('catalog_subjects').select(['grade', 'track', 'block', 'code']).where('id', '=', m.subject_id).executeTakeFirstOrThrow();
      return h.ownerDb
        .selectFrom('catalog_materials as cm').innerJoin('catalog_subjects as cs', 'cs.id', 'cm.subject_id').select('cm.id')
        .where('cm.version_id', '=', nextId).where('cm.title', '=', m.title)
        .where('cs.grade', '=', subj.grade).where('cs.track', '=', subj.track).where('cs.block', '=', subj.block).where('cs.code', '=', subj.code)
        .executeTakeFirstOrThrow();
    };
    expect((await admin.delete(`/api/admin/catalog/materials/${(await draftCopy(dropped)).id}`)).statusCode).toBe(200);
    expect((await admin.post(`/api/admin/catalog/versions/${nextId}/publish`)).statusCode).toBe(200);

    await t.owner.client.patch(`${t.base}/items/${t.books[0]}`, { note: 'Follows the book', assigneeId: t.editor.userId, status: 'todo', dueOn: '2027-09-01' });
    await t.owner.client.patch(`${t.base}/items/${t.books[1]}`, { note: 'Book is dropped' });
    const preview = (await t.owner.client.get(`${t.base}/carry-forward?to=${nextId}`)).json();
    expect(preview.notes).toEqual({ carried: 1, lost: 1 });

    const res = await t.owner.client.post(`${t.base}/carry-forward`, { targetVersionId: nextId, mode: 'copy', name: 'Plan 2027' });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().notesCarried).toBe(1);
    const carried = (await t.owner.client.get(`/api/orgs/${t.owner.orgId}/scopes/${res.json().scope.id}`)).json();
    expect(carried.annotations).toEqual([expect.objectContaining({ materialId: (await draftCopy(kept)).id, note: 'Follows the book', assigneeId: t.editor.userId, status: 'todo', dueOn: '2027-09-01' })]);

    // Moving the original in place keeps its note too.
    const moved = await t.owner.client.post(`${t.base}/carry-forward`, { targetVersionId: nextId, mode: 'move' });
    expect(moved.statusCode, moved.body).toBe(200);
    expect((await t.owner.client.get(t.base)).json().annotations).toEqual([expect.objectContaining({ note: 'Follows the book' })]);
  });

  it('CSV and JSON exports and the read API carry note and assignee; the text export stays the original layout', async () => {
    const t = await team();
    await t.owner.client.patch(`${t.base}/items/${t.books[0]}`, { note: '=SUM(1) check edition', assigneeId: t.editor.userId });
    const csv = parseCsv((await t.owner.client.get(`${t.base}/export?format=csv`)).body);
    const header = csv[0]!;
    const row = csv.find((r) => r[header.indexOf('material_id')] === t.books[0])!;
    expect(header.slice(-4, -2)).toEqual(['note', 'assignee']);
    expect(row.slice(-4, -2)).toEqual(["'=SUM(1) check edition", 'Member editor']);
    const json = JSON.parse((await t.owner.client.get(`${t.base}/export?format=json`)).body);
    expect(json.items.find((i: { materialId: string }) => i.materialId === t.books[0])).toMatchObject({ note: '=SUM(1) check edition', assignee: 'Member editor' });
    expect((await t.owner.client.get(`${t.base}/export?format=txt`)).body).not.toContain('SUM');

    const key = (await t.owner.client.post(`/api/orgs/${t.owner.orgId}/api-keys`, { name: 'n' })).json().key as string;
    const api = await h.app.inject({ method: 'GET', url: `/api/v1/scopes/${t.scopeId}`, headers: { authorization: `Bearer ${key}` } });
    expect(api.json().items.find((i: { materialId: string }) => i.materialId === t.books[0])).toMatchObject({ note: '=SUM(1) check edition', assignee: 'Member editor' });
  });

  it('another organization cannot read or change them', async () => {
    const t = await team();
    const other = await signUp(h, { org: 'Other' });
    expect((await other.client.patch(`${t.base}/items/${t.books[0]}`, { note: 'x' })).statusCode).toBe(404);
    expect((await other.client.post(`${t.base}/items/assign`, { materialIds: [t.books[0]], assigneeId: other.userId })).statusCode).toBe(404);
    expect((await other.client.get(t.base)).statusCode).toBe(404);
  });
});

describe('status, due dates, assignment emails and my assignments', () => {
  const emails = (to: string) => h.ownerDb.selectFrom('email_outbox').select(['subject', 'text_body']).where('to_email', '=', to).where('template', '=', 'items_assigned').execute();

  it('an editor sets a status and a due date; bad values are refused', async () => {
    const t = await team();
    const res = await t.editor.client.patch(`${t.base}/items/${t.books[0]}`, { status: 'in_progress', dueOn: '2026-11-15' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().annotation).toMatchObject({ status: 'in_progress', dueOn: '2026-11-15', note: null, assigneeId: null });
    expect((await t.viewer.client.get(t.base)).json().annotations).toEqual([expect.objectContaining({ materialId: t.books[0], status: 'in_progress', dueOn: '2026-11-15' })]);
    for (const bad of [{ status: 'finished' }, { dueOn: '2026-13-01' }, { dueOn: '15/11/2026' }, { dueOn: '1999-12-31' }]) {
      expect((await t.editor.client.patch(`${t.base}/items/${t.books[0]}`, bad)).json().error.code, JSON.stringify(bad)).toBe('VALIDATION_ERROR');
    }
    // Clearing everything leaves nothing to follow up.
    await t.editor.client.patch(`${t.base}/items/${t.books[0]}`, { status: null, dueOn: null });
    expect((await t.viewer.client.get(t.base)).json().annotations).toEqual([]);
  });

  it('the member a book is assigned to can update its status, even as a viewer, and nothing else', async () => {
    const t = await team();
    await t.owner.client.patch(`${t.base}/items/${t.books[0]}`, { assigneeId: t.viewer.userId, note: 'Check the edition' });
    expect((await t.viewer.client.patch(`${t.base}/items/${t.books[0]}`, { status: 'done' })).statusCode).toBe(200);
    expect((await t.viewer.client.patch(`${t.base}/items/${t.books[0]}`, { status: 'done', note: 'changed' })).statusCode).toBe(403);
    expect((await t.viewer.client.patch(`${t.base}/items/${t.books[0]}`, { dueOn: '2026-12-01' })).statusCode).toBe(403);
    expect((await t.viewer.client.patch(`${t.base}/items/${t.books[1]}`, { status: 'done' })).statusCode).toBe(403);
    const a = (await t.owner.client.get(t.base)).json().annotations[0];
    expect(a).toMatchObject({ status: 'done', note: 'Check the edition', assigneeId: t.viewer.userId, annotatedBy: 'Member viewer' });
  });

  it('updates status and due date of several books at once, keeping notes and assignees', async () => {
    const t = await team();
    await t.owner.client.patch(`${t.base}/items/${t.books[0]}`, { note: 'Keep', assigneeId: t.editor.userId });
    const res = await t.owner.client.post(`${t.base}/items/assign`, { materialIds: t.books.slice(0, 3), status: 'todo', dueOn: '2026-12-01' });
    expect(res.json()).toEqual({ updated: 3 });
    const list = (await t.owner.client.get(t.base)).json().annotations;
    expect(list).toHaveLength(3);
    expect(list.find((a: { materialId: string }) => a.materialId === t.books[0])).toMatchObject({ note: 'Keep', assigneeId: t.editor.userId, status: 'todo', dueOn: '2026-12-01' });
    expect((await t.owner.client.post(`${t.base}/items/assign`, { materialIds: t.books.slice(0, 1) })).json().error.code).toBe('VALIDATION_ERROR');
    const audit = (await t.owner.client.get(`/api/orgs/${t.owner.orgId}/audit-logs?action=scope.items_`)).json().entries;
    expect(audit[0]).toMatchObject({ action: 'scope.items_tracked', metadata: { count: 3, status: 'todo', dueOn: '2026-12-01' } });
    // No editor rights, no bulk updates.
    expect((await t.viewer.client.post(`${t.base}/items/assign`, { materialIds: t.books.slice(0, 1), status: 'done' })).statusCode).toBe(403);
  });

  it('emails the new assignee the list of books, in their language, unless they turned it off', async () => {
    const t = await team();
    await t.editor.client.patch('/api/auth/profile', { locale: 'ar' });
    const titles = await h.ownerDb.selectFrom('catalog_materials').select('title').where('id', 'in', t.books.slice(0, 2)).execute();
    await t.owner.client.post(`${t.base}/items/assign`, { materialIds: t.books.slice(0, 2), assigneeId: t.editor.userId });
    const mail = await emails(t.editor.email);
    expect(mail).toHaveLength(1);
    expect(mail[0]!.subject).toBe('أسند إليك Owner Olfat كتبًا في «Plan» (2)');
    for (const { title } of titles) expect(mail[0]!.text_body).toContain(`• ${title}`);
    expect(mail[0]!.text_body).toContain(`/org/${t.owner.orgId}/scopes/${t.scopeId}/items?show=mine`);
    expect(mail[0]!.text_body).toContain('/account');

    // Assigning yourself sends nothing; turning emails off keeps the in-app notice only.
    await t.editor.client.patch(`${t.base}/items/${t.books[2]}`, { assigneeId: t.editor.userId });
    expect((await t.editor.client.patch('/api/auth/profile', { assignmentEmails: false })).json().user.assignmentEmails).toBe(false);
    await t.owner.client.patch(`${t.base}/items/${t.books[3]}`, { assigneeId: t.editor.userId });
    expect(await emails(t.editor.email)).toHaveLength(1);
    expect(await notifications(t.editor.userId)).toHaveLength(2);
  });

  it('a long list is shortened in the email', async () => {
    const owner = await signUp(h, { org: 'Big School', name: 'Owner Olfat' });
    const editor = await addMember(h, owner.client, owner.orgId, 'editor');
    const versionId = await publishedVersionId(h);
    const books = await someMaterialIds(h, versionId, 13);
    const scopeId = (await owner.client.post(`/api/orgs/${owner.orgId}/scopes`, { name: 'Big', catalogVersionId: versionId })).json().scope.id as string;
    await owner.client.post(`/api/orgs/${owner.orgId}/scopes/${scopeId}/items`, { add: books });
    await owner.client.post(`/api/orgs/${owner.orgId}/scopes/${scopeId}/items/assign`, { materialIds: books, assigneeId: editor.userId });
    const [mail] = await emails(editor.email);
    expect(mail!.subject).toBe('Owner Olfat assigned you 13 books in “Big”');
    expect(mail!.text_body.match(/^• /gm)).toHaveLength(11);
    expect(mail!.text_body).toContain('• and 3 more');
  });

  it('my assignments: across scopes, overdue first, then by due date; done ones apart; counts for the navigation', async () => {
    const t = await team();
    const second = (await t.owner.client.post(`/api/orgs/${t.owner.orgId}/scopes`, { name: 'Second plan', catalogVersionId: t.versionId })).json().scope.id as string;
    const secondBase = `/api/orgs/${t.owner.orgId}/scopes/${second}`;
    await t.owner.client.post(`${secondBase}/items`, { add: t.books.slice(0, 1) });
    await t.owner.client.patch(`${t.base}/items/${t.books[0]}`, { assigneeId: t.editor.userId, dueOn: '2100-01-10' });
    await t.owner.client.patch(`${t.base}/items/${t.books[1]}`, { assigneeId: t.editor.userId });
    await t.owner.client.patch(`${t.base}/items/${t.books[2]}`, { assigneeId: t.editor.userId, dueOn: '2000-01-05', status: 'in_progress' });
    await t.owner.client.patch(`${t.base}/items/${t.books[3]}`, { assigneeId: t.editor.userId, status: 'done' });
    await t.owner.client.patch(`${secondBase}/items/${t.books[0]}`, { assigneeId: t.editor.userId, dueOn: '2100-01-01', note: 'Other scope' });
    await t.owner.client.patch(`${t.base}/items/${t.books[1]}`, { note: 'not mine' });

    const open = (await t.editor.client.get(`/api/orgs/${t.owner.orgId}/assignments`)).json();
    expect(open.items.map((i: { materialId: string; scopeName: string }) => [i.materialId, i.scopeName])).toEqual([
      [t.books[2], 'Plan'], [t.books[0], 'Second plan'], [t.books[0], 'Plan'], [t.books[1], 'Plan'],
    ]);
    expect(open.items[0]).toMatchObject({ overdue: true, status: 'in_progress', dueOn: '2000-01-05', title: expect.any(String), grade: expect.any(Number), readOnly: false });
    expect(open.items[1]).toMatchObject({ overdue: false, note: 'Other scope' });
    expect(open.canEditAll).toBe(true);
    const done = (await t.editor.client.get(`/api/orgs/${t.owner.orgId}/assignments?show=done`)).json().items;
    expect(done.map((i: { materialId: string }) => i.materialId)).toEqual([t.books[3]]);
    expect((await t.editor.client.get(`/api/orgs/${t.owner.orgId}/assignments?show=all`)).json().items).toHaveLength(5);
    expect((await t.editor.client.get(`/api/orgs/${t.owner.orgId}`)).json().myAssignments).toEqual({ open: 4, overdue: 1, dueSoon: 0 });
    expect((await t.owner.client.get(`/api/orgs/${t.owner.orgId}/assignments`)).json().items).toEqual([]);
    expect((await t.viewer.client.get(`/api/orgs/${t.owner.orgId}`)).json().myAssignments).toEqual({ open: 0, overdue: 0, dueSoon: 0 });
  });

  it('status and due date travel with duplicates and carry-forward, and appear in exports', async () => {
    const t = await team();
    await t.owner.client.patch(`${t.base}/items/${t.books[0]}`, { status: 'in_progress', dueOn: '2026-11-15' });
    const copy = (await t.owner.client.post(`${t.base}/duplicate`, { name: 'Plan copy' })).json().scope.id as string;
    expect((await t.owner.client.get(`/api/orgs/${t.owner.orgId}/scopes/${copy}`)).json().annotations).toEqual([expect.objectContaining({ status: 'in_progress', dueOn: '2026-11-15' })]);
    const csv = parseCsv((await t.owner.client.get(`${t.base}/export?format=csv`)).body);
    const header = csv[0]!;
    expect(header.slice(-4)).toEqual(['note', 'assignee', 'status', 'due_on']);
    expect(csv.find((r) => r[header.indexOf('material_id')] === t.books[0])!.slice(-2)).toEqual(['in_progress', '2026-11-15']);
    const json = JSON.parse((await t.owner.client.get(`${t.base}/export?format=json`)).body);
    expect(json.items.find((i: { materialId: string }) => i.materialId === t.books[0])).toMatchObject({ status: 'in_progress', dueOn: '2026-11-15' });
  });
});
