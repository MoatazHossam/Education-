import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorFromRequest, recordAudit, requestMeta } from '../audit/audit.js';
import { hasRole, inOrg } from '../auth/guards.js';
import { getEntitlements, lockOrg } from '../billing/entitlements.js';
import { gradeList } from '../catalog/service.js';
import type { HomeworkMaterial } from '../db/types.js';
import type { AppContext } from '../http/context.js';
import { rateLimited } from '../http/rate-limit.js';
import { AppError, badRequest, conflict, notFound } from '../lib/errors.js';
import { parse, zUuid } from '../lib/validation.js';
import { getScope } from '../scopes/service.js';
import { zGrade } from '../students/service.js';
import { itemRetention } from './retention.js';
import { classTests } from './tests-service.js';
import { assertStorageAvailable, filesOf, MAX_FILE_BYTES, MAX_FILES_PER_ITEM, openable, readUpload, saveFile, sendFile, UPLOAD_CONTENT_TYPES } from './files.js';
import {
  assertClassroomEnabled,
  assertTeachesSubject,
  classAccess,
  classHomework,
  classroomEnabled,
  classStudents,
  classSubjects,
  homeworkAccess,
  homeworkJson,
  homeworkRoster,
  listClasses,
  notifyHomeworkPublished,
  notifyHomeworkReturned,
  num,
  rosterStatus,
  teachesSubject,
  zClassName,
  zPoints,
  zSubjectName,
} from './service.js';

const OrgParams = z.object({ orgId: z.string() });
const ClassParams = z.object({ orgId: z.string(), classId: zUuid });
const HomeworkParams = z.object({ orgId: z.string(), homeworkId: zUuid });
const zWhen = z.iso.datetime({ offset: true }).transform((s) => new Date(s));

const HomeworkBody = z.object({
  subjectEn: zSubjectName,
  subjectAr: zSubjectName,
  title: z.string().trim().min(1).max(200),
  instructions: z.string().trim().max(5000).default(''),
  materialIds: z.array(zUuid).max(10).default([]),
  publishAt: zWhen.optional(),
  dueAt: zWhen,
  maxPoints: zPoints.positive().nullable().default(null),
  allowLate: z.boolean().default(true),
});

