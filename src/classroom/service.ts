import { sql } from 'kysely';
import { z } from 'zod';
import { hasRole, type OrgAccess } from '../auth/guards.js';
import type { Entitlements } from '../billing/entitlements.js';
import { loadCatalogTree } from '../catalog/service.js';
import type { Database, Executor } from '../db/index.js';
import { withSystemContext } from '../db/index.js';
import type { Homework, HomeworkMaterial, Locale, SchoolClass, SubmissionStatus } from '../db/types.js';
import { AppError, notFound } from '../lib/errors.js';
import { notify } from '../notifications/email.js';
import { studentsEnabled } from '../students/service.js';

// Classes, teachers and homework (docs/CLASSROOM.md).

export const zClassName = z.string().trim().min(1).max(60);
export const zSubjectName = z.string().trim().min(1).max(120);
/** Marks: up to 9999.99, in steps of 0.01. */
export const zPoints = z
  .number()
  .min(0)
  .max(9999.99)
  .refine((n) => Math.round(n * 100) === n * 100, 'Use at most two decimals');

/** Classes and homework come with student accounts: the same switch turns both on. */
export function classroomEnabled(ent: Entitlements): boolean {
  return studentsEnabled(ent);
}

export function assertClassroomEnabled(ent: Entitlements): void {
  if (!classroomEnabled(ent)) {
    throw new AppError(402, 'CLASSROOM_NOT_ENABLED', 'Classes and homework come with student accounts, which are not part of your plan yet. Contact us to turn them on for your school.');
  }
}

export const num = (v: string | number | null): number | null => (v === null ? null : Number(v));

// ------------------------------------------------------------ who may use a class

export interface Teaching {
  id: string;
  subjectEn: string;
  subjectAr: string;
}

export interface ClassAccess {
  cls: SchoolClass;
  /** Owners and admins manage every class. */
  admin: boolean;
  /** The subjects this member teaches in the class. */
  teaching: Teaching[];
}

/**
 * The class, if this member may open it: owners and admins always, other
 * members when they teach in it. Anyone else gets a 404, as for another school.
 */
export async function classAccess(exec: Executor, access: OrgAccess, classId: string): Promise<ClassAccess> {
  const cls = await exec.selectFrom('classes').selectAll().where('org_id', '=', access.org.id).where('id', '=', classId).executeTakeFirst();
  if (!cls) throw notFound('Class');
  const admin = hasRole(access.role, 'admin');
  const teaching = (
    await exec.selectFrom('class_teachers').select(['id', 'subject_en', 'subject_ar']).where('class_id', '=', classId).where('user_id', '=', access.user.id).orderBy('subject_en').execute()
  ).map((t) => ({ id: t.id, subjectEn: t.subject_en, subjectAr: t.subject_ar }));
  if (!admin && !teaching.length) throw notFound('Class');
  return { cls, admin, teaching };
}

export function teachesSubject(acc: ClassAccess, subjectEn: string): boolean {
  return acc.admin || acc.teaching.some((t) => t.subjectEn === subjectEn);
}

export function assertTeachesSubject(acc: ClassAccess, subjectEn: string): void {
  if (!teachesSubject(acc, subjectEn)) throw new AppError(403, 'NOT_SUBJECT_TEACHER', 'Only teachers of this subject in this class, and the school’s admins, can do this');
}

/** Homework and the class it belongs to, if this member may open the class. */
export async function homeworkAccess(exec: Executor, access: OrgAccess, homeworkId: string): Promise<{ hw: Homework; acc: ClassAccess }> {
  const hw = await exec.selectFrom('homework').selectAll().where('org_id', '=', access.org.id).where('id', '=', homeworkId).executeTakeFirst();
  if (!hw) throw notFound('Homework');
  const acc = await classAccess(exec, access, hw.class_id).catch((err: unknown) => {
    throw err instanceof AppError && err.statusCode === 404 ? notFound('Homework') : err;
  });
  return { hw, acc };
}

// ------------------------------------------------------------ the class's subjects and books

export interface ClassSubject {
  nameEn: string;
  nameAr: string;
  /** Books of the subject selected in the class's curriculum scope (none without a scope). */
  materials: HomeworkMaterial[];
}

