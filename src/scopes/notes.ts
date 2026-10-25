import { sql } from 'kysely';
import type { Executor } from '../db/index.js';
import type { Locale } from '../db/types.js';
import { AppError } from '../lib/errors.js';
import { notify } from '../notifications/email.js';

// Per-item notes and assignees on a scope's selected books. Stored on
// scope_items, so they live and die with the selection (migration 0008).

export interface Annotation {
  materialId: string;
  note: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  annotatedAt: Date | null;
  annotatedBy: string | null;
}

/** Items of the scope that carry a note or an assignee. */
export async function scopeAnnotations(exec: Executor, scopeId: string): Promise<Annotation[]> {
  const rows = await exec
    .selectFrom('scope_items as i')
    .leftJoin('users as a', 'a.id', 'i.assignee_id')
    .leftJoin('users as b', 'b.id', 'i.annotated_by')
    .select(['i.material_id', 'i.note', 'i.assignee_id', 'i.annotated_at', 'a.name as assigneeName', 'b.name as annotatedBy'])
    .where('i.scope_id', '=', scopeId)
    .where((eb) => eb.or([eb('i.note', 'is not', null), eb('i.assignee_id', 'is not', null)]))
    .execute();
  return rows.map((r) => ({ materialId: r.material_id, note: r.note, assigneeId: r.assignee_id, assigneeName: r.assigneeName, annotatedAt: r.annotated_at, annotatedBy: r.annotatedBy }));
}

/** Note and assignee name per material, for exports. */
export async function annotationsForExport(exec: Executor, scopeId: string): Promise<Map<string, { note: string | null; assignee: string | null }>> {
  return new Map((await scopeAnnotations(exec, scopeId)).map((a) => [a.materialId, { note: a.note, assignee: a.assigneeName }]));
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

export async function assertMember(exec: Executor, orgId: string, userId: string): Promise<void> {
  const m = await exec.selectFrom('memberships').select('user_id').where('org_id', '=', orgId).where('user_id', '=', userId).executeTakeFirst();
  if (!m) throw new AppError(400, 'ASSIGNEE_NOT_MEMBER', 'Choose a member of your organization');
}

const ASSIGNED: Record<Locale, (p: { by: string; count: number; scope: string }) => { title: string; body: string }> = {
  en: (p) => ({ title: `${p.by} assigned you ${p.count} ${p.count === 1 ? 'book' : 'books'}`, body: `In the scope “${p.scope}”.` }),
  ar: (p) => ({ title: `أسند إليك ${p.by} كتبًا للمتابعة (${p.count})`, body: `في النطاق «${p.scope}».` }),
};

/** In-app notice to the new assignee, in their language; nothing when people assign themselves. */
export async function notifyAssigned(
  exec: Executor,
  p: { orgId: string; scope: { id: string; name: string }; assigneeId: string; byUserId: string; byName: string; count: number },
): Promise<void> {
  if (p.assigneeId === p.byUserId || p.count === 0) return;
  const to = await exec.selectFrom('users').select(['locale']).where('id', '=', p.assigneeId).executeTakeFirst();
  if (!to) return;
  const text = ASSIGNED[to.locale]({ by: p.byName, count: p.count, scope: p.scope.name });
  await notify(exec, { userId: p.assigneeId, orgId: p.orgId, kind: 'item_assigned', title: text.title, body: text.body, link: `/org/${p.orgId}/scopes/${p.scope.id}/items?show=mine` });
}
