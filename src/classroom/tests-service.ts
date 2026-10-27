import { sql } from 'kysely';
import { z } from 'zod';
import type { Database, Executor } from '../db/index.js';
import { withSystemContext } from '../db/index.js';
import type { AnswerKey, GivenAnswer, Locale, QuestionOption, QuestionType, Test, TestAttempt, TestEventKind } from '../db/types.js';
import { notify } from '../notifications/email.js';
import { attemptDeadline, autoMark } from './marking.js';
import { num } from './service.js';

// Online tests and exams (docs/ONLINE_TESTS.md): shared queries for the staff
// and student routes, marking, and the worker's pass that ends attempts on time.

/** Answers saved this long after the deadline still count (a slow network on the last save). */
export const SAVE_GRACE_MS = 15_000;
/** Seen within this time: shown as online on the teacher's monitor. */
export const ONLINE_WINDOW_MS = 45_000;
/** Most monitoring events kept per attempt (a misbehaving page cannot fill the table). */
export const MAX_EVENTS_PER_ATTEMPT = 300;

export const zOptions = z.array(z.object({ id: z.string().regex(/^[a-j]$/), text: z.string().trim().min(1).max(500) })).max(10);
export const zKey = z.union([z.array(z.string().max(200)).max(20), z.boolean(), z.object({ guide: z.string().max(2000).nullable() })]);
export const zQuestionType = z.enum(['single', 'multiple', 'true_false', 'short', 'essay']);

export type TestPhase = 'draft' | 'upcoming' | 'open' | 'closed';

/** When the test stops accepting work: closed by the teacher, or its closing time. */
export function testEnd(t: Pick<Test, 'closes_at' | 'closed_early_at'>): Date {
  return t.closed_early_at && t.closed_early_at < t.closes_at ? t.closed_early_at : t.closes_at;
}

export function testPhase(t: Pick<Test, 'status' | 'opens_at' | 'closes_at' | 'closed_early_at'>, now = new Date()): TestPhase {
  if (t.status === 'draft') return 'draft';
  if (now < t.opens_at) return 'upcoming';
  return now < testEnd(t) ? 'open' : 'closed';
}

/**
 * When no student can still be working: the teacher's early close (which submits every attempt), or the
 * closing time plus the most extra time anyone was given (attempts with extra time may run past it).
 */
export function testOverForAll(t: Pick<Test, 'closes_at' | 'closed_early_at' | 'max_extra_minutes'>): Date {
  if (t.closed_early_at) return t.closed_early_at;
  return new Date(t.closes_at.getTime() + t.max_extra_minutes * 60_000);
}

/** Whether a student may see marks of a submitted attempt (the test's results setting). */
export function resultsVisible(t: Pick<Test, 'results' | 'results_released_at' | 'closes_at' | 'closed_early_at' | 'max_extra_minutes'>, attempt: Pick<TestAttempt, 'status'>, now = new Date()): boolean {
  if (attempt.status !== 'submitted') return false;
  if (t.results === 'after_submit') return true;
  // Not while a classmate with extra time is still working: results show which answers were right.
  if (t.results === 'after_close') return now >= testOverForAll(t);
  return t.results_released_at !== null;
}

export function testJson(t: Test, now = new Date()) {
  return {
    id: t.id,
    classId: t.class_id,
    subjectEn: t.subject_en,
    subjectAr: t.subject_ar,
    title: t.title,
    instructions: t.instructions,
    kind: t.kind,
    status: t.status,
    phase: testPhase(t, now),
    opensAt: t.opens_at,
    closesAt: t.closes_at,
    closedEarlyAt: t.closed_early_at,
    durationMinutes: t.duration_minutes,
    maxAttempts: t.max_attempts,
    shuffleQuestions: t.shuffle_questions,
    shuffleOptions: t.shuffle_options,
    results: t.results,
    showAnswers: t.show_answers,
    resultsReleasedAt: t.results_released_at,
    requireCode: t.access_code !== null,
    oneDevice: t.one_device,
    publishedAt: t.published_at,
    // Deleted under the school's retention periods (classroom/retention.ts).
    workRemovedAt: t.work_removed_at,
    monitoringRemovedAt: t.monitoring_removed_at,
  };
}

