import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withSystemContext } from '../../src/db/index.js';
import { parseCsv } from '../../src/lib/csv.js';
import { addMember, createHarness, createStudent, enableStudents, resetData, signUp, studentLogin, type Harness } from '../helpers/harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness({ RATE_LIMIT_ENABLED: 'false' });
});
afterAll(async () => h.close());
beforeEach(async () => resetData(h.ownerDb));

const SCIENCE = { subjectEn: 'Science', subjectAr: 'العلوم' };
const ART = { subjectEn: 'Art', subjectAr: 'التربية الفنية' };
const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

/** Class 5A with Amira and Omar, a viewer who teaches Science there, and some marked work. */
async function school() {
  const owner = await signUp(h, { org: 'Delta School' });
  await enableStudents(h, owner.orgId);
  const teacher = await addMember(h, owner.client, owner.orgId, 'viewer');
  const amira = await createStudent(h, owner.client, owner.orgId, { username: 'amira', name: 'Amira', grade: 5 });
  const omar = await createStudent(h, owner.client, owner.orgId, { username: 'omar', name: 'Omar', grade: 5 });
  const classId = (await owner.client.post(`/api/orgs/${owner.orgId}/classes`, { name: '5A', grade: 5 })).json().class.id as string;
  await owner.client.request('PUT', `/api/orgs/${owner.orgId}/classes/${classId}/students`, { studentIds: [amira.userId, omar.userId] });
  await owner.client.post(`/api/orgs/${owner.orgId}/classes/${classId}/teachers`, { userId: teacher.userId, ...SCIENCE });
  return { owner, teacher, amira, omar, classId, orgId: owner.orgId };
}
type School = Awaited<ReturnType<typeof school>>;

async function homework(s: School, client: School['teacher']['client'], body: Record<string, unknown>) {
  const res = await client.post(`/api/orgs/${s.orgId}/classes/${s.classId}/homework`, { ...SCIENCE, title: 'Homework', dueAt: inMinutes(2 * 24 * 60), maxPoints: 10, ...body });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().homework.id as string;
}

/**
 * Science: homework 1 (10 marks, now past due: Amira 8 returned, Omar missing),
 * a test closing in an hour (2 marks: Amira 2, results when it closes), homework 2
 * (5 marks, due later: Amira handed in and marked 4, not returned yet), and
 * homework without a mark (not in the gradebook). Art: homework set by the owner.
 */
async function markedWork(s: School) {
  const amira = await studentLogin(h, s.amira);
  const hw1 = await homework(s, s.teacher.client, { title: 'Plants worksheet' });
  const hw2 = await homework(s, s.teacher.client, { title: '=1+1 practice', maxPoints: 5, dueAt: inMinutes(3 * 24 * 60) });
  await homework(s, s.teacher.client, { title: 'Bring a leaf', maxPoints: null });
  await homework(s, s.owner.client, { ...ART, title: 'Draw the Nile', dueAt: inMinutes(24 * 60) });
  for (const id of [hw1, hw2]) expect((await amira.post(`/api/student/homework/${id}/hand-in`, { body: 'My answer' })).statusCode).toBe(200);
  expect((await s.teacher.client.patch(`/api/orgs/${s.orgId}/homework/${hw1}/submissions/${s.amira.userId}`, { points: 8, return: true })).statusCode).toBe(200);
  expect((await s.teacher.client.patch(`/api/orgs/${s.orgId}/homework/${hw2}/submissions/${s.amira.userId}`, { points: 4 })).statusCode).toBe(200);
  await withSystemContext(h.ownerDb, (trx) => sql`UPDATE homework SET publish_at = now() - interval '3 days', due_at = now() - interval '1 day' WHERE id = ${hw1}`.execute(trx));

  const test = await s.teacher.client.post(`/api/orgs/${s.orgId}/classes/${s.classId}/tests`, { ...SCIENCE, title: 'Planets quiz', opensAt: inMinutes(-1), closesAt: inMinutes(60) });
  const testId = test.json().test.id as string;
  await s.teacher.client.post(`/api/orgs/${s.orgId}/tests/${testId}/questions`, {
    type: 'single', prompt: 'Which planet is closest to the Sun?', options: [{ id: 'a', text: 'Venus' }, { id: 'b', text: 'Mercury' }], points: 2, key: ['b'],
  });
  await s.teacher.client.post(`/api/orgs/${s.orgId}/tests/${testId}/publish`);
  const questionId = (await s.teacher.client.get(`/api/orgs/${s.orgId}/tests/${testId}`)).json().questions[0].id as string;
  const attemptId = (await amira.post(`/api/student/tests/${testId}/start`)).json().attemptId as string;
  await amira.request('PUT', `/api/student/attempts/${attemptId}/answers/${questionId}`, { answer: 'b' });
  await amira.post(`/api/student/attempts/${attemptId}/submit`);
  return { amira, hw1, hw2, testId };
}

