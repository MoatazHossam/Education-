import type { FastifyRequest } from 'fastify';
import { requireStudentSession } from '../auth/guards.js';
import { getEntitlements } from '../billing/entitlements.js';
import { withStudentContext, withUserContext, type Trx } from '../db/index.js';
import type { Organization, Student, User } from '../db/types.js';
import type { AppContext } from '../http/context.js';
import { forbidden, notFound } from '../lib/errors.js';
import { studentsEnabled } from './service.js';

export interface StudentAccess {
  user: User;
  student: Student;
  org: Organization;
}

/**
 * Runs `fn` for the signed-in student, in their school's context with
 * app.current_student set. The school comes from the student's own record,
 * never from the request, and row-level security limits every query to what
 * this student may see (migration 0013).
 */
export async function asStudent<T>(ctx: AppContext, req: FastifyRequest, fn: (trx: Trx, s: StudentAccess) => Promise<T>): Promise<T> {
  const { user } = requireStudentSession(req);
  const student = await withUserContext(ctx.db, user.id, (trx) => trx.selectFrom('students').selectAll().where('user_id', '=', user.id).executeTakeFirst());
  if (!student) throw notFound();
  return withStudentContext(ctx.db, { orgId: student.org_id, studentId: user.id }, async (trx) => {
    const org = await trx.selectFrom('organizations').selectAll().where('id', '=', student.org_id).executeTakeFirstOrThrow();
    if (org.status !== 'active') throw forbidden('Your school’s account is suspended. Ask your school.', 'ORG_SUSPENDED');
    if (!studentsEnabled(await getEntitlements(trx, org.id, ctx.config.GRACE_DAYS))) {
      throw forbidden('Your school has not turned on the student portal. Ask your school.', 'STUDENT_PORTAL_OFF');
    }
    return fn(trx, { user, student, org });
  });
}
