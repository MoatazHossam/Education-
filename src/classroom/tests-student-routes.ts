import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireStudentSession } from '../auth/guards.js';
import { withOrgContext, type Trx } from '../db/index.js';
import type { QuestionOption, Test, TestAttempt } from '../db/types.js';
import type { AppContext } from '../http/context.js';
import { perAccount, rateLimited } from '../http/rate-limit.js';
import { AppError, conflict, forbidden, notFound } from '../lib/errors.js';
import { parse, zUuid } from '../lib/validation.js';
import { asStudent } from '../students/context.js';
import { answerProblem, attemptDeadline, shuffled } from './marking.js';
import { num } from './service.js';
import { markAttempt, MAX_EVENTS_PER_ATTEMPT, recordEvent, resultsVisible, SAVE_GRACE_MS, submitAttempt, testEnd, testJson, testPhase } from './tests-service.js';

// Taking online tests in the student portal (docs/ONLINE_TESTS.md §5). The
// server keeps the time: answers after the deadline are refused and the attempt
// is submitted. Students never receive answer keys before the test is over, and
// only when the teacher shows them (row-level security, migration 0014).

const TestParams = z.object({ testId: zUuid });
const AttemptParams = z.object({ attemptId: zUuid });

/** What a student sees of a test: no answer keys, no start code. */
function studentTestJson(t: Test, now = new Date()) {
  const j = testJson(t, now);
  return { ...j, endsAt: testEnd(t), requireCode: t.access_code !== null };
}

async function myTests(trx: Trx, studentId: string) {
  const tests = await trx.selectFrom('tests as t').innerJoin('classes as c', 'c.id', 't.class_id').selectAll('t').select('c.name as className').orderBy('t.opens_at', 'desc').execute();
  const attempts = await trx.selectFrom('test_attempts').selectAll().where('student_id', '=', studentId).orderBy('number').execute();
  const overrides = await trx.selectFrom('test_student_overrides').selectAll().where('student_id', '=', studentId).execute();
  const now = new Date();
  return tests.map((t) => {
    const mine = attempts.filter((a) => a.test_id === t.id);
    const allowed = t.max_attempts + (overrides.find((o) => o.test_id === t.id)?.extra_attempts ?? 0);
    const visible = mine.filter((a) => resultsVisible(t, a, now) && !a.needs_marking && a.score !== null);
    const best = visible.reduce<TestAttempt | null>((b, a) => (b && Number(b.score) >= Number(a.score) ? b : a), null);
    return {
      ...studentTestJson(t, now),
      className: t.className,
      attemptsUsed: mine.length,
      attemptsAllowed: allowed,
      inProgressAttemptId: mine.find((a) => a.status === 'in_progress')?.id ?? null,
      submitted: mine.some((a) => a.status === 'submitted'),
      waitingForMarks: mine.some((a) => a.status === 'submitted' && (a.needs_marking || !resultsVisible(t, a, now))),
      best: best ? { attemptId: best.id, score: num(best.score), maxPoints: num(best.max_points) } : null,
    };
  });
}

/**
 * The attempt continues in the browser session that started it. Another
 * session is noted for the teacher; when the test is set to one device, it is
 * refused until the teacher allows it (which clears the session). Returns
 * true when refused: the caller commits the note and then answers OTHER_DEVICE,
 * so the refusal does not roll back what the teacher should see.
 */
async function claimDevice(trx: Trx, test: Test, attempt: TestAttempt, sessionId: string): Promise<boolean> {
  if (attempt.session_id === sessionId) return false;
  if (attempt.session_id === null) {
    await trx.updateTable('test_attempts').set({ session_id: sessionId }).where('id', '=', attempt.id).execute();
    await recordEvent(trx, attempt, 'resumed', { newDevice: true });
    return false;
  }
  if (attempt.events_count < MAX_EVENTS_PER_ATTEMPT) await recordEvent(trx, attempt, 'other_device', {});
  if (test.one_device) return true;
  await trx.updateTable('test_attempts').set({ session_id: sessionId }).where('id', '=', attempt.id).execute();
  return false;
}