describe('gradebook', () => {
  it('shows each student’s marks for a class and subject, with what is missing and an average of what is marked', async () => {
    const s = await school();
    const { hw1, hw2, testId } = await markedWork(s);
    const book = (await s.teacher.client.get(`/api/orgs/${s.orgId}/classes/${s.classId}/gradebook?subject=Science`)).json();
    expect(book.subjects).toEqual([ART, SCIENCE]);
    expect(book.subject).toEqual(SCIENCE);
    // Oldest first; homework without a full mark is left out.
    expect(book.items.map((i: { kind: string; id: string; maxPoints: number }) => [i.kind, i.id, i.maxPoints])).toEqual([['homework', hw1, 10], ['test', testId, 2], ['homework', hw2, 5]]);
    const [amira, omar] = book.students;
    expect(amira).toMatchObject({ name: 'Amira', average: 82.4, missing: 0 });
    expect(amira.cells).toEqual([{ status: 'marked', points: 8 }, { status: 'marked', points: 2 }, { status: 'marked', points: 4 }]);
    expect(omar).toMatchObject({ name: 'Omar', average: null, missing: 1 });
    expect(omar.cells.map((c: { status: string }) => c.status)).toEqual(['missing', 'pending', 'pending']);
    // Without a subject, the first one; another subject's teacher of the class can look too.
    expect((await s.owner.client.get(`/api/orgs/${s.orgId}/classes/${s.classId}/gradebook`)).json().subject).toEqual(ART);
    // A member who does not teach the class cannot open it.
    const editor = await addMember(h, s.owner.client, s.orgId, 'editor');
    expect((await editor.client.get(`/api/orgs/${s.orgId}/classes/${s.classId}/gradebook`)).statusCode).toBe(404);
  });

  it('downloads as CSV in the member’s language, guarded against spreadsheet formulas, and the download is audited', async () => {
    const s = await school();
    await markedWork(s);
    const res = await s.teacher.client.get(`/api/orgs/${s.orgId}/classes/${s.classId}/gradebook?subject=Science&format=csv`);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toBe('attachment; filename="gradebook-5A-Science.csv"');
    const rows = parseCsv(res.body);
    expect(rows[0]![0]).toBe('Student');
    expect(rows[0]!.slice(2, 5).map((c) => c.replace(/\d{4}-\d{2}-\d{2}/, 'DATE'))).toEqual(['Plants worksheet (DATE, /10)', 'Planets quiz (DATE, /2)', "'=1+1 practice (DATE, /5)"]);
    expect(rows[0]!.slice(5)).toEqual(['Average %', 'Missing']);
    expect(rows[1]).toEqual(['Amira', 'amira', '8', '2', '4', '82.4', '0']);
    expect(rows[2]).toEqual(['Omar', 'omar', 'Missing', '', '', '', '1']);
    await h.ownerDb.updateTable('users').set({ locale: 'ar' }).where('id', '=', s.teacher.userId).execute();
    const ar = parseCsv((await s.teacher.client.get(`/api/orgs/${s.orgId}/classes/${s.classId}/gradebook?subject=Science&format=csv`)).body);
    expect([ar[0]![0], ar[2]![2]]).toEqual(['الطالب', 'فات موعده']);
    const audit = await withSystemContext(h.ownerDb, (trx) => trx.selectFrom('audit_logs').select(['action', 'metadata']).where('org_id', '=', s.orgId).where('action', '=', 'class.gradebook_exported').execute());
    expect(audit).toHaveLength(2);
    expect(audit[0]!.metadata).toMatchObject({ name: '5A', subject: 'Science', students: 2 });
  });
});

describe('my grades', () => {
  it('a student sees only their own marks, once returned or shown, in each class and subject', async () => {
    const s = await school();
    const { amira, testId } = await markedWork(s);
    let grades = (await amira.get('/api/student/grades')).json().subjects;
    expect(grades.map((g: { className: string; subjectEn: string }) => `${g.className} ${g.subjectEn}`)).toEqual(['5A Art', '5A Science']);
    const science = grades[1];
    // The test's results come when it closes, and homework 2 is marked but not returned yet.
    expect(science.items.map((i: { title: string; status: string; points: number | null }) => [i.title, i.status, i.points])).toEqual([
      ['Plants worksheet', 'marked', 8],
      ['Planets quiz', 'to_mark', null],
      ['=1+1 practice', 'to_mark', null],
    ]);
    expect(science.average).toBe(80);
    // Once the test is over its score counts.
    await withSystemContext(h.ownerDb, (trx) => sql`UPDATE tests SET opens_at = now() - interval '2 hours', closes_at = now() - interval '1 minute' WHERE id = ${testId}`.execute(trx));
    grades = (await amira.get('/api/student/grades')).json().subjects;
    expect(grades[1].items[1]).toMatchObject({ status: 'marked', points: 2, maxPoints: 2 });
    expect(grades[1].average).toBe(83.3);

    // Omar sees his own row only: the missed homework and the test he did not take.
    const omar = await studentLogin(h, s.omar);
    const his = (await omar.get('/api/student/grades')).json().subjects[1];
    expect(his.items.map((i: { status: string }) => i.status)).toEqual(['missing', 'missing', 'pending']);
    expect(his).toMatchObject({ average: null, missing: 2 });
    expect(JSON.stringify(his)).not.toContain(s.amira.userId);
  });
});
