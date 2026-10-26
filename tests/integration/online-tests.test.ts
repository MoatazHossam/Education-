import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runTestDeadlines } from '../../src/classroom/tests-service.js';
import { withStudentContext, withSystemContext } from '../../src/db/index.js';
import { addMember, createHarness, createStudent, enableStudents, resetData, signUp, studentLogin, type Harness } from '../helpers/harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness({ RATE_LIMIT_ENABLED: 'false' });
});
afterAll(async () => h.close());
beforeEach(async () => resetData(h.ownerDb));

const SUBJECT = { subjectEn: 'Science', subjectAr: 'العلوم' };
const minutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

/** A school with a class of two students (one using Arabic) and a viewer who teaches Science there. */
async function school() {
  const owner = await signUp(h, { org: 'Delta School' });
  await enableStudents(h, owner.orgId);
  const teacher = await addMember(h, owner.client, owner.orgId, 'viewer');
  const amira = await createStudent(h, owner.client, owner.orgId, { username: 'amira', name: 'Amira', grade: 5 });
  const omar = await createStudent(h, owner.client, owner.orgId, { username: 'omar', name: 'Omar', grade: 5 });
  await h.ownerDb.updateTable('users').set({ locale: 'ar' }).where('id', '=', omar.userId).execute();
  const classId = (await owner.client.post(`/api/orgs/${owner.orgId}/classes`, { name: '5A', grade: 5 })).json().class.id as string;
  await owner.client.request('PUT', `/api/orgs/${owner.orgId}/classes/${classId}/students`, { studentIds: [amira.userId, omar.userId] });
  await owner.client.post(`/api/orgs/${owner.orgId}/classes/${classId}/teachers`, { userId: teacher.userId, ...SUBJECT });
  return { owner, teacher, amira, omar, classId, orgId: owner.orgId };
}
type School = Awaited<ReturnType<typeof school>>;

const QUESTIONS = [
  { type: 'single', prompt: 'Which planet is closest to the Sun?', options: [{ id: 'a', text: 'Venus' }, { id: 'b', text: 'Mercury' }], points: 2, key: ['b'] },
  { type: 'multiple', prompt: 'Which are mammals?', options: [{ id: 'a', text: 'Whale' }, { id: 'b', text: 'Shark' }, { id: 'c', text: 'Bat' }], points: 2, key: ['a', 'c'] },
  { type: 'true_false', prompt: 'Water boils at 100 °C at sea level.', options: [], points: 1, key: true },
  { type: 'short', prompt: 'Name the dam on the Nile in the south of Egypt.', options: [], points: 1, key: ['السد العالي', 'High Dam', 'Aswan High Dam'] },
  { type: 'essay', prompt: 'Explain why the Nile floods once a year.', options: [], points: 4, key: { guide: 'Rain in the Ethiopian highlands' } },
] as const;

async function writeTest(s: School, settings: Record<string, unknown> = {}, questions: readonly unknown[] = QUESTIONS) {
  const res = await s.teacher.client.post(`/api/orgs/${s.orgId}/classes/${s.classId}/tests`, {
    ...SUBJECT, title: 'Unit 3 quiz', opensAt: minutes(-1), closesAt: minutes(60), ...settings,
  });
  expect(res.statusCode, res.body).toBe(201);
  const testId = res.json().test.id as string;
  const ids: string[] = [];
  for (const q of questions) {
    const r = await s.teacher.client.post(`/api/orgs/${s.orgId}/tests/${testId}/questions`, q);
    expect(r.statusCode, r.body).toBe(201);
    ids.push(r.json().question.id);
  }
  return { testId, questionIds: ids };
}

async function publish(s: School, testId: string) {
  const r = await s.teacher.client.post(`/api/orgs/${s.orgId}/tests/${testId}/publish`);
  expect(r.statusCode, r.body).toBe(200);
  return r.json().test;
}

async function audit(orgId: string) {
  return withSystemContext(h.ownerDb, (trx) => trx.selectFrom('audit_logs').select('action').where('org_id', '=', orgId).where('action', 'like', 'test.%').execute());
}

