import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorFromRequest, recordAudit, requestMeta } from '../audit/audit.js';
import { inOrg, requireStudentSession } from '../auth/guards.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { revokeUserSessions } from '../auth/sessions.js';
import { getEntitlements, lockOrg } from '../billing/entitlements.js';
import { gradeList } from '../catalog/service.js';
import type { Trx } from '../db/index.js';
import type { AppContext } from '../http/context.js';
import { perAccount, rateLimited } from '../http/rate-limit.js';
import { CsvError, parseCsv } from '../lib/csv.js';
import { AppError, badRequest, notFound } from '../lib/errors.js';
import { parse, zLocale, zPassword, zUuid } from '../lib/validation.js';
import { getScope } from '../scopes/service.js';
import { asStudent } from './context.js';
import {
  assertStudentCapacity,
  countStudents,
  createStudents,
  generateStudentPassword,
  listStudents,
  planStudentImport,
  studentCurriculum,
  studentsEnabled,
  zGrade,
  zStudentName,
  zUsername,
} from './service.js';

const OrgParams = z.object({ orgId: z.string() });
const StudentParams = z.object({ orgId: z.string(), userId: zUuid });

async function scopeOrNull(trx: Trx, orgId: string, scopeId: string | null | undefined): Promise<string | null> {
  if (!scopeId) return null;
  return (await getScope(trx, orgId, scopeId)).id;
}

