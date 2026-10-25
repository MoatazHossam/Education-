import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { hashPassword } from '../auth/password.js';
import type { Entitlements } from '../billing/entitlements.js';
import { gradeList, loadCatalogTree } from '../catalog/service.js';
import type { Executor, Trx } from '../db/index.js';
import type { Locale } from '../db/types.js';
import { AppError, limitReached } from '../lib/errors.js';

// School-created student accounts (docs/STUDENT_ACCOUNTS.md). Data kept per
// student: display name, username, grade and the scope that is their
// curriculum. No email, birth date or contact details.

export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,38}[a-z0-9]$/;
export const zUsername = z
  .string()
  .trim()
  .toLowerCase()
  .regex(USERNAME_RE, 'Use 3–40 letters, digits, dots, dashes or underscores, starting and ending with a letter or digit');
export const zGrade = z.coerce.number().int().min(1).max(12);
export const zStudentName = z.string().trim().min(1).max(120);

/** At most this many students per import, so one request stays within a few seconds of hashing. */
export const MAX_IMPORT_ROWS = 300;

// No look-alike characters (0/o, 1/l/i): staff read these out or print them for students.
const PASSWORD_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** A one-time password such as "kq7m-3tzp-x9ab" (about 59 bits). It is shown once and never stored. */
export function generateStudentPassword(): string {
  const groups: string[] = [];
  for (let g = 0; g < 3; g++) {
    let s = '';
    for (let i = 0; i < 4; i++) s += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
    groups.push(s);
  }
  return groups.join('-');
}

export function studentsEnabled(ent: Entitlements): boolean {
  return ent.limits.max_students !== 0;
}

export async function countStudents(exec: Executor, orgId: string): Promise<number> {
  const r = await exec.selectFrom('students').select((eb) => eb.fn.countAll<string>().as('n')).where('org_id', '=', orgId).executeTakeFirstOrThrow();
  return Number(r.n);
}

/** Call under lockOrg so concurrent creations cannot pass the limit together. */
export async function assertStudentCapacity(exec: Executor, orgId: string, ent: Entitlements, adding: number): Promise<void> {
  const max = ent.limits.max_students;
  if (max === 0) {
    throw new AppError(402, 'STUDENTS_NOT_ENABLED', 'Student accounts are not part of your plan yet. Contact us to turn them on for your school.', { limit: 'max_students', max: 0 });
  }
  if (max === null) return;
  const used = await countStudents(exec, orgId);
  if (used + adding > max) {
    throw limitReached(`Your plan allows ${max} student accounts (${used} in use)`, { limit: 'max_students', max, used, adding });
  }
}

export interface NewStudent {
  username: string;
  name: string;
  grade: number;
  scopeId: string | null;
}

export interface CreatedStudent extends NewStudent {
  userId: string;
  password: string;
}

/**
 * Creates student accounts in the school's tenant context (caller's transaction).
 * Passwords are generated here and returned once; only their hashes are stored.
 */
export async function createStudents(trx: Trx, orgId: string, locale: Locale, createdBy: string, list: NewStudent[]): Promise<CreatedStudent[]> {
  const passwords = list.map(() => generateStudentPassword());
  const hashes = await Promise.all(passwords.map((p) => hashPassword(p)));
  const out: CreatedStudent[] = [];
  for (const [i, s] of list.entries()) {
    const user = await trx
      .insertInto('users')
      .values({ kind: 'student', email: null, name: s.name, password_hash: hashes[i]!, locale })
      .returning('id')
      .executeTakeFirstOrThrow();
    await trx.insertInto('students').values({ user_id: user.id, org_id: orgId, username: s.username, grade: s.grade, scope_id: s.scopeId, created_by: createdBy }).execute();
    out.push({ ...s, userId: user.id, password: passwords[i]! });
  }
  return out;
}

export async function listStudents(exec: Executor, orgId: string) {
  const rows = await exec
    .selectFrom('students as s')
    .innerJoin('users as u', 'u.id', 's.user_id')
    .leftJoin('scopes as sc', 'sc.id', 's.scope_id')
    .select(['s.user_id', 's.username', 's.grade', 's.scope_id', 's.created_at', 'u.name', 'u.last_login_at', 'u.locked_until', 'sc.name as scopeName'])
    .where('s.org_id', '=', orgId)
    .orderBy('s.grade')
    .orderBy('s.username')
    .execute();
  const now = new Date();
  return rows.map((r) => ({
    userId: r.user_id,
    username: r.username,
    name: r.name,
    grade: r.grade,
    scopeId: r.scope_id,
    scopeName: r.scopeName,
    lastLoginAt: r.last_login_at,
    locked: Boolean(r.locked_until && r.locked_until > now),
    createdAt: r.created_at,
  }));
}