/**
 * The subjects of the class's grade, from its curriculum scope's catalogue (or
 * the newest published catalogue when it has no scope), each with the books
 * the scope selected. Subjects taught in several tracks appear once.
 */
export async function classSubjects(exec: Executor, cls: Pick<SchoolClass, 'grade' | 'scope_id'>): Promise<{ academicYear: string | null; subjects: ClassSubject[] }> {
  let versionId: string | null = null;
  let selected: Set<string> | null = null;
  if (cls.scope_id) {
    const scope = await exec.selectFrom('scopes').select(['id', 'catalog_version_id']).where('id', '=', cls.scope_id).executeTakeFirst();
    if (scope) {
      versionId = scope.catalog_version_id;
      selected = new Set((await exec.selectFrom('scope_items').select('material_id').where('scope_id', '=', scope.id).execute()).map((r) => r.material_id));
    }
  }
  if (!versionId) {
    const newest = await exec.selectFrom('catalog_versions').select('id').where('status', '=', 'published').orderBy('academic_year', 'desc').orderBy('published_at', 'desc').executeTakeFirst();
    versionId = newest?.id ?? null;
  }
  if (!versionId) return { academicYear: null, subjects: [] };
  const tree = await loadCatalogTree(exec, versionId);
  const byName = new Map<string, ClassSubject>();
  for (const s of tree.subjects) {
    if (s.grade !== cls.grade) continue;
    const entry = byName.get(s.nameEn) ?? { nameEn: s.nameEn, nameAr: s.nameAr, materials: [] };
    if (selected) for (const m of s.materials) if (selected.has(m.id)) entry.materials.push({ id: m.id, kind: m.kind, title: m.title });
    byName.set(s.nameEn, entry);
  }
  return { academicYear: tree.version.academicYear, subjects: [...byName.values()] };
}

// ------------------------------------------------------------ lists for staff

export async function listClasses(exec: Executor, access: OrgAccess, includeArchived: boolean) {
  const admin = hasRole(access.role, 'admin');
  const me = access.user.id;
  let q = exec
    .selectFrom('classes as c')
    .leftJoin('scopes as sc', 'sc.id', 'c.scope_id')
    .select(['c.id', 'c.name', 'c.grade', 'c.scope_id', 'c.archived_at', 'sc.name as scopeName'])
    .select((eb) => [
      eb.selectFrom('class_students as cs').select((e) => e.fn.countAll<string>().as('n')).whereRef('cs.class_id', '=', 'c.id').as('students'),
      // Work handed in and waiting for a mark, in the subjects this member teaches (all of them for admins).
      eb
        .selectFrom('homework_submissions as s')
        .innerJoin('homework as h', 'h.id', 's.homework_id')
        .select((e) => e.fn.countAll<string>().as('n'))
        .whereRef('h.class_id', '=', 'c.id')
        .where('s.status', '=', 'submitted')
        .$if(!admin, (qb) => qb.where((e) => e.exists(e.selectFrom('class_teachers as t').select('t.id').whereRef('t.class_id', '=', 'h.class_id').whereRef('t.subject_en', '=', 'h.subject_en').where('t.user_id', '=', me))))
        .as('toMark'),
    ])
    .where('c.org_id', '=', access.org.id);
  if (!admin) q = q.where((eb) => eb.exists(eb.selectFrom('class_teachers as t').select('t.id').whereRef('t.class_id', '=', 'c.id').where('t.user_id', '=', me)));
  if (!includeArchived) q = q.where('c.archived_at', 'is', null);
  const rows = await q.orderBy('c.grade').orderBy('c.name').execute();
  const teachers = rows.length
    ? await exec
        .selectFrom('class_teachers as t')
        .innerJoin('users as u', 'u.id', 't.user_id')
        .select(['t.id', 't.class_id', 't.user_id', 't.subject_en', 't.subject_ar', 'u.name'])
        .where(
          't.class_id',
          'in',
          rows.map((r) => r.id),
        )
        .orderBy('t.subject_en')
        .execute()
    : [];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    grade: r.grade,
    scopeId: r.scope_id,
    scopeName: r.scopeName,
    archived: r.archived_at !== null,
    students: Number(r.students ?? 0),
    toMark: Number(r.toMark ?? 0),
    teachers: teachers.filter((t) => t.class_id === r.id).map((t) => ({ id: t.id, userId: t.user_id, name: t.name, subjectEn: t.subject_en, subjectAr: t.subject_ar })),
    mine: teachers.some((t) => t.class_id === r.id && t.user_id === me),
  }));
}