describe('writing and publishing a test', () => {
  it('checks questions, keeps drafts from students, and tells the class when it is published', async () => {
    const s = await school();
    const created = await s.teacher.client.post(`/api/orgs/${s.orgId}/classes/${s.classId}/tests`, { ...SUBJECT, title: 'x', opensAt: minutes(10), closesAt: minutes(5) });
    expect(created.json().error.code).toBe('CLOSES_BEFORE_OPENS');
    const other = await s.teacher.client.post(`/api/orgs/${s.orgId}/classes/${s.classId}/tests`, { subjectEn: 'Art', subjectAr: 'فنون', title: 'x', opensAt: minutes(0), closesAt: minutes(5) });
    expect(other.json().error.code).toBe('NOT_SUBJECT_TEACHER');

    const { testId } = await writeTest(s, {}, []);
    const bad = await s.teacher.client.post(`/api/orgs/${s.orgId}/tests/${testId}/questions`, { type: 'single', prompt: 'x', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], points: 1, key: ['a', 'b'] });
    expect(bad.json().error).toMatchObject({ code: 'QUESTION_INVALID', message: 'Mark exactly one correct choice' });
    expect((await s.teacher.client.post(`/api/orgs/${s.orgId}/tests/${testId}/publish`)).json().error.code).toBe('TEST_EMPTY');
    for (const q of QUESTIONS) await s.teacher.client.post(`/api/orgs/${s.orgId}/tests/${testId}/questions`, q);

    // A draft is invisible to students, also directly in the database.
    const amira = await studentLogin(h, s.amira);
    expect((await amira.get('/api/student/tests')).json().tests).toEqual([]);
    expect(await withStudentContext(h.db, { orgId: s.orgId, studentId: s.amira.userId }, (trx) => trx.selectFrom('tests').select('id').execute())).toEqual([]);

    const t = await publish(s, testId);
    expect(t).toMatchObject({ status: 'published', phase: 'open' });
    const omar = await studentLogin(h, s.omar);
    expect((await omar.get('/api/student/notifications')).json().notifications[0]).toMatchObject({ kind: 'test_published', title: 'اختبار جديد: Unit 3 quiz', link: `/student/tests/${testId}` });
    expect((await amira.get('/api/student/notifications')).json().notifications[0].title).toBe('New test: Unit 3 quiz');
    const home = (await amira.get('/api/student/home')).json();
    expect(home.tests.open.map((x: { id: string }) => x.id)).toEqual([testId]);
    // Teachers of other subjects in the class can look but not change; other members cannot see it.
    const owner = s.owner.client;
    expect((await owner.get(`/api/orgs/${s.orgId}/classes/${s.classId}`)).json().tests[0]).toMatchObject({ id: testId, counts: { questions: 5, enrolled: 2 } });
    const editor = await addMember(h, owner, s.orgId, 'editor');
    expect((await editor.client.get(`/api/orgs/${s.orgId}/tests/${testId}`)).statusCode).toBe(404);
    expect((await audit(s.orgId)).map((a) => a.action).sort()).toEqual(['test.created', 'test.published']);
  });
});

