import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withOrgContext, withSystemContext } from '../../src/db/index.js';
import { runCleanup } from '../../src/jobs/tasks.js';
import { runDueReminders } from '../../src/scopes/reminders.js';
import { addMember, createHarness, publishedVersionId, resetData, signUp, someMaterialIds, type Harness } from '../helpers/harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness({ RATE_LIMIT_ENABLED: 'false' });
});
afterAll(async () => h.close());
beforeEach(async () => resetData(h.ownerDb));

// 10:30 in Cairo (UTC+2 in November): inside the sending hours. "Today" is 2026-11-10.
const MORNING = new Date('2026-11-10T08:30:00Z');
const NEXT_MORNING = new Date('2026-11-11T08:30:00Z');
const run = (now = MORNING) => runDueReminders(h.db, h.config, now);

async function team(n = 4) {
  const owner = await signUp(h, { org: 'Reminder School', name: 'Owner Olfat' });
  const editor = await addMember(h, owner.client, owner.orgId, 'editor');
  const viewer = await addMember(h, owner.client, owner.orgId, 'viewer');
  const versionId = await publishedVersionId(h);
  const books = await someMaterialIds(h, versionId, n);
  const scopeId = (await owner.client.post(`/api/orgs/${owner.orgId}/scopes`, { name: 'Plan', catalogVersionId: versionId })).json().scope.id as string;
  expect((await owner.client.post(`/api/orgs/${owner.orgId}/scopes/${scopeId}/items`, { add: books })).statusCode).toBe(200);
  const base = `/api/orgs/${owner.orgId}/scopes/${scopeId}`;
  const titles = new Map((await h.ownerDb.selectFrom('catalog_materials').select(['id', 'title']).where('id', 'in', books).execute()).map((r) => [r.id, r.title]));
  /** Sets assignee, due date and status of one book, as the owner. */
  const track = async (book: string, body: Record<string, unknown>) => {
    const res = await owner.client.patch(`${base}/items/${book}`, body);
    expect(res.statusCode, res.body).toBe(200);
  };
  return { owner, editor, viewer, versionId, books, scopeId, base, titles, track };
}

const reminderEmails = (to: string) =>
  h.ownerDb.selectFrom('email_outbox').select(['subject', 'text_body']).where('to_email', '=', to).where('template', '=', 'items_due').orderBy('created_at').execute();
const reminderNotices = (userId: string) =>
  h.ownerDb.selectFrom('notifications').select(['title', 'body', 'link', 'org_id']).where('user_id', '=', userId).where('kind', '=', 'items_due').orderBy('created_at').execute();
// item_reminders has forced row-level security, even for the table owner.
const records = () => withSystemContext(h.ownerDb, (trx) => trx.selectFrom('item_reminders').selectAll().orderBy('due_on').execute());