export async function classStudents(exec: Executor, classId: string) {
  return exec
    .selectFrom('class_students as cs')
    .innerJoin('students as s', 's.user_id', 'cs.student_id')
    .innerJoin('users as u', 'u.id', 's.user_id')
    .select(['s.user_id', 's.username', 's.grade', 'u.name'])
    .where('cs.class_id', '=', classId)
    .orderBy('u.name')
    .execute()
    .then((rows) => rows.map((r) => ({ userId: r.user_id, username: r.username, name: r.name, grade: r.grade })));
}

function homeworkJson(h: Homework) {
  return {
    id: h.id,
    classId: h.class_id,
    subjectEn: h.subject_en,
    subjectAr: h.subject_ar,
    title: h.title,
    instructions: h.instructions,
    materials: h.materials,
    publishAt: h.publish_at,
    dueAt: h.due_at,
    maxPoints: num(h.max_points),
    allowLate: h.allow_late,
    createdAt: h.created_at,
  };
}
export { homeworkJson };

/** The class's homework, newest due first, with hand-in counts. */
export async function classHomework(exec: Executor, classId: string) {
  const rows = await exec
    .selectFrom('homework as h')
    .selectAll('h')
    .select((eb) => [
      eb.selectFrom('class_students as cs').select((e) => e.fn.countAll<string>().as('n')).whereRef('cs.class_id', '=', 'h.class_id').as('enrolled'),
      eb.selectFrom('homework_submissions as s').select((e) => e.fn.countAll<string>().as('n')).whereRef('s.homework_id', '=', 'h.id').where('s.status', 'in', ['submitted', 'returned']).as('handedIn'),
      eb.selectFrom('homework_submissions as s').select((e) => e.fn.countAll<string>().as('n')).whereRef('s.homework_id', '=', 'h.id').where('s.status', '=', 'submitted').as('toMark'),
      eb.selectFrom('homework_submissions as s').select((e) => e.fn.countAll<string>().as('n')).whereRef('s.homework_id', '=', 'h.id').where('s.status', '=', 'returned').as('returned'),
    ])
    .where('h.class_id', '=', classId)
    .orderBy('h.due_at', 'desc')
    .execute();
  return rows.map((r) => ({
    ...homeworkJson(r),
    counts: { enrolled: Number(r.enrolled ?? 0), handedIn: Number(r.handedIn ?? 0), toMark: Number(r.toMark ?? 0), returned: Number(r.returned ?? 0) },
  }));
}

/** What a teacher sees for each student: drafts count as not handed in, and their text stays private. */
export type RosterStatus = 'assigned' | 'submitted' | 'returned';

export function rosterStatus(status: SubmissionStatus | null | undefined): RosterStatus {
  return status === 'submitted' || status === 'returned' ? status : 'assigned';
}

/**
 * One row per student of the class, plus any student who handed in before
 * leaving it. A teacher-created row for paper work counts as handed in once returned.
 */