describe('taking a test', () => {
  it('students get questions without answer keys, answers are checked and saved, and submission marks them', async () => {
    const s = await school();
    const { testId, questionIds } = await writeTest(s, { results: 'after_close', showAnswers: true });
    await publish(s, testId);
    const amira = await studentLogin(h, s.amira);

    // Before starting, a student's queries see no questions; never any keys.
    const before = await withStudentContext(h.db, { orgId: s.orgId, studentId: s.amira.userId }, async (trx) => ({
      questions: await trx.selectFrom('test_questions').select('id').execute(),
      keys: await trx.selectFrom('test_question_keys').select('question_id').execute(),
    }));
    expect(before).toEqual({ questions: [], keys: [] });

    const start = await amira.post(`/api/student/tests/${testId}/start`);
    expect(start.statusCode, start.body).toBe(200);
    const attemptId = start.json().attemptId as string;
    // Starting again resumes the same attempt.
    expect((await amira.post(`/api/student/tests/${testId}/start`)).json()).toEqual({ attemptId, resumed: true });
    const view = (await amira.get(`/api/student/attempts/${attemptId}`)).json();
    expect(view.questions).toHaveLength(5);
    expect(JSON.stringify(view)).not.toMatch(/"key"|Ethiopian|السد العالي/);
    const during = await withStudentContext(h.db, { orgId: s.orgId, studentId: s.amira.userId }, (trx) => trx.selectFrom('test_question_keys').select('question_id').execute());
    expect(during).toEqual([]);

    const put = (qid: string, answer: unknown) => amira.request('PUT', `/api/student/attempts/${attemptId}/answers/${qid}`, { answer });
    expect((await put(questionIds[0]!, 'z')).json().error.code).toBe('ANSWER_INVALID');
    expect((await put('7d3c6c1e-9a39-4f0b-8f43-0d1f7c2b9a11', 'a')).statusCode).toBe(404);
    expect((await put(questionIds[0]!, 'b')).statusCode).toBe(200);
    expect((await put(questionIds[1]!, ['a'])).statusCode).toBe(200); // half the mammals: 1 of 2
    expect((await put(questionIds[2]!, true)).statusCode).toBe(200);
    expect((await put(questionIds[3]!, 'السَّد العالى')).statusCode).toBe(200); // diacritics and ى still match
    expect((await put(questionIds[4]!, 'Rain falls in Ethiopia in summer.')).statusCode).toBe(200);

    expect((await amira.post(`/api/student/attempts/${attemptId}/submit`)).json()).toMatchObject({ status: 'submitted' });
    expect((await put(questionIds[0]!, 'a')).json().error.code).toBe('ATTEMPT_SUBMITTED');
    // The results show after the test closes.
    expect((await amira.get(`/api/student/attempts/${attemptId}/result`)).json().error.code).toBe('RESULTS_NOT_YET');

    // The teacher sees 5 of 10 marked automatically (2 + 1 of 2 + 1 + 1) and the essay waiting; marks it 3/4.
    const detail = (await s.teacher.client.get(`/api/orgs/${s.orgId}/tests/${testId}/attempts/${attemptId}`)).json();
    expect(detail.attempt).toMatchObject({ score: 5, maxPoints: 10, needsMarking: true });
    expect(detail.questions.map((q: { autoPoints: number | null }) => q.autoPoints)).toEqual([2, 1, 1, 1, null]);
    const essay = await s.teacher.client.patch(`/api/orgs/${s.orgId}/tests/${testId}/attempts/${attemptId}/answers/${questionIds[4]}`, { points: 3, feedback: 'Good; name the season.' });
    expect(essay.json()).toEqual({ score: 8, needsMarking: false });
    expect((await s.teacher.client.patch(`/api/orgs/${s.orgId}/tests/${testId}/attempts/${attemptId}/answers/${questionIds[4]}`, { points: 5 })).json().error.code).toBe('POINTS_ABOVE_TOTAL');

    // A teacher of another subject in the class can look, without the answer key, and cannot mark.
    const art = await addMember(h, s.owner.client, s.orgId, 'viewer');
    await s.owner.client.post(`/api/orgs/${s.orgId}/classes/${s.classId}/teachers`, { userId: art.userId, subjectEn: 'Art', subjectAr: 'فنون' });
    const looking = (await art.client.get(`/api/orgs/${s.orgId}/tests/${testId}/attempts/${attemptId}`)).json();
    expect(looking).toMatchObject({ canMark: false, attempt: { score: 8 } });
    expect(JSON.stringify(looking)).not.toMatch(/"key"|Ethiopian|Aswan/);
    const page = (await art.client.get(`/api/orgs/${s.orgId}/tests/${testId}`)).json();
    expect(page).toMatchObject({ canEdit: false, accessCode: null });
    expect(JSON.stringify(page)).not.toMatch(/"key"|Ethiopian|Aswan/);
    expect((await art.client.patch(`/api/orgs/${s.orgId}/tests/${testId}/attempts/${attemptId}/answers/${questionIds[4]}`, { points: 1 })).json().error.code).toBe('NOT_SUBJECT_TEACHER');

    // Closed: the student sees the mark, the comment and, as the teacher chose, the correct answers.
    await s.teacher.client.post(`/api/orgs/${s.orgId}/tests/${testId}/close`);
    const result = (await amira.get(`/api/student/attempts/${attemptId}/result`)).json();
    expect(result.attempt).toMatchObject({ score: 8, maxPoints: 10 });
    expect(result.answersShown).toBe(true);
    expect(result.questions.find((q: { id: string }) => q.id === questionIds[1])).toMatchObject({ earned: 1, correct: ['a', 'c'] });
    expect(result.questions.find((q: { id: string }) => q.id === questionIds[4])).toMatchObject({ earned: 3, feedback: 'Good; name the season.', correct: null });
    expect((await amira.get('/api/student/tests')).json().tests[0]).toMatchObject({ best: { score: 8, maxPoints: 10 }, phase: 'closed' });
  });

  it('a start code, the number of attempts and retakes the teacher allows', async () => {
    const s = await school();
    const { testId } = await writeTest(s, { requireCode: true, results: 'after_submit' }, [QUESTIONS[0]]);
    await publish(s, testId);
    const code = (await s.teacher.client.get(`/api/orgs/${s.orgId}/tests/${testId}`)).json().accessCode as string;
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    const amira = await studentLogin(h, s.amira);
    expect((await amira.post(`/api/student/tests/${testId}`)).statusCode).toBe(404);
    const testView = (await amira.get(`/api/student/tests/${testId}`)).json();
    expect(testView.test.requireCode).toBe(true);
    expect(JSON.stringify(testView)).not.toContain(code);
    expect((await amira.post(`/api/student/tests/${testId}/start`, { code: 'AAAAAA' })).json().error.code).toBe('WRONG_START_CODE');
    const a1 = (await amira.post(`/api/student/tests/${testId}/start`, { code: code.toLowerCase() })).json().attemptId;
    await amira.post(`/api/student/attempts/${a1}/submit`);
    // After submitting: the mark at once (results after submit).
    expect((await amira.get(`/api/student/attempts/${a1}/result`)).json().attempt).toMatchObject({ score: 0, maxPoints: 2 });
    expect((await amira.post(`/api/student/tests/${testId}/start`, { code })).json().error.code).toBe('NO_ATTEMPTS_LEFT');
    expect((await s.teacher.client.post(`/api/orgs/${s.orgId}/tests/${testId}/students/${s.amira.userId}/extra-attempt`)).json()).toEqual({ extraAttempts: 1, attemptsAllowed: 2 });
    const a2 = await amira.post(`/api/student/tests/${testId}/start`, { code });
    expect(a2.statusCode).toBe(200);
    expect(a2.json().attemptId).not.toBe(a1);
  });
});

