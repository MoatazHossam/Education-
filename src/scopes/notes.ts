import { sql, type NotNull } from 'kysely';
import type { Executor } from '../db/index.js';
import type { ItemStatus, Locale } from '../db/types.js';
import { AppError } from '../lib/errors.js';
import { enqueueEmail, notify } from '../notifications/email.js';

// Follow-up on a scope's selected books: a note, the member responsible, a
// status and a due date. Stored on scope_items, so they live and die with the
// selection (migrations 0008 and 0009).

export const ITEM_STATUSES = ['todo', 'in_progress', 'done'] as const satisfies readonly ItemStatus[];

/**
 * Due dates are calendar days for Egyptian schools: "today" and "overdue" use
 * Cairo's date, so a book due today is not overdue at 1 a.m. Cairo time.
 */
const TODAY = sql<string>`(now() AT TIME ZONE 'Africa/Cairo')::date`;
/** "Due soon": due today or in the next two days (the app's marker and the reminder emails). */
export const DUE_SOON_DAYS = 2;

export interface Annotation {
  materialId: string;
  note: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  status: ItemStatus | null;
  dueOn: string | null;
  annotatedAt: Date | null;
  annotatedBy: string | null;
}

/** A selected book counts as followed up when it has any of these. */
export const TRACKED_SQL = sql`(note IS NOT NULL OR assignee_id IS NOT NULL OR status IS NOT NULL OR due_on IS NOT NULL)`;

/** Items of the scope that carry a note, an assignee, a status or a due date. */
export async function scopeAnnotations(exec: Executor, scopeId: string): Promise<Annotation[]> {
  const rows = await exec
    .selectFrom('scope_items as i')
    .leftJoin('users as a', 'a.id', 'i.assignee_id')
    .leftJoin('users as b', 'b.id', 'i.annotated_by')
    .select(['i.material_id', 'i.note', 'i.assignee_id', 'i.status', 'i.due_on', 'i.annotated_at', 'a.name as assigneeName', 'b.name as annotatedBy'])
    .where('i.scope_id', '=', scopeId)
    .where((eb) => eb.or([eb('i.note', 'is not', null), eb('i.assignee_id', 'is not', null), eb('i.status', 'is not', null), eb('i.due_on', 'is not', null)]))
    .execute();
  return rows.map((r) => ({
    materialId: r.material_id,
    note: r.note,
    assigneeId: r.assignee_id,
    assigneeName: r.assigneeName,
    status: r.status,
    dueOn: r.due_on,
    annotatedAt: r.annotated_at,
    annotatedBy: r.annotatedBy,
  }));
}

export type ExportAnnotation = { note: string | null; assignee: string | null; status: ItemStatus | null; dueOn: string | null };

/** Follow-up fields per material, for exports. */
export async function annotationsForExport(exec: Executor, scopeId: string): Promise<Map<string, ExportAnnotation>> {
  return new Map((await scopeAnnotations(exec, scopeId)).map((a) => [a.materialId, { note: a.note, assignee: a.assigneeName, status: a.status, dueOn: a.dueOn }]));
}

/** Notes and assignees per scope, for the scopes list. */
export async function annotationCounts(exec: Executor, orgId: string, userId: string): Promise<Map<string, { notes: number; assigned: number; assignedToMe: number }>> {
  const { rows } = await sql<{ scope_id: string; notes: string; assigned: string; mine: string }>`
    SELECT scope_id,
           count(*) FILTER (WHERE note IS NOT NULL) AS notes,
           count(*) FILTER (WHERE assignee_id IS NOT NULL) AS assigned,
           count(*) FILTER (WHERE assignee_id = ${userId}) AS mine
    FROM scope_items
    WHERE org_id = ${orgId} AND (note IS NOT NULL OR assignee_id IS NOT NULL)
    GROUP BY scope_id`.execute(exec);
  return new Map(rows.map((r) => [r.scope_id, { notes: Number(r.notes), assigned: Number(r.assigned), assignedToMe: Number(r.mine) }]));
}

/** The member's open assignments in the organization (not done), and how many are overdue or due soon. */
export async function assignmentCounts(exec: Executor, orgId: string, userId: string): Promise<{ open: number; overdue: number; dueSoon: number }> {
  const { rows } = await sql<{ open: string; overdue: string; due_soon: string }>`
    SELECT count(*) AS open, count(*) FILTER (WHERE due_on < ${TODAY}) AS overdue,
           count(*) FILTER (WHERE due_on BETWEEN ${TODAY} AND ${TODAY} + ${DUE_SOON_DAYS}::int) AS due_soon
    FROM scope_items
    WHERE org_id = ${orgId} AND assignee_id = ${userId} AND status IS DISTINCT FROM 'done'`.execute(exec);
  return { open: Number(rows[0]?.open ?? 0), overdue: Number(rows[0]?.overdue ?? 0), dueSoon: Number(rows[0]?.due_soon ?? 0) };
}

/**
 * Books assigned to the member across the organization's scopes: open ones
 * first by due date (overdue first, no date last), then done ones.
 */
