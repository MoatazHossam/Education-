import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorFromRequest, recordAudit, requestMeta } from '../audit/audit.js';
import { inOrg, type OrgAccess } from '../auth/guards.js';
import { getEntitlements } from '../billing/entitlements.js';
import type { Executor } from '../db/index.js';
import type { AnswerKey, Test } from '../db/types.js';
import type { AppContext } from '../http/context.js';
import { rateLimited } from '../http/rate-limit.js';
import { AppError, badRequest, conflict, notFound } from '../lib/errors.js';
import { parse, zUuid } from '../lib/validation.js';
import { attemptDeadline, newAccessCode, questionProblem } from './marking.js';
import { assertClassroomEnabled, assertTeachesSubject, classAccess, num, teachesSubject, zPoints, zSubjectName, type ClassAccess } from './service.js';
import {
  giveExtraTime,
  markAttempt,
  monitorRows,
  notifyResultsReleased,
  notifyTestPublished,
  recordEvent,
  submitAttempt,
  testJson,
  testPhase,
  testQuestions,
  zKey,
  zOptions,
  zQuestionType,
} from './tests-service.js';

// Online tests and exams for teachers (docs/ONLINE_TESTS.md §6): write a test,
// publish it, watch it live, act on single students, mark what the computer
// cannot, and release results. Only the subject's teachers (and the school's
// admins) change a test; any teacher of the class may look at it.

const ClassParams = z.object({ orgId: z.string(), classId: zUuid });
const TestParams = z.object({ orgId: z.string(), testId: zUuid });
const zWhen = z.iso.datetime({ offset: true }).transform((s) => new Date(s));

const Settings = z.object({
  title: z.string().trim().min(1).max(200),
  instructions: z.string().trim().max(5000).default(''),
  kind: z.enum(['quiz', 'exam']).default('quiz'),
  opensAt: zWhen,
  closesAt: zWhen,
  durationMinutes: z.number().int().min(1).max(600).nullable().default(null),
  maxAttempts: z.number().int().min(1).max(10).default(1),
  shuffleQuestions: z.boolean().default(false),
  shuffleOptions: z.boolean().default(false),
  results: z.enum(['after_submit', 'after_close', 'manual']).default('after_close'),
  showAnswers: z.boolean().default(false),
  requireCode: z.boolean().default(false),
  oneDevice: z.boolean().default(false),
});

/** For changes: the same fields with no defaults, so only what is sent changes. */
const SettingsPatch = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  instructions: z.string().trim().max(5000).optional(),
  kind: z.enum(['quiz', 'exam']).optional(),
  opensAt: zWhen.optional(),
  closesAt: zWhen.optional(),
  durationMinutes: z.number().int().min(1).max(600).nullable().optional(),
  maxAttempts: z.number().int().min(1).max(10).optional(),
  shuffleQuestions: z.boolean().optional(),
  shuffleOptions: z.boolean().optional(),
  results: z.enum(['after_submit', 'after_close', 'manual']).optional(),
  showAnswers: z.boolean().optional(),
  requireCode: z.boolean().optional(),
  oneDevice: z.boolean().optional(),
});

const QuestionBody = z.object({ type: zQuestionType, prompt: z.string().trim().min(1).max(2000), options: zOptions.default([]), points: zPoints.positive(), key: zKey });

/** Settings that cannot change once a student has started: they would make attempts unequal. */
const LOCKED_AFTER_START = ['kind', 'opensAt', 'durationMinutes', 'maxAttempts', 'shuffleQuestions', 'shuffleOptions', 'requireCode', 'oneDevice'] as const;

interface TestAccess {
  test: Test;
  acc: ClassAccess;
  canEdit: boolean;
}