describe('time', () => {
  it('the server keeps the time: late answers are refused, the attempt is submitted, and the worker catches the rest', async () => {
    const s = await school();
    const { testId, questionIds } = await writeTest(s, { durationMinutes: 20 }, [QUESTIONS[0], QUESTIONS[2]]);
    await publish(s, testId);
    const amira = await studentLogin(h, s.amira);
    const omar = await studentLogin(h, s.omar);
    const aId = (await amira.post(`/api/student/tests/${testId}/start`)).json().attemptId;
    const oId = (await omar.post(`/api/student/tests/${testId}/start`)).json().attemptId;
    const view = (await amira.get(`/api/student/attempts/${aId}`)).json();
    expect(new Date(view.attempt.deadlineAt).getTime() - new Date(view.attempt.startedAt).getTime()).toBe(20 * 60_000);
    await amira.request('PUT', `/api/student/attempts/${aId}/answers/${questionIds[0]}`, { answer: 'b' });

    // Extra time for Amira moves her deadline; the teacher's monitor shows it.
    const extra = (await s.teacher.client.post(`/api/orgs/${s.orgId}/tests/${testId}/students/${s.amira.userId}/extra-time`, { minutes: 10 })).json();
    expect(new Date(extra.deadlineAt).getTime() - new Date(view.attempt.startedAt).getTime()).toBe(30 * 60_000);

    // Time runs out (moved into the past here): a save is refused and the work is submitted and marked.
    await withSystemContext(h.ownerDb, (trx) => sql`UPDATE test_attempts SET deadline_at = now() - interval '1 minute' WHERE test_id = ${testId}`.execute(trx));
    const late = await amira.request('PUT', `/api/student/attempts/${aId}/answers/${questionIds[1]}`, { answer: true });
    expect(late.json().error.code).toBe('TIME_UP');
    const attempts = await withSystemContext(h.ownerDb, (trx) => trx.selectFrom('test_attempts').select(['id', 'status', 'submit_reason', 'score']).where('test_id', '=', testId).execute());
    expect(attempts.find((a) => a.id === aId)).toMatchObject({ status: 'submitted', submit_reason: 'time', score: '2.00' });
    // Omar closed his laptop: the worker submits and marks his attempt.
    expect(await runTestDeadlines(h.db)).toEqual({ timedOut: 1, marked: 1 });
    expect(await withSystemContext(h.ownerDb, (trx) => trx.selectFrom('test_attempts').select(['status', 'submit_reason', 'score']).where('id', '=', oId).executeTakeFirst())).toMatchObject({ status: 'submitted', submit_reason: 'time', score: '0.00' });
  });
});

