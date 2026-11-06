import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withSystemContext } from '../../src/db/index.js';
import { runAssignmentDigests } from '../../src/scopes/digest.js';
import { runDueReminders } from '../../src/scopes/reminders.js';
import { addMember, createHarness, distinctTitleMaterialIds, publishedVersionId, resetData, signUp, type Harness } from '../helpers/harness.js';

// Each school's time zone (docs/production/IMPLEMENTATION_ROADMAP.md task 5.1, migration 0024): "overdue", the
// hours when reminders and daily summaries go out, and the times in notifications follow
// organizations.time_zone. Every school starts on Africa/Cairo, so Egyptian schools behave as before.

let h: Harness;
beforeAll(async () => {
  h = await createHarness({ RATE_LIMIT_ENABLED: 'false' });
});
afterAll(async () => h.close());
beforeEach(async () => resetData(h.ownerDb));

const sys = <T>(fn: Parameters<typeof withSystemContext<T>>[1]) => withSystemContext(h.ownerDb, fn);

/** A school with an editor and a scope of `n` books; `zone` set through the settings API. */
async function school(org: string, zone?: string, n = 2) {
  const owner = await signUp(h, { org, name: 'Owner Olfat' });
  if (zone) expect((await owner.client.patch(`/api/orgs/${owner.orgId}`, { timeZone: zone })).statusCode).toBe(200);
  const editor = await addMember(h, owner.client, owner.orgId, 'editor');
  const versionId = await publishedVersionId(h);
  const books = await distinctTitleMaterialIds(h, versionId, n);
  const scopeId = (await owner.client.post(`/api/orgs/${owner.orgId}/scopes`, { name: 'Plan', catalogVersionId: versionId })).json().scope.id as string;
  expect((await owner.client.post(`/api/orgs/${owner.orgId}/scopes/${scopeId}/items`, { add: books })).statusCode).toBe(200);
  const base = `/api/orgs/${owner.orgId}/scopes/${scopeId}`;
  const track = async (book: string, body: Record<string, unknown>) => {
    const res = await owner.client.patch(`${base}/items/${book}`, body);
    expect(res.statusCode, res.body).toBe(200);
  };
  return { owner, editor, books, base, track };
}