export async function homeworkRoster(exec: Executor, hw: Homework) {
  const rows = await exec
    .selectFrom('students as st')
    .innerJoin('users as u', 'u.id', 'st.user_id')
    .leftJoin('homework_submissions as s', (j) => j.onRef('s.student_id', '=', 'st.user_id').on('s.homework_id', '=', hw.id))
    .select(['st.user_id', 'st.username', 'u.name', 's.status', 's.submitted_at', 's.late', 's.points', 's.returned_at', 's.graded_at'])
    .select((eb) => [
      eb.exists(eb.selectFrom('class_students as cs').select('cs.student_id').whereRef('cs.student_id', '=', 'st.user_id').where('cs.class_id', '=', hw.class_id)).as('enrolled'),
      eb.selectFrom('classroom_files as f').select((e) => e.fn.countAll<string>().as('n')).whereRef('f.submission_id', '=', 's.id').as('files'),
    ])
    .where('st.org_id', '=', hw.org_id)
    .where((eb) =>
      eb.or([
        eb.exists(eb.selectFrom('class_students as cs').select('cs.student_id').whereRef('cs.student_id', '=', 'st.user_id').where('cs.class_id', '=', hw.class_id)),
        eb('s.status', 'in', ['submitted', 'returned']),
      ]),
    )
    .orderBy('u.name')
    .execute();
  const now = new Date();
  return rows.map((r) => {
    const status = rosterStatus(r.status);
    return {
      studentId: r.user_id,
      username: r.username,
      name: r.name,
      enrolled: Boolean(r.enrolled),
      status,
      missing: status === 'assigned' && hw.due_at < now,
      submittedAt: status === 'assigned' ? null : r.submitted_at,
      late: status === 'assigned' ? false : Boolean(r.late),
      points: num(r.points ?? null),
      graded: r.graded_at !== null && r.graded_at !== undefined,
      returnedAt: r.returned_at ?? null,
      files: status === 'assigned' ? 0 : Number(r.files ?? 0),
    };
  });
}

// ------------------------------------------------------------ notifications to students

const fmtWhen = (d: Date, locale: Locale) =>
  new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: locale === 'ar' ? 'long' : 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Africa/Cairo' }).format(d);

const ASSIGNED: Record<Locale, (p: { title: string; subject: string; due: string }) => { title: string; body: string }> = {
  en: (p) => ({ title: `New homework: ${p.title}`, body: `${p.subject} · due ${p.due}` }),
  ar: (p) => ({ title: `واجب جديد: ${p.title}`, body: `${p.subject} · موعد التسليم ${p.due}` }),
};

const RETURNED: Record<Locale, (p: { title: string; mark: string | null }) => { title: string; body: string }> = {
  en: (p) => ({ title: `Homework returned: ${p.title}`, body: p.mark ? `Your mark: ${p.mark}. Open it to read your teacher’s comments.` : 'Open it to read your teacher’s comments.' }),
  ar: (p) => ({ title: `أُعيد إليك الواجب: ${p.title}`, body: p.mark ? `درجتك: ${p.mark}. افتحه لقراءة ملاحظات المعلم.` : 'افتحه لقراءة ملاحظات المعلم.' }),
};

/** Tells the class's students about published homework, once (in their language). */
export async function notifyHomeworkPublished(exec: Executor, hw: Homework): Promise<number> {
  const students = await exec
    .selectFrom('class_students as cs')
    .innerJoin('users as u', 'u.id', 'cs.student_id')
    .select(['u.id', 'u.locale'])
    .where('cs.class_id', '=', hw.class_id)
    .execute();
  for (const s of students) {
    const text = ASSIGNED[s.locale]({ title: hw.title, subject: s.locale === 'ar' ? hw.subject_ar : hw.subject_en, due: fmtWhen(hw.due_at, s.locale) });
    await notify(exec, { userId: s.id, orgId: hw.org_id, kind: 'homework_assigned', title: text.title, body: text.body, link: `/student/homework/${hw.id}` });
  }
  await exec.updateTable('homework').set({ notified_at: new Date() }).where('id', '=', hw.id).execute();
  return students.length;
}

export async function notifyHomeworkReturned(exec: Executor, hw: Homework, studentId: string, points: number | null): Promise<void> {
  const to = await exec.selectFrom('users').select(['id', 'locale']).where('id', '=', studentId).where('kind', '=', 'student').executeTakeFirst();
  if (!to) return;
  const max = num(hw.max_points);
  const mark = points !== null && max !== null ? `${points} / ${max}` : null;
  const text = RETURNED[to.locale]({ title: hw.title, mark });
  await notify(exec, { userId: to.id, orgId: hw.org_id, kind: 'homework_returned', title: text.title, body: text.body, link: `/student/homework/${hw.id}` });
}