export async function myAssignments(exec: Executor, orgId: string, userId: string, show: 'open' | 'done' | 'all') {
  let q = exec
    .selectFrom('scope_items as i')
    .innerJoin('scopes as s', 's.id', 'i.scope_id')
    .innerJoin('catalog_versions as v', 'v.id', 's.catalog_version_id')
    .innerJoin('catalog_materials as m', 'm.id', 'i.material_id')
    .innerJoin('catalog_subjects as c', 'c.id', 'm.subject_id')
    .leftJoin('users as b', 'b.id', 'i.annotated_by')
    .select([
      'i.scope_id', 's.name as scopeName', 'v.academic_year', 'i.material_id', 'm.title', 'm.kind', 'c.grade', 'c.name_en', 'c.name_ar',
      'i.note', 'i.status', 'i.due_on', 'i.annotated_at', 'b.name as annotatedBy',
      sql<boolean>`coalesce(i.due_on < ${TODAY} AND i.status IS DISTINCT FROM 'done', false)`.as('overdue'),
    ])
    .where('i.org_id', '=', orgId)
    .where('i.assignee_id', '=', userId);
  if (show === 'open') q = q.where((eb) => eb.or([eb('i.status', 'is', null), eb('i.status', '!=', 'done')]));
  if (show === 'done') q = q.where('i.status', '=', 'done');
  const rows = await q
    .orderBy(sql`i.status IS NOT DISTINCT FROM 'done'`)
    .orderBy(sql`i.due_on ASC NULLS LAST`)
    .orderBy('s.name')
    .orderBy('c.grade')
    .orderBy('m.title')
    .limit(2000)
    .execute();
  return rows.map((r) => ({
    scopeId: r.scope_id,
    scopeName: r.scopeName,
    academicYear: r.academic_year,
    materialId: r.material_id,
    title: r.title,
    kind: r.kind,
    grade: r.grade,
    subjectEn: r.name_en,
    subjectAr: r.name_ar,
    note: r.note,
    status: r.status,
    dueOn: r.due_on,
    overdue: r.overdue,
    annotatedAt: r.annotated_at,
    annotatedBy: r.annotatedBy,
  }));
}

export async function assertMember(exec: Executor, orgId: string, userId: string): Promise<void> {
  const m = await exec.selectFrom('memberships').select('user_id').where('org_id', '=', orgId).where('user_id', '=', userId).executeTakeFirst();
  if (!m) throw new AppError(400, 'ASSIGNEE_NOT_MEMBER', 'Choose a member of your organization');
}

const ASSIGNED: Record<Locale, (p: { by: string; count: number; scope: string }) => { title: string; body: string }> = {
  en: (p) => ({ title: `${p.by} assigned you ${p.count} ${p.count === 1 ? 'book' : 'books'}`, body: `In the scope “${p.scope}”.` }),
  ar: (p) => ({ title: `أسند إليك ${p.by} كتبًا للمتابعة (${p.count})`, body: `في النطاق «${p.scope}».` }),
};

const EMAIL_LIST_MAX = 10;

/**
 * Tells the new assignee: an in-app notification and, unless they turned it
 * off, an email listing the books. Both in their language. Nothing when people
 * assign themselves.
 */
export async function notifyAssigned(
  exec: Executor,
  p: { orgId: string; orgName: string; appUrl: string; scope: { id: string; name: string }; assigneeId: string; byUserId: string; byName: string; materialIds: string[] },
): Promise<void> {
  const count = p.materialIds.length;
  if (p.assigneeId === p.byUserId || count === 0) return;
  const to = await exec
    .selectFrom('users')
    .select(['locale', 'email', 'assignment_emails', 'email_verified_at', 'status'])
    .where('id', '=', p.assigneeId)
    .where('kind', '=', 'staff')
    .$narrowType<{ email: NotNull }>()
    .executeTakeFirst();
  if (!to) return;
  const path = `/org/${p.orgId}/scopes/${p.scope.id}/items?show=mine`;
  const text = ASSIGNED[to.locale]({ by: p.byName, count, scope: p.scope.name });
  await notify(exec, { userId: p.assigneeId, orgId: p.orgId, kind: 'item_assigned', title: text.title, body: text.body, link: path });
  if (!to.assignment_emails || !to.email_verified_at || to.status !== 'active') return;
  const titles = await exec.selectFrom('catalog_materials').select('title').where('id', 'in', p.materialIds.slice(0, EMAIL_LIST_MAX)).orderBy('title').execute();
  const more = count - titles.length;
  const items = titles.map((t) => `• ${t.title}`).join('\n') + (more > 0 ? (to.locale === 'ar' ? `\n• و${more} غيرها` : `\n• and ${more} more`) : '');
  await enqueueEmail(exec, to.email, 'items_assigned', to.locale, {
    by: p.byName,
    count: String(count),
    scope: p.scope.name,
    orgName: p.orgName,
    items,
    link: `${p.appUrl}${path}`,
    settingsLink: `${p.appUrl}/account`,
  });
}