export async function testQuestions(exec: Executor, testId: string, withKeys: boolean) {
  const rows = await exec
    .selectFrom('test_questions as q')
    .$if(withKeys, (qb) => qb.leftJoin('test_question_keys as k', 'k.question_id', 'q.id').select('k.key'))
    .select(['q.id', 'q.position', 'q.type', 'q.prompt', 'q.options', 'q.points'])
    .where('q.test_id', '=', testId)
    .orderBy('q.position')
    .orderBy('q.created_at')
    .execute();
  return rows.map((r) => ({
    id: r.id,
    position: r.position,
    type: r.type,
    prompt: r.prompt,
    options: r.options,
    points: Number(r.points),
    ...(withKeys ? { key: (r as unknown as { key: AnswerKey | null }).key } : {}),
  }));
}

/** The class's tests, newest first, with how many students submitted and how many attempts wait for marking. */
export async function classTests(exec: Executor, classId: string) {
  const rows = await exec
    .selectFrom('tests as t')
    .selectAll('t')
    .select((eb) => [
      eb.selectFrom('test_questions as q').select((e) => e.fn.countAll<string>().as('n')).whereRef('q.test_id', '=', 't.id').as('questions'),
      eb.selectFrom('test_attempts as a').select((e) => sql<string>`count(DISTINCT ${e.ref('a.student_id')})`.as('n')).whereRef('a.test_id', '=', 't.id').where('a.status', '=', 'submitted').as('submitted'),
      eb.selectFrom('test_attempts as a').select((e) => e.fn.countAll<string>().as('n')).whereRef('a.test_id', '=', 't.id').where('a.status', '=', 'in_progress').as('inProgress'),
      eb.selectFrom('test_attempts as a').select((e) => e.fn.countAll<string>().as('n')).whereRef('a.test_id', '=', 't.id').where('a.needs_marking', '=', true).as('toMark'),
      eb.selectFrom('class_students as cs').select((e) => e.fn.countAll<string>().as('n')).whereRef('cs.class_id', '=', 't.class_id').as('enrolled'),
    ])
    .where('t.class_id', '=', classId)
    .orderBy('t.opens_at', 'desc')
    .execute();
  const now = new Date();
  return rows.map((r) => ({
    ...testJson(r, now),
    counts: { questions: Number(r.questions ?? 0), submitted: Number(r.submitted ?? 0), inProgress: Number(r.inProgress ?? 0), toMark: Number(r.toMark ?? 0), enrolled: Number(r.enrolled ?? 0) },
  }));
}

// ------------------------------------------------------------ attempts

/**
 * Marks an attempt from the answer keys and the teacher's marks, and stores
 * its totals. Runs where keys are readable (staff or system context), never
 * in a student's context.
 */