/**
 * Worker pass: homework scheduled for later is announced once its time comes.
 * (Homework published at once is announced in the request that creates it.)
 */
export async function runHomeworkAnnouncements(db: Database, now = new Date()): Promise<{ homework: number; students: number }> {
  return withSystemContext(db, async (trx) => {
    const due = await trx.selectFrom('homework').selectAll().where('notified_at', 'is', null).where('publish_at', '<=', now).orderBy('publish_at').limit(200).forUpdate().skipLocked().execute();
    let students = 0;
    for (const hw of due) students += await notifyHomeworkPublished(trx, hw);
    return { homework: due.length, students };
  });
}

// ------------------------------------------------------------ the student's view

export type StudentHomeworkStatus = 'assigned' | 'draft' | 'submitted' | 'returned';

/**
 * Homework of the student's classes, with their own state. Row-level security
 * already limits the rows to this student's classes and published homework.
 */
export async function studentHomework(exec: Executor, studentId: string, show: 'todo' | 'done' | 'all') {
  let q = exec
    .selectFrom('homework as h')
    .innerJoin('classes as c', 'c.id', 'h.class_id')
    .leftJoin('homework_submissions as s', (j) => j.onRef('s.homework_id', '=', 'h.id').on('s.student_id', '=', studentId))
    .selectAll('h')
    .select(['c.name as className', 's.status', 's.submitted_at', 's.late', 's.points', 's.returned_at'])
    .where('h.publish_at', '<=', sql<Date>`now()`);
  if (show === 'todo') q = q.where((eb) => eb.or([eb('s.status', 'is', null), eb('s.status', '=', 'draft')]));
  if (show === 'done') q = q.where('s.status', 'in', ['submitted', 'returned']);
  const rows = await q.orderBy(show === 'done' ? 'h.due_at' : 'h.due_at', show === 'done' ? 'desc' : 'asc').limit(200).execute();
  const now = new Date();
  return rows.map((r) => {
    const status: StudentHomeworkStatus = r.status ?? 'assigned';
    const handedIn = status === 'submitted' || status === 'returned';
    return {
      ...homeworkJson(r),
      className: r.className,
      status,
      overdue: !handedIn && r.due_at < now,
      closed: !handedIn && !r.allow_late && r.due_at < now,
      submittedAt: handedIn ? r.submitted_at : null,
      late: handedIn ? Boolean(r.late) : false,
      // A mark is the student's only once the teacher returns the work.
      points: status === 'returned' ? num(r.points) : null,
      returnedAt: status === 'returned' ? r.returned_at : null,
    };
  });
}

/** For the staff navigation: whether Classes is shown, and how much handed-in work waits for this member's mark. */
export async function classroomNav(exec: Executor, access: Pick<OrgAccess, 'role' | 'user'> & { org: { id: string } }, ent: Entitlements) {
  const admin = hasRole(access.role, 'admin');
  const teaches = admin
    ? false
    : Boolean(await exec.selectFrom('class_teachers').select('id').where('org_id', '=', access.org.id).where('user_id', '=', access.user.id).executeTakeFirst());
  if (!admin && !teaches) return { enabled: classroomEnabled(ent), show: false, toMark: 0 };
  const r = await exec
    .selectFrom('homework_submissions as s')
    .innerJoin('homework as h', 'h.id', 's.homework_id')
    .innerJoin('classes as c', 'c.id', 'h.class_id')
    .select((e) => e.fn.countAll<string>().as('n'))
    .where('s.org_id', '=', access.org.id)
    .where('s.status', '=', 'submitted')
    .where('c.archived_at', 'is', null)
    .$if(!admin, (qb) => qb.where((e) => e.exists(e.selectFrom('class_teachers as t').select('t.id').whereRef('t.class_id', '=', 'h.class_id').whereRef('t.subject_en', '=', 'h.subject_en').where('t.user_id', '=', access.user.id))))
    .executeTakeFirstOrThrow();
  return { enabled: classroomEnabled(ent), show: admin ? classroomEnabled(ent) || teaches : true, toMark: Number(r.n) };
}
