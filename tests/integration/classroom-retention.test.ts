import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runClassroomRetention } from '../../src/classroom/retention.js';
import { withSystemContext } from '../../src/db/index.js';
import { addMember, createHarness, createStudent, enableStudents, latestEmail, resetData, signUp, studentLogin, type Harness } from '../helpers/harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness({ RATE_LIMIT_ENABLED: 'false' });
});
afterAll(async () => h.close());
beforeEach(async () => resetData(h.ownerDb));

const SCIENCE = { subjectEn: 'Science', subjectAr: 'العلوم' };
const DAY = 86_400_000;
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');

// Today at 10:00 UTC, midday in Cairo: notices go out between 08:00 and 21:00 Cairo time.
const base = new Date(`${new Date().toISOString().slice(0, 10)}T10:00:00Z`);
const at = (days: number) => new Date(base.getTime() + days * DAY);
const run = (days: number, hourUtc = 10) => runClassroomRetention(h.db, h.config, new Date(at(days).getTime() + (hourUtc - 10) * 3_600_000));

/**
 * Delta School, class 5A (Amira and Omar), a viewer who teaches Science there,
 * an admin, and in Science: homework 40 days past due (Amira's answer with a
 * photo, marked 8 and returned; Omar's draft), homework 5 days past due
 * (Amira's answer), and a test that ended 39 days ago (Amira answered, left
 * the page once, scored 2).
 */
async function school() {
  const owner = await signUp(h, { org: 'Delta School' });
  const orgId = owner.orgId;
  await enableStudents(h, orgId);
  const teacher = await addMember(h, owner.client, orgId, 'viewer');
  const admin = await addMember(h, owner.client, orgId, 'admin');
  const amira = await createStudent(h, owner.client, orgId, { username: 'amira', name: 'Amira', grade: 5 });
  const omar = await createStudent(h, owner.client, orgId, { username: 'omar', name: 'Omar', grade: 5 });
  const classId = (await owner.client.post(`/api/orgs/${orgId}/classes`, { name: '5A', grade: 5 })).json().class.id as string;
  await owner.client.request('PUT', `/api/orgs/${orgId}/classes/${classId}/students`, { studentIds: [amira.userId, omar.userId] });
  await owner.client.post(`/api/orgs/${orgId}/classes/${classId}/teachers`, { userId: teacher.userId, ...SCIENCE });
  const amiraClient = await studentLogin(h, amira);
  const omarClient = await studentLogin(h, omar);

  const newHomework = async (title: string) => {
    const res = await teacher.client.post(`/api/orgs/${orgId}/classes/${classId}/homework`, { ...SCIENCE, title, dueAt: new Date(Date.now() + DAY).toISOString(), maxPoints: 10 });
    expect(res.statusCode, res.body).toBe(201);
    return res.json().homework.id as string;
  };
  const oldHw = await newHomework('Plants worksheet');
  const upload = await h.app.inject({
    method: 'POST',
    url: `/api/student/homework/${oldHw}/files`,
    remoteAddress: amiraClient.ip,
    headers: { cookie: [...amiraClient.cookies].map(([k, v]) => `${k}=${v}`).join('; '), 'x-csrf-token': amiraClient.csrf!, 'content-type': 'application/octet-stream', 'x-file-name': 'leaf.png' },
    payload: PNG,
  });
  expect(upload.statusCode, upload.body).toBe(201);
  expect((await amiraClient.post(`/api/student/homework/${oldHw}/hand-in`, { body: 'Leaves make food from sunlight.' })).statusCode).toBe(200);
  expect((await omarClient.request('PUT', `/api/student/homework/${oldHw}/submission`, { body: 'Draft idea' })).statusCode).toBe(200);
  expect((await teacher.client.patch(`/api/orgs/${orgId}/homework/${oldHw}/submissions/${amira.userId}`, { points: 8, feedback: 'Well explained', return: true })).statusCode).toBe(200);
  const recentHw = await newHomework('Water cycle');
  expect((await amiraClient.post(`/api/student/homework/${recentHw}/hand-in`, { body: 'Evaporation, then rain.' })).statusCode).toBe(200);

  const testId = (await teacher.client.post(`/api/orgs/${orgId}/classes/${classId}/tests`, { ...SCIENCE, title: 'Planets quiz', opensAt: new Date(Date.now() - 60_000).toISOString(), closesAt: new Date(Date.now() + 3_600_000).toISOString() })).json().test.id as string;
  await teacher.client.post(`/api/orgs/${orgId}/tests/${testId}/questions`, { type: 'single', prompt: 'Which planet is closest to the Sun?', options: [{ id: 'a', text: 'Venus' }, { id: 'b', text: 'Mercury' }], points: 2, key: ['b'] });
  await teacher.client.post(`/api/orgs/${orgId}/tests/${testId}/publish`);
  const questionId = (await teacher.client.get(`/api/orgs/${orgId}/tests/${testId}`)).json().questions[0].id as string;
  const attemptId = (await amiraClient.post(`/api/student/tests/${testId}/start`)).json().attemptId as string;
  await amiraClient.request('PUT', `/api/student/attempts/${attemptId}/answers/${questionId}`, { answer: 'b' });
  await amiraClient.post(`/api/student/attempts/${attemptId}/events`, { kind: 'left_page', seconds: 42 });
  expect((await amiraClient.post(`/api/student/attempts/${attemptId}/submit`)).statusCode).toBe(200);

  await withSystemContext(h.ownerDb, async (trx) => {
    await sql`UPDATE homework SET publish_at = ${at(-50)}, due_at = ${at(-40)} WHERE id = ${oldHw}`.execute(trx);
    await sql`UPDATE homework SET publish_at = ${at(-10)}, due_at = ${at(-5)} WHERE id = ${recentHw}`.execute(trx);
    await sql`UPDATE tests SET opens_at = ${at(-40)}, closes_at = ${at(-39)} WHERE id = ${testId}`.execute(trx);
  });
  return { owner, orgId, teacher, admin, amira, omar, amiraClient, classId, oldHw, recentHw, testId, attemptId, questionId };
}
type School = Awaited<ReturnType<typeof school>>;

