import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireStudentSession } from '../auth/guards.js';
import { getEntitlements, lockOrg } from '../billing/entitlements.js';
import type { Trx } from '../db/index.js';
import type { Homework } from '../db/types.js';
import type { AppContext } from '../http/context.js';
import { rateLimited } from '../http/rate-limit.js';
import { conflict, notFound } from '../lib/errors.js';
import { parse, zUuid } from '../lib/validation.js';
import { asStudent } from '../students/context.js';
import { assertStorageAvailable, filesOf, MAX_FILE_BYTES, MAX_FILES_PER_ITEM, readUpload, saveFile, sendFile, UPLOAD_CONTENT_TYPES } from './files.js';
import { homeworkJson, num, studentHomework } from './service.js';
import { myTests } from './tests-student-routes.js';

// The student portal's homework (docs/CLASSROOM.md §4). Every handler runs in
// asStudent, whose row-level security context limits queries to this student's
// classes, the homework published to them and their own work.

const HomeworkParams = z.object({ homeworkId: zUuid });

async function visibleHomework(trx: Trx, homeworkId: string): Promise<Homework> {
  const hw = await trx.selectFrom('homework').selectAll().where('id', '=', homeworkId).executeTakeFirst();
  if (!hw) throw notFound('Homework');
  return hw;
}

async function ownSubmission(trx: Trx, hw: Homework, studentId: string) {
  return trx.selectFrom('homework_submissions').selectAll().where('homework_id', '=', hw.id).where('student_id', '=', studentId).executeTakeFirst();
}

/** The student's draft, created on first use. Handed-in or returned work cannot change. */
async function editableDraft(trx: Trx, hw: Homework, studentId: string) {
  const sub = await ownSubmission(trx, hw, studentId);
  if (sub && sub.status === 'returned') throw conflict('Your teacher has returned this homework', 'HOMEWORK_RETURNED');
  if (sub && sub.status === 'submitted') throw conflict('Take back your work before changing it', 'HOMEWORK_HANDED_IN');
  if (!hw.allow_late && hw.due_at < new Date()) throw conflict('The due time has passed and this homework does not accept late work', 'HOMEWORK_CLOSED');
  return sub ?? (await trx.insertInto('homework_submissions').values({ org_id: hw.org_id, homework_id: hw.id, student_id: studentId }).returningAll().executeTakeFirstOrThrow());
}

