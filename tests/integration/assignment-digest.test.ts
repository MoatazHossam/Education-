import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withOrgContext, withSystemContext, withUserContext } from '../../src/db/index.js';
import { runCleanup } from '../../src/jobs/tasks.js';
import { runAssignmentDigests } from '../../src/scopes/digest.js';
import { addMember, createHarness, distinctTitleMaterialIds, publishedVersionId, resetData, signUp, type Harness } from '../helpers/harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness({ RATE_LIMIT_ENABLED: 'false' });
});
afterAll(async () => h.close());
beforeEach(async () => resetData(h.ownerDb));

/** 08:30 UTC tomorrow: after tomorrow's 08:00 in Cairo, so everything assigned so far is due in that summary. */
function tomorrowMorning(): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(8, 30, 0, 0);
  return d;
}
const run = (now = tomorrowMorning()) => runAssignmentDigests(h.db, h.config, now);

/** A school with a scope of `n` books, an owner and an editor (Hana) who chose the morning summary. */
async function school(org = 'Alpha School', n = 4) {
  const owner = await signUp(h, { org, name: 'Owner Olfat' });
  const hana = await addMember(h, owner.client, owner.orgId, 'editor');
  expect((await hana.client.patch('/api/auth/profile', { assignmentEmailFrequency: 'daily' })).json().user).toMatchObject({ assignmentEmails: true, assignmentEmailFrequency: 'daily' });
  const versionId = await publishedVersionId(h);
  const books = await distinctTitleMaterialIds(h, versionId, n);
  const scopeId = (await owner.client.post(`/api/orgs/${owner.orgId}/scopes`, { name: 'Plan', catalogVersionId: versionId })).json().scope.id as string;
  expect((await owner.client.post(`/api/orgs/${owner.orgId}/scopes/${scopeId}/items`, { add: books })).statusCode).toBe(200);
  const base = `/api/orgs/${owner.orgId}/scopes/${scopeId}`;
  const titles = new Map((await h.ownerDb.selectFrom('catalog_materials').select(['id', 'title']).where('id', 'in', books).execute()).map((r) => [r.id, r.title]));
  const assign = async (ids: string[], assigneeId = hana.userId, by = owner.client) => {
    const res = await by.post(`${base}/items/assign`, { materialIds: ids, assigneeId });
    expect(res.statusCode, res.body).toBe(200);
  };
  return { owner, hana, versionId, books, scopeId, base, titles, assign };
}

const emails = (to: string, template: string) =>
  h.ownerDb.selectFrom('email_outbox').select(['subject', 'text_body']).where('to_email', '=', to).where('template', '=', template).orderBy('created_at').execute();
// assignment_digest_items has forced row-level security, even for the table owner.
const waiting = () => withSystemContext(h.ownerDb, (trx) => trx.selectFrom('assignment_digest_items').selectAll().execute());