const PERIODS = { monitoringDays: 7, workDays: 30, recordsDays: 365 };
const save = (s: School, body: Record<string, unknown>, client = s.owner.client) => client.request('PUT', `/api/orgs/${s.orgId}/classroom-retention`, body);

async function counts(s: School) {
  return withSystemContext(h.ownerDb, async (trx) => {
    const one = async (q: string) => Number((await sql<{ n: string }>`${sql.raw(q)}`.execute(trx)).rows[0]!.n);
    return {
      submissions: await one(`SELECT count(*) AS n FROM homework_submissions WHERE homework_id = '${s.oldHw}'`),
      answered: await one(`SELECT count(*) AS n FROM homework_submissions WHERE homework_id = '${s.oldHw}' AND body <> ''`),
      files: await one(`SELECT count(*) AS n FROM classroom_files f JOIN homework_submissions x ON x.id = f.submission_id WHERE x.homework_id = '${s.oldHw}'`),
      events: await one(`SELECT count(*) AS n FROM test_events WHERE attempt_id = '${s.attemptId}'`),
      answers: await one(`SELECT count(*) AS n FROM test_answers WHERE attempt_id = '${s.attemptId}' AND answer <> 'null'::jsonb`),
      recentWork: await one(`SELECT count(*) AS n FROM homework_submissions WHERE homework_id = '${s.recentHw}' AND body <> ''`),
    };
  });
}