export async function markAttempt(exec: Executor, attemptId: string): Promise<void> {
  const attempt = await exec.selectFrom('test_attempts').selectAll().where('id', '=', attemptId).executeTakeFirst();
  if (!attempt) return;
  const questions = await exec
    .selectFrom('test_questions as q')
    .leftJoin('test_question_keys as k', 'k.question_id', 'q.id')
    .select(['q.id', 'q.type', 'q.points', 'k.key'])
    .where('q.test_id', '=', attempt.test_id)
    .execute();
  const answers = new Map(
    (await exec.selectFrom('test_answers').select(['question_id', 'answer', 'auto_points', 'manual_points']).where('attempt_id', '=', attemptId).execute()).map((a) => [a.question_id, a]),
  );
  let auto = 0;
  let manual = 0;
  let score = 0;
  let needsMarking = false;
  for (const q of questions) {
    const given = answers.get(q.id);
    const points = Number(q.points);
    // An answer deleted under the school's retention periods (classroom/retention.ts) keeps the automatic mark it had.
    const removed = given !== undefined && given.answer === null;
    const a = removed ? num(given.auto_points) : autoMark(q.type, points, (q.key ?? []) as AnswerKey, given?.answer as GivenAnswer | undefined);
    if (given && !removed) await exec.updateTable('test_answers').set({ auto_points: a }).where('attempt_id', '=', attemptId).where('question_id', '=', q.id).execute();
    const m = num(given?.manual_points ?? null);
    if (a !== null) auto += a;
    if (m !== null) manual += m;
    if (a === null && m === null) needsMarking = true;
    score += m ?? a ?? 0;
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  await exec
    .updateTable('test_attempts')
    .set({ auto_points: round(auto), manual_points: round(manual), score: round(score), needs_marking: needsMarking, marked_at: new Date() })
    .where('id', '=', attemptId)
    .execute();
}

export async function recordEvent(exec: Executor, attempt: Pick<TestAttempt, 'id' | 'org_id'>, kind: TestEventKind, detail: Record<string, unknown> = {}): Promise<void> {
  await exec.insertInto('test_events').values({ org_id: attempt.org_id, attempt_id: attempt.id, kind, detail: JSON.stringify(detail) }).execute();
  await exec.updateTable('test_attempts').set((eb) => ({ events_count: eb('events_count', '+', 1) })).where('id', '=', attempt.id).execute();
}

/** Ends an attempt (once). Marking follows in a context that can read the keys. */
export async function submitAttempt(exec: Executor, attempt: TestAttempt, reason: 'student' | 'time' | 'teacher' | 'closed'): Promise<boolean> {
  const res = await exec
    .updateTable('test_attempts')
    .set({ status: 'submitted', submitted_at: new Date(), submit_reason: reason })
    .where('id', '=', attempt.id)
    .where('status', '=', 'in_progress')
    .executeTakeFirst();
  if (!Number(res.numUpdatedRows)) return false;
  const kind = reason === 'student' ? 'submitted' : reason === 'time' ? 'time_up' : reason === 'teacher' ? 'forced_submit' : 'closed';
  await recordEvent(exec, attempt, kind, {});
  return true;
}

/** Extra time for one student: their allowance grows, and an attempt in progress gets the later deadline. */
export async function giveExtraTime(exec: Executor, test: Test, studentId: string, minutes: number): Promise<{ extraMinutes: number; deadlineAt: Date | null }> {
  const row = await exec
    .insertInto('test_student_overrides')
    .values({ test_id: test.id, org_id: test.org_id, student_id: studentId, extra_minutes: Math.min(600, minutes) })
    .onConflict((oc) => oc.columns(['test_id', 'student_id']).doUpdateSet((eb) => ({ extra_minutes: sql<number>`least(600, ${eb.ref('test_student_overrides.extra_minutes')} + ${minutes})` })))
    .returning('extra_minutes')
    .executeTakeFirstOrThrow();
  await exec.updateTable('tests').set({ max_extra_minutes: sql<number>`greatest(max_extra_minutes, ${row.extra_minutes})` }).where('id', '=', test.id).execute();
  const open = await exec.selectFrom('test_attempts').selectAll().where('test_id', '=', test.id).where('student_id', '=', studentId).where('status', '=', 'in_progress').executeTakeFirst();
  if (!open) return { extraMinutes: row.extra_minutes, deadlineAt: null };
  const extra = Math.min(600, open.extra_minutes + minutes);
  const deadline = attemptDeadline(test, open.started_at, extra);
  await exec.updateTable('test_attempts').set({ extra_minutes: extra, deadline_at: deadline }).where('id', '=', open.id).execute();
  await recordEvent(exec, open, 'extra_time', { minutes });
  return { extraMinutes: row.extra_minutes, deadlineAt: deadline };
}

// ------------------------------------------------------------ monitor

/** The teacher's live view: one row per student of the class, with their current or last attempt and what was noticed. */
export async function monitorRows(exec: Executor, test: Test, now = new Date()) {
  const students = await exec
    .selectFrom('class_students as cs')
    .innerJoin('students as s', 's.user_id', 'cs.student_id')
    .innerJoin('users as u', 'u.id', 's.user_id')
    .leftJoin('test_student_overrides as o', (j) => j.onRef('o.student_id', '=', 's.user_id').on('o.test_id', '=', test.id))
    .select(['s.user_id', 's.username', 'u.name', 'o.extra_minutes', 'o.extra_attempts'])
    .where('cs.class_id', '=', test.class_id)
    .orderBy('u.name')
    .execute();
  const attempts = await exec.selectFrom('test_attempts').selectAll().where('test_id', '=', test.id).orderBy('number').execute();
  const totalQuestions = Number((await exec.selectFrom('test_questions').select((e) => e.fn.countAll<string>().as('n')).where('test_id', '=', test.id).executeTakeFirstOrThrow()).n);
  const ids = attempts.map((a) => a.id);
  const answered = ids.length
    ? new Map((await exec.selectFrom('test_answers').select(['attempt_id', (e) => e.fn.countAll<string>().as('n')]).where('attempt_id', 'in', ids).groupBy('attempt_id').execute()).map((r) => [r.attempt_id, Number(r.n)]))
    : new Map<string, number>();
  const events = ids.length
    ? await exec
        .selectFrom('test_events')
        .select(['attempt_id', 'kind', (e) => e.fn.countAll<string>().as('n'), (e) => sql<string>`coalesce(sum((${e.ref('detail')}->>'seconds')::numeric), 0)`.as('seconds')])
        .where('attempt_id', 'in', ids)
        .where('kind', 'in', ['left_page', 'paste', 'other_device', 'offline'])
        .groupBy(['attempt_id', 'kind'])
        .execute()
    : [];
  const ev = (attemptId: string, kind: string) => events.find((e) => e.attempt_id === attemptId && e.kind === kind);
  return students.map((s) => {
    const mine = attempts.filter((a) => a.student_id === s.user_id);
    const current = mine.find((a) => a.status === 'in_progress') ?? mine[mine.length - 1] ?? null;
    const best = mine.filter((a) => a.status === 'submitted' && a.score !== null).reduce<TestAttempt | null>((b, a) => (b && Number(b.score) >= Number(a.score) ? b : a), null);
    return {
      studentId: s.user_id,
      username: s.username,
      name: s.name,
      attemptsUsed: mine.length,
      attemptsAllowed: test.max_attempts + (s.extra_attempts ?? 0),
      extraMinutes: s.extra_minutes ?? 0,
      best: best ? { attemptId: best.id, score: num(best.score), maxPoints: num(best.max_points), needsMarking: best.needs_marking } : null,
      current: current
        ? {
            attemptId: current.id,
            number: current.number,
            status: current.status,
            startedAt: current.started_at,
            deadlineAt: current.deadline_at,
            submittedAt: current.submitted_at,
            submitReason: current.submit_reason,
            answered: answered.get(current.id) ?? 0,
            total: totalQuestions,
            lastSeenAt: current.last_seen_at,
            online: current.status === 'in_progress' && now.getTime() - current.last_seen_at.getTime() < ONLINE_WINDOW_MS,
            leftPage: Number(ev(current.id, 'left_page')?.n ?? 0),
            awaySeconds: Math.round(Number(ev(current.id, 'left_page')?.seconds ?? 0)),
            pastes: Number(ev(current.id, 'paste')?.n ?? 0),
            otherDevice: Number(ev(current.id, 'other_device')?.n ?? 0),
            offline: Number(ev(current.id, 'offline')?.n ?? 0),
            deviceLocked: test.one_device && current.status === 'in_progress' && current.session_id !== null,
            score: num(current.score),
            needsMarking: current.needs_marking,
          }
        : null,
    };
  });
}

// ------------------------------------------------------------ notifications

const fmtWhen = (d: Date, locale: Locale) =>
  new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', { weekday: 'short', day: 'numeric', month: locale === 'ar' ? 'long' : 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Africa/Cairo' }).format(d);