describe('time for everyone and extra time', () => {
  it('a new closing time moves students already working; results and answers wait for anyone with extra time', async () => {
    const s = await school();
    const { testId, questionIds } = await writeTest(s, { closesAt: minutes(30), results: 'after_close', showAnswers: true }, [QUESTIONS[0]]);
    await publish(s, testId);
    const amira = await studentLogin(h, s.amira);
    const omar = await studentLogin(h, s.omar);
    const aId = (await amira.post(`/api/student/tests/${testId}/start`)).json().attemptId;
    const oId = (await omar.post(`/api/student/tests/${testId}/start`)).json().attemptId;
    // Ten more minutes for everyone: attempts already running end later too.
    const closes = minutes(40);
    expect((await s.teacher.client.patch(`/api/orgs/${s.orgId}/tests/${testId}`, { closesAt: closes })).statusCode).toBe(200);
    expect((await amira.post(`/api/student/attempts/${aId}/heartbeat`)).json().deadlineAt).toBe(closes);

    // Omar gets 20 minutes beyond the closing time; Amira submits.
    await s.teacher.client.post(`/api/orgs/${s.orgId}/tests/${testId}/students/${s.omar.userId}/extra-time`, { minutes: 20 });
    await amira.request('PUT', `/api/student/attempts/${aId}/answers/${questionIds[0]}`, { answer: 'b' });
    await amira.post(`/api/student/attempts/${aId}/submit`);
    // The closing time passes (moved into the past here) while Omar is still working: no results or answers for Amira yet.
    const moveClose = (ago: number) => withSystemContext(h.ownerDb, (trx) => sql`UPDATE tests SET opens_at = now() - interval '2 hours', closes_at = now() - make_interval(mins => ${ago}) WHERE id = ${testId}`.execute(trx));
    await moveClose(1);
    expect((await amira.get(`/api/student/attempts/${aId}/result`)).json().error.code).toBe('RESULTS_NOT_YET');
    expect((await amira.get(`/api/student/tests/${testId}`)).json().attempts[0]).toMatchObject({ resultsVisible: false, score: null });
    expect(await withStudentContext(h.db, { orgId: s.orgId, studentId: s.amira.userId }, (trx) => trx.selectFrom('test_question_keys').select('key').execute())).toEqual([]);
    expect((await omar.post(`/api/student/attempts/${oId}/heartbeat`)).json().status).toBe('in_progress');

    // Once his extra time is over as well, the results and the correct answers show.
    await withSystemContext(h.ownerDb, (trx) => sql`UPDATE test_attempts SET deadline_at = now() - interval '1 minute' WHERE id = ${oId}`.execute(trx));
    expect(await runTestDeadlines(h.db)).toEqual({ timedOut: 1, marked: 1 });
    await moveClose(21);
    const result = (await amira.get(`/api/student/attempts/${aId}/result`)).json();
    expect(result).toMatchObject({ answersShown: true, attempt: { score: 2, maxPoints: 2 } });
    expect(result.questions[0].correct).toEqual(['b']);
  });
});

