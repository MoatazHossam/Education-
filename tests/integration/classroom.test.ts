import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runHomeworkAnnouncements } from '../../src/classroom/service.js';
import { withStudentContext, withSystemContext } from '../../src/db/index.js';
import { addMember, Client, createHarness, createStudent, enableStudents, publishedVersionId, resetData, signUp, studentLogin, type Harness } from '../helpers/harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness({ RATE_LIMIT_ENABLED: 'false' });
});
afterAll(async () => h.close());
beforeEach(async () => resetData(h.ownerDb));

// A tiny real PNG (1×1) and JPEG header; the server decides the type from these bytes.
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');
const PDF = Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n', 'latin1');

async function upload(client: Client, url: string, data: Buffer, name: string, contentType = 'application/octet-stream') {
  return h.app.inject({
    method: 'POST',
    url,
    remoteAddress: client.ip,
    headers: {
      cookie: [...client.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
      ...(client.csrf ? { 'x-csrf-token': client.csrf } : {}),
      'content-type': contentType,
      'x-file-name': encodeURIComponent(name),
    },
    payload: data,
  });
}

/** Grade 4 subject with at least two books, and a scope selecting two of them. */
async function curriculum(owner: { client: Client; orgId: string }) {
  const versionId = await publishedVersionId(h);
  const subject = await h.ownerDb
    .selectFrom('catalog_subjects as s')
    .select(['s.id', 's.name_en', 's.name_ar'])
    .where('s.version_id', '=', versionId)
    .where('s.grade', '=', 4)
    .where((eb) => eb.exists(eb.selectFrom('catalog_materials as m').select('m.id').whereRef('m.subject_id', '=', 's.id').offset(1).limit(1)))
    .orderBy('s.sort_order')
    .executeTakeFirstOrThrow();
  const books = await h.ownerDb.selectFrom('catalog_materials').select(['id', 'title']).where('subject_id', '=', subject.id).orderBy('sort_order').limit(2).execute();
  const other = await h.ownerDb
    .selectFrom('catalog_materials as m')
    .innerJoin('catalog_subjects as s', 's.id', 'm.subject_id')
    .select('m.id')
    .where('m.version_id', '=', versionId)
    .where('s.grade', '=', 9)
    .executeTakeFirstOrThrow();
  const scope = await owner.client.post(`/api/orgs/${owner.orgId}/scopes`, { name: 'Grade 4 books', catalogVersionId: versionId });
  const scopeId = scope.json().scope.id as string;
  expect((await owner.client.post(`/api/orgs/${owner.orgId}/scopes/${scopeId}/items`, { add: books.map((b) => b.id) })).statusCode).toBe(200);
  return { scopeId, subjectEn: subject.name_en, subjectAr: subject.name_ar, books, otherGradeBook: other.id };
}

/** A school with student accounts, a Grade 4 class of two students and a teacher (viewer) for one subject. */
async function schoolWithClass() {
  const owner = await signUp(h, { org: 'Nile School' });
  await enableStudents(h, owner.orgId);
  const cur = await curriculum(owner);
  const teacher = await addMember(h, owner.client, owner.orgId, 'viewer');
  const amira = await createStudent(h, owner.client, owner.orgId, { username: 'amira', name: 'Amira', grade: 4, scopeId: cur.scopeId });
  const omar = await createStudent(h, owner.client, owner.orgId, { username: 'omar', name: 'Omar', grade: 4, scopeId: cur.scopeId });
  await h.ownerDb.updateTable('users').set({ locale: 'ar' }).where('id', '=', omar.userId).execute();
  const created = await owner.client.post(`/api/orgs/${owner.orgId}/classes`, { name: '4A', grade: 4, scopeId: cur.scopeId });
  expect(created.statusCode).toBe(201);
  const classId = created.json().class.id as string;
  expect((await owner.client.request('PUT', `/api/orgs/${owner.orgId}/classes/${classId}/students`, { studentIds: [amira.userId, omar.userId] })).statusCode).toBe(200);
  const t = await owner.client.post(`/api/orgs/${owner.orgId}/classes/${classId}/teachers`, { userId: teacher.userId, subjectEn: cur.subjectEn, subjectAr: cur.subjectAr });
  expect(t.statusCode).toBe(201);
  return { owner, teacher, amira, omar, classId, cur };
}

const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

async function setHomework(s: Awaited<ReturnType<typeof schoolWithClass>>, body: Record<string, unknown> = {}) {
  const res = await s.teacher.client.post(`/api/orgs/${s.owner.orgId}/classes/${s.classId}/homework`, {
    subjectEn: s.cur.subjectEn,
    subjectAr: s.cur.subjectAr,
    title: 'Read pages 10–12',
    instructions: 'Answer questions 1 to 3 in your notebook and upload a photo.',
    materialIds: [s.cur.books[0]!.id],
    dueAt: inDays(2),
    maxPoints: 10,
    ...body,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().homework as { id: string };
}

describe('classes are off until student accounts are on', () => {
  it('refuses to create a class and says so', async () => {
    const owner = await signUp(h);
    const list = (await owner.client.get(`/api/orgs/${owner.orgId}/classes`)).json();
    expect(list).toMatchObject({ enabled: false, admin: true, classes: [] });
    const res = await owner.client.post(`/api/orgs/${owner.orgId}/classes`, { name: '4A', grade: 4 });
    expect(res.statusCode).toBe(402);
    expect(res.json().error.code).toBe('CLASSROOM_NOT_ENABLED');
  });
});

describe('classes and teachers', () => {
  it('admins manage classes; a teacher sees only the classes they teach, other members none', async () => {
    const s = await schoolWithClass();
    const other = await s.owner.client.post(`/api/orgs/${s.owner.orgId}/classes`, { name: '4B', grade: 4 });
    expect(other.statusCode).toBe(201);
    expect((await s.owner.client.post(`/api/orgs/${s.owner.orgId}/classes`, { name: '4a', grade: 4 })).json().error.code).toBe('CLASS_NAME_TAKEN');

    const mine = (await s.teacher.client.get(`/api/orgs/${s.owner.orgId}/classes`)).json();
    expect(mine.admin).toBe(false);
    expect(mine.classes.map((c: { name: string }) => c.name)).toEqual(['4A']);
    expect(mine.classes[0]).toMatchObject({ students: 2, mine: true, teachers: [{ subjectEn: s.cur.subjectEn }] });
    expect((await s.teacher.client.get(`/api/orgs/${s.owner.orgId}/classes/${other.json().class.id}`)).statusCode).toBe(404);

    const detail = (await s.teacher.client.get(`/api/orgs/${s.owner.orgId}/classes/${s.classId}`)).json();
    expect(detail.students.map((x: { name: string }) => x.name)).toEqual(['Amira', 'Omar']);
    expect(detail.teaching).toEqual([expect.objectContaining({ subjectEn: s.cur.subjectEn, subjectAr: s.cur.subjectAr })]);
    // The class's subjects come from its curriculum scope, with the books it selected.
    const subject = detail.subjects.find((x: { nameEn: string }) => x.nameEn === s.cur.subjectEn);
    expect(subject.materials.map((m: { id: string }) => m.id).sort()).toEqual(s.cur.books.map((b) => b.id).sort());

    // Members who teach nothing see no classes; teachers cannot manage classes.
    const editor = await addMember(h, s.owner.client, s.owner.orgId, 'editor');
    expect((await editor.client.get(`/api/orgs/${s.owner.orgId}/classes`)).json().classes).toEqual([]);
    expect((await editor.client.get(`/api/orgs/${s.owner.orgId}/classes/${s.classId}`)).statusCode).toBe(404);
    expect((await s.teacher.client.patch(`/api/orgs/${s.owner.orgId}/classes/${s.classId}`, { name: 'X' })).statusCode).toBe(403);
    expect((await s.teacher.client.request('PUT', `/api/orgs/${s.owner.orgId}/classes/${s.classId}/students`, { studentIds: [] })).statusCode).toBe(403);

    // Students of another school cannot be enrolled.
    const elsewhere = await signUp(h, { org: 'Elsewhere' });
    await enableStudents(h, elsewhere.orgId);
    const stranger = await createStudent(h, elsewhere.client, elsewhere.orgId, { grade: 4 });
    const bad = await s.owner.client.request('PUT', `/api/orgs/${s.owner.orgId}/classes/${s.classId}/students`, { studentIds: [s.amira.userId, stranger.userId] });
    expect(bad.statusCode).toBe(400);

    // Only members can teach; leaving the school ends the teaching.
    const outsider = await signUp(h, { org: 'Outsider' });
    expect((await s.owner.client.post(`/api/orgs/${s.owner.orgId}/classes/${s.classId}/teachers`, { userId: outsider.userId, subjectEn: 'Art', subjectAr: 'التربية الفنية' })).json().error.code).toBe('TEACHER_NOT_MEMBER');
    await s.owner.client.delete(`/api/orgs/${s.owner.orgId}/members/${s.teacher.userId}`);
    expect(await h.ownerDb.selectFrom('class_teachers').select('id').where('user_id', '=', s.teacher.userId).execute()).toEqual([]);
  });
});

describe('homework', () => {
  it('a teacher sets homework; students are told in their language, hand in text and a photo, and get it back marked', async () => {
    const s = await schoolWithClass();
    // Only books of the class's curriculum for that subject.
    const wrong = await s.teacher.client.post(`/api/orgs/${s.owner.orgId}/classes/${s.classId}/homework`, {
      subjectEn: s.cur.subjectEn, subjectAr: s.cur.subjectAr, title: 'x', dueAt: inDays(1), materialIds: [s.cur.otherGradeBook],
    });
    expect(wrong.json().error.code).toBe('INVALID_HOMEWORK_BOOKS');
    // Only subjects the teacher teaches.
    const otherSubject = await s.teacher.client.post(`/api/orgs/${s.owner.orgId}/classes/${s.classId}/homework`, { subjectEn: 'Art', subjectAr: 'فنون', title: 'x', dueAt: inDays(1) });
    expect(otherSubject.statusCode).toBe(403);
    expect(otherSubject.json().error.code).toBe('NOT_SUBJECT_TEACHER');

    const hw = await setHomework(s);
    const teacherFile = await upload(s.teacher.client, `/api/orgs/${s.owner.orgId}/homework/${hw.id}/files`, PDF, 'worksheet.pdf', 'application/pdf');
    expect(teacherFile.statusCode, teacherFile.body).toBe(201);

    const amira = await studentLogin(h, s.amira);
    const omar = await studentLogin(h, s.omar);
    const notes = (await omar.get('/api/student/notifications')).json().notifications;
    expect(notes[0]).toMatchObject({ kind: 'homework_assigned', title: 'واجب جديد: Read pages 10–12', link: `/student/homework/${hw.id}` });
    expect(notes[0].body).toContain(s.cur.subjectAr);
    expect((await amira.get('/api/student/notifications')).json().notifications[0].title).toBe('New homework: Read pages 10–12');

    const home = (await amira.get('/api/student/home')).json();
    expect(home.todo.map((x: { id: string }) => x.id)).toEqual([hw.id]);
    expect(home.todo[0]).toMatchObject({ className: '4A', status: 'assigned', maxPoints: 10, materials: [{ id: s.cur.books[0]!.id }] });

    // A draft stays private to the student.
    expect((await amira.request('PUT', `/api/student/homework/${hw.id}/submission`, { body: 'Draft answer' })).statusCode).toBe(200);
    const notText = await upload(amira, `/api/student/homework/${hw.id}/files`, Buffer.from('<html><script>alert(1)</script>'), 'page.png', 'image/png');
    expect(notText.statusCode).toBe(415);
    expect(notText.json().error.code).toBe('FILE_TYPE_NOT_ALLOWED');
    const photo = await upload(amira, `/api/student/homework/${hw.id}/files`, PNG, 'C:\\Users\\amira\\notebook page.jpeg');
    expect(photo.statusCode, photo.body).toBe(201);
    expect(photo.json().file).toMatchObject({ name: 'notebook page.png', contentType: 'image/png' });
    let roster = (await s.teacher.client.get(`/api/orgs/${s.owner.orgId}/homework/${hw.id}`)).json().roster;
    expect(roster.find((r: { name: string }) => r.name === 'Amira')).toMatchObject({ status: 'assigned', files: 0 });
    const draftView = (await s.teacher.client.get(`/api/orgs/${s.owner.orgId}/homework/${hw.id}/submissions/${s.amira.userId}`)).json();
    expect(draftView.submission).toMatchObject({ status: 'assigned', body: '', files: [] });
    expect((await s.teacher.client.get(`/api/orgs/${s.owner.orgId}/files/${photo.json().file.id}`)).statusCode).toBe(404);

    const handIn = await amira.post(`/api/student/homework/${hw.id}/hand-in`, { body: 'Final answer: 1) a 2) b 3) c' });
    expect(handIn.json()).toMatchObject({ status: 'submitted', late: false });
    expect((await amira.request('PUT', `/api/student/homework/${hw.id}/submission`, { body: 'change' })).json().error.code).toBe('HOMEWORK_HANDED_IN');

    roster = (await s.teacher.client.get(`/api/orgs/${s.owner.orgId}/homework/${hw.id}`)).json().roster;
    expect(roster.find((r: { name: string }) => r.name === 'Amira')).toMatchObject({ status: 'submitted', files: 1, late: false });
    expect(roster.find((r: { name: string }) => r.name === 'Omar')).toMatchObject({ status: 'assigned', missing: false });
    const view = (await s.teacher.client.get(`/api/orgs/${s.owner.orgId}/homework/${hw.id}/submissions/${s.amira.userId}`)).json();
    expect(view.submission).toMatchObject({ status: 'submitted', body: 'Final answer: 1) a 2) b 3) c' });
    const file = await s.teacher.client.get(`/api/orgs/${s.owner.orgId}/files/${view.submission.files[0].id}`);
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toBe('image/png');
    expect(file.headers['content-security-policy']).toContain('sandbox');
    expect(file.rawPayload.equals(PNG)).toBe(true);
    // PDFs download rather than open in the app's origin.
    const pdf = await amira.get(`/api/student/files/${teacherFile.json().file.id}`);
    expect(pdf.headers['content-disposition']).toMatch(/^attachment; filename="worksheet.pdf"/);

    // Marks stay within the total, and only the subject's teachers mark.
    expect((await s.teacher.client.patch(`/api/orgs/${s.owner.orgId}/homework/${hw.id}/submissions/${s.amira.userId}`, { points: 11 })).json().error.code).toBe('POINTS_ABOVE_TOTAL');
    const editor = await addMember(h, s.owner.client, s.owner.orgId, 'editor');
    expect((await editor.client.patch(`/api/orgs/${s.owner.orgId}/homework/${hw.id}/submissions/${s.amira.userId}`, { points: 1 })).statusCode).toBe(404);
    const marked = await s.teacher.client.patch(`/api/orgs/${s.owner.orgId}/homework/${hw.id}/submissions/${s.amira.userId}`, { points: 8.5, feedback: 'Good work. Check question 3.' });
    expect(marked.json()).toMatchObject({ status: 'submitted', points: 8.5 });
    // Not returned yet: the student does not see the mark.
    expect((await amira.get(`/api/student/homework/${hw.id}`)).json().submission).toMatchObject({ status: 'submitted', points: null, feedback: null });
    const returned = await s.teacher.client.post(`/api/orgs/${s.owner.orgId}/homework/${hw.id}/return`, { studentIds: [s.amira.userId, s.omar.userId] });
    expect(returned.json()).toEqual({ returned: 1 });
    const mine = (await amira.get(`/api/student/homework/${hw.id}`)).json();
    expect(mine.submission).toMatchObject({ status: 'returned', points: 8.5, feedback: 'Good work. Check question 3.' });
    expect((await amira.get('/api/student/notifications')).json().notifications[0]).toMatchObject({ kind: 'homework_returned', body: expect.stringContaining('8.5 / 10') });
    expect((await amira.post(`/api/student/homework/${hw.id}/take-back`)).json().error.code).toBe('NOT_HANDED_IN');
    expect((await upload(amira, `/api/student/homework/${hw.id}/files`, PNG, 'more.png')).json().error.code).toBe('HOMEWORK_RETURNED');
    expect((await amira.get('/api/student/homework?show=done')).json().homework).toEqual([expect.objectContaining({ id: hw.id, status: 'returned', points: 8.5 })]);

    // Work done on paper: marked and returned without a hand-in.
    const paper = await s.teacher.client.patch(`/api/orgs/${s.owner.orgId}/homework/${hw.id}/submissions/${s.omar.userId}`, { points: 6, return: true });
    expect(paper.json()).toMatchObject({ status: 'returned', points: 6 });
    expect((await omar.get(`/api/student/homework/${hw.id}`)).json().submission).toMatchObject({ status: 'returned', points: 6 });

    const audit = await withSystemContext(h.ownerDb, (trx) => trx.selectFrom('audit_logs').select('action').where('org_id', '=', s.owner.orgId).where('action', 'like', 'homework.%').execute());
    expect(audit.map((a) => a.action).sort()).toEqual(['homework.created', 'homework.marked', 'homework.returned', 'homework.returned']);
  });

  it('late work, closed homework, and taking work back', async () => {
    const s = await schoolWithClass();
    const amira = await studentLogin(h, s.amira);
    const hw = await setHomework(s, { publishAt: inDays(-3), dueAt: inDays(-1) });
    const late = await amira.post(`/api/student/homework/${hw.id}/hand-in`, { body: 'Sorry it is late' });
    expect(late.json()).toMatchObject({ status: 'submitted', late: true });
    expect((await amira.post(`/api/student/homework/${hw.id}/take-back`)).json()).toEqual({ status: 'draft' });

    const strict = await setHomework(s, { title: 'Strict', publishAt: inDays(-3), dueAt: inDays(-1), allowLate: false });
    const home = (await amira.get('/api/student/home')).json();
    expect(home.missed.map((x: { id: string }) => x.id)).toEqual([strict.id]);
    expect(home.todo.map((x: { id: string }) => x.id)).toEqual([hw.id]);
    expect((await amira.post(`/api/student/homework/${strict.id}/hand-in`)).json().error.code).toBe('HOMEWORK_CLOSED');
    const roster = (await s.teacher.client.get(`/api/orgs/${s.owner.orgId}/homework/${strict.id}`)).json().roster;
    expect(roster.every((r: { missing: boolean }) => r.missing)).toBe(true);
  });

  it('scheduled homework stays hidden until its time, then the worker tells the class once', async () => {
    const s = await schoolWithClass();
    const amira = await studentLogin(h, s.amira);
    const hw = await setHomework(s, { publishAt: inDays(1), dueAt: inDays(3) });
    expect((await amira.get('/api/student/homework?show=all')).json().homework).toEqual([]);
    expect((await amira.get(`/api/student/homework/${hw.id}`)).statusCode).toBe(404);
    expect((await amira.get('/api/student/notifications')).json().notifications).toEqual([]);
    expect(await runHomeworkAnnouncements(h.db)).toEqual({ homework: 0, students: 0 });

    await withSystemContext(h.ownerDb, (trx) => sql`UPDATE homework SET publish_at = now() - interval '1 minute' WHERE id = ${hw.id}`.execute(trx));
    expect(await runHomeworkAnnouncements(h.db)).toEqual({ homework: 1, students: 2 });
    expect(await runHomeworkAnnouncements(h.db)).toEqual({ homework: 0, students: 0 });
    expect((await amira.get(`/api/student/homework/${hw.id}`)).statusCode).toBe(200);
    expect((await amira.get('/api/student/notifications')).json().notifications).toHaveLength(1);
  });

  it('row-level security keeps each student to their own classes and work, whatever the query', async () => {
    const s = await schoolWithClass();
    const hw = await setHomework(s);
    const amira = await studentLogin(h, s.amira);
    const omar = await studentLogin(h, s.omar);
    await omar.post(`/api/student/homework/${hw.id}/hand-in`, { body: 'Omar’s answer' });
    const omarFile = await upload(omar, `/api/student/homework/${hw.id}/files`, PNG, 'x.png');
    expect(omarFile.json().error.code).toBe('HOMEWORK_HANDED_IN');
    await omar.post(`/api/student/homework/${hw.id}/take-back`);
    const file = (await upload(omar, `/api/student/homework/${hw.id}/files`, PNG, 'omar.png')).json().file;
    expect((await amira.get(`/api/student/files/${file.id}`)).statusCode).toBe(404);
    expect((await omar.get(`/api/student/files/${file.id}`)).statusCode).toBe(200);

    // A student outside the class sees nothing of it.
    const layla = await createStudent(h, s.owner.client, s.owner.orgId, { username: 'layla', name: 'Layla', grade: 4 });
    const laylaClient = await studentLogin(h, layla);
    expect((await laylaClient.get(`/api/student/homework/${hw.id}`)).statusCode).toBe(404);
    expect((await laylaClient.get('/api/student/home')).json()).toMatchObject({ classes: [], todo: [] });

    // Directly in the database, with the student context the routes use and no filter at all.
    const seen = await withStudentContext(h.db, { orgId: s.owner.orgId, studentId: s.amira.userId }, async (trx) => ({
      submissions: await trx.selectFrom('homework_submissions').select('student_id').execute(),
      files: await trx.selectFrom('classroom_files').select(['id', 'homework_id']).execute(),
      students: await trx.selectFrom('students').select('user_id').execute(),
      classes: await trx.selectFrom('classes').select('id').execute(),
      insert: await trx
        .insertInto('classes')
        .values({ org_id: s.owner.orgId, name: 'Fake', grade: 4 })
        .execute()
        .then(() => 'inserted')
        .catch((e: Error) => e.message),
    }));
    expect(seen.submissions).toEqual([]);
    expect(seen.files.every((f) => f.homework_id === hw.id)).toBe(true);
    expect(seen.students).toEqual([{ user_id: s.amira.userId }]);
    expect(seen.classes).toEqual([{ id: s.classId }]);
    expect(seen.insert).toMatch(/row-level security/);
  });

  it('school storage limit, file count and deleting a class', async () => {
    const s = await schoolWithClass();
    const hw = await setHomework(s);
    const amira = await studentLogin(h, s.amira);
    for (let i = 0; i < 5; i++) expect((await upload(amira, `/api/student/homework/${hw.id}/files`, PNG, `p${i}.png`)).statusCode).toBe(201);
    expect((await upload(amira, `/api/student/homework/${hw.id}/files`, PNG, 'p6.png')).json().error.code).toBe('TOO_MANY_FILES');
    await withSystemContext(h.ownerDb, (trx) =>
      sql`UPDATE subscriptions SET limit_overrides = limit_overrides || '{"max_storage_mb": 0}'::jsonb WHERE org_id = ${s.owner.orgId}`.execute(trx),
    );
    const full = await upload(s.teacher.client, `/api/orgs/${s.owner.orgId}/homework/${hw.id}/files`, PNG, 'sheet.png');
    expect(full.statusCode).toBe(402);
    expect(full.json().error.code).toBe('STORAGE_LIMIT_REACHED');

    expect((await s.owner.client.delete(`/api/orgs/${s.owner.orgId}/classes/${s.classId}`)).statusCode).toBe(200);
    const left = await h.ownerDb.selectFrom('classroom_files').select('id').execute();
    expect(left).toEqual([]);
    expect(await h.ownerDb.selectFrom('homework').select('id').execute()).toEqual([]);
  });
});