const otherDevice = () => conflict('This test continues only on the device where you started it. Ask your teacher to allow this one.', 'OTHER_DEVICE');

/** The attempt and its test, for the signed-in student; submits it if its time is up. */
async function liveAttempt(trx: Trx, attemptId: string): Promise<{ attempt: TestAttempt; test: Test; timedOut: boolean }> {
  const attempt = await trx.selectFrom('test_attempts').selectAll().where('id', '=', attemptId).executeTakeFirst();
  if (!attempt) throw notFound('Attempt');
  const test = await trx.selectFrom('tests').selectAll().where('id', '=', attempt.test_id).executeTakeFirst();
  if (!test) throw notFound('Attempt');
  if (attempt.status === 'in_progress' && Date.now() > attempt.deadline_at.getTime() + SAVE_GRACE_MS) {
    await submitAttempt(trx, attempt, 'time');
    return { attempt: { ...attempt, status: 'submitted' }, test, timedOut: true };
  }
  return { attempt, test, timedOut: false };
}

export { myTests };

export function registerStudentTestRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** Marks in the school's context (answer keys are not readable in a student's). The worker retries if this fails. */
  const mark = async (orgId: string, attemptId: string) => {
    await withOrgContext(ctx.db, { orgId }, (trx) => markAttempt(trx, attemptId)).catch((err: unknown) => ctx.log.error({ err, attemptId }, 'marking failed; the worker will retry'));
  };

  app.get('/api/student/tests', async (req) => asStudent(ctx, req, async (trx, { user }) => ({ tests: await myTests(trx, user.id) })));

  app.get('/api/student/tests/:testId', async (req) => {
    const { testId } = parse(TestParams, req.params);
    return asStudent(ctx, req, async (trx, { user }) => {
      const t = (await myTests(trx, user.id)).find((x) => x.id === testId);
      if (!t) throw notFound('Test');
      const test = await trx.selectFrom('tests').selectAll().where('id', '=', testId).executeTakeFirstOrThrow();
      const attempts = await trx.selectFrom('test_attempts').selectAll().where('test_id', '=', testId).where('student_id', '=', user.id).orderBy('number').execute();
      const now = new Date();
      return {
        test: t,
        attempts: attempts.map((a) => {
          const visible = resultsVisible(test, a, now);
          return {
            id: a.id,
            number: a.number,
            status: a.status,
            startedAt: a.started_at,
            submittedAt: a.submitted_at,
            submitReason: a.submit_reason,
            resultsVisible: visible,
            needsMarking: a.needs_marking,
            score: visible && !a.needs_marking ? num(a.score) : null,
            maxPoints: num(a.max_points),
          };
        }),
      };
    });
  });

  app.post('/api/student/tests/:testId/start', rateLimited(60, '15 minutes', perAccount), async (req) => {
    const { testId } = parse(TestParams, req.params);
    const body = parse(z.object({ code: z.string().trim().toUpperCase().max(12).optional() }), req.body ?? {});
    const { session } = requireStudentSession(req);
    return asStudent(ctx, req, async (trx, { user, org }) => {
      const test = await trx.selectFrom('tests').selectAll().where('id', '=', testId).executeTakeFirst();
      if (!test) throw notFound('Test');
      const open = await trx.selectFrom('test_attempts').selectAll().where('test_id', '=', testId).where('student_id', '=', user.id).where('status', '=', 'in_progress').executeTakeFirst();
      if (open) {
        if (await claimDevice(trx, test, open, session.id)) return { blocked: true as const };
        return { attemptId: open.id, resumed: true };
      }
      const phase = testPhase(test);
      if (phase !== 'open') throw conflict(phase === 'upcoming' ? 'This test has not opened yet' : 'This test is closed', 'TEST_NOT_OPEN');
      if (test.access_code && body.code !== test.access_code) throw forbidden('Enter the start code your teacher gives you', 'WRONG_START_CODE');
      const override = await trx.selectFrom('test_student_overrides').selectAll().where('test_id', '=', testId).where('student_id', '=', user.id).executeTakeFirst();
      const used = Number((await trx.selectFrom('test_attempts').select((e) => e.fn.countAll<string>().as('n')).where('test_id', '=', testId).where('student_id', '=', user.id).executeTakeFirstOrThrow()).n);
      if (used >= test.max_attempts + (override?.extra_attempts ?? 0)) throw conflict('You have used all your attempts', 'NO_ATTEMPTS_LEFT');
      const now = new Date();
      const extra = override?.extra_minutes ?? 0;
      // The attempt is created first: a student's request can read a test's questions only once they have an attempt.
      const attempt = await trx
        .insertInto('test_attempts')
        .values({
          org_id: org.id,
          test_id: testId,
          student_id: user.id,
          number: used + 1,
          started_at: now,
          deadline_at: attemptDeadline(test, now, extra),
          extra_minutes: extra,
          session_id: session.id,
          question_order: JSON.stringify([]),
          max_points: 0,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      const questions = await trx.selectFrom('test_questions').select(['id', 'type', 'options', 'points']).where('test_id', '=', testId).orderBy('position').orderBy('created_at').execute();
      if (!questions.length) throw conflict('This test has no questions yet', 'TEST_EMPTY');
      const order = test.shuffle_questions ? shuffled(questions.map((q) => q.id)) : questions.map((q) => q.id);
      const optionOrder: Record<string, string[]> = {};
      for (const q of questions) {
        if (q.type !== 'single' && q.type !== 'multiple') continue;
        const ids = q.options.map((o) => o.id);
        optionOrder[q.id] = test.shuffle_options ? shuffled(ids) : ids;
      }
      const max = questions.reduce((s, q) => s + Number(q.points), 0);
      await trx.updateTable('test_attempts').set({ question_order: JSON.stringify(order), option_order: JSON.stringify(optionOrder), max_points: max }).where('id', '=', attempt.id).execute();
      await recordEvent(trx, attempt, 'started', {});
      return { attemptId: attempt.id, resumed: false };
    }).then((r) => {
      if ('blocked' in r) throw otherDevice();
      return r;
    });
  });

  app.get('/api/student/attempts/:attemptId', async (req) => {
    const { attemptId } = parse(AttemptParams, req.params);
    const { session } = requireStudentSession(req);
    const r = await asStudent(ctx, req, async (trx, { org }) => {
      const { attempt, test, timedOut } = await liveAttempt(trx, attemptId);
      if (attempt.status === 'in_progress') {
        if (await claimDevice(trx, test, attempt, session.id)) return { blocked: true as const };
        await trx.updateTable('test_attempts').set({ last_seen_at: new Date() }).where('id', '=', attempt.id).execute();
      }
      const questions = await trx.selectFrom('test_questions').select(['id', 'type', 'prompt', 'options', 'points']).where('test_id', '=', test.id).execute();
      const byId = new Map(questions.map((q) => [q.id, q]));
      const answers = await trx.selectFrom('test_answers').select(['question_id', 'answer']).where('attempt_id', '=', attemptId).execute();
      const order = attempt.option_order;
      return {
        orgId: org.id,
        timedOut,
        body: {
          serverNow: new Date(),
          test: studentTestJson(test),
          attempt: { id: attempt.id, number: attempt.number, status: attempt.status, startedAt: attempt.started_at, deadlineAt: attempt.deadline_at, submittedAt: attempt.submitted_at },
          questions: attempt.question_order
            .map((id) => byId.get(id))
            .filter((q) => q !== undefined)
            .map((q) => {
              const opts = q.options as QuestionOption[];
              const ids = order[q.id];
              return { id: q.id, type: q.type, prompt: q.prompt, points: Number(q.points), options: ids ? ids.map((i) => opts.find((o) => o.id === i)!).filter(Boolean) : opts };
            }),
          answers: Object.fromEntries(answers.map((a) => [a.question_id, a.answer])),
        },
      };
    });
    if ('blocked' in r) throw otherDevice();
    if (r.timedOut) await mark(r.orgId, attemptId);
    return r.body;
  });

  app.put('/api/student/attempts/:attemptId/answers/:questionId', rateLimited(3000, '1 hour', perAccount), async (req) => {
    const { attemptId, questionId } = parse(AttemptParams.extend({ questionId: zUuid }), req.params);
    const body = parse(z.object({ answer: z.unknown() }), req.body);
    const { session } = requireStudentSession(req);
    const r = await asStudent(ctx, req, async (trx, { org }) => {
      const { attempt, test, timedOut } = await liveAttempt(trx, attemptId);
      if (timedOut) return { orgId: org.id, timedOut: true as const };
      if (attempt.status !== 'in_progress') throw conflict('This attempt is submitted', 'ATTEMPT_SUBMITTED');
      if (await claimDevice(trx, test, attempt, session.id)) return { blocked: true as const };
      if (!attempt.question_order.includes(questionId)) throw notFound('Question');
      const now = new Date();
      if (body.answer === null || body.answer === undefined) {
        await trx.deleteFrom('test_answers').where('attempt_id', '=', attemptId).where('question_id', '=', questionId).execute();
      } else {
        const q = await trx.selectFrom('test_questions').select(['type', 'options']).where('id', '=', questionId).executeTakeFirstOrThrow();
        const problem = answerProblem(q.type, q.options, body.answer);
        if (problem) throw new AppError(400, 'ANSWER_INVALID', problem);
        await trx
          .insertInto('test_answers')
          .values({ attempt_id: attemptId, org_id: attempt.org_id, question_id: questionId, answer: JSON.stringify(body.answer), saved_at: now })
          .onConflict((oc) => oc.columns(['attempt_id', 'question_id']).doUpdateSet({ answer: JSON.stringify(body.answer), saved_at: now }))
          .execute();
      }
      await trx.updateTable('test_attempts').set({ last_seen_at: now }).where('id', '=', attemptId).execute();
      return { orgId: org.id, timedOut: false as const, savedAt: now };
    });
    if ('blocked' in r) throw otherDevice();
    if (r.timedOut) {
      await mark(r.orgId, attemptId);
      throw conflict('Time is up. Your answers were submitted.', 'TIME_UP');
    }
    return { savedAt: r.savedAt };
  });

  // Every 20 seconds while the test page is open: keeps the teacher's monitor current and the page's clock in step.
  app.post('/api/student/attempts/:attemptId/heartbeat', rateLimited(1200, '1 hour', perAccount), async (req) => {
    const { attemptId } = parse(AttemptParams, req.params);
    const { session } = requireStudentSession(req);
    const r = await asStudent(ctx, req, async (trx, { org }) => {
      const { attempt, test, timedOut } = await liveAttempt(trx, attemptId);
      if (attempt.status === 'in_progress') {
        if (await claimDevice(trx, test, attempt, session.id)) return { blocked: true as const };
        await trx.updateTable('test_attempts').set({ last_seen_at: new Date() }).where('id', '=', attemptId).execute();
      }
      const fresh = await trx.selectFrom('test_attempts').select(['status', 'deadline_at']).where('id', '=', attemptId).executeTakeFirstOrThrow();
      return { orgId: org.id, timedOut, body: { status: fresh.status, deadlineAt: fresh.deadline_at, serverNow: new Date() } };
    });
    if ('blocked' in r) throw otherDevice();
    if (r.timedOut) await mark(r.orgId, attemptId);
    return r.body;
  });

  // What the page notices (shown to the teacher): leaving the test page, pasting, losing the connection.
  app.post('/api/student/attempts/:attemptId/events', rateLimited(1200, '1 hour', perAccount), async (req) => {
    const { attemptId } = parse(AttemptParams, req.params);
    const body = parse(
      z.object({ kind: z.enum(['left_page', 'returned', 'paste', 'offline', 'online']), seconds: z.number().min(0).max(36_000).optional(), length: z.number().int().min(0).max(1_000_000).optional() }),
      req.body,
    );
    return asStudent(ctx, req, async (trx) => {
      const attempt = await trx.selectFrom('test_attempts').selectAll().where('id', '=', attemptId).executeTakeFirst();
      if (!attempt) throw notFound('Attempt');
      if (attempt.status !== 'in_progress' || attempt.events_count >= MAX_EVENTS_PER_ATTEMPT) return { recorded: false };
      const detail: Record<string, unknown> = {};
      if (body.seconds !== undefined) detail.seconds = Math.round(body.seconds);
      if (body.length !== undefined) detail.length = body.length;
      await recordEvent(trx, attempt, body.kind, detail);
      return { recorded: true };
    });
  });

  app.post('/api/student/attempts/:attemptId/submit', async (req) => {
    const { attemptId } = parse(AttemptParams, req.params);
    const r = await asStudent(ctx, req, async (trx, { org }) => {
      const { attempt, timedOut } = await liveAttempt(trx, attemptId);
      if (!timedOut && attempt.status !== 'in_progress') throw conflict('This attempt is already submitted', 'ATTEMPT_SUBMITTED');
      if (!timedOut) await submitAttempt(trx, attempt, 'student');
      return { orgId: org.id, testId: attempt.test_id };
    });
    await mark(r.orgId, attemptId);
    return { status: 'submitted', testId: r.testId };
  });

  // The student's own review, once the test's results setting allows it.
  app.get('/api/student/attempts/:attemptId/result', async (req) => {
    const { attemptId } = parse(AttemptParams, req.params);
    return asStudent(ctx, req, async (trx) => {
      const attempt = await trx.selectFrom('test_attempts').selectAll().where('id', '=', attemptId).executeTakeFirst();
      if (!attempt) throw notFound('Attempt');
      const test = await trx.selectFrom('tests').selectAll().where('id', '=', attempt.test_id).executeTakeFirstOrThrow();
      if (!resultsVisible(test, attempt)) throw forbidden('Your teacher has not shown the results of this test yet', 'RESULTS_NOT_YET');
      const questions = await trx.selectFrom('test_questions').select(['id', 'type', 'prompt', 'options', 'points']).where('test_id', '=', test.id).execute();
      // Row-level security returns keys only when the teacher shows answers and the test is over.
      const keys = new Map((await trx.selectFrom('test_question_keys').select(['question_id', 'key']).where('test_id', '=', test.id).execute()).map((k) => [k.question_id, k.key]));
      const answers = new Map((await trx.selectFrom('test_answers').selectAll().where('attempt_id', '=', attemptId).execute()).map((a) => [a.question_id, a]));
      const byId = new Map(questions.map((q) => [q.id, q]));
      return {
        test: studentTestJson(test),
        attempt: { id: attempt.id, number: attempt.number, submittedAt: attempt.submitted_at, submitReason: attempt.submit_reason, needsMarking: attempt.needs_marking, score: attempt.needs_marking ? null : num(attempt.score), maxPoints: num(attempt.max_points) },
        answersShown: keys.size > 0,
        questions: attempt.question_order
          .map((id) => byId.get(id))
          .filter((q) => q !== undefined)
          .map((q) => {
            const a = answers.get(q.id);
            const pts = num(a?.manual_points ?? null) ?? num(a?.auto_points ?? null);
            const k = keys.get(q.id);
            return {
              id: q.id,
              type: q.type,
              prompt: q.prompt,
              options: q.options,
              points: Number(q.points),
              answer: a?.answer ?? null,
              earned: a ? pts : 0,
              waiting: Boolean(a) && pts === null,
              feedback: a?.feedback ?? null,
              correct: k === undefined ? null : q.type === 'essay' ? null : k,
            };
          }),
      };
    });
  });
}