describe('monitoring and control', () => {
  it('the teacher sees who is working, leaving the page, pasting or using another device, and acts on one student', async () => {
    const s = await school();
    const { testId } = await writeTest(s, { oneDevice: true, kind: 'exam' }, [QUESTIONS[0], QUESTIONS[3]]);
    await publish(s, testId);
    const amira = await studentLogin(h, s.amira);
    const aId = (await amira.post(`/api/student/tests/${testId}/start`)).json().attemptId;
    await amira.post(`/api/student/attempts/${aId}/events`, { kind: 'left_page', seconds: 42 });
    await amira.post(`/api/student/attempts/${aId}/events`, { kind: 'paste', length: 120 });
    expect((await amira.post(`/api/student/attempts/${aId}/events`, { kind: 'submitted' })).statusCode).toBe(400);

    // The same student in a second browser: refused until the teacher allows it.
    const second = await studentLogin(h, s.amira);
    expect((await second.get(`/api/student/attempts/${aId}`)).json().error.code).toBe('OTHER_DEVICE');
    let board = (await s.teacher.client.get(`/api/orgs/${s.orgId}/tests/${testId}/monitor`)).json();
    const row = board.students.find((x: { name: string }) => x.name === 'Amira');
    expect(row.current).toMatchObject({ status: 'in_progress', online: true, answered: 0, total: 2, leftPage: 1, awaySeconds: 42, pastes: 1, otherDevice: 1, deviceLocked: true });
    expect(board.students.find((x: { name: string }) => x.name === 'Omar').current).toBeNull();
    expect((await s.teacher.client.post(`/api/orgs/${s.orgId}/tests/${testId}/attempts/${aId}/allow-device`)).json()).toEqual({ status: 'allowed' });
    expect((await second.get(`/api/student/attempts/${aId}`)).statusCode).toBe(200);
    // Now the first browser is the other device.
    expect((await amira.post(`/api/student/attempts/${aId}/heartbeat`)).json().error.code).toBe('OTHER_DEVICE');
    const events = (await s.teacher.client.get(`/api/orgs/${s.orgId}/tests/${testId}/attempts/${aId}/events`)).json().events.map((e: { kind: string }) => e.kind);
    expect(events).toEqual(['started', 'left_page', 'paste', 'other_device', 'device_allowed', 'resumed', 'other_device']);

    // Submit one student's work; then close the test, which submits everyone still working.
    expect((await s.teacher.client.post(`/api/orgs/${s.orgId}/tests/${testId}/attempts/${aId}/submit`)).json()).toEqual({ status: 'submitted' });
    const omar = await studentLogin(h, s.omar);
    const oId = (await omar.post(`/api/student/tests/${testId}/start`)).json().attemptId;
    const closed = (await s.teacher.client.post(`/api/orgs/${s.orgId}/tests/${testId}/close`)).json();
    expect(closed).toMatchObject({ submitted: 1, test: { phase: 'closed' } });
    expect((await omar.post(`/api/student/tests/${testId}/start`)).json().error.code).toBe('TEST_NOT_OPEN');
    board = (await s.teacher.client.get(`/api/orgs/${s.orgId}/tests/${testId}/monitor`)).json();
    expect(board.students.map((x: { current: { submitReason: string } }) => x.current.submitReason).sort()).toEqual(['closed', 'teacher']);
    expect(await withSystemContext(h.ownerDb, (trx) => trx.selectFrom('test_attempts').select('submit_reason').where('id', '=', oId).executeTakeFirst())).toEqual({ submit_reason: 'closed' });
    // A later closing time reopens it.
    const reopened = (await s.teacher.client.patch(`/api/orgs/${s.orgId}/tests/${testId}`, { closesAt: minutes(30) })).json();
    expect(reopened.test.phase).toBe('open');
    expect((await audit(s.orgId)).map((a) => a.action).sort()).toEqual(['test.closed', 'test.created', 'test.device_allowed', 'test.forced_submit', 'test.published', 'test.updated']);
  });

  it('questions and timing are locked once a student starts; results released by hand reach the students', async () => {
    const s = await school();
    const { testId, questionIds } = await writeTest(s, { results: 'manual' }, [QUESTIONS[0]]);
    await publish(s, testId);
    const amira = await studentLogin(h, s.amira);
    const aId = (await amira.post(`/api/student/tests/${testId}/start`)).json().attemptId;
    expect((await s.teacher.client.post(`/api/orgs/${s.orgId}/tests/${testId}/questions`, QUESTIONS[2])).json().error.code).toBe('TEST_STARTED');
    expect((await s.teacher.client.patch(`/api/orgs/${s.orgId}/tests/${testId}/questions/${questionIds[0]}`, QUESTIONS[0])).json().error.code).toBe('TEST_STARTED');
    expect((await s.teacher.client.patch(`/api/orgs/${s.orgId}/tests/${testId}`, { durationMinutes: 5 })).json().error.code).toBe('TEST_STARTED');
    expect((await s.teacher.client.post(`/api/orgs/${s.orgId}/tests/${testId}/unpublish`)).json().error.code).toBe('TEST_STARTED');
    expect((await s.teacher.client.patch(`/api/orgs/${s.orgId}/tests/${testId}`, { title: 'Unit 3 quiz (corrected)' })).statusCode).toBe(200);
    await amira.request('PUT', `/api/student/attempts/${aId}/answers/${questionIds[0]}`, { answer: 'b' });
    await amira.post(`/api/student/attempts/${aId}/submit`);
    await s.teacher.client.post(`/api/orgs/${s.orgId}/tests/${testId}/close`);
    expect((await amira.get(`/api/student/attempts/${aId}/result`)).json().error.code).toBe('RESULTS_NOT_YET');
    expect((await s.teacher.client.post(`/api/orgs/${s.orgId}/tests/${testId}/release`)).statusCode).toBe(200);
    expect((await amira.get(`/api/student/attempts/${aId}/result`)).json().attempt).toMatchObject({ score: 2, maxPoints: 2 });
    expect((await amira.get('/api/student/notifications')).json().notifications[0]).toMatchObject({ kind: 'test_results', title: 'Results are out: Unit 3 quiz (corrected)' });
    // The teacher's results page.
    const results = (await s.teacher.client.get(`/api/orgs/${s.orgId}/tests/${testId}/results`)).json();
    expect(results.students.find((x: { name: string }) => x.name === 'Amira')).toMatchObject({ best: { score: 2, maxPoints: 2, needsMarking: false }, attempts: [{ number: 1, status: 'submitted', submitReason: 'student' }] });
  });

  it('a student never reaches another student’s attempt, answers or events', async () => {
    const s = await school();
    const { testId, questionIds } = await writeTest(s, {}, [QUESTIONS[0]]);
    await publish(s, testId);
    const amira = await studentLogin(h, s.amira);
    const omar = await studentLogin(h, s.omar);
    const aId = (await amira.post(`/api/student/tests/${testId}/start`)).json().attemptId;
    await amira.request('PUT', `/api/student/attempts/${aId}/answers/${questionIds[0]}`, { answer: 'b' });
    for (const [method, url, body] of [
      ['GET', `/api/student/attempts/${aId}`, undefined],
      ['PUT', `/api/student/attempts/${aId}/answers/${questionIds[0]}`, { answer: 'a' }],
      ['POST', `/api/student/attempts/${aId}/submit`, {}],
      ['POST', `/api/student/attempts/${aId}/events`, { kind: 'paste' }],
      ['GET', `/api/student/attempts/${aId}/result`, undefined],
    ] as const) {
      expect((await omar.request(method, url, body)).statusCode, url).toBe(404);
    }
    const seen = await withStudentContext(h.db, { orgId: s.orgId, studentId: s.omar.userId }, async (trx) => ({
      attempts: await trx.selectFrom('test_attempts').select('id').execute(),
      answers: await trx.selectFrom('test_answers').select('question_id').execute(),
      events: await trx.selectFrom('test_events').select('id').execute(),
      questions: await trx.selectFrom('test_questions').select('id').execute(),
    }));
    expect(seen).toEqual({ attempts: [], answers: [], events: [], questions: [] });
    // Another school's teacher and students see nothing.
    const elsewhere = await signUp(h, { org: 'Elsewhere' });
    expect((await elsewhere.client.get(`/api/orgs/${elsewhere.orgId}/tests/${testId}`)).statusCode).toBe(404);
    expect((await elsewhere.client.get(`/api/orgs/${s.orgId}/tests/${testId}`)).statusCode).toBe(404);
  });
});