export async function registerStudentClassroomRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  // The day's view: what is due (overdue first), and work returned in the last week.
  app.get('/api/student/home', async (req) => {
    return asStudent(ctx, req, async (trx, { user, student, org }) => {
      const todo = await studentHomework(trx, user.id, 'todo');
      const done = await studentHomework(trx, user.id, 'done');
      const weekAgo = new Date(Date.now() - 7 * 86_400_000);
      const classes = await trx.selectFrom('classes').select(['id', 'name', 'grade']).where('archived_at', 'is', null).orderBy('name').execute();
      const tests = await myTests(trx, user.id);
      const usable = (t: (typeof tests)[number]) => t.inProgressAttemptId !== null || t.attemptsUsed < t.attemptsAllowed;
      return {
        school: { name: org.name },
        student: { name: user.name, grade: student.grade },
        classes,
        tests: {
          open: tests.filter((t) => t.phase === 'open' && usable(t)),
          upcoming: tests.filter((t) => t.phase === 'upcoming').reverse(),
        },
        todo: todo.filter((h) => !h.closed),
        missed: todo.filter((h) => h.closed),
        returned: done.filter((h) => h.status === 'returned' && h.returnedAt && h.returnedAt > weekAgo),
      };
    });
  });

  app.get('/api/student/homework', async (req) => {
    const { show } = parse(z.object({ show: z.enum(['todo', 'done', 'all']).default('todo') }), req.query);
    return asStudent(ctx, req, async (trx, { user }) => ({ homework: await studentHomework(trx, user.id, show) }));
  });

  app.get('/api/student/homework/:homeworkId', async (req) => {
    const { homeworkId } = parse(HomeworkParams, req.params);
    return asStudent(ctx, req, async (trx, { user }) => {
      const hw = await visibleHomework(trx, homeworkId);
      const cls = await trx.selectFrom('classes').select(['id', 'name']).where('id', '=', hw.class_id).executeTakeFirstOrThrow();
      const sub = await ownSubmission(trx, hw, user.id);
      const returned = sub?.status === 'returned';
      return {
        homework: homeworkJson(hw),
        class: cls,
        files: await filesOf(trx, { homeworkId }),
        submission: {
          status: sub?.status ?? 'assigned',
          body: sub?.body ?? '',
          submittedAt: sub?.submitted_at ?? null,
          late: sub?.late ?? false,
          // The mark and comments are the student's once the teacher returns the work.
          points: returned ? num(sub.points) : null,
          feedback: returned ? sub.feedback : null,
          returnedAt: returned ? sub.returned_at : null,
          files: sub ? await filesOf(trx, { submissionId: sub.id }) : [],
        },
        closed: !hw.allow_late && hw.due_at < new Date() && !(sub && sub.status !== 'draft'),
      };
    });
  });

  app.put('/api/student/homework/:homeworkId/submission', rateLimited(600, '1 hour'), async (req) => {
    const { homeworkId } = parse(HomeworkParams, req.params);
    const body = parse(z.object({ body: z.string().max(10000) }), req.body);
    return asStudent(ctx, req, async (trx, { user }) => {
      const hw = await visibleHomework(trx, homeworkId);
      const draft = await editableDraft(trx, hw, user.id);
      await trx.updateTable('homework_submissions').set({ body: body.body }).where('id', '=', draft.id).execute();
      return { status: 'draft' };
    });
  });

  app.post('/api/student/homework/:homeworkId/hand-in', rateLimited(120, '1 hour'), async (req) => {
    const { homeworkId } = parse(HomeworkParams, req.params);
    const body = parse(z.object({ body: z.string().max(10000).optional() }), req.body ?? {});
    return asStudent(ctx, req, async (trx, { user }) => {
      const hw = await visibleHomework(trx, homeworkId);
      const draft = await editableDraft(trx, hw, user.id);
      const now = new Date();
      const updated = await trx
        .updateTable('homework_submissions')
        .set({ ...(body.body !== undefined ? { body: body.body } : {}), status: 'submitted', submitted_at: now, late: now > hw.due_at })
        .where('id', '=', draft.id)
        .returning(['status', 'submitted_at', 'late'])
        .executeTakeFirstOrThrow();
      return { status: updated.status, submittedAt: updated.submitted_at, late: updated.late };
    });
  });

  // Back to a draft, to change it; only until the teacher returns it.
  app.post('/api/student/homework/:homeworkId/take-back', async (req) => {
    const { homeworkId } = parse(HomeworkParams, req.params);
    return asStudent(ctx, req, async (trx, { user }) => {
      const hw = await visibleHomework(trx, homeworkId);
      const sub = await ownSubmission(trx, hw, user.id);
      if (!sub || sub.status !== 'submitted') throw conflict('There is no handed-in work to take back', 'NOT_HANDED_IN');
      if (!hw.allow_late && hw.due_at < new Date()) throw conflict('The due time has passed and this homework does not accept late work', 'HOMEWORK_CLOSED');
      await trx.updateTable('homework_submissions').set({ status: 'draft', submitted_at: null, late: false }).where('id', '=', sub.id).execute();
      return { status: 'draft' };
    });
  });

  await app.register(async (scope) => {
    scope.addContentTypeParser(UPLOAD_CONTENT_TYPES, { parseAs: 'buffer', bodyLimit: MAX_FILE_BYTES + 1 }, (_req, body, done) => done(null, body));

    scope.post('/api/student/homework/:homeworkId/files', { bodyLimit: MAX_FILE_BYTES + 1, ...rateLimited(120, '1 hour') }, async (req, reply) => {
      const { homeworkId } = parse(HomeworkParams, req.params);
      const file = await asStudent(ctx, req, async (trx, { user, org }) => {
        const hw = await visibleHomework(trx, homeworkId);
        const draft = await editableDraft(trx, hw, user.id);
        const upload = readUpload(req);
        await lockOrg(trx, org.id);
        const count = await trx.selectFrom('classroom_files').select((eb) => eb.fn.countAll<string>().as('n')).where('submission_id', '=', draft.id).executeTakeFirstOrThrow();
        if (Number(count.n) >= MAX_FILES_PER_ITEM) throw conflict(`At most ${MAX_FILES_PER_ITEM} files per homework`, 'TOO_MANY_FILES');
        await assertStorageAvailable(trx, org.id, await getEntitlements(trx, org.id, ctx.config.GRACE_DAYS), upload.data.length);
        return saveFile(trx, { orgId: org.id, submissionId: draft.id, upload, uploadedBy: user.id });
      });
      return reply.status(201).send({ file });
    });
  });

  app.delete('/api/student/homework/:homeworkId/files/:fileId', async (req) => {
    const { homeworkId, fileId } = parse(HomeworkParams.extend({ fileId: zUuid }), req.params);
    return asStudent(ctx, req, async (trx, { user }) => {
      const hw = await visibleHomework(trx, homeworkId);
      const draft = await editableDraft(trx, hw, user.id);
      const removed = await trx.deleteFrom('classroom_files').where('id', '=', fileId).where('submission_id', '=', draft.id).returning('id').executeTakeFirst();
      if (!removed) throw notFound('File');
      return { status: 'deleted' };
    });
  });

  // Files of visible homework and the student's own files (row-level security decides).
  app.get('/api/student/files/:fileId', async (req, reply) => {
    const { fileId } = parse(z.object({ fileId: zUuid }), req.params);
    const file = await asStudent(ctx, req, async (trx) => {
      const f = await trx.selectFrom('classroom_files').select(['name', 'content_type', 'data']).where('id', '=', fileId).executeTakeFirst();
      if (!f) throw notFound('File');
      return f;
    });
    return sendFile(reply, file);
  });

  // ------------------------------------------------------------ notifications (in the portal; students have no email)
  app.get('/api/student/notifications', async (req) => {
    const { user } = requireStudentSession(req);
    const rows = await ctx.db
      .selectFrom('notifications')
      .select(['id', 'kind', 'title', 'body', 'link', 'read_at', 'created_at'])
      .where('user_id', '=', user.id)
      .orderBy('created_at', 'desc')
      .limit(50)
      .execute();
    return { notifications: rows.map((n) => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, link: n.link, readAt: n.read_at, createdAt: n.created_at })) };
  });

  app.post('/api/student/notifications/read', async (req) => {
    const { user } = requireStudentSession(req);
    const { ids } = parse(z.object({ ids: z.array(zUuid).max(100).optional() }), req.body ?? {});
    let q = ctx.db.updateTable('notifications').set({ read_at: new Date() }).where('user_id', '=', user.id).where('read_at', 'is', null);
    if (ids?.length) q = q.where('id', 'in', ids);
    const res = await q.executeTakeFirst();
    return { updated: Number(res.numUpdatedRows) };
  });

}