describe('due-date reminders', () => {
  it('reminds the assignee once about books due soon and overdue, in one email listing both', async () => {
    const t = await team();
    const [today, inTwoDays, inThreeDays, twoDaysAgo] = t.books as [string, string, string, string];
    await t.track(today, { assigneeId: t.editor.userId, dueOn: '2026-11-10', status: 'in_progress' });
    await t.track(inTwoDays, { assigneeId: t.editor.userId, dueOn: '2026-11-12' });
    await t.track(inThreeDays, { assigneeId: t.editor.userId, dueOn: '2026-11-13' });
    await t.track(twoDaysAgo, { assigneeId: t.editor.userId, dueOn: '2026-11-08', status: 'todo' });

    expect(await run()).toEqual({ members: 1, reminded: 3, emails: 1, failed: 0 });
    const [mail, ...rest] = await reminderEmails(t.editor.email);
    expect(rest).toEqual([]);
    expect(mail!.subject).toBe('Reminder: 1 overdue and 2 due soon in Reminder School');
    const body = mail!.text_body;
    expect(body).toContain('Hello Member editor,');
    expect(body).toContain(`Overdue (1):\n• ${t.titles.get(twoDaysAgo)} — “Plan”, was due 8 Nov 2026`);
    expect(body).toContain(`Due soon (2):\n• ${t.titles.get(today)} — “Plan”, due today\n• ${t.titles.get(inTwoDays)} — “Plan”, due 12 Nov 2026`);
    expect(body).not.toContain(t.titles.get(inThreeDays)!);
    expect(body).toContain(`${h.config.APP_URL}/org/${t.owner.orgId}/assignments`);
    expect(body).toContain(`${h.config.APP_URL}/account`);
    expect(await reminderNotices(t.editor.userId)).toEqual([
      { title: '1 overdue and 2 due soon', body: 'Books assigned to you in Reminder School.', link: `/org/${t.owner.orgId}/assignments`, org_id: t.owner.orgId },
    ]);

    // The next pass the same day finds nothing new.
    expect(await run()).toEqual({ members: 0, reminded: 0, emails: 0, failed: 0 });
    expect(await reminderEmails(t.editor.email)).toHaveLength(1);

    // The next day, the book due today is overdue and the one due in three days is due soon.
    expect(await run(NEXT_MORNING)).toMatchObject({ members: 1, reminded: 2, emails: 1 });
    const second = (await reminderEmails(t.editor.email))[1]!;
    expect(second.subject).toBe('Reminder: 1 overdue and 1 due soon in Reminder School');
    expect(second.text_body).toContain(`Overdue (1):\n• ${t.titles.get(today)} — “Plan”, was due 10 Nov 2026`);
    expect(second.text_body).toContain(`Due soon (1):\n• ${t.titles.get(inThreeDays)} — “Plan”, due 13 Nov 2026`);
    expect(second.text_body).not.toContain(t.titles.get(twoDaysAgo)!);
    expect((await records()).map((r) => r.kind).sort()).toEqual(['due_soon', 'due_soon', 'due_soon', 'overdue', 'overdue']);
  });

  it('writes to each member in their language, one email per member', async () => {
    const t = await team();
    await t.viewer.client.patch('/api/auth/profile', { locale: 'ar' });
    await t.track(t.books[0]!, { assigneeId: t.viewer.userId, dueOn: '2026-11-11' });
    await t.track(t.books[1]!, { assigneeId: t.viewer.userId, dueOn: '2026-11-05' });
    await t.track(t.books[2]!, { assigneeId: t.editor.userId, dueOn: '2026-11-10' });
    expect(await run()).toMatchObject({ members: 2, reminded: 3, emails: 2 });
    const [ar] = await reminderEmails(t.viewer.email);
    expect(ar!.subject).toBe('تذكير: كتب متأخرة (1) وكتب يحين موعدها قريبًا (1) في Reminder School');
    expect(ar!.text_body).toContain(`يحين موعدها قريبًا (1):\n• ${t.titles.get(t.books[0]!)} — «Plan»، موعده غدًا`);
    expect(ar!.text_body).toContain(`متأخرة عن موعدها (1):\n• ${t.titles.get(t.books[1]!)} — «Plan»، كان موعده`);
    expect((await reminderNotices(t.viewer.userId))[0]!.title).toBe('كتب متأخرة (1) وكتب يحين موعدها قريبًا (1)');
    const [en] = await reminderEmails(t.editor.email);
    expect(en!.subject).toBe('Reminder: 1 book is due soon in Reminder School');
    expect((await reminderNotices(t.editor.userId))[0]!.title).toBe('1 book is due soon');
  });

  it('leaves out done books, unassigned books and books overdue for more than a week; sends only between 8:00 and 21:00 Cairo time', async () => {
    const t = await team();
    await t.track(t.books[0]!, { assigneeId: t.editor.userId, dueOn: '2026-11-10', status: 'done' });
    await t.track(t.books[1]!, { dueOn: '2026-11-10' });
    await t.track(t.books[2]!, { assigneeId: t.editor.userId, dueOn: '2026-11-02' });
    await t.track(t.books[3]!, { assigneeId: t.editor.userId, dueOn: '2026-11-03' });

    // 06:00 and 21:30 in Cairo.
    for (const early of [new Date('2026-11-10T04:00:00Z'), new Date('2026-11-10T19:30:00Z')]) {
      expect(await run(early)).toEqual({ skipped: 'outside_hours', members: 0, reminded: 0, emails: 0, failed: 0 });
    }
    expect(await records()).toEqual([]);
    expect(await run()).toMatchObject({ members: 1, reminded: 1 });
    expect((await records()).map((r) => [r.material_id, r.kind])).toEqual([[t.books[3], 'overdue']]);
  });

  it('a new due date or a new assignee is reminded again; reopening a book is not', async () => {
    const t = await team();
    const book = t.books[0]!;
    await t.track(book, { assigneeId: t.editor.userId, dueOn: '2026-11-10' });
    expect(await run()).toMatchObject({ reminded: 1 });

    await t.track(book, { status: 'done' });
    await t.track(book, { status: 'todo' });
    expect(await run()).toMatchObject({ reminded: 0 });

    await t.track(book, { dueOn: '2026-11-11' });
    expect(await run()).toMatchObject({ members: 1, reminded: 1 });
    await t.track(book, { assigneeId: t.viewer.userId });
    expect(await run()).toMatchObject({ members: 1, reminded: 1 });
    expect(await reminderEmails(t.editor.email)).toHaveLength(2);
    expect(await reminderEmails(t.viewer.email)).toHaveLength(1);
  });

  it('turning reminder emails off keeps the in-app notice; unverified addresses get the notice only', async () => {
    const t = await team();
    expect((await t.editor.client.get('/api/auth/me')).json().user.dueReminderEmails).toBe(true);
    expect((await t.editor.client.patch('/api/auth/profile', { dueReminderEmails: 'no' })).statusCode).toBe(400);
    expect((await t.editor.client.patch('/api/auth/profile', { dueReminderEmails: false })).json().user.dueReminderEmails).toBe(false);
    await h.ownerDb.updateTable('users').set({ email_verified_at: null }).where('id', '=', t.viewer.userId).execute();
    await t.track(t.books[0]!, { assigneeId: t.editor.userId, dueOn: '2026-11-10' });
    await t.track(t.books[1]!, { assigneeId: t.viewer.userId, dueOn: '2026-11-10' });

    expect(await run()).toEqual({ members: 2, reminded: 2, emails: 0, failed: 0 });
    expect(await reminderEmails(t.editor.email)).toEqual([]);
    expect(await reminderEmails(t.viewer.email)).toEqual([]);
    expect(await reminderNotices(t.editor.userId)).toHaveLength(1);
    expect(await reminderNotices(t.viewer.userId)).toHaveLength(1);
  });

  it('suspended accounts and organizations get nothing until they are active again', async () => {
    const t = await team();
    await t.track(t.books[0]!, { assigneeId: t.editor.userId, dueOn: '2026-11-10' });
    await t.track(t.books[1]!, { assigneeId: t.viewer.userId, dueOn: '2026-11-10' });
    await h.ownerDb.updateTable('users').set({ status: 'suspended' }).where('id', '=', t.editor.userId).execute();
    expect(await run()).toMatchObject({ members: 1, reminded: 1 });
    expect(await reminderNotices(t.editor.userId)).toEqual([]);

    await h.ownerDb.updateTable('users').set({ status: 'active' }).where('id', '=', t.editor.userId).execute();
    await h.ownerDb.updateTable('organizations').set({ status: 'suspended' }).where('id', '=', t.owner.orgId).execute();
    expect(await run()).toMatchObject({ members: 0, reminded: 0 });
    await h.ownerDb.updateTable('organizations').set({ status: 'active' }).where('id', '=', t.owner.orgId).execute();
    expect(await run()).toMatchObject({ members: 1, reminded: 1 });
    expect(await reminderEmails(t.editor.email)).toHaveLength(1);
  });

  it('two workers running at once send each reminder once', async () => {
    const t = await team();
    for (const book of t.books) await t.track(book, { assigneeId: t.editor.userId, dueOn: '2026-11-11' });
    const results = await Promise.all([run(), run(), run()]);
    expect(results.reduce((n, r) => n + r.reminded, 0)).toBe(4);
    expect(results.reduce((n, r) => n + r.failed, 0)).toBe(0);
    const mail = await reminderEmails(t.editor.email);
    expect(mail.length).toBeGreaterThanOrEqual(1);
    expect(mail.map((m) => m.text_body.match(/^• /gm)?.length ?? 0).reduce((a, b) => a + b, 0)).toBe(4);
    expect(await records()).toHaveLength(4);
  });

  it('a long list is shortened in the email', async () => {
    const t = await team(23);
    const res = await t.owner.client.post(`${t.base}/items/assign`, { materialIds: t.books, assigneeId: t.editor.userId, dueOn: '2026-11-12' });
    expect(res.statusCode, res.body).toBe(200);
    expect(await run()).toMatchObject({ reminded: 23, emails: 1 });
    const [mail] = await reminderEmails(t.editor.email);
    expect(mail!.subject).toBe('Reminder: 23 books are due soon in Reminder School');
    expect(mail!.text_body.match(/^• /gm)).toHaveLength(21);
    expect(mail!.text_body).toContain('Due soon (23):');
    expect(mail!.text_body).toContain('• and 3 more');
  });

  it('records go with the book, the member and old due dates, and stay inside the organization', async () => {
    const t = await team();
    await t.track(t.books[0]!, { assigneeId: t.editor.userId, dueOn: '2026-11-10' });
    await t.track(t.books[1]!, { assigneeId: t.viewer.userId, dueOn: '2026-11-10' });
    await t.track(t.books[2]!, { assigneeId: t.viewer.userId, dueOn: '2026-11-04' });
    await run();
    expect(await records()).toHaveLength(3);

    const other = await signUp(h, { org: 'Other School' });
    expect(await withOrgContext(h.db, { orgId: other.orgId }, (trx) => trx.selectFrom('item_reminders').selectAll().execute())).toEqual([]);
    expect(await withOrgContext(h.db, { orgId: t.owner.orgId }, (trx) => trx.selectFrom('item_reminders').selectAll().execute())).toHaveLength(3);

    // Deselecting the book removes its record; so does removing the member.
    expect((await t.owner.client.post(`${t.base}/items`, { remove: [t.books[0]] })).statusCode).toBe(200);
    expect((await records()).map((r) => r.material_id).sort()).toEqual([t.books[1], t.books[2]].sort());
    expect((await t.owner.client.delete(`/api/orgs/${t.owner.orgId}/members/${t.viewer.userId}`)).statusCode).toBe(200);
    expect(await records()).toEqual([]);

    // Retention: records are dropped 60 days after their due date.
    await t.track(t.books[3]!, { assigneeId: t.editor.userId, dueOn: '2026-11-10' });
    await run();
    expect((await runCleanup(h.db, h.config, new Date('2027-01-08T12:00:00Z'))).itemReminders).toBe(0);
    expect((await runCleanup(h.db, h.config, new Date('2027-01-10T12:00:00Z'))).itemReminders).toBe(1);
  });

  it('the navigation counts books due soon', async () => {
    const t = await team();
    const day = (offset: number) => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + offset);
      return d.toISOString().slice(0, 10);
    };
    // Days far enough from the Cairo/UTC date boundary not to matter: 1 and 30 days ahead.
    await t.track(t.books[0]!, { assigneeId: t.editor.userId, dueOn: day(1) });
    await t.track(t.books[1]!, { assigneeId: t.editor.userId, dueOn: day(30) });
    expect((await t.editor.client.get(`/api/orgs/${t.owner.orgId}`)).json().myAssignments).toEqual({ open: 2, overdue: 0, dueSoon: 1 });
  });
});