const PUBLISHED: Record<Locale, (p: { title: string; subject: string; opens: string; closes: string; exam: boolean; open: boolean }) => { title: string; body: string }> = {
  en: (p) => ({ title: `${p.exam ? 'New exam' : 'New test'}: ${p.title}`, body: p.open ? `${p.subject} · open now until ${p.closes}` : `${p.subject} · opens ${p.opens}` }),
  ar: (p) => ({ title: `${p.exam ? 'امتحان جديد' : 'اختبار جديد'}: ${p.title}`, body: p.open ? `${p.subject} · متاح الآن حتى ${p.closes}` : `${p.subject} · يبدأ ${p.opens}` }),
};
const RELEASED: Record<Locale, (p: { title: string }) => { title: string; body: string }> = {
  en: (p) => ({ title: `Results are out: ${p.title}`, body: 'Open the test to see your mark.' }),
  ar: (p) => ({ title: `ظهرت النتيجة: ${p.title}`, body: 'افتح الاختبار لترى درجتك.' }),
};

async function classStudentLocales(exec: Executor, classId: string) {
  return exec.selectFrom('class_students as cs').innerJoin('users as u', 'u.id', 'cs.student_id').select(['u.id', 'u.locale']).where('cs.class_id', '=', classId).execute();
}

export async function notifyTestPublished(exec: Executor, t: Test): Promise<void> {
  const now = new Date();
  for (const s of await classStudentLocales(exec, t.class_id)) {
    const text = PUBLISHED[s.locale]({ title: t.title, subject: s.locale === 'ar' ? t.subject_ar : t.subject_en, opens: fmtWhen(t.opens_at, s.locale), closes: fmtWhen(testEnd(t), s.locale), exam: t.kind === 'exam', open: now >= t.opens_at });
    await notify(exec, { userId: s.id, orgId: t.org_id, kind: 'test_published', title: text.title, body: text.body, link: `/student/tests/${t.id}` });
  }
  await exec.updateTable('tests').set({ notified_at: now }).where('id', '=', t.id).execute();
}