async function testAccess(exec: Executor, access: OrgAccess, testId: string): Promise<TestAccess> {
  const test = await exec.selectFrom('tests').selectAll().where('org_id', '=', access.org.id).where('id', '=', testId).executeTakeFirst();
  if (!test) throw notFound('Test');
  const acc = await classAccess(exec, access, test.class_id).catch((err: unknown) => {
    throw err instanceof AppError && err.statusCode === 404 ? notFound('Test') : err;
  });
  return { test, acc, canEdit: teachesSubject(acc, test.subject_en) };
}

async function editable(exec: Executor, access: OrgAccess, testId: string): Promise<TestAccess> {
  const ta = await testAccess(exec, access, testId);
  assertTeachesSubject(ta.acc, ta.test.subject_en);
  return ta;
}

async function hasAttempts(exec: Executor, testId: string): Promise<boolean> {
  return Boolean(await exec.selectFrom('test_attempts').select('id').where('test_id', '=', testId).limit(1).executeTakeFirst());
}

async function assertNotStarted(exec: Executor, testId: string): Promise<void> {
  if (await hasAttempts(exec, testId)) throw conflict('Students have started this test; its questions and timing can no longer change', 'TEST_STARTED');
}

function checkQuestion(body: z.infer<typeof QuestionBody>): void {
  const problem = questionProblem({ ...body, key: body.key as AnswerKey });
  if (problem) throw new AppError(400, 'QUESTION_INVALID', problem);
}