describe('classroom data retention', () => {
  it('deletes nothing until a school sets periods; saving previews, records notices and tells owners and admins', async () => {
    const s = await school();
    const before = await counts(s);
    expect(before).toEqual({ submissions: 2, answered: 2, files: 1, events: 3, answers: 1, recentWork: 1 });
    expect(await run(400)).toMatchObject({ schools: 0, removed: 0, notices: 0 });
    expect(await counts(s)).toEqual(before);
    const empty = (await s.owner.client.get(`/api/orgs/${s.orgId}/classroom-retention`)).json();
    expect(empty).toMatchObject({ periods: { monitoringDays: null, workDays: null, recordsDays: null }, noticeDays: 14, upcoming: [], held: [] });

    // The preview counts what is already past the periods: the old homework's work, the test's answers and monitoring.
    const preview = (await s.owner.client.post(`/api/orgs/${s.orgId}/classroom-retention/preview`, PERIODS)).json();
    expect(preview).toMatchObject({ homework: 1, tests: 1, counts: { monitoring: { test: 1 }, work: { homework: 1, test: 1 }, records: { homework: 0, test: 0 } } });
    expect(new Date(preview.deleteFrom).getTime() - Date.now()).toBeGreaterThan(13.9 * DAY);

    const saved = await save(s, PERIODS);
    expect(saved.statusCode, saved.body).toBe(200);
    const body = saved.json();
    expect(body.noticesSent).toBe(3);
    expect(body.periods).toEqual(PERIODS);
    expect(body.upcoming.map((n: { kind: string; title: string; stage: string; className: string }) => `${n.className} ${n.kind} ${n.title} ${n.stage}`).sort()).toEqual([
      '5A homework Plants worksheet work',
      '5A test Planets quiz monitoring',
      '5A test Planets quiz work',
    ]);
    // Never sooner than 14 days after the notice.
    for (const n of body.upcoming) expect(new Date(n.deleteAfter).getTime() - Date.now()).toBeGreaterThan(13.9 * DAY);
    expect(await counts(s)).toEqual(before);

    // Owners and admins are told, in the app and by email; teachers are not.
    const notes = await h.ownerDb.selectFrom('notifications').select(['user_id', 'title', 'link']).where('kind', '=', 'classroom_retention').execute();
    expect(notes.map((n) => n.user_id).sort()).toEqual([s.owner.userId, s.admin.userId].sort());
    expect(notes[0]!.link).toBe(`/org/${s.orgId}/classes/retention`);
    const mail = await latestEmail(h, s.owner.email, 'classroom_retention');
    expect(mail!.subject).toMatch(/^Classroom data in Delta School will be deleted from \d+ \w+ \d{4}$/);
    expect(mail!.text_body).toContain('• 5A — “Plants worksheet”: students’ work, on or after');
    expect(mail!.text_body).toContain('• 5A — “Planets quiz”: monitoring records, on or after');
    expect(mail!.text_body).not.toContain('Leaves make food');

    // A homework or test page says what is due to be deleted.
    const hw = (await s.teacher.client.get(`/api/orgs/${s.orgId}/homework/${s.oldHw}`)).json();
    expect(hw.retention).toMatchObject({ hold: false, workRemovedAt: null, pending: [{ stage: 'work' }] });

    // Saving again sends nothing new; the change is audited.
    expect((await save(s, PERIODS)).json().noticesSent).toBe(0);
    const audit = await withSystemContext(h.ownerDb, (trx) => trx.selectFrom('audit_logs').select(['metadata']).where('org_id', '=', s.orgId).where('action', '=', 'classroom.retention_updated').orderBy('created_at').execute());
    expect(audit[0]!.metadata).toMatchObject({ before: { workDays: null }, after: PERIODS, noticesSent: 3 });
  });

  it('after the notice period, deletes work and monitoring but keeps marks, and the gradebook still shows them', async () => {
    const s = await school();
    await save(s, PERIODS);
    expect(await run(13)).toMatchObject({ schools: 1, removed: 0 });
    const result = await run(15);
    expect(result).toMatchObject({ schools: 1, removed: 3, failed: 0 });
    expect(await counts(s)).toEqual({ submissions: 1, answered: 0, files: 0, events: 0, answers: 0, recentWork: 1 });

    // Amira's hand-in keeps its state, mark and comments; Omar's draft is gone.
    const sub = (await s.teacher.client.get(`/api/orgs/${s.orgId}/homework/${s.oldHw}/submissions/${s.amira.userId}`)).json();
    expect(sub.homework.workRemovedAt).not.toBeNull();
    expect(sub.submission).toMatchObject({ status: 'returned', body: '', points: 8, feedback: 'Well explained', files: [] });
    const mine = (await s.amiraClient.get(`/api/student/homework/${s.oldHw}`)).json();
    expect(mine.homework.workRemovedAt).not.toBeNull();
    expect(mine.submission).toMatchObject({ status: 'returned', body: '', points: 8, files: [] });

    // The test keeps its score; the answer and the monitoring are gone, and re-marking keeps the automatic mark.
    const results = (await s.teacher.client.get(`/api/orgs/${s.orgId}/tests/${s.testId}/results`)).json();
    expect(results.test.workRemovedAt).not.toBeNull();
    expect(results.test.monitoringRemovedAt).not.toBeNull();
    expect(results.students.find((r: { name: string }) => r.name === 'Amira').best.score).toBe(2);
    expect((await s.teacher.client.patch(`/api/orgs/${s.orgId}/tests/${s.testId}/attempts/${s.attemptId}/answers/${s.questionId}`, { feedback: 'Correct' })).statusCode).toBe(200);
    const attempt = (await s.teacher.client.get(`/api/orgs/${s.orgId}/tests/${s.testId}/attempts/${s.attemptId}`)).json();
    expect(attempt.attempt.score).toBe(2);
    expect(attempt.questions[0]).toMatchObject({ answer: null, autoPoints: 2, feedback: 'Correct' });
    expect((await s.teacher.client.get(`/api/orgs/${s.orgId}/tests/${s.testId}/attempts/${s.attemptId}/events`)).json().events).toEqual([]);
    const review = (await s.amiraClient.get(`/api/student/attempts/${s.attemptId}/result`)).json();
    expect(review.attempt.score).toBe(2);
    expect(review.questions[0]).toMatchObject({ answer: null, earned: 2 });

    const book = (await s.teacher.client.get(`/api/orgs/${s.orgId}/classes/${s.classId}/gradebook?subject=Science`)).json();
    expect(book.students[0].cells.slice(0, 2)).toEqual([{ status: 'marked', points: 8 }, { status: 'marked', points: 2 }]);

    // Audited by the system, with titles and counts but no student work.
    const audit = await withSystemContext(h.ownerDb, (trx) => trx.selectFrom('audit_logs').select(['actor_type', 'metadata']).where('org_id', '=', s.orgId).where('action', '=', 'classroom.retention_applied').execute());
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actor_type).toBe('system');
    expect(audit[0]!.metadata).toMatchObject({ monitoring: { tests: 1 }, work: { homework: 1, tests: 1 }, records: { homework: 0, tests: 0 } });
    expect(JSON.stringify(audit[0]!.metadata)).not.toContain('Leaves');
    // Day 13's pass announced the recent homework's work (due 5 days ago, kept 30 days).
    const left = (await s.owner.client.get(`/api/orgs/${s.orgId}/classroom-retention`)).json().upcoming;
    expect(left.map((n: { title: string; stage: string }) => `${n.title} ${n.stage}`)).toEqual(['Water cycle work']);
    expect((await counts(s)).recentWork).toBe(1);
    // Nothing more to delete or announce yet.
    expect(await run(16)).toMatchObject({ removed: 0, notices: 0 });
  });

  it('a hold, a longer period or a moved date cancels a deletion; records go with everything; other schools are untouched', async () => {
    const s = await school();
    const other = await signUp(h, { org: 'Other School' });
    await enableStudents(h, other.orgId);
    const otherClass = (await other.client.post(`/api/orgs/${other.orgId}/classes`, { name: '6B', grade: 6 })).json().class.id as string;
    const otherHw = (await other.client.post(`/api/orgs/${other.orgId}/classes/${otherClass}/homework`, { ...SCIENCE, title: 'Old', dueAt: new Date(Date.now() + DAY).toISOString() })).json().homework.id as string;
    await withSystemContext(h.ownerDb, (trx) => sql`UPDATE homework SET publish_at = ${at(-400)}, due_at = ${at(-399)} WHERE id = ${otherHw}`.execute(trx));

    // Keep the test (an appeal): its notices go and no new ones come.
    const held = await s.admin.client.request('PUT', `/api/orgs/${s.orgId}/classroom-retention/hold`, { kind: 'test', id: s.testId, keep: true });
    expect(held.statusCode, held.body).toBe(200);
    expect(held.json().held.map((i: { title: string }) => i.title)).toEqual(['Planets quiz']);
    await save(s, { monitoringDays: 7, workDays: 30, recordsDays: 35 });
    let upcoming = (await s.owner.client.get(`/api/orgs/${s.orgId}/classroom-retention`)).json().upcoming;
    expect(upcoming.map((n: { title: string; stage: string }) => `${n.title} ${n.stage}`).sort()).toEqual(['Plants worksheet records', 'Plants worksheet work']);

    // A longer period drops notices it no longer covers.
    upcoming = (await save(s, { monitoringDays: 7, workDays: 30, recordsDays: 60 })).json().upcoming;
    expect(upcoming.map((n: { title: string; stage: string }) => `${n.title} ${n.stage}`)).toEqual(['Plants worksheet work']);
    upcoming = (await save(s, { monitoringDays: 7, workDays: 30, recordsDays: 35 })).json().upcoming;
    expect(upcoming).toHaveLength(2);

    // The worker checks again when the date comes: a period lengthened behind its back, or a later due time, cancels.
    await withSystemContext(h.ownerDb, (trx) => sql`UPDATE classroom_retention SET work_days = 300, records_days = 300 WHERE org_id = ${s.orgId}`.execute(trx));
    expect(await run(15)).toMatchObject({ removed: 0, dropped: 2 });
    expect((await counts(s)).answered).toBe(2);
    await save(s, { monitoringDays: 7, workDays: 30, recordsDays: 35 });
    await withSystemContext(h.ownerDb, (trx) => sql`UPDATE homework SET due_at = ${at(10)} WHERE id = ${s.oldHw}`.execute(trx));
    expect(await run(15)).toMatchObject({ removed: 0, dropped: 2 });
    await withSystemContext(h.ownerDb, (trx) => sql`UPDATE homework SET due_at = ${at(-40)} WHERE id = ${s.oldHw}`.execute(trx));

    // At night no notices go out; at midday they do, and 14 days later the homework goes with its work and marks.
    expect(await run(1, 23)).toMatchObject({ notices: 0 });
    expect(await run(1)).toMatchObject({ notices: 2 });
    expect(await run(16)).toMatchObject({ removed: 2 });
    const homeworkIds = () => withSystemContext(h.ownerDb, (trx) => trx.selectFrom('homework').select('id').execute()).then((rows) => rows.map((r) => r.id));
    expect(await homeworkIds()).not.toContain(s.oldHw);
    expect(await h.ownerDb.selectFrom('notifications').select('id').where('link', '=', `/student/homework/${s.oldHw}`).executeTakeFirst()).toBeUndefined();
    // The held test is whole, the other school's old homework too.
    expect((await counts(s)).events).toBe(3);
    expect((await homeworkIds()).sort()).toEqual([s.recentHw, otherHw].sort());

    // Lifting the hold lets the periods apply again, with a new notice.
    const lifted = (await s.owner.client.request('PUT', `/api/orgs/${s.orgId}/classroom-retention/hold`, { kind: 'test', id: s.testId, keep: false })).json();
    expect(lifted.held).toEqual([]);
    // (Day 16's pass also announced the recent homework, now within 14 days of its dates.)
    expect(lifted.upcoming.map((n: { title: string; stage: string }) => `${n.title} ${n.stage}`).sort()).toEqual([
      'Planets quiz monitoring',
      'Planets quiz records',
      'Planets quiz work',
      'Water cycle records',
      'Water cycle work',
    ]);
  });

  it('only owners and admins manage it, periods must be in order, and students see none of it', async () => {
    const s = await school();
    expect((await s.teacher.client.get(`/api/orgs/${s.orgId}/classroom-retention`)).statusCode).toBe(403);
    expect((await save(s, PERIODS, s.teacher.client)).statusCode).toBe(403);
    expect((await s.teacher.client.request('PUT', `/api/orgs/${s.orgId}/classroom-retention/hold`, { kind: 'test', id: s.testId, keep: true })).statusCode).toBe(403);
    expect((await s.amiraClient.get(`/api/orgs/${s.orgId}/classroom-retention`)).statusCode).toBe(403);

    const wrong = await save(s, { monitoringDays: 400, workDays: 30, recordsDays: 365 });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error.code).toBe('RETENTION_ORDER');
    expect((await save(s, { monitoringDays: 0, workDays: null, recordsDays: null })).statusCode).toBe(400);
    expect((await save(s, { monitoringDays: null, workDays: null, recordsDays: 3651 })).statusCode).toBe(400);
    // Another school's homework cannot be held from here.
    const other = await signUp(h, { org: 'Other School' });
    expect((await other.client.request('PUT', `/api/orgs/${other.orgId}/classroom-retention/hold`, { kind: 'homework', id: s.oldHw, keep: true })).statusCode).toBe(404);

    // Unset is allowed and drops every notice.
    await save(s, PERIODS);
    const off = (await save(s, { monitoringDays: null, workDays: null, recordsDays: null })).json();
    expect(off.upcoming).toEqual([]);
    expect(await run(20)).toMatchObject({ removed: 0 });
    expect((await counts(s)).answered).toBe(2);
  });
});