export async function notifyResultsReleased(exec: Executor, t: Test): Promise<void> {
  const takers = await exec
    .selectFrom('test_attempts as a')
    .innerJoin('users as u', 'u.id', 'a.student_id')
    .select(['u.id', 'u.locale'])
    .distinct()
    .where('a.test_id', '=', t.id)
    .where('a.status', '=', 'submitted')
    .execute();
  for (const s of takers) {
    const text = RELEASED[s.locale]({ title: t.title });
    await notify(exec, { userId: s.id, orgId: t.org_id, kind: 'test_results', title: text.title, body: text.body, link: `/student/tests/${t.id}` });
  }
}

// ------------------------------------------------------------ worker

/**
 * Worker pass: attempts whose time is up are submitted (the student's page
 * normally does it; this covers closed laptops and lost connections), and any
 * submitted attempt not yet marked is marked.
 */
export async function runTestDeadlines(db: Database, now = new Date()): Promise<{ timedOut: number; marked: number }> {
  return withSystemContext(db, async (trx) => {
    const late = await trx
      .selectFrom('test_attempts')
      .selectAll()
      .where('status', '=', 'in_progress')
      .where('deadline_at', '<', new Date(now.getTime() - SAVE_GRACE_MS))
      .orderBy('deadline_at')
      .limit(500)
      .forUpdate()
      .skipLocked()
      .execute();
    let timedOut = 0;
    for (const a of late) if (await submitAttempt(trx, a, 'time')) timedOut++;
    const unmarked = await trx.selectFrom('test_attempts').select('id').where('status', '=', 'submitted').where('marked_at', 'is', null).limit(500).execute();
    for (const a of unmarked) await markAttempt(trx, a.id);
    return { timedOut, marked: unmarked.length };
  });
}

export type { QuestionOption, QuestionType };