describe('daily summary of assignment emails', () => {
  it('members who chose it get no email per assignment, only the in-app notice; the books wait for the morning summary', async () => {
    const s = await school();
    await s.assign(s.books.slice(0, 2));
    await s.assign(s.books.slice(2, 3));
    expect(await emails(s.hana.email, 'items_assigned')).toEqual([]);
    const notices = await h.ownerDb.selectFrom('notifications').select('title').where('user_id', '=', s.hana.userId).where('kind', '=', 'item_assigned').execute();
    expect(notices).toHaveLength(2);
    expect(await waiting()).toHaveLength(3);

    expect(await run()).toEqual({ members: 1, emails: 1, books: 3, failed: 0 });
    const [mail, ...rest] = await emails(s.hana.email, 'items_assigned_daily');
    expect(rest).toEqual([]);
    expect(mail!.subject).toBe('Your daily summary: 3 books assigned to you');
    const sorted = s.books.slice(0, 3).map((id) => s.titles.get(id)!).sort((a, b) => a.localeCompare(b));
    expect(mail!.text_body).toContain(`Hello Member editor,\n\nBooks assigned to you since your last summary:\n\nAlpha School (3 books):\n“Plan”, assigned by Owner Olfat:\n${sorted.map((t) => `• ${t}`).join('\n')}\nSee them: ${h.config.APP_URL}/org/${s.owner.orgId}/assignments`);
    expect(mail!.text_body).toContain(`${h.config.APP_URL}/account`);
    expect(await waiting()).toEqual([]);
    expect(await run()).toEqual({ members: 0, emails: 0, books: 0, failed: 0 });
  });

  it('sends at most one summary a day: what is assigned after the morning sending time waits for the next morning', async () => {
    const s = await school();
    await s.assign(s.books.slice(0, 1));
    await s.assign(s.books.slice(1, 2));
    // Cairo is UTC+2 in November: 08:00 there is 06:00 UTC.
    const at = (book: string, iso: string) =>
      withSystemContext(h.ownerDb, (trx) => trx.updateTable('assignment_digest_items').set({ assigned_at: new Date(iso) }).where('material_id', '=', book).execute());
    await at(s.books[0]!, '2026-11-09T15:00:00Z');
    await at(s.books[1]!, '2026-11-10T07:00:00Z');

    expect(await run(new Date('2026-11-10T05:30:00Z'))).toMatchObject({ skipped: 'outside_hours' });
    expect(await run(new Date('2026-11-10T06:30:00Z'))).toMatchObject({ members: 1, emails: 1, books: 1 });
    expect((await emails(s.hana.email, 'items_assigned_daily'))[0]!.text_body).toContain(s.titles.get(s.books[0]!)!);
    expect(await run(new Date('2026-11-10T09:00:00Z'))).toMatchObject({ members: 0, emails: 0 });
    expect(await run(new Date('2026-11-11T06:30:00Z'))).toMatchObject({ members: 1, emails: 1, books: 1 });
    const second = (await emails(s.hana.email, 'items_assigned_daily'))[1]!;
    expect(second.subject).toBe('Your daily summary: 1 book assigned to you');
    expect(second.text_body).toContain(s.titles.get(s.books[1]!)!);
  });

  it('one email covers every organization, grouped by scope and by who assigned the books', async () => {
    const a = await school('Alpha School');
    const editorB = await addMember(h, a.owner.client, a.owner.orgId, 'editor');
    await a.assign(a.books.slice(0, 1));
    await a.assign(a.books.slice(1, 2), a.hana.userId, editorB.client);

    // Hana is also a member of a second school.
    const b = await signUp(h, { org: 'Beta School', name: 'Owner Bassem' });
    await withSystemContext(h.ownerDb, (trx) => trx.insertInto('memberships').values({ org_id: b.orgId, user_id: a.hana.userId, role: 'viewer' }).execute());
    const scopeB = (await b.client.post(`/api/orgs/${b.orgId}/scopes`, { name: 'Grade 1', catalogVersionId: a.versionId })).json().scope.id as string;
    await b.client.post(`/api/orgs/${b.orgId}/scopes/${scopeB}/items`, { add: a.books.slice(2, 3) });
    expect((await b.client.post(`/api/orgs/${b.orgId}/scopes/${scopeB}/items/assign`, { materialIds: a.books.slice(2, 3), assigneeId: a.hana.userId })).statusCode).toBe(200);

    expect(await run()).toMatchObject({ members: 1, emails: 1, books: 3 });
    const [mail] = await emails(a.hana.email, 'items_assigned_daily');
    const body = mail!.text_body;
    expect(body).toContain(`Alpha School (2 books):\n“Plan”, assigned by Member editor:\n• ${a.titles.get(a.books[1]!)}\n“Plan”, assigned by Owner Olfat:\n• ${a.titles.get(a.books[0]!)}\nSee them: ${h.config.APP_URL}/org/${a.owner.orgId}/assignments`);
    expect(body).toContain(`Beta School (1 book):\n“Grade 1”, assigned by Owner Bassem:\n• ${a.titles.get(a.books[2]!)}\nSee them: ${h.config.APP_URL}/org/${b.orgId}/assignments`);
    expect(body.indexOf('Alpha School')).toBeLessThan(body.indexOf('Beta School'));
  });

  it('leaves out books unassigned or removed since, and suspended organizations; nothing left means no email', async () => {
    const s = await school();
    await s.assign(s.books);
    await s.owner.client.patch(`${s.base}/items/${s.books[0]}`, { assigneeId: s.owner.userId });
    await s.owner.client.post(`${s.base}/items`, { remove: [s.books[1]] });
    expect(await run()).toMatchObject({ emails: 1, books: 2 });
    const body = (await emails(s.hana.email, 'items_assigned_daily'))[0]!.text_body;
    expect(body).not.toContain(s.titles.get(s.books[0]!)!);
    expect(body).toContain(s.titles.get(s.books[2]!)!);

    await s.owner.client.post(`${s.base}/items/assign`, { materialIds: s.books.slice(2), assigneeId: null });
    await s.assign(s.books.slice(2));
    await h.ownerDb.updateTable('organizations').set({ status: 'suspended' }).where('id', '=', s.owner.orgId).execute();
    expect(await run()).toMatchObject({ members: 1, emails: 0, books: 0 });
    expect(await waiting()).toEqual([]);
    expect(await emails(s.hana.email, 'items_assigned_daily')).toHaveLength(1);
  });

  it('switching back to emails right away, or off, drops what was waiting; the choice is validated', async () => {
    const s = await school();
    await s.assign(s.books.slice(0, 1));
    expect(await waiting()).toHaveLength(1);
    expect((await s.hana.client.patch('/api/auth/profile', { assignmentEmailFrequency: 'weekly' })).statusCode).toBe(400);
    const back = (await s.hana.client.patch('/api/auth/profile', { assignmentEmailFrequency: 'instant' })).json().user;
    expect(back).toMatchObject({ assignmentEmails: true, assignmentEmailFrequency: 'instant' });
    expect(await waiting()).toEqual([]);
    await s.assign(s.books.slice(1, 2));
    expect(await emails(s.hana.email, 'items_assigned')).toHaveLength(1);

    await s.hana.client.patch('/api/auth/profile', { assignmentEmailFrequency: 'daily' });
    await s.assign(s.books.slice(2, 3));
    expect(await waiting()).toHaveLength(1);
    await s.hana.client.patch('/api/auth/profile', { assignmentEmails: false });
    expect(await waiting()).toEqual([]);
    expect((await s.hana.client.get('/api/auth/me')).json().user).toMatchObject({ assignmentEmails: false, assignmentEmailFrequency: 'daily' });
    await s.assign(s.books.slice(3, 4));
    expect(await waiting()).toEqual([]);
    expect(await run()).toMatchObject({ members: 0, emails: 0 });
  });

  it('an unverified address gets no summary; the waiting books are dropped', async () => {
    const s = await school();
    await s.assign(s.books.slice(0, 2));
    await h.ownerDb.updateTable('users').set({ email_verified_at: null }).where('id', '=', s.hana.userId).execute();
    expect(await run()).toMatchObject({ members: 1, emails: 0 });
    expect(await waiting()).toEqual([]);
  });

  it('writes in the member’s language and shortens long lists', async () => {
    const s = await school('Alpha School', 13);
    await s.hana.client.patch('/api/auth/profile', { locale: 'ar' });
    await s.assign(s.books);
    expect(await run()).toMatchObject({ emails: 1, books: 13 });
    const [mail] = await emails(s.hana.email, 'items_assigned_daily');
    expect(mail!.subject).toBe('ملخصك اليومي: كتب أُسندت إليك (13)');
    expect(mail!.text_body).toContain('Alpha School (13):\n«Plan»، أسندها Owner Olfat:');
    expect(mail!.text_body.match(/^• /gm)).toHaveLength(11);
    expect(mail!.text_body).toContain('• و3 غيرها');
    expect(mail!.text_body).toContain('اطّلع عليها: ');
  });

  it('two workers running at once send one summary', async () => {
    const s = await school();
    await s.assign(s.books);
    const results = await Promise.all([run(), run(), run()]);
    expect(results.reduce((n, r) => n + r.emails, 0)).toBe(1);
    expect(results.reduce((n, r) => n + r.failed, 0)).toBe(0);
    expect(await emails(s.hana.email, 'items_assigned_daily')).toHaveLength(1);
  });

  it('waiting rows stay inside the organization and the member; old ones are cleaned up', async () => {
    const s = await school();
    await s.assign(s.books.slice(0, 2));
    const other = await signUp(h, { org: 'Other School' });
    expect(await withOrgContext(h.db, { orgId: other.orgId }, (trx) => trx.selectFrom('assignment_digest_items').selectAll().execute())).toEqual([]);
    expect(await withUserContext(h.db, other.userId, (trx) => trx.selectFrom('assignment_digest_items').selectAll().execute())).toEqual([]);
    expect(await withUserContext(h.db, s.hana.userId, (trx) => trx.selectFrom('assignment_digest_items').selectAll().execute())).toHaveLength(2);
    // A member cannot add rows for themselves outside an organization context.
    await expect(
      withUserContext(h.db, s.hana.userId, (trx) =>
        trx.insertInto('assignment_digest_items').values({ org_id: s.owner.orgId, user_id: s.hana.userId, scope_id: s.scopeId, material_id: s.books[2]! }).execute(),
      ),
    ).rejects.toThrow(/row-level security/);

    const later = new Date(Date.now() + 31 * 86_400_000);
    expect((await runCleanup(h.db, h.config, new Date(Date.now() + 29 * 86_400_000))).digestItems).toBe(0);
    expect((await runCleanup(h.db, h.config, later)).digestItems).toBe(2);
  });
});