// ------------------------------------------------------------ CSV import

export interface ImportPlan {
  rows: (NewStudent & { line: number; scopeName: string | null })[];
  errors: { line: number; message: string }[];
}

const HEADER_ALIASES: Record<string, keyof NewStudent | 'scope'> = {
  username: 'username', user: 'username', 'اسم المستخدم': 'username',
  name: 'name', 'full name': 'name', الاسم: 'name',
  grade: 'grade', الصف: 'grade',
  scope: 'scope', curriculum: 'scope', النطاق: 'scope',
};

/**
 * Validates a roster (columns: username, name, grade, optional scope by name).
 * The import is all or nothing: any error and nothing is created.
 */
export function planStudentImport(records: string[][], existingUsernames: Set<string>, scopesByName: Map<string, string>): ImportPlan {
  const plan: ImportPlan = { rows: [], errors: [] };
  const [header, ...body] = records;
  if (!header) {
    plan.errors.push({ line: 1, message: 'The file is empty' });
    return plan;
  }
  const cols = header.map((c) => HEADER_ALIASES[c.trim().toLowerCase()]);
  for (const need of ['username', 'name', 'grade'] as const) {
    if (!cols.includes(need)) plan.errors.push({ line: 1, message: `Missing column "${need}"` });
  }
  if (plan.errors.length) return plan;
  if (!body.length) plan.errors.push({ line: 2, message: 'The file has no students' });
  if (body.length > MAX_IMPORT_ROWS) {
    plan.errors.push({ line: MAX_IMPORT_ROWS + 2, message: `At most ${MAX_IMPORT_ROWS} students per file. Split the file and import each part.` });
    return plan;
  }
  const seen = new Map<string, number>();
  for (const [i, rec] of body.entries()) {
    const line = i + 2;
    const cell = (k: (typeof cols)[number]) => (rec[cols.indexOf(k)] ?? '').trim();
    const username = zUsername.safeParse(cell('username'));
    const name = zStudentName.safeParse(cell('name'));
    const grade = zGrade.safeParse(cell('grade'));
    const scopeName = cols.includes('scope') ? cell('scope') : '';
    const problems: string[] = [];
    if (!username.success) problems.push(`username: ${username.error.issues[0]?.message ?? 'invalid'}`);
    if (!name.success) problems.push('name: required, at most 120 characters');
    if (!grade.success) problems.push('grade: a number from 1 to 12');
    const scopeId = scopeName ? scopesByName.get(scopeName.toLowerCase()) : null;
    if (scopeName && !scopeId) problems.push(`scope: no scope named "${scopeName}"`);
    if (username.success) {
      if (existingUsernames.has(username.data)) problems.push(`username "${username.data}" is already used at your school`);
      const first = seen.get(username.data);
      if (first) problems.push(`username "${username.data}" repeats line ${first}`);
      else seen.set(username.data, line);
    }
    if (problems.length) {
      plan.errors.push({ line, message: problems.join('; ') });
      continue;
    }
    plan.rows.push({ line, username: username.data!, name: name.data!, grade: grade.data!, scopeId: scopeId ?? null, scopeName: scopeName || null });
  }
  return plan;
}

// ------------------------------------------------------------ the student's own view

/** The books of the student's grade in the scope the school assigned (none until one is assigned). */
export async function studentCurriculum(exec: Executor, student: { grade: number; scope_id: string | null }) {
  const grade = gradeList().find((g) => g.grade === student.grade) ?? null;
  if (!student.scope_id) return { scope: null, grade, subjects: [] };
  const scope = await exec.selectFrom('scopes').select(['id', 'name', 'catalog_version_id']).where('id', '=', student.scope_id).executeTakeFirst();
  if (!scope) return { scope: null, grade, subjects: [] };
  const items = await exec.selectFrom('scope_items').select('material_id').where('scope_id', '=', scope.id).execute();
  const selected = new Set(items.map((i) => i.material_id));
  const tree = await loadCatalogTree(exec, scope.catalog_version_id, { allowUnpublished: false });
  const subjects = tree.subjects
    .filter((s) => s.grade === student.grade)
    .map((s) => ({
      id: s.id,
      track: s.track,
      block: s.block,
      nameEn: s.nameEn,
      nameAr: s.nameAr,
      status: s.status,
      materials: s.materials.filter((m) => selected.has(m.id)).map((m) => ({ id: m.id, kind: m.kind, title: m.title })),
    }))
    .filter((s) => s.materials.length > 0);
  return { scope: { id: scope.id, name: scope.name, academicYear: tree.version.academicYear }, grade, subjects };
}