export async function registerClassroomRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const grace = ctx.config.GRACE_DAYS;

  // ------------------------------------------------------------ classes
  // Owners and admins see every class; other members see the classes they teach.
  app.get('/api/orgs/:orgId/classes', async (req) => {
    const { orgId } = parse(OrgParams, req.params);
    const { archived } = parse(z.object({ archived: z.enum(['0', '1']).default('0') }), req.query);
    return inOrg(ctx, req, orgId, 'viewer', async (trx, access) => {
      const ent = await getEntitlements(trx, orgId, grace);
      return { enabled: classroomEnabled(ent), admin: hasRole(access.role, 'admin'), grades: gradeList(), classes: await listClasses(trx, access, archived === '1') };
    });
  });

  app.post('/api/orgs/:orgId/classes', rateLimited(120, '1 hour'), async (req, reply) => {
    const { orgId } = parse(OrgParams, req.params);
    const body = parse(z.object({ name: zClassName, grade: zGrade, scopeId: zUuid.nullable().default(null) }), req.body);
    const created = await inOrg(ctx, req, orgId, 'admin', async (trx) => {
      assertClassroomEnabled(await getEntitlements(trx, orgId, grace));
      const scopeId = body.scopeId ? (await getScope(trx, orgId, body.scopeId)).id : null;
      const row = await trx
        .insertInto('classes')
        .values({ org_id: orgId, name: body.name, grade: body.grade, scope_id: scopeId, created_by: req.auth?.kind === 'session' ? req.auth.user.id : null })
        .returning(['id', 'name', 'grade', 'scope_id'])
        .executeTakeFirst()
        .catch((err: { code?: string }) => {
          if (err.code === '23505') throw conflict('There is already a class with this name', 'CLASS_NAME_TAKEN');
          throw err;
        });
      await recordAudit(trx, actorFromRequest(req), { orgId, action: 'class.created', targetType: 'class', targetId: row!.id, metadata: { name: body.name, grade: body.grade } }, requestMeta(req));
      return row!;
    });
    return reply.status(201).send({ class: { id: created.id, name: created.name, grade: created.grade, scopeId: created.scope_id } });
  });

  app.get('/api/orgs/:orgId/classes/:classId', async (req) => {
    const { orgId, classId } = parse(ClassParams, req.params);
    return inOrg(ctx, req, orgId, 'viewer', async (trx, access) => {
      const acc = await classAccess(trx, access, classId);
      const scope = acc.cls.scope_id ? await trx.selectFrom('scopes').select(['id', 'name']).where('id', '=', acc.cls.scope_id).executeTakeFirst() : undefined;
      const teachers = await trx
        .selectFrom('class_teachers as t')
        .innerJoin('users as u', 'u.id', 't.user_id')
        .select(['t.id', 't.user_id', 't.subject_en', 't.subject_ar', 'u.name'])
        .where('t.class_id', '=', classId)
        .orderBy('t.subject_en')
        .execute();
      const homework = (await classHomework(trx, classId)).map((h) => ({ ...h, mine: teachesSubject(acc, h.subjectEn) }));
      const tests = (await classTests(trx, classId)).map((x) => ({ ...x, mine: teachesSubject(acc, x.subjectEn) }));
      return {
        class: { id: acc.cls.id, name: acc.cls.name, grade: acc.cls.grade, scopeId: acc.cls.scope_id, scopeName: scope?.name ?? null, archived: acc.cls.archived_at !== null },
        grade: gradeList().find((g) => g.grade === acc.cls.grade) ?? null,
        admin: acc.admin,
        teaching: acc.teaching,
        teachers: teachers.map((t) => ({ id: t.id, userId: t.user_id, name: t.name, subjectEn: t.subject_en, subjectAr: t.subject_ar })),
        students: await classStudents(trx, classId),
        ...(await classSubjects(trx, acc.cls)),
        homework,
        tests,
      };
    });
  });

  app.patch('/api/orgs/:orgId/classes/:classId', async (req) => {
    const { orgId, classId } = parse(ClassParams, req.params);
    const body = parse(z.object({ name: zClassName.optional(), grade: zGrade.optional(), scopeId: zUuid.nullable().optional(), archived: z.boolean().optional() }), req.body);
    return inOrg(ctx, req, orgId, 'admin', async (trx, access) => {
      const { cls } = await classAccess(trx, access, classId);
      const scopeId = body.scopeId === undefined ? cls.scope_id : body.scopeId ? (await getScope(trx, orgId, body.scopeId)).id : null;
      await trx
        .updateTable('classes')
        .set({
          name: body.name ?? cls.name,
          grade: body.grade ?? cls.grade,
          scope_id: scopeId,
          archived_at: body.archived === undefined ? cls.archived_at : body.archived ? (cls.archived_at ?? new Date()) : null,
        })
        .where('id', '=', classId)
        .execute()
        .catch((err: { code?: string }) => {
          if (err.code === '23505') throw conflict('There is already a class with this name', 'CLASS_NAME_TAKEN');
          throw err;
        });
      await recordAudit(trx, actorFromRequest(req), { orgId, action: 'class.updated', targetType: 'class', targetId: classId, metadata: { name: body.name ?? cls.name, fields: Object.keys(body) } }, requestMeta(req));
      return { status: 'updated' };
    });
  });

  // Deletes the class with its homework, hand-ins and files.
  app.delete('/api/orgs/:orgId/classes/:classId', async (req) => {
    const { orgId, classId } = parse(ClassParams, req.params);
    return inOrg(ctx, req, orgId, 'admin', async (trx, access) => {
      const { cls } = await classAccess(trx, access, classId);
      await trx.deleteFrom('classes').where('id', '=', classId).execute();
      await recordAudit(trx, actorFromRequest(req), { orgId, action: 'class.deleted', targetType: 'class', targetId: classId, metadata: { name: cls.name } }, requestMeta(req));
      return { status: 'deleted' };
    });
  });

  // The class's students: the full list replaces the current one.
  app.put('/api/orgs/:orgId/classes/:classId/students', async (req) => {
    const { orgId, classId } = parse(ClassParams, req.params);
    const body = parse(z.object({ studentIds: z.array(zUuid).max(500) }), req.body);
    return inOrg(ctx, req, orgId, 'admin', async (trx, access) => {
      const { cls } = await classAccess(trx, access, classId);
      const wanted = [...new Set(body.studentIds)];
      if (wanted.length) {
        const found = await trx.selectFrom('students').select('user_id').where('org_id', '=', orgId).where('user_id', 'in', wanted).execute();
        if (found.length !== wanted.length) throw badRequest('Some of these students are not at your school');
      }
      const current = (await trx.selectFrom('class_students').select('student_id').where('class_id', '=', classId).execute()).map((r) => r.student_id);
      const add = wanted.filter((id) => !current.includes(id));
      const remove = current.filter((id) => !wanted.includes(id));
      if (remove.length) await trx.deleteFrom('class_students').where('class_id', '=', classId).where('student_id', 'in', remove).execute();
      if (add.length) await trx.insertInto('class_students').values(add.map((id) => ({ class_id: classId, org_id: orgId, student_id: id }))).execute();
      await recordAudit(trx, actorFromRequest(req), { orgId, action: 'class.students_changed', targetType: 'class', targetId: classId, metadata: { name: cls.name, added: add.length, removed: remove.length } }, requestMeta(req));
      return { added: add.length, removed: remove.length, students: await classStudents(trx, classId) };
    });
  });

  app.post('/api/orgs/:orgId/classes/:classId/teachers', async (req, reply) => {
    const { orgId, classId } = parse(ClassParams, req.params);
    const body = parse(z.object({ userId: zUuid, subjectEn: zSubjectName, subjectAr: zSubjectName }), req.body);
    const row = await inOrg(ctx, req, orgId, 'admin', async (trx, access) => {
      const { cls } = await classAccess(trx, access, classId);
      const member = await trx.selectFrom('memberships as m').innerJoin('users as u', 'u.id', 'm.user_id').select(['m.user_id', 'u.name']).where('m.org_id', '=', orgId).where('m.user_id', '=', body.userId).executeTakeFirst();
      if (!member) throw new AppError(400, 'TEACHER_NOT_MEMBER', 'Choose a member of your school');
      const created = await trx
        .insertInto('class_teachers')
        .values({ class_id: classId, org_id: orgId, user_id: body.userId, subject_en: body.subjectEn, subject_ar: body.subjectAr })
        .returning(['id'])
        .executeTakeFirst()
        .catch((err: { code?: string }) => {
          if (err.code === '23505') throw conflict('This member already teaches this subject in this class', 'ALREADY_TEACHER');
          throw err;
        });
      await recordAudit(trx, actorFromRequest(req), { orgId, action: 'class.teacher_added', targetType: 'class', targetId: classId, metadata: { name: cls.name, teacher: body.userId, subject: body.subjectEn } }, requestMeta(req));
      return { id: created!.id, userId: member.user_id, name: member.name, subjectEn: body.subjectEn, subjectAr: body.subjectAr };
    });
    return reply.status(201).send({ teacher: row });
  });

  app.delete('/api/orgs/:orgId/classes/:classId/teachers/:teacherId', async (req) => {
    const { orgId, classId, teacherId } = parse(ClassParams.extend({ teacherId: zUuid }), req.params);
    return inOrg(ctx, req, orgId, 'admin', async (trx, access) => {
      const { cls } = await classAccess(trx, access, classId);
      const removed = await trx.deleteFrom('class_teachers').where('id', '=', teacherId).where('class_id', '=', classId).returning(['user_id', 'subject_en']).executeTakeFirst();
      if (!removed) throw notFound('Teacher');
      await recordAudit(trx, actorFromRequest(req), { orgId, action: 'class.teacher_removed', targetType: 'class', targetId: classId, metadata: { name: cls.name, teacher: removed.user_id, subject: removed.subject_en } }, requestMeta(req));
      return { status: 'removed' };
    });
  });

  // ------------------------------------------------------------ homework

  /** Books picked for the homework must be in the class's curriculum for that subject; they are copied. */
  async function pickMaterials(trx: Parameters<typeof classSubjects>[0], cls: Parameters<typeof classSubjects>[1], subjectEn: string, ids: string[]): Promise<HomeworkMaterial[]> {
    if (!ids.length) return [];
    const { subjects } = await classSubjects(trx, cls);
    const allowed = new Map((subjects.find((s) => s.nameEn === subjectEn)?.materials ?? []).map((m) => [m.id, m]));
    const out = [...new Set(ids)].map((id) => allowed.get(id));
    if (out.some((m) => !m)) throw new AppError(400, 'INVALID_HOMEWORK_BOOKS', 'Choose books from this class’s curriculum for this subject');
    return out as HomeworkMaterial[];
  }

  app.post('/api/orgs/:orgId/classes/:classId/homework', rateLimited(300, '1 hour'), async (req, reply) => {
    const { orgId, classId } = parse(ClassParams, req.params);
    const body = parse(HomeworkBody, req.body);
    const hw = await inOrg(ctx, req, orgId, 'viewer', async (trx, access) => {
      assertClassroomEnabled(await getEntitlements(trx, orgId, grace));
      const acc = await classAccess(trx, access, classId);
      if (acc.cls.archived_at) throw conflict('This class is archived', 'CLASS_ARCHIVED');
      assertTeachesSubject(acc, body.subjectEn);
      const publishAt = body.publishAt ?? new Date();
      if (body.dueAt <= publishAt) throw new AppError(400, 'DUE_BEFORE_PUBLISH', 'The due time must be after the time the homework is set');
      const materials = await pickMaterials(trx, acc.cls, body.subjectEn, body.materialIds);
      const row = await trx
        .insertInto('homework')
        .values({
          org_id: orgId,
          class_id: classId,
          subject_en: body.subjectEn,
          subject_ar: body.subjectAr,
          title: body.title,
          instructions: body.instructions,
          materials: JSON.stringify(materials),
          publish_at: publishAt,
          due_at: body.dueAt,
          max_points: body.maxPoints,
          allow_late: body.allowLate,
          created_by: access.user.id,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      // Published now: tell the students in this request. Scheduled: the worker does it later.
      if (row.publish_at <= new Date()) await notifyHomeworkPublished(trx, row);
      await recordAudit(trx, actorFromRequest(req), { orgId, action: 'homework.created', targetType: 'homework', targetId: row.id, metadata: { class: acc.cls.name, title: row.title, subject: row.subject_en } }, requestMeta(req));
      return row;
    });
    return reply.status(201).send({ homework: homeworkJson(hw) });
  });

  app.get('/api/orgs/:orgId/homework/:homeworkId', async (req) => {
    const { orgId, homeworkId } = parse(HomeworkParams, req.params);
    return inOrg(ctx, req, orgId, 'viewer', async (trx, access) => {
      const { hw, acc } = await homeworkAccess(trx, access, homeworkId);
      return {
        homework: homeworkJson(hw),
        class: { id: acc.cls.id, name: acc.cls.name, grade: acc.cls.grade },
        canEdit: teachesSubject(acc, hw.subject_en),
        files: await filesOf(trx, { homeworkId }),
        roster: await homeworkRoster(trx, hw),
        retention: await itemRetention(trx, 'homework', hw),
      };
    });
  });

  app.patch('/api/orgs/:orgId/homework/:homeworkId', async (req) => {
    const { orgId, homeworkId } = parse(HomeworkParams, req.params);
    const body = parse(HomeworkBody.partial().omit({ subjectEn: true, subjectAr: true }), req.body);
    return inOrg(ctx, req, orgId, 'viewer', async (trx, access) => {
      const { hw, acc } = await homeworkAccess(trx, access, homeworkId);
      assertTeachesSubject(acc, hw.subject_en);
      const publishAt = body.publishAt ?? hw.publish_at;
      const dueAt = body.dueAt ?? hw.due_at;
      if (dueAt <= publishAt) throw new AppError(400, 'DUE_BEFORE_PUBLISH', 'The due time must be after the time the homework is set');
      if (body.maxPoints !== undefined) {
        const top = await trx.selectFrom('homework_submissions').select((eb) => eb.fn.max('points').as('top')).where('homework_id', '=', homeworkId).executeTakeFirst();
        const highest = num((top?.top as string | null) ?? null);
        if (highest !== null && (body.maxPoints === null || highest > body.maxPoints)) {
          throw conflict(`Some work already has ${highest} points; the total cannot be lower`, 'POINTS_ABOVE_TOTAL');
        }
      }
      const materials = body.materialIds ? await pickMaterials(trx, acc.cls, hw.subject_en, body.materialIds) : undefined;
      const updated = await trx
        .updateTable('homework')
        .set({
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.instructions !== undefined ? { instructions: body.instructions } : {}),
          ...(materials ? { materials: JSON.stringify(materials) } : {}),
          publish_at: publishAt,
          due_at: dueAt,
          ...(body.maxPoints !== undefined ? { max_points: body.maxPoints } : {}),
          ...(body.allowLate !== undefined ? { allow_late: body.allowLate } : {}),
        })
        .where('id', '=', homeworkId)
        .returningAll()
        .executeTakeFirstOrThrow();
      if (!updated.notified_at && updated.publish_at <= new Date()) await notifyHomeworkPublished(trx, updated);
      await recordAudit(trx, actorFromRequest(req), { orgId, action: 'homework.updated', targetType: 'homework', targetId: homeworkId, metadata: { title: updated.title, fields: Object.keys(body) } }, requestMeta(req));
      return { homework: homeworkJson(updated) };
    });
  });

  app.delete('/api/orgs/:orgId/homework/:homeworkId', async (req) => {
    const { orgId, homeworkId } = parse(HomeworkParams, req.params);
    return inOrg(ctx, req, orgId, 'viewer', async (trx, access) => {
      const { hw, acc } = await homeworkAccess(trx, access, homeworkId);
      assertTeachesSubject(acc, hw.subject_en);
      await trx.deleteFrom('homework').where('id', '=', homeworkId).execute();
      await recordAudit(trx, actorFromRequest(req), { orgId, action: 'homework.deleted', targetType: 'homework', targetId: homeworkId, metadata: { class: acc.cls.name, title: hw.title } }, requestMeta(req));
      return { status: 'deleted' };
    });
  });

  // ------------------------------------------------------------ marking

  app.get('/api/orgs/:orgId/homework/:homeworkId/submissions/:studentId', async (req) => {
    const { orgId, homeworkId, studentId } = parse(HomeworkParams.extend({ studentId: zUuid }), req.params);
    return inOrg(ctx, req, orgId, 'viewer', async (trx, access) => {
      const { hw, acc } = await homeworkAccess(trx, access, homeworkId);
      const student = await trx.selectFrom('students as s').innerJoin('users as u', 'u.id', 's.user_id').select(['s.user_id', 's.username', 'u.name']).where('s.org_id', '=', orgId).where('s.user_id', '=', studentId).executeTakeFirst();
      if (!student) throw notFound('Student');
      const sub = await trx.selectFrom('homework_submissions').selectAll().where('homework_id', '=', homeworkId).where('student_id', '=', studentId).executeTakeFirst();
      // A draft is the student's own until they hand it in.
      const visible = sub && sub.status !== 'draft' ? sub : null;
      return {
        homework: homeworkJson(hw),
        student: { userId: student.user_id, username: student.username, name: student.name },
        canMark: teachesSubject(acc, hw.subject_en),
        submission: {
          status: rosterStatus(sub?.status),
          body: visible?.body ?? '',
          submittedAt: visible?.submitted_at ?? null,
          late: visible?.late ?? false,
          points: num(sub?.points ?? null),
          feedback: sub?.feedback ?? null,
          gradedAt: sub?.graded_at ?? null,
          returnedAt: sub?.returned_at ?? null,
          files: visible ? await filesOf(trx, { submissionId: visible.id }) : [],
        },
      };
    });
  });

  /**
   * Mark and comment, and optionally return the work to the student (who then
   * sees the mark). Works for students who handed in nothing online, to record
   * work done on paper.
   */
  app.patch('/api/orgs/:orgId/homework/:homeworkId/submissions/:studentId', async (req) => {
    const { orgId, homeworkId, studentId } = parse(HomeworkParams.extend({ studentId: zUuid }), req.params);
    const body = parse(z.object({ points: zPoints.nullable().optional(), feedback: z.string().trim().max(3000).nullable().optional(), return: z.boolean().default(false) }), req.body);
    return inOrg(ctx, req, orgId, 'viewer', async (trx, access) => {
      const { hw, acc } = await homeworkAccess(trx, access, homeworkId);
      assertTeachesSubject(acc, hw.subject_en);
      const max = num(hw.max_points);
      if (body.points !== undefined && body.points !== null) {
        if (max === null) throw badRequest('This homework is not marked with points');
        if (body.points > max) throw new AppError(400, 'POINTS_ABOVE_TOTAL', `The mark can be at most ${max}`);
      }
      const student = await trx.selectFrom('students').select('user_id').where('org_id', '=', orgId).where('user_id', '=', studentId).executeTakeFirst();
      if (!student) throw notFound('Student');
      let sub = await trx.selectFrom('homework_submissions').selectAll().where('homework_id', '=', homeworkId).where('student_id', '=', studentId).executeTakeFirst();
      if (!sub) sub = await trx.insertInto('homework_submissions').values({ org_id: orgId, homework_id: homeworkId, student_id: studentId }).returningAll().executeTakeFirstOrThrow();
      const now = new Date();
      const marking = body.points !== undefined || body.feedback !== undefined;
      const updated = await trx
        .updateTable('homework_submissions')
        .set({
          ...(body.points !== undefined ? { points: body.points } : {}),
          ...(body.feedback !== undefined ? { feedback: body.feedback || null } : {}),
          ...(marking ? { graded_by: access.user.id, graded_at: now } : {}),
          ...(body.return ? { status: 'returned' as const, returned_at: now } : {}),
        })
        .where('id', '=', sub.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      if (body.return) {
        await notifyHomeworkReturned(trx, hw, studentId, num(updated.points));
        await recordAudit(trx, actorFromRequest(req), { orgId, action: 'homework.returned', targetType: 'homework', targetId: homeworkId, metadata: { title: hw.title, student: studentId, points: num(updated.points) } }, requestMeta(req));
      } else if (marking) {
        await recordAudit(trx, actorFromRequest(req), { orgId, action: 'homework.marked', targetType: 'homework', targetId: homeworkId, metadata: { title: hw.title, student: studentId, points: num(updated.points) } }, requestMeta(req));
      }
      return { status: rosterStatus(updated.status), points: num(updated.points), feedback: updated.feedback, returnedAt: updated.returned_at };
    });
  });

  // Return several students' work at once (those handed in or already marked).
  app.post('/api/orgs/:orgId/homework/:homeworkId/return', async (req) => {
    const { orgId, homeworkId } = parse(HomeworkParams, req.params);
    const body = parse(z.object({ studentIds: z.array(zUuid).min(1).max(500) }), req.body);
    return inOrg(ctx, req, orgId, 'viewer', async (trx, access) => {
      const { hw, acc } = await homeworkAccess(trx, access, homeworkId);
      assertTeachesSubject(acc, hw.subject_en);
      const rows = await trx
        .updateTable('homework_submissions')
        .set({ status: 'returned', returned_at: new Date() })
        .where('homework_id', '=', homeworkId)
        .where('student_id', 'in', body.studentIds)
        .where((eb) => eb.or([eb('status', '=', 'submitted'), eb.and([eb('status', '=', 'draft'), eb('graded_at', 'is not', null)])]))
        .returning(['student_id', 'points'])
        .execute();
      for (const r of rows) await notifyHomeworkReturned(trx, hw, r.student_id, num(r.points));
      if (rows.length) await recordAudit(trx, actorFromRequest(req), { orgId, action: 'homework.returned', targetType: 'homework', targetId: homeworkId, metadata: { title: hw.title, count: rows.length } }, requestMeta(req));
      return { returned: rows.length };
    });
  });

  // ------------------------------------------------------------ files

  app.get('/api/orgs/:orgId/files/:fileId', async (req, reply) => {
    const { orgId, fileId } = parse(z.object({ orgId: z.string(), fileId: zUuid }), req.params);
    const file = await inOrg(ctx, req, orgId, 'viewer', async (trx, access) => {
      const f = await trx.selectFrom('classroom_files').selectAll().where('org_id', '=', orgId).where('id', '=', fileId).executeTakeFirst();
      if (!f) throw notFound('File');
      let homeworkId = f.homework_id;
      if (f.submission_id) {
        const sub = await trx.selectFrom('homework_submissions').select(['homework_id', 'status']).where('id', '=', f.submission_id).executeTakeFirstOrThrow();
        if (sub.status === 'draft') throw notFound('File');
        homeworkId = sub.homework_id;
      }
      await homeworkAccess(trx, access, homeworkId!).catch(() => {
        throw notFound('File');
      });
      return openable(f);
    });
    return sendFile(reply, file);
  });

  // Raw uploads (photos and PDFs) are parsed only on this route.
  await app.register(async (scope) => {
    scope.addContentTypeParser(UPLOAD_CONTENT_TYPES, { parseAs: 'buffer', bodyLimit: MAX_FILE_BYTES + 1 }, (_req, body, done) => done(null, body));

    scope.post('/api/orgs/:orgId/homework/:homeworkId/files', { bodyLimit: MAX_FILE_BYTES + 1, ...rateLimited(300, '1 hour') }, async (req, reply) => {
      const { orgId, homeworkId } = parse(HomeworkParams, req.params);
      const file = await inOrg(ctx, req, orgId, 'viewer', async (trx, access) => {
        const { hw, acc } = await homeworkAccess(trx, access, homeworkId);
        assertTeachesSubject(acc, hw.subject_en);
        const upload = readUpload(req);
        await lockOrg(trx, orgId);
        const count = await trx.selectFrom('classroom_files').select((eb) => eb.fn.countAll<string>().as('n')).where('homework_id', '=', homeworkId).executeTakeFirstOrThrow();
        if (Number(count.n) >= MAX_FILES_PER_ITEM) throw conflict(`At most ${MAX_FILES_PER_ITEM} files per homework`, 'TOO_MANY_FILES');
        await assertStorageAvailable(trx, orgId, await getEntitlements(trx, orgId, grace), upload.data.length);
        return saveFile(trx, { orgId, homeworkId, upload, uploadedBy: access.user.id });
      });
      return reply.status(201).send({ file });
    });
  });

  app.delete('/api/orgs/:orgId/homework/:homeworkId/files/:fileId', async (req) => {
    const { orgId, homeworkId, fileId } = parse(HomeworkParams.extend({ fileId: zUuid }), req.params);
    return inOrg(ctx, req, orgId, 'viewer', async (trx, access) => {
      const { hw, acc } = await homeworkAccess(trx, access, homeworkId);
      assertTeachesSubject(acc, hw.subject_en);
      const removed = await trx.deleteFrom('classroom_files').where('id', '=', fileId).where('homework_id', '=', homeworkId).returning('id').executeTakeFirst();
      if (!removed) throw notFound('File');
      return { status: 'deleted' };
    });
  });

}