export function registerTestRoutes(app: FastifyInstance, ctx: AppContext): void {
  const grace = ctx.config.GRACE_DAYS;

  app.post('/api/orgs/:orgId/classes/:classId/tests', rateLimited(300, '1 hour'), async (req, reply) => {
    const { orgId, classId } = parse(ClassParams, req.params);
    const body = parse(Settings.extend({ subjectEn: zSubjectName, subjectAr: zSubjectName }), req.body);
    const test = await inOrg(ctx, req, orgId, 'viewer', async (trx, access) => {
      assertClassroomEnabled(await getEntitlements(trx, orgId, grace));
      const acc = await classAccess(trx, access, classId);
      if (acc.cls.archived_at) throw conflict('This class is archived', 'CLASS_ARCHIVED');
      assertTeachesSubject(acc, body.subjectEn);
      if (body.closesAt <= body.opensAt) throw new AppError(400, 'CLOSES_BEFORE_OPENS', 'The test must close after it opens');
      const row = await trx
        .insertInto('tests')
        .values({
          org_id: orgId,
          class_id: classId,
          subject_en: body.subjectEn,
          subject_ar: body.subjectAr,
          title: body.title,
          instructions: body.instructions,
          kind: body.kind,
          opens_at: body.opensAt,
          closes_at: body.closesAt,
          duration_minutes: body.durationMinutes,
          max_attempts: body.maxAttempts,
          shuffle_questions: body.shuffleQuestions,
          shuffle_options: body.shuffleOptions,
          results: body.results,
          show_answers: body.showAnswers,
          access_code: body.requireCode ? newAccessCode() : null,
          one_device: body.oneDevice,
          created_by: access.user.id,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await recordAudit(trx, actorFromRequest(req), { orgId, action: 'test.created', targetType: 'test', targetId: row.id, metadata: { class: acc.cls.name, title: row.title, kind: row.kind } }, requestMeta(req));
      return row;
    });
    return reply.status(201).send({ test: testJson(test) });
  });

  app.get('/api/orgs/:orgId/tests/:testId', async (req) => {
    const { orgId, testId } = parse(TestParams, req.params);
    return inOrg(ctx, req, orgId, 'viewer', async (trx, access) => {
      const { test, acc, canEdit } = await testAccess(trx, access, testId);
      return {
        test: testJson(test),
        accessCode: canEdit ? test.access_code : null,
        class: { id: acc.cls.id, name: acc.cls.name, grade: acc.cls.grade },
        canEdit,
        started: await hasAttempts(trx, testId),
        questions: await testQuestions(trx, testId, canEdit),
      };
    });
  });

  app.patch('/api/orgs/:orgId/tests/:testId', async (req) => {
    const { orgId, testId } = parse(TestParams, req.params);
    const body = parse(SettingsPatch, req.body);
    return inOrg(ctx, req, orgId, 'viewer', async (trx, access) => {
      const { test } = await editable(trx, access, testId);
      if (LOCKED_AFTER_START.some((k) => body[k] !== undefined) && (await hasAttempts(trx, testId))) {
        throw conflict('Students have started this test; its timing and rules can no longer change', 'TEST_STARTED');
      }
      const opens = body.opensAt ?? test.opens_at;
      const closes = body.closesAt ?? test.closes_at;
      if (closes <= opens) throw new AppError(400, 'CLOSES_BEFORE_OPENS', 'The test must close after it opens');
      // A later closing time reopens a test the teacher closed early.
      const reopen = body.closesAt !== undefined && test.closed_early_at !== null && body.closesAt > new Date();
      const updated = await trx
        .updateTable('tests')
        .set({
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.instructions !== undefined ? { instructions: body.instructions } : {}),
          ...(body.kind !== undefined ? { kind: body.kind } : {}),
          opens_at: opens,
          closes_at: closes,
          ...(reopen ? { closed_early_at: null } : {}),
          ...(body.durationMinutes !== undefined ? { duration_minutes: body.durationMinutes } : {}),
          ...(body.maxAttempts !== undefined ? { max_attempts: body.maxAttempts } : {}),
          ...(body.shuffleQuestions !== undefined ? { shuffle_questions: body.shuffleQuestions } : {}),
          ...(body.shuffleOptions !== undefined ? { shuffle_options: body.shuffleOptions } : {}),
          ...(body.results !== undefined ? { results: body.results } : {}),
          ...(body.showAnswers !== undefined ? { show_answers: body.showAnswers } : {}),
          ...(body.requireCode !== undefined ? { access_code: body.requireCode ? (test.access_code ?? newAccessCode()) : null } : {}),
          ...(body.oneDevice !== undefined ? { one_device: body.oneDevice } : {}),
        })
        .where('id', '=', testId)
        .returningAll()
        .executeTakeFirstOrThrow();
      // A new closing time applies to students already working ("ten more minutes for everyone").
      if (body.closesAt !== undefined) {
        const open = await trx.selectFrom('test_attempts').select(['id', 'started_at', 'extra_minutes']).where('test_id', '=', testId).where('status', '=', 'in_progress').execute();
        for (const a of open) await trx.updateTable('test_attempts').set({ deadline_at: attemptDeadline(updated, a.started_at, a.extra_minutes) }).where('id', '=', a.id).execute();
      }
      await recordAudit(trx, actorFromRequest(req), { orgId, action: 'test.updated', targetType: 'test', targetId: testId, metadata: { title: updated.title, fields: Object.keys(body) } }, requestMeta(req));
      return { test: testJson(updated), accessCode: updated.access_code };
    });
  });

  app.delete('/api/orgs/:orgId/tests/:testId', async (req) => {
    const { orgId, testId } = parse(TestParams, req.params);
    return inOrg(ctx, req, orgId, 'viewer', async (trx, access) => {
      const { test, acc } = await editable(trx, access, testId);
      await trx.deleteFrom('tests').where('id', '=', testId).execute();
      await recordAudit(trx, actorFromRequest(req), { orgId, action: 'test.deleted', targetType: 'test', targetId: testId, metadata: { class: acc.cls.name, title: test.title } }, requestMeta(req));
      return { status: 'deleted' };
    });
  });

  // ------------------------------------------------------------ questions (until a student starts)

  app.post('/api/orgs/:orgId/tests/:testId/questions', rateLimited(1000, '1 hour'), async (req, reply) => {
    const { orgId, testId } = parse(TestParams, req.params);
    const body = parse(QuestionBody, req.body);
    checkQuestion(body);
    const q = await inOrg(ctx, req, orgId, 'viewer', async (trx, access) => {
      await editable(trx, access, testId);
      await assertNotStarted(trx, testId);
      const count = Number((await trx.selectFrom('test_questions').select((e) => e.fn.countAll<string>().as('n')).where('test_id', '=', testId).executeTakeFirstOrThrow()).n);
      if (count >= 100) throw conflict('A test can have at most 100 questions', 'TOO_MANY_QUESTIONS');
      const top = await trx.selectFrom('test_questions').select((e) => e.fn.max('position').as('p')).where('test_id', '=', testId).executeTakeFirst();
      const row = await trx
        .insertInto('test_questions')
        .values({ org_id: orgId, test_id: testId, position: (top?.p ?? -1) + 1, type: body.type, prompt: body.prompt, options: JSON.stringify(body.options), points: body.points })
        .returning(['id'])
        .executeTakeFirstOrThrow();
      await trx.insertInto('test_question_keys').values({ question_id: row.id, org_id: orgId, test_id: testId, key: JSON.stringify(body.key) }).execute();
      return row;
    });
    return reply.status(201).send({ question: { id: q.id } });
  });

  app.patch('/api/orgs/:orgId/tests/:testId/questions/:questionId', async (req) => {
    const { orgId, testId, questionId } = parse(TestParams.extend({ questionId: zUuid }), req.params);
    const body = parse(QuestionBody, req.body);
    checkQuestion(body);
    return inOrg(ctx, req, orgId, 'viewer', async (trx, access) => {
      await editable(trx, access, testId);
      await assertNotStarted(trx, testId);
      const res = await trx
        .updateTable('test_questions')
        .set({ type: body.type, prompt: body.prompt, options: JSON.stringify(body.options), points: body.points })
        .where('id', '=', questionId)
        .where('test_id', '=', testId)
        .executeTakeFirst();
      if (!Number(res.numUpdatedRows)) throw notFound('Question');
      await trx.updateTable('test_question_keys').set({ key: JSON.stringify(body.key) }).where('question_id', '=', questionId).execute();
      return { status: 'updated' };
    });
  });

  app.delete('/api/orgs/:orgId/tests/:testId/questions/:questionId', async (req) => {
    const { orgId, testId, questionId } = parse(TestParams.extend({ questionId: zUuid }), req.params);
    return inOrg(ctx, req, orgId, 'viewer', async (trx, access) => {
      await editable(trx, access, testId);
      await assertNotStarted(trx, testId);
      const res = await trx.deleteFrom('test_questions').where('id', '=', questionId).where('test_id', '=', testId).executeTakeFirst();
      if (!Number(res.numDeletedRows)) throw notFound('Question');
      return { status: 'deleted' };
    });
  });

  app.put('/api/orgs/:orgId/tests/:testId/questions/order', async (req) => {
    const { orgId, testId } = parse(TestParams, req.params);
    const { ids } = parse(z.object({ ids: z.array(zUuid).min(1).max(100) }), req.body);
    return inOrg(ctx, req, orgId, 'viewer', async (trx, access) => {
      await editable(trx, access, testId);
      await assertNotStarted(trx, testId);
      const current = (await trx.selectFrom('test_questions').select('id').where('test_id', '=', testId).execute()).map((r) => r.id);
      if (current.length !== ids.length || new Set(ids).size !== ids.length || ids.some((id) => !current.includes(id))) throw badRequest('Send every question of the test once');
      for (const [i, id] of ids.entries()) await trx.updateTable('test_questions').set({ position: i }).where('id', '=', id).execute();
      return { status: 'updated' };
    });
  });

  // ------------------------------------------------------------ publishing

  app.post('/api/orgs/:orgId/tests/:testId/publish', async (req) => {
    const { orgId, testId } = parse(TestParams, req.params);
    return inOrg(ctx, req, orgId, 'viewer', async (trx, access) => {
      const { test, acc } = await editable(trx, access, testId);
      if (test.status === 'published') return { test: testJson(test) };
      const questions = await testQuestions(trx, testId, true);
      if (!questions.length) throw new AppError(400, 'TEST_EMPTY', 'Add at least one question first');
      if (testPhase({ ...test, status: 'published' }) === 'closed') throw new AppError(400, 'TEST_ALREADY_CLOSED', 'The closing time has passed; set a later one first');
      const updated = await trx.updateTable('tests').set({ status: 'published', published_at: new Date() }).where('id', '=', testId).returningAll().executeTakeFirstOrThrow();
      await notifyTestPublished(trx, updated);
      await recordAudit(trx, actorFromRequest(req), { orgId, action: 'test.published', targetType: 'test', targetId: testId, metadata: { class: acc.cls.name, title: test.title, questions: questions.length } }, requestMeta(req));
      return { test: testJson(updated) };
    });
  });

  // Back to a draft, while no student has started.
  app.post('/api/orgs/:orgId/tests/:testId/unpublish', async (req) => {
    const { orgId, testId } = parse(TestParams, req.params);
    return inOrg(ctx, req, orgId, 'viewer', async (trx, access) => {
      const { test } = await editable(trx, access, testId);
      await assertNotStarted(trx, testId);
      const updated = await trx.updateTable('tests').set({ status: 'draft', published_at: null, notified_at: null }).where('id', '=', testId).returningAll().executeTakeFirstOrThrow();
      await recordAudit(trx, actorFromRequest(req), { orgId, action: 'test.unpublished', targetType: 'test', targetId: testId, metadata: { title: test.title } }, requestMeta(req));
      return { test: testJson(updated) };
    });
  });

  // ------------------------------------------------------------ monitoring and control

  app.get('/api/orgs/:orgId/tests/:testId/monitor', async (req) => {
    const { orgId, testId } = parse(TestParams, req.params);
    return inOrg(ctx, req, orgId, 'viewer', async (trx, access) => {
      const { test, acc, canEdit } = await testAccess(trx, access, testId);
      const now = new Date();
      return { now, test: testJson(test, now), accessCode: canEdit ? test.access_code : null, class: { id: acc.cls.id, name: acc.cls.name }, canEdit, students: await monitorRows(trx, test, now) };
    });
  });

  app.get('/api/orgs/:orgId/tests/:testId/attempts/:attemptId/events', async (req) => {
    const { orgId, testId, attemptId } = parse(TestParams.extend({ attemptId: zUuid }), req.params);
    return inOrg(ctx, req, orgId, 'viewer', async (trx, access) => {
      await testAccess(trx, access, testId);
      const attempt = await trx.selectFrom('test_attempts').select('id').where('id', '=', attemptId).where('test_id', '=', testId).executeTakeFirst();
      if (!attempt) throw notFound('Attempt');
      const events = await trx.selectFrom('test_events').select(['kind', 'at', 'detail']).where('attempt_id', '=', attemptId).orderBy('id').execute();
      return { events };
    });
  });

  app.post('/api/orgs/:orgId/tests/:testId/students/:studentId/extra-time', async (req) => {
    const { orgId, testId, studentId } = parse(TestParams.extend({ studentId: zUuid }), req.params);
    const { minutes } = parse(z.object({ minutes: z.number().int().min(1).max(120) }), req.body);
    return inOrg(ctx, req, orgId, 'viewer', async (trx, access) => {
      const { test } = await editable(trx, access, testId);
      await assertInClass(trx, test, studentId);
      const r = await giveExtraTime(trx, test, studentId, minutes);
      await recordAudit(trx, actorFromRequest(req), { orgId, action: 'test.extra_time', targetType: 'test', targetId: testId, metadata: { title: test.title, student: studentId, minutes } }, requestMeta(req));
      return r;
    });
  });

  app.post('/api/orgs/:orgId/tests/:testId/students/:studentId/extra-attempt', async (req) => {
    const { orgId, testId, studentId } = parse(TestParams.extend({ studentId: zUuid }), req.params);
    return inOrg(ctx, req, orgId, 'viewer', async (trx, access) => {
      const { test } = await editable(trx, access, testId);
      await assertInClass(trx, test, studentId);
      const row = await trx
        .insertInto('test_student_overrides')
        .values({ test_id: testId, org_id: orgId, student_id: studentId, extra_attempts: 1 })
        .onConflict((oc) => oc.columns(['test_id', 'student_id']).doUpdateSet((eb) => ({ extra_attempts: eb('test_student_overrides.extra_attempts', '+', 1) })))
        .returning('extra_attempts')
        .executeTakeFirstOrThrow()
        .catch((err: { code?: string }) => {
          if (err.code === '23514') throw conflict('At most 10 extra attempts', 'TOO_MANY_ATTEMPTS');
          throw err;
        });
      await recordAudit(trx, actorFromRequest(req), { orgId, action: 'test.extra_attempt', targetType: 'test', targetId: testId, metadata: { title: test.title, student: studentId } }, requestMeta(req));
      return { extraAttempts: row.extra_attempts, attemptsAllowed: test.max_attempts + row.extra_attempts };
    });
  });

  app.post('/api/orgs/:orgId/tests/:testId/attempts/:attemptId/submit', async (req) => {
    const { orgId, testId, attemptId } = parse(TestParams.extend({ attemptId: zUuid }), req.params);
    return inOrg(ctx, req, orgId, 'viewer', async (trx, access) => {
      const { test } = await editable(trx, access, testId);
      const attempt = await trx.selectFrom('test_attempts').selectAll().where('id', '=', attemptId).where('test_id', '=', testId).executeTakeFirst();
      if (!attempt) throw notFound('Attempt');
      if (!(await submitAttempt(trx, attempt, 'teacher'))) throw conflict('This attempt is already submitted', 'ATTEMPT_SUBMITTED');
      await markAttempt(trx, attemptId);
      await recordAudit(trx, actorFromRequest(req), { orgId, action: 'test.forced_submit', targetType: 'test', targetId: testId, metadata: { title: test.title, student: attempt.student_id } }, requestMeta(req));
      return { status: 'submitted' };
    });
  });

  // Lets the attempt continue in another browser (a computer that broke, a changed seat).
  app.post('/api/orgs/:orgId/tests/:testId/attempts/:attemptId/allow-device', async (req) => {
    const { orgId, testId, attemptId } = parse(TestParams.extend({ attemptId: zUuid }), req.params);
    return inOrg(ctx, req, orgId, 'viewer', async (trx, access) => {
      const { test } = await editable(trx, access, testId);
      const attempt = await trx.selectFrom('test_attempts').selectAll().where('id', '=', attemptId).where('test_id', '=', testId).where('status', '=', 'in_progress').executeTakeFirst();
      if (!attempt) throw notFound('Attempt');
      await trx.updateTable('test_attempts').set({ session_id: null }).where('id', '=', attemptId).execute();
      await recordEvent(trx, attempt, 'device_allowed', {});
      await recordAudit(trx, actorFromRequest(req), { orgId, action: 'test.device_allowed', targetType: 'test', targetId: testId, metadata: { title: test.title, student: attempt.student_id } }, requestMeta(req));
      return { status: 'allowed' };
    });
  });

  // Ends the test now: open attempts are submitted and marked.
  app.post('/api/orgs/:orgId/tests/:testId/close', async (req) => {
    const { orgId, testId } = parse(TestParams, req.params);
    return inOrg(ctx, req, orgId, 'viewer', async (trx, access) => {
      const { test } = await editable(trx, access, testId);
      if (testPhase(test) !== 'open') throw conflict('The test is not open', 'TEST_NOT_OPEN');
      const updated = await trx.updateTable('tests').set({ closed_early_at: new Date() }).where('id', '=', testId).returningAll().executeTakeFirstOrThrow();
      const open = await trx.selectFrom('test_attempts').selectAll().where('test_id', '=', testId).where('status', '=', 'in_progress').execute();
      for (const a of open) {
        await submitAttempt(trx, a, 'closed');
        await markAttempt(trx, a.id);
      }
      await recordAudit(trx, actorFromRequest(req), { orgId, action: 'test.closed', targetType: 'test', targetId: testId, metadata: { title: test.title, submitted: open.length } }, requestMeta(req));
      return { test: testJson(updated), submitted: open.length };
    });
  });

  app.post('/api/orgs/:orgId/tests/:testId/new-code', async (req) => {
    const { orgId, testId } = parse(TestParams, req.params);
    return inOrg(ctx, req, orgId, 'viewer', async (trx, access) => {
      const { test } = await editable(trx, access, testId);
      if (!test.access_code) throw conflict('This test does not use a start code', 'NO_START_CODE');
      const code = newAccessCode();
      await trx.updateTable('tests').set({ access_code: code }).where('id', '=', testId).execute();
      return { accessCode: code };
    });
  });

  // ------------------------------------------------------------ results and marking

  app.get('/api/orgs/:orgId/tests/:testId/results', async (req) => {
    const { orgId, testId } = parse(TestParams, req.params);
    return inOrg(ctx, req, orgId, 'viewer', async (trx, access) => {
      const { test, acc, canEdit } = await testAccess(trx, access, testId);
      const rows = await monitorRows(trx, test);
      const attempts = await trx
        .selectFrom('test_attempts')
        .select(['id', 'student_id', 'number', 'status', 'started_at', 'submitted_at', 'submit_reason', 'score', 'max_points', 'needs_marking'])
        .where('test_id', '=', testId)
        .orderBy('number')
        .execute();
      return {
        test: testJson(test),
        class: { id: acc.cls.id, name: acc.cls.name },
        canEdit,
        students: rows.map((r) => ({
          studentId: r.studentId,
          name: r.name,
          username: r.username,
          best: r.best,
          attempts: attempts
            .filter((a) => a.student_id === r.studentId)
            .map((a) => ({ id: a.id, number: a.number, status: a.status, startedAt: a.started_at, submittedAt: a.submitted_at, submitReason: a.submit_reason, score: num(a.score), maxPoints: num(a.max_points), needsMarking: a.needs_marking })),
        })),
      };
    });
  });

  app.get('/api/orgs/:orgId/tests/:testId/attempts/:attemptId', async (req) => {
    const { orgId, testId, attemptId } = parse(TestParams.extend({ attemptId: zUuid }), req.params);
    return inOrg(ctx, req, orgId, 'viewer', async (trx, access) => {
      const { test, canEdit } = await testAccess(trx, access, testId);
      const attempt = await trx
        .selectFrom('test_attempts as a')
        .innerJoin('users as u', 'u.id', 'a.student_id')
        .selectAll('a')
        .select('u.name')
        .where('a.id', '=', attemptId)
        .where('a.test_id', '=', testId)
        .executeTakeFirst();
      if (!attempt) throw notFound('Attempt');
      const questions = await testQuestions(trx, testId, canEdit);
      const answers = new Map((await trx.selectFrom('test_answers').selectAll().where('attempt_id', '=', attemptId).execute()).map((a) => [a.question_id, a]));
      const order = attempt.question_order;
      const ordered = [...questions].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
      return {
        test: testJson(test),
        canMark: canEdit,
        attempt: {
          id: attempt.id,
          student: { id: attempt.student_id, name: attempt.name },
          number: attempt.number,
          status: attempt.status,
          startedAt: attempt.started_at,
          submittedAt: attempt.submitted_at,
          submitReason: attempt.submit_reason,
          score: num(attempt.score),
          maxPoints: num(attempt.max_points),
          needsMarking: attempt.needs_marking,
        },
        questions: ordered.map((q) => {
          const a = answers.get(q.id);
          return { ...q, answer: a?.answer ?? null, autoPoints: num(a?.auto_points ?? null), manualPoints: num(a?.manual_points ?? null), feedback: a?.feedback ?? null };
        }),
      };
    });
  });

  // The teacher's mark for one answer (an essay, or a correction of the computer's mark). null removes it.
  app.patch('/api/orgs/:orgId/tests/:testId/attempts/:attemptId/answers/:questionId', async (req) => {
    const { orgId, testId, attemptId, questionId } = parse(TestParams.extend({ attemptId: zUuid, questionId: zUuid }), req.params);
    const body = parse(z.object({ points: zPoints.nullable().optional(), feedback: z.string().trim().max(2000).nullable().optional() }), req.body);
    return inOrg(ctx, req, orgId, 'viewer', async (trx, access) => {
      const { test } = await editable(trx, access, testId);
      const attempt = await trx.selectFrom('test_attempts').selectAll().where('id', '=', attemptId).where('test_id', '=', testId).executeTakeFirst();
      if (!attempt) throw notFound('Attempt');
      if (attempt.status !== 'submitted') throw conflict('The student is still working on this attempt', 'ATTEMPT_IN_PROGRESS');
      const q = await trx.selectFrom('test_questions').select(['id', 'points']).where('id', '=', questionId).where('test_id', '=', testId).executeTakeFirst();
      if (!q) throw notFound('Question');
      if (body.points !== undefined && body.points !== null && body.points > Number(q.points)) throw new AppError(400, 'POINTS_ABOVE_TOTAL', `This question is worth ${Number(q.points)}`);
      await trx
        .insertInto('test_answers')
        .values({ attempt_id: attemptId, org_id: orgId, question_id: questionId, answer: JSON.stringify(''), manual_points: body.points ?? null, feedback: body.feedback ?? null })
        .onConflict((oc) =>
          oc.columns(['attempt_id', 'question_id']).doUpdateSet({
            ...(body.points !== undefined ? { manual_points: body.points } : {}),
            ...(body.feedback !== undefined ? { feedback: body.feedback || null } : {}),
          }),
        )
        .execute();
      await markAttempt(trx, attemptId);
      const after = await trx.selectFrom('test_attempts').select(['score', 'needs_marking']).where('id', '=', attemptId).executeTakeFirstOrThrow();
      await recordAudit(trx, actorFromRequest(req), { orgId, action: 'test.marked', targetType: 'test', targetId: testId, metadata: { title: test.title, student: attempt.student_id, points: body.points ?? null } }, requestMeta(req));
      return { score: num(after.score), needsMarking: after.needs_marking };
    });
  });

  app.post('/api/orgs/:orgId/tests/:testId/release', async (req) => {
    const { orgId, testId } = parse(TestParams, req.params);
    return inOrg(ctx, req, orgId, 'viewer', async (trx, access) => {
      const { test } = await editable(trx, access, testId);
      if (test.results !== 'manual') throw conflict('Results of this test are shown automatically', 'RESULTS_AUTOMATIC');
      if (test.results_released_at) return { test: testJson(test) };
      const updated = await trx.updateTable('tests').set({ results_released_at: new Date() }).where('id', '=', testId).returningAll().executeTakeFirstOrThrow();
      await notifyResultsReleased(trx, updated);
      await recordAudit(trx, actorFromRequest(req), { orgId, action: 'test.results_released', targetType: 'test', targetId: testId, metadata: { title: test.title } }, requestMeta(req));
      return { test: testJson(updated) };
    });
  });
}

async function assertInClass(exec: Executor, test: Test, studentId: string): Promise<void> {
  const row = await exec.selectFrom('class_students').select('student_id').where('class_id', '=', test.class_id).where('student_id', '=', studentId).executeTakeFirst();
  if (!row) throw notFound('Student');
}