describe('a school’s time zone', () => {
  it('is Cairo by default, and owners and admins set it, with the country, from the database’s list of zones', async () => {
    const s = await school('Riyadh School');
    const org = () => s.owner.client.get(`/api/orgs/${s.owner.orgId}`).then((r) => r.json().organization);
    expect(await org()).toMatchObject({ timeZone: 'Africa/Cairo', country: null });

    const res = await s.owner.client.patch(`/api/orgs/${s.owner.orgId}`, { timeZone: 'Asia/Riyadh', country: 'SA' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().organization).toMatchObject({ timeZone: 'Asia/Riyadh', country: 'SA' });
    expect(await org()).toMatchObject({ timeZone: 'Asia/Riyadh', country: 'SA' });

    const bad = await s.owner.client.patch(`/api/orgs/${s.owner.orgId}`, { timeZone: 'Mars/Olympus_Mons' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.details).toEqual([expect.objectContaining({ path: 'timeZone' })]);
    for (const country of ['sa', 'SAU', '']) expect((await s.owner.client.patch(`/api/orgs/${s.owner.orgId}`, { country })).statusCode, country).toBe(400);
    expect((await s.owner.client.patch(`/api/orgs/${s.owner.orgId}`, { country: null })).statusCode).toBe(200);
    expect(await org()).toMatchObject({ timeZone: 'Asia/Riyadh', country: null });
    // Editors cannot change the school's settings.
    expect((await s.editor.client.patch(`/api/orgs/${s.owner.orgId}`, { timeZone: 'Africa/Cairo' })).statusCode).toBe(403);
    const audit = await sys((trx) => trx.selectFrom('audit_logs').select('metadata').where('action', '=', 'org.updated').where('org_id', '=', s.owner.orgId).orderBy('id').execute());
    expect(audit.map((a) => a.metadata)).toContainEqual({ timeZone: 'Asia/Riyadh', country: 'SA' });
  });

  it('decides "overdue": a book due on a date that has passed in the school’s zone is overdue there only', async () => {
    // UTC+14 and UTC−11: 25 hours apart, so the first zone's date is always ahead of the second's.
    const ahead = await school('Kiritimati School', 'Pacific/Kiritimati', 1);
    const behind = await school('Niue School', 'Pacific/Niue', 1);
    const { rows } = await sql<{ day: string }>`SELECT (now() AT TIME ZONE 'Pacific/Niue')::date::text AS day`.execute(h.ownerDb);
    const niueToday = rows[0]!.day;
    for (const s of [ahead, behind]) await s.track(s.books[0]!, { assigneeId: s.editor.userId, dueOn: niueToday });
    const mine = async (s: typeof ahead) => (await s.editor.client.get(`/api/orgs/${s.owner.orgId}/assignments`)).json().items[0];
    expect(await mine(ahead)).toMatchObject({ dueOn: niueToday, overdue: true });
    expect(await mine(behind)).toMatchObject({ dueOn: niueToday, overdue: false });
    expect((await ahead.editor.client.get(`/api/orgs/${ahead.owner.orgId}`)).json().myAssignments).toMatchObject({ open: 1, overdue: 1 });
    expect((await behind.editor.client.get(`/api/orgs/${behind.owner.orgId}`)).json().myAssignments).toMatchObject({ open: 1, overdue: 0, dueSoon: 1 });
  });

  it('decides when reminders go out, and which day is "today" in them', async () => {
    const riyadh = await school('Riyadh School', 'Asia/Riyadh');
    const cairo = await school('Cairo School');
    for (const s of [riyadh, cairo]) await s.track(s.books[0]!, { assigneeId: s.editor.userId, dueOn: '2026-11-10' });
    const reminded = () => sys((trx) => trx.selectFrom('item_reminders').select(['org_id', 'kind']).orderBy('org_id').execute());

    // 04:30 UTC: 06:30 in Cairo and 07:30 in Riyadh, before 08:00 in both.
    expect(await runDueReminders(h.db, h.config, new Date('2026-11-10T04:30:00Z'))).toMatchObject({ skipped: 'outside_hours' });
    // 05:30 UTC: 08:30 in Riyadh (sending hours), 07:30 in Cairo (not yet).
    expect(await runDueReminders(h.db, h.config, new Date('2026-11-10T05:30:00Z'))).toMatchObject({ members: 1, reminded: 1 });
    expect(await reminded()).toEqual([{ org_id: riyadh.owner.orgId, kind: 'due_soon' }]);
    // 06:30 UTC: 08:30 in Cairo; Riyadh's reminder is not sent twice.
    expect(await runDueReminders(h.db, h.config, new Date('2026-11-10T06:30:00Z'))).toMatchObject({ members: 1, reminded: 1 });
    expect((await reminded()).map((r) => r.org_id).sort()).toEqual([riyadh.owner.orgId, cairo.owner.orgId].sort());

    // 21:30 UTC on the 10th: 00:30 on the 11th in Riyadh, where the book is now overdue, but still the 10th in Cairo
    // (and outside both schools' hours, so nothing is sent).
    const { rows } = await sql<{ riyadh: string; cairo: string }>`
      SELECT ('2026-11-10T21:30:00Z'::timestamptz AT TIME ZONE 'Asia/Riyadh')::date::text AS riyadh,
             ('2026-11-10T21:30:00Z'::timestamptz AT TIME ZONE 'Africa/Cairo')::date::text AS cairo`.execute(h.ownerDb);
    expect(rows[0]).toEqual({ riyadh: '2026-11-11', cairo: '2026-11-10' });
  });

  it('decides the morning of a member’s daily summary: the zone of the school where their oldest waiting book was assigned', async () => {
    const riyadh = await school('Riyadh School', 'Asia/Riyadh');
    expect((await riyadh.editor.client.patch('/api/auth/profile', { assignmentEmailFrequency: 'daily' })).statusCode).toBe(200);
    expect((await riyadh.owner.client.post(`${riyadh.base}/items/assign`, { materialIds: [riyadh.books[0]], assigneeId: riyadh.editor.userId })).statusCode).toBe(200);
    // The book was assigned now; the summary goes out the next morning after 08:00 in Riyadh (05:00 UTC).
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const at = (hourUtc: number, minute = 30) => new Date(Date.UTC(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth(), tomorrow.getUTCDate(), hourUtc, minute));
    // 04:30 UTC: 07:30 in Riyadh, 06:30 in Cairo: outside every school's hours.
    expect(await runAssignmentDigests(h.db, h.config, at(4))).toMatchObject({ skipped: 'outside_hours' });
    // 05:30 UTC: 08:30 in Riyadh, still 07:30 in Cairo.
    expect(await runAssignmentDigests(h.db, h.config, at(5))).toMatchObject({ members: 1, emails: 1, books: 1 });
  });

  it('is used for dates and times in notices: a retention deletion date is the school’s date', async () => {
    const { hourIn } = await import('../../src/lib/zone.js');
    const { noticeLines } = await import('../../src/classroom/retention.js');
    // 06:00 UTC is 09:00 in Riyadh and 08:00 in Cairo (November).
    expect(hourIn('Asia/Riyadh', new Date('2026-11-10T06:00:00Z'))).toBe(9);
    expect(hourIn('Africa/Cairo', new Date('2026-11-10T06:00:00Z'))).toBe(8);
    // 21:30 UTC on the 10th is the 11th in Riyadh and still the 10th in Cairo.
    const item = { noticeId: 'n', kind: 'homework' as const, id: 'h', title: 'Fractions', classId: 'c', className: 'Grade 5 A', subjectEn: 'Maths', subjectAr: 'رياضيات', stage: 'work' as const, date: new Date('2026-10-01T00:00:00Z'), deleteAfter: new Date('2026-11-10T21:30:00Z'), notifiedAt: new Date() };
    expect(noticeLines('en', [item], 'Asia/Riyadh')).toBe('• Grade 5 A — “Fractions”: students’ work, on or after 11 Nov 2026');
    expect(noticeLines('en', [item])).toBe('• Grade 5 A — “Fractions”: students’ work, on or after 10 Nov 2026');
  });
});