export function registerStudentRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, config } = ctx;
  const grace = config.GRACE_DAYS;

  // ------------------------------------------------------------ school staff: manage students (admins and the owner)
  app.get('/api/orgs/:orgId/students', async (req) => {
    const { orgId } = parse(OrgParams, req.params);
    return inOrg(ctx, req, orgId, 'admin', async (trx, { org }) => {
      const ent = await getEntitlements(trx, orgId, grace);
      return {
        enabled: studentsEnabled(ent),
        limit: ent.limits.max_students,
        used: await countStudents(trx, orgId),
        schoolCode: org.slug,
        grades: gradeList(),
        students: await listStudents(trx, orgId),
      };
    });
  });

  const StudentBody = z.object({ username: zUsername, name: zStudentName, grade: zGrade, scopeId: zUuid.nullable().optional() });

  app.post('/api/orgs/:orgId/students', rateLimited(120, '1 hour'), async (req, reply) => {
    const { orgId } = parse(OrgParams, req.params);
    const body = parse(StudentBody, req.body);
    const created = await inOrg(ctx, req, orgId, 'admin', async (trx, { org, user }) => {
      await lockOrg(trx, orgId);
      await assertStudentCapacity(trx, orgId, await getEntitlements(trx, orgId, grace), 1);
      const taken = await trx.selectFrom('students').select('user_id').where('org_id', '=', orgId).where('username', '=', body.username).executeTakeFirst();
      if (taken) throw new AppError(409, 'USERNAME_TAKEN', 'This username is already used at your school');
      const scopeId = await scopeOrNull(trx, orgId, body.scopeId);
      const [s] = await createStudents(trx, orgId, org.locale, user.id, [{ username: body.username, name: body.name, grade: body.grade, scopeId }]);
      await recordAudit(trx, actorFromRequest(req), { orgId, action: 'student.created', targetType: 'student', targetId: s!.userId, metadata: { username: s!.username, grade: s!.grade } }, requestMeta(req));
      return s!;
    });
    return reply.status(201).send({ student: { userId: created.userId, username: created.username, name: created.name, grade: created.grade, scopeId: created.scopeId }, password: created.password });
  });

  // Roster import: preview first (apply=false), then apply. All or nothing.
  app.post('/api/orgs/:orgId/students/import', { bodyLimit: 2 * 1_048_576, ...rateLimited(30, '1 hour') }, async (req) => {
    const { orgId } = parse(OrgParams, req.params);
    const body = parse(z.object({ csv: z.string().max(1_500_000), apply: z.boolean().default(false) }), req.body);
    return inOrg(ctx, req, orgId, 'admin', async (trx, { org, user }) => {
      if (body.apply) await lockOrg(trx, orgId);
      if (body.csv.includes('�')) throw badRequest('The file is not UTF-8. In Excel, save it as "CSV UTF-8 (Comma delimited)".');
      let records: string[][];
      try {
        records = parseCsv(body.csv);
      } catch (err) {
        throw badRequest(err instanceof CsvError ? err.message : 'The file could not be read as CSV');
      }
      const existing = await trx.selectFrom('students').select('username').where('org_id', '=', orgId).execute();
      const scopes = await trx.selectFrom('scopes').select(['id', 'name']).where('org_id', '=', orgId).execute();
      const plan = planStudentImport(records, new Set(existing.map((e) => e.username)), new Map(scopes.map((s) => [s.name.toLowerCase(), s.id])));
      const ent = await getEntitlements(trx, orgId, grace);
      const used = existing.length;
      const summary = { enabled: studentsEnabled(ent), limit: ent.limits.max_students, used, errors: plan.errors, rows: plan.rows.map((r) => ({ line: r.line, username: r.username, name: r.name, grade: r.grade, scopeName: r.scopeName })) };
      if (!body.apply) return { applied: false, ...summary };
      if (plan.errors.length) throw new AppError(400, 'IMPORT_INVALID', 'Fix the errors in the file and try again; nothing was imported', plan.errors);
      await assertStudentCapacity(trx, orgId, ent, plan.rows.length);
      const created = await createStudents(trx, orgId, org.locale, user.id, plan.rows.map(({ username, name, grade, scopeId }) => ({ username, name, grade, scopeId })));
      await recordAudit(trx, actorFromRequest(req), { orgId, action: 'student.imported', targetType: 'organization', targetId: orgId, metadata: { count: created.length } }, requestMeta(req));
      return {
        applied: true,
        schoolCode: org.slug,
        created: created.map((s) => ({ userId: s.userId, username: s.username, name: s.name, grade: s.grade, password: s.password })),
      };
    });
  });

  app.patch('/api/orgs/:orgId/students/:userId', async (req) => {
    const { orgId, userId } = parse(StudentParams, req.params);
    const body = parse(z.object({ name: zStudentName.optional(), grade: zGrade.optional(), scopeId: zUuid.nullable().optional() }), req.body);
    return inOrg(ctx, req, orgId, 'admin', async (trx) => {
      const student = await trx.selectFrom('students').selectAll().where('org_id', '=', orgId).where('user_id', '=', userId).executeTakeFirst();
      if (!student) throw notFound('Student');
      const scopeId = body.scopeId === undefined ? student.scope_id : await scopeOrNull(trx, orgId, body.scopeId);
      await trx.updateTable('students').set({ grade: body.grade ?? student.grade, scope_id: scopeId }).where('user_id', '=', userId).execute();
      if (body.name) await trx.updateTable('users').set({ name: body.name }).where('id', '=', userId).where('kind', '=', 'student').execute();
      await recordAudit(trx, actorFromRequest(req), { orgId, action: 'student.updated', targetType: 'student', targetId: userId, metadata: { username: student.username, fields: Object.keys(body) } }, requestMeta(req));
      return { status: 'updated' };
    });
  });

  // A new one-time password; signs the student out everywhere and lifts a lockout.
  app.post('/api/orgs/:orgId/students/:userId/reset-password', rateLimited(120, '1 hour'), async (req) => {
    const { orgId, userId } = parse(StudentParams, req.params);
    return inOrg(ctx, req, orgId, 'admin', async (trx) => {
      const student = await trx.selectFrom('students').select(['user_id', 'username']).where('org_id', '=', orgId).where('user_id', '=', userId).executeTakeFirst();
      if (!student) throw notFound('Student');
      const password = generateStudentPassword();
      await trx
        .updateTable('users')
        .set({ password_hash: await hashPassword(password), password_changed_at: new Date(), failed_login_count: 0, locked_until: null })
        .where('id', '=', userId)
        .where('kind', '=', 'student')
        .execute();
      await revokeUserSessions(trx, userId);
      await recordAudit(trx, actorFromRequest(req), { orgId, action: 'student.password_reset', targetType: 'student', targetId: userId, metadata: { username: student.username } }, requestMeta(req));
      return { password };
    });
  });

  // Deletes the student's account, sessions and notifications (trigger students_delete_account).
  app.delete('/api/orgs/:orgId/students/:userId', async (req) => {
    const { orgId, userId } = parse(StudentParams, req.params);
    return inOrg(ctx, req, orgId, 'admin', async (trx) => {
      const removed = await trx.deleteFrom('students').where('org_id', '=', orgId).where('user_id', '=', userId).returning(['username']).executeTakeFirst();
      if (!removed) throw notFound('Student');
      await recordAudit(trx, actorFromRequest(req), { orgId, action: 'student.removed', targetType: 'student', targetId: userId, metadata: { username: removed.username } }, requestMeta(req));
      return { status: 'removed' };
    });
  });

  // ------------------------------------------------------------ the student portal
  app.get('/api/student/curriculum', async (req) => {
    return asStudent(ctx, req, async (trx, { student, org }) => ({
      school: { name: org.name },
      ...(await studentCurriculum(trx, student)),
    }));
  });

  app.patch('/api/student/profile', async (req) => {
    const { user } = requireStudentSession(req);
    const body = parse(z.object({ locale: zLocale }), req.body);
    await db.updateTable('users').set({ locale: body.locale }).where('id', '=', user.id).execute();
    return { status: 'updated' };
  });

  app.post('/api/student/password', rateLimited(10, '15 minutes', perAccount), async (req) => {
    const { user, session } = requireStudentSession(req);
    const body = parse(z.object({ currentPassword: z.string().min(1).max(256), newPassword: zPassword }), req.body);
    if (!(await verifyPassword(user.password_hash, body.currentPassword))) throw new AppError(400, 'INVALID_PASSWORD', 'Current password is incorrect');
    const passwordHash = await hashPassword(body.newPassword);
    await asStudent(ctx, req, async (trx, { student }) => {
      await trx.updateTable('users').set({ password_hash: passwordHash, password_changed_at: new Date() }).where('id', '=', user.id).execute();
      await revokeUserSessions(trx, user.id, session.id);
      await recordAudit(trx, { type: 'user', userId: user.id }, { orgId: student.org_id, action: 'student.password_changed', targetType: 'student', targetId: user.id, metadata: { username: student.username } }, requestMeta(req));
    });
    return { status: 'password_changed' };
  });
}
