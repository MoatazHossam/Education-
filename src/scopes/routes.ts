import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { actorFromRequest, recordAudit, requestMeta } from '../audit/audit.js';
import { hasRole, inOrg, requireUser } from '../auth/guards.js';
import { assertScopeAvailable, assertScopeEditable, consumeUsage, getEntitlements, lockOrg, requireFeature } from '../billing/entitlements.js';
import { loadCatalogTree } from '../catalog/service.js';
import { withUserContext, type Executor } from '../db/index.js';
import type { AppContext } from '../http/context.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { parse, zUuid } from '../lib/validation.js';
import { planCarryForward } from './carry.js';
import { compareScopes, comparisonCsv } from './compare.js';
import { selectedRows, toCsv, toJson, toText } from './export.js';
import { annotationCounts, annotationsForExport, assertMember, assignmentCounts, ITEM_STATUSES, myAssignments, notifyAssigned, scopeAnnotations, TRACKED_SQL } from './notes.js';
import { getScope, listScopes, scopeMaterialIds } from './service.js';

const MAX_BATCH = 2000;
const ScopeParams = z.object({ orgId: z.string(), scopeId: z.string() });
const ItemParams = ScopeParams.extend({ materialId: zUuid });
const zStatus = z.enum(ITEM_STATUSES);
const zDueOn = z.iso.date().refine((d) => d >= '2000-01-01' && d <= '2100-12-31', 'Choose a date between 2000 and 2100');
const NoteBody = z
  .object({ note: z.string().trim().max(500).nullable().optional(), assigneeId: zUuid.nullable().optional(), status: zStatus.nullable().optional(), dueOn: zDueOn.nullable().optional() })
  .refine((b) => b.note !== undefined || b.assigneeId !== undefined || b.status !== undefined || b.dueOn !== undefined, { message: 'Nothing to change', path: ['note'] });
const BulkBody = z
  .object({ materialIds: z.array(zUuid).min(1).max(MAX_BATCH), assigneeId: zUuid.nullable().optional(), status: zStatus.nullable().optional(), dueOn: zDueOn.nullable().optional() })
  .refine((b) => b.assigneeId !== undefined || b.status !== undefined || b.dueOn !== undefined, { message: 'Nothing to change', path: ['assigneeId'] });
const EMPTY_ANNOTATION = { note: null, assigneeId: null, assigneeName: null, status: null, dueOn: null, annotatedAt: null, annotatedBy: null };
const ScopeBody = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).nullable().optional(),
});

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === '23505';
}

async function assertPublishedVersion(exec: Executor, versionId: string): Promise<void> {
  const v = await exec.selectFrom('catalog_versions').select('status').where('id', '=', versionId).executeTakeFirst();
  if (!v || v.status !== 'published') throw badRequest('Choose a published catalogue version');
}

const CarryBody = z.object({
  targetVersionId: zUuid,
  mode: z.enum(['copy', 'move']).default('copy'),
  name: z.string().trim().min(1).max(120).optional(),
  // Target materials to add (e.g. a new edition replacing a missing book) or carried ones to leave out.
  add: z.array(zUuid).max(MAX_BATCH).default([]),
  skip: z.array(zUuid).max(MAX_BATCH).default([]),
});

/** "Grade 4 pilot (2026/2027)" → "Grade 4 pilot (2027/2028)". */
function carriedName(name: string, academicYear: string): string {
  const base = name.replace(/\s*\(\d{4}\/\d{4}\)$/, '');
  return `${base.slice(0, 120 - academicYear.length - 3)} (${academicYear})`;
}

async function carryPlanFor(exec: Executor, orgId: string, scopeId: string, targetVersionId: string) {
  const scope = await getScope(exec, orgId, scopeId);
  if (targetVersionId === scope.catalog_version_id) throw badRequest('The scope already uses this catalogue version');
  await assertPublishedVersion(exec, targetVersionId);
  const source = await loadCatalogTree(exec, scope.catalog_version_id, { allowUnpublished: true });
  const target = await loadCatalogTree(exec, targetVersionId);
  const plan = planCarryForward(source, target, new Set(await scopeMaterialIds(exec, scope.id)));
  return { scope, source, target, plan };
}

function safeFilename(name: string): string {
  return name.normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'scope';
}

export function registerScopeRoutes(app: FastifyInstance, ctx: AppContext): void {
  const grace = ctx.config.GRACE_DAYS;

  app.get('/api/orgs/:orgId/scopes', async (req) => {
    const { orgId } = parse(z.object({ orgId: z.string() }), req.params);
    return inOrg(ctx, req, orgId, 'viewer', async (trx, { user }) => {
      const ent = await getEntitlements(trx, orgId, grace);
      const scopes = await listScopes(trx, orgId);
      const counts = await annotationCounts(trx, orgId, user.id);
      const max = ent.limits.max_scopes;
      // Oldest scopes stay editable when an org holds more than its plan allows.
      return {
        scopes: scopes.map((s, i) => ({ ...s, readOnly: max !== null && i >= max, ...(counts.get(s.id) ?? { notes: 0, assigned: 0, assignedToMe: 0 }) })),
        limit: max,
      };
    });
  });

  app.post('/api/orgs/:orgId/scopes', async (req, reply) => {
    const { orgId } = parse(z.object({ orgId: z.string() }), req.params);
    const body = parse(ScopeBody.extend({ catalogVersionId: zUuid }), req.body);
    const scope = await inOrg(ctx, req, orgId, 'editor', async (trx, { user }) => {
      await lockOrg(trx, orgId);
      await assertScopeAvailable(trx, orgId, await getEntitlements(trx, orgId, grace));
      await assertPublishedVersion(trx, body.catalogVersionId);
      const created = await trx
        .insertInto('scopes')
        .values({ org_id: orgId, catalog_version_id: body.catalogVersionId, name: body.name, description: body.description ?? null, created_by: user.id })
        .returningAll()
        .executeTakeFirstOrThrow()
        .catch((err) => {
          throw isUniqueViolation(err) ? conflict('A scope with this name already exists', 'SCOPE_NAME_TAKEN') : err;
        });
      await recordAudit(trx, actorFromRequest(req), { orgId, action: 'scope.created', targetType: 'scope', targetId: created.id, metadata: { name: created.name } }, requestMeta(req));
      return created;
    });
    return reply.status(201).send({ scope: { id: scope.id, name: scope.name, description: scope.description, catalogVersionId: scope.catalog_version_id, itemCount: 0 } });
  });

  // Two scopes of the organization side by side. Across catalogue versions books are matched
  // by subject and title (match.ts). `format=csv` downloads it: needs CSV export on the plan,
  // and is counted and audited like other exports.
  app.get('/api/orgs/:orgId/scopes/compare', async (req, reply) => {
    const { orgId } = parse(z.object({ orgId: z.string() }), req.params);
    const q = parse(z.object({ a: zUuid, b: zUuid, format: z.enum(['json', 'csv']).default('json') }), req.query);
    if (q.a === q.b) throw badRequest('Choose two different scopes');
    const out = await inOrg(ctx, req, orgId, 'viewer', async (trx) => {
      const [a, b] = [await getScope(trx, orgId, q.a), await getScope(trx, orgId, q.b)];
      const treeA = await loadCatalogTree(trx, a.catalog_version_id, { allowUnpublished: true });
      const treeB = await loadCatalogTree(trx, b.catalog_version_id, { allowUnpublished: true });
      const cmp = compareScopes(treeA, new Set(await scopeMaterialIds(trx, a.id)), treeB, new Set(await scopeMaterialIds(trx, b.id)));
      if (q.format === 'csv') {
        const ent = await getEntitlements(trx, orgId, grace);
        requireFeature(ent, 'export_csv', 'CSV export');
        await consumeUsage(trx, orgId, 'exports', ent.limits.exports_per_month, 'exports');
        await recordAudit(trx, actorFromRequest(req), { orgId, action: 'scope.comparison_exported', targetType: 'scope', targetId: a.id, metadata: { with: b.id, ...cmp.summary } }, requestMeta(req));
      }
      const side = (s: typeof a, tree: typeof treeA) => ({ id: s.id, name: s.name, catalogVersionId: s.catalog_version_id, academicYear: tree.version.academicYear });
      return { a: side(a, treeA), b: side(b, treeB), ...cmp };
    });
    if (q.format === 'csv') {
      return reply.type('text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="compare-${safeFilename(out.a.name)}-${safeFilename(out.b.name)}.csv"`)
        .send(comparisonCsv(out, out.a, out.b));
    }
    return out;
  });

  app.get('/api/orgs/:orgId/scopes/:scopeId', async (req) => {
    const { orgId, scopeId } = parse(ScopeParams, req.params);
    return inOrg(ctx, req, orgId, 'viewer', async (trx) => {
      const scope = await getScope(trx, orgId, scopeId);
      const materialIds = await scopeMaterialIds(trx, scope.id);
      return {
        scope: { id: scope.id, name: scope.name, description: scope.description, catalogVersionId: scope.catalog_version_id, createdAt: scope.created_at, updatedAt: scope.updated_at },
        materialIds,
        annotations: await scopeAnnotations(trx, scope.id),
      };
    });
  });

  app.patch('/api/orgs/:orgId/scopes/:scopeId', async (req) => {
    const { orgId, scopeId } = parse(ScopeParams, req.params);
    const body = parse(ScopeBody.partial(), req.body);
    return inOrg(ctx, req, orgId, 'editor', async (trx) => {
      const scope = await getScope(trx, orgId, scopeId);
      await assertScopeEditable(trx, orgId, scope.id, await getEntitlements(trx, orgId, grace));
      const updated = await trx
        .updateTable('scopes')
        .set({ ...(body.name ? { name: body.name } : {}), ...(body.description !== undefined ? { description: body.description } : {}) })
        .where('id', '=', scope.id)
        .returningAll()
        .executeTakeFirstOrThrow()
        .catch((err) => {
          throw isUniqueViolation(err) ? conflict('A scope with this name already exists', 'SCOPE_NAME_TAKEN') : err;
        });
      await recordAudit(trx, actorFromRequest(req), { orgId, action: 'scope.updated', targetType: 'scope', targetId: scope.id, metadata: body }, requestMeta(req));
      return { scope: { id: updated.id, name: updated.name, description: updated.description } };
    });
  });

  app.delete('/api/orgs/:orgId/scopes/:scopeId', async (req) => {
    const { orgId, scopeId } = parse(ScopeParams, req.params);
    return inOrg(ctx, req, orgId, 'editor', async (trx) => {
      const scope = await getScope(trx, orgId, scopeId);
      await trx.deleteFrom('scopes').where('id', '=', scope.id).execute();
      await recordAudit(trx, actorFromRequest(req), { orgId, action: 'scope.deleted', targetType: 'scope', targetId: scope.id, metadata: { name: scope.name } }, requestMeta(req));
      return { status: 'deleted' };
    });
  });

  app.post('/api/orgs/:orgId/scopes/:scopeId/items', async (req) => {
    const { orgId, scopeId } = parse(ScopeParams, req.params);
    const body = parse(
      z
        .object({ add: z.array(zUuid).max(MAX_BATCH).default([]), remove: z.array(zUuid).max(MAX_BATCH).default([]) })
        .refine((b) => b.add.length + b.remove.length > 0, { message: 'Nothing to change', path: ['add'] }),
      req.body,
    );
    return inOrg(ctx, req, orgId, 'editor', async (trx, { user }) => {
      const scope = await getScope(trx, orgId, scopeId);
      await assertScopeEditable(trx, orgId, scope.id, await getEntitlements(trx, orgId, grace));
      const add = [...new Set(body.add)];
      if (add.length) {
        const valid = await trx.selectFrom('catalog_materials').select('id').where('version_id', '=', scope.catalog_version_id).where('id', 'in', add).execute();
        if (valid.length !== add.length) {
          const ok = new Set(valid.map((v) => v.id));
          throw new AppError(400, 'INVALID_MATERIALS', 'Some materials do not belong to this scope’s catalogue version', { invalid: add.filter((id) => !ok.has(id)) });
        }
        await trx
          .insertInto('scope_items')
          .values(add.map((id) => ({ scope_id: scope.id, org_id: orgId, catalog_version_id: scope.catalog_version_id, material_id: id, added_by: user.id })))
          .onConflict((oc) => oc.columns(['scope_id', 'material_id']).doNothing())
          .execute();
      }
      if (body.remove.length) {
        await trx.deleteFrom('scope_items').where('scope_id', '=', scope.id).where('material_id', 'in', [...new Set(body.remove)]).execute();
      }
      await trx.updateTable('scopes').set({ updated_at: sql`now()` }).where('id', '=', scope.id).execute();
      const count = await trx.selectFrom('scope_items').select((eb) => eb.fn.countAll<string>().as('n')).where('scope_id', '=', scope.id).executeTakeFirstOrThrow();
      await recordAudit(trx, actorFromRequest(req), { orgId, action: 'scope.items_updated', targetType: 'scope', targetId: scope.id, metadata: { added: add.length, removed: body.remove.length } }, requestMeta(req));
      return { itemCount: Number(count.n) };
    });
  });

  app.delete('/api/orgs/:orgId/scopes/:scopeId/items', async (req) => {
    const { orgId, scopeId } = parse(ScopeParams, req.params);
    return inOrg(ctx, req, orgId, 'editor', async (trx) => {
      const scope = await getScope(trx, orgId, scopeId);
      await assertScopeEditable(trx, orgId, scope.id, await getEntitlements(trx, orgId, grace));
      const res = await trx.deleteFrom('scope_items').where('scope_id', '=', scope.id).executeTakeFirst();
      await trx.updateTable('scopes').set({ updated_at: sql`now()` }).where('id', '=', scope.id).execute();
      await recordAudit(trx, actorFromRequest(req), { orgId, action: 'scope.cleared', targetType: 'scope', targetId: scope.id, metadata: { removed: Number(res.numDeletedRows) } }, requestMeta(req));
      return { itemCount: 0 };
    });
  });

  // Note, member responsible, status and due date of one selected book. Editors and above
  // change anything; the member a book is assigned to (any role) can update its status.
  app.patch('/api/orgs/:orgId/scopes/:scopeId/items/:materialId', async (req) => {
    const { orgId, scopeId, materialId } = parse(ItemParams, req.params);
    const body = parse(NoteBody, req.body);
    return inOrg(ctx, req, orgId, 'viewer', async (trx, { user, role, org }) => {
      const scope = await getScope(trx, orgId, scopeId);
      const item = await trx.selectFrom('scope_items').select(['note', 'assignee_id', 'status', 'due_on']).where('scope_id', '=', scope.id).where('material_id', '=', materialId).executeTakeFirst();
      if (!hasRole(role, 'editor')) {
        const statusOnly = body.note === undefined && body.assigneeId === undefined && body.dueOn === undefined;
        if (!item || !statusOnly || item.assignee_id !== user.id) throw forbidden();
      }
      await assertScopeEditable(trx, orgId, scope.id, await getEntitlements(trx, orgId, grace));
      if (!item) throw notFound('Item');
      if (body.assigneeId) await assertMember(trx, orgId, body.assigneeId);
      const next = {
        note: body.note === undefined ? item.note : body.note || null,
        assignee_id: body.assigneeId === undefined ? item.assignee_id : body.assigneeId,
        status: body.status === undefined ? item.status : body.status,
        due_on: body.dueOn === undefined ? item.due_on : body.dueOn,
      };
      const tracked = next.note !== null || next.assignee_id !== null || next.status !== null || next.due_on !== null;
      await trx
        .updateTable('scope_items')
        .set({ ...next, annotated_by: tracked ? user.id : null, annotated_at: tracked ? new Date() : null })
        .where('scope_id', '=', scope.id)
        .where('material_id', '=', materialId)
        .execute();
      await trx.updateTable('scopes').set({ updated_at: sql`now()` }).where('id', '=', scope.id).execute();
      // The note's text stays out of the audit log; what changed is recorded.
      const was = (a: unknown, b: unknown, v: unknown) => (a === b ? 'unchanged' : v);
      const changes = {
        note: was(next.note, item.note, next.note === null ? 'removed' : 'set'),
        assigneeId: was(next.assignee_id, item.assignee_id, next.assignee_id),
        status: was(next.status, item.status, next.status),
        dueOn: was(next.due_on, item.due_on, next.due_on),
      };
      await recordAudit(trx, actorFromRequest(req), { orgId, action: 'scope.item_annotated', targetType: 'scope', targetId: scope.id, metadata: { materialId, ...changes } }, requestMeta(req));
      if (next.assignee_id && next.assignee_id !== item.assignee_id) {
        await notifyAssigned(trx, { orgId, orgName: org.name, appUrl: ctx.config.APP_URL, scope, assigneeId: next.assignee_id, byUserId: user.id, byName: user.name, materialIds: [materialId] });
      }
      return { annotation: (await scopeAnnotations(trx, scope.id)).find((a) => a.materialId === materialId) ?? { materialId, ...EMPTY_ANNOTATION } };
    });
  });

  // Several selected books at once: assignee, status and/or due date (fields left out stay as
  // they are; notes are never touched). All books must be selected in the scope, or nothing changes.
  app.post('/api/orgs/:orgId/scopes/:scopeId/items/assign', async (req) => {
    const { orgId, scopeId } = parse(ScopeParams, req.params);
    const body = parse(BulkBody, req.body);
    return inOrg(ctx, req, orgId, 'editor', async (trx, { user, org }) => {
      const scope = await getScope(trx, orgId, scopeId);
      await assertScopeEditable(trx, orgId, scope.id, await getEntitlements(trx, orgId, grace));
      if (body.assigneeId) await assertMember(trx, orgId, body.assigneeId);
      const ids = [...new Set(body.materialIds)];
      const present = await trx.selectFrom('scope_items').select(['material_id', 'assignee_id', 'status', 'due_on']).where('scope_id', '=', scope.id).where('material_id', 'in', ids).execute();
      if (present.length !== ids.length) {
        const ok = new Set(present.map((p) => p.material_id));
        throw new AppError(400, 'INVALID_MATERIALS', 'Some books are not selected in this scope', { invalid: ids.filter((id) => !ok.has(id)) });
      }
      const differs = (p: (typeof present)[number]) =>
        (body.assigneeId !== undefined && p.assignee_id !== body.assigneeId) || (body.status !== undefined && p.status !== body.status) || (body.dueOn !== undefined && p.due_on !== body.dueOn);
      const changed = present.filter(differs).map((p) => p.material_id);
      if (changed.length) {
        await trx
          .updateTable('scope_items')
          .set({
            ...(body.assigneeId !== undefined ? { assignee_id: body.assigneeId } : {}),
            ...(body.status !== undefined ? { status: body.status } : {}),
            ...(body.dueOn !== undefined ? { due_on: body.dueOn } : {}),
          })
          .where('scope_id', '=', scope.id)
          .where('material_id', 'in', changed)
          .execute();
        // A row left with nothing to follow up carries no annotation stamp.
        await sql`
          UPDATE scope_items SET annotated_by = CASE WHEN ${TRACKED_SQL} THEN ${user.id}::uuid END,
                                 annotated_at = CASE WHEN ${TRACKED_SQL} THEN now() END
          WHERE scope_id = ${scope.id} AND material_id = ANY(${changed}::uuid[])`.execute(trx);
        await trx.updateTable('scopes').set({ updated_at: sql`now()` }).where('id', '=', scope.id).execute();
        const metadata = { count: changed.length, ...(body.assigneeId !== undefined ? { assigneeId: body.assigneeId } : {}), ...(body.status !== undefined ? { status: body.status } : {}), ...(body.dueOn !== undefined ? { dueOn: body.dueOn } : {}) };
        await recordAudit(trx, actorFromRequest(req), { orgId, action: body.assigneeId !== undefined ? 'scope.items_assigned' : 'scope.items_tracked', targetType: 'scope', targetId: scope.id, metadata }, requestMeta(req));
        if (body.assigneeId) {
          const newlyAssigned = present.filter((p) => p.assignee_id !== body.assigneeId).map((p) => p.material_id);
          await notifyAssigned(trx, { orgId, orgName: org.name, appUrl: ctx.config.APP_URL, scope, assigneeId: body.assigneeId, byUserId: user.id, byName: user.name, materialIds: newlyAssigned });
        }
      }
      return { updated: changed.length };
    });
  });

  const ShowQuery = z.object({ show: z.enum(['open', 'done', 'all']).default('open') });

  /** The member's books in one organization; books in scopes over the plan limit are read-only. */
  async function assignmentsIn(trx: Executor, orgId: string, userId: string, show: 'open' | 'done' | 'all') {
    const ent = await getEntitlements(trx, orgId, grace);
    const scopes = await listScopes(trx, orgId);
    const max = ent.limits.max_scopes;
    const readOnly = new Set(scopes.filter((_, i) => max !== null && i >= max).map((sc) => sc.id));
    const items = await myAssignments(trx, orgId, userId, show);
    return items.map((it) => ({ ...it, readOnly: readOnly.has(it.scopeId) }));
  }

  // Books assigned to the signed-in member across the organization's scopes.
  app.get('/api/orgs/:orgId/assignments', async (req) => {
    const { orgId } = parse(z.object({ orgId: z.string() }), req.params);
    const { show } = parse(ShowQuery, req.query);
    return inOrg(ctx, req, orgId, 'viewer', async (trx, { user, role }) => ({
      items: await assignmentsIn(trx, orgId, user.id, show),
      canEditAll: hasRole(role, 'editor'),
    }));
  });

  // The same across every organization the member belongs to. Each one is read
  // in its own tenant context through the checks of its own page (inOrg), so a
  // suspended organization, or one that asks this member for two-factor sign-in,
  // is listed as unavailable instead of read.
  app.get('/api/assignments', async (req) => {
    const { user } = requireUser(req);
    const { show } = parse(ShowQuery, req.query);
    const memberships = await withUserContext(ctx.db, user.id, (trx) =>
      trx.selectFrom('memberships as m').innerJoin('organizations as o', 'o.id', 'm.org_id').select(['o.id', 'o.name']).where('m.user_id', '=', user.id).orderBy('o.name').execute(),
    );
    const organizations: { id: string; name: string; open: number; overdue: number; dueSoon: number }[] = [];
    const unavailable: { id: string; name: string; reason: string }[] = [];
    const items = [];
    for (const m of memberships) {
      try {
        const found = await inOrg(ctx, req, m.id, 'viewer', async (trx) => ({
          items: await assignmentsIn(trx, m.id, user.id, show),
          counts: await assignmentCounts(trx, m.id, user.id),
        }));
        organizations.push({ id: m.id, name: m.name, ...found.counts });
        items.push(...found.items.map((it) => ({ orgId: m.id, orgName: m.name, ...it })));
      } catch (err) {
        if (!(err instanceof AppError) || (err.statusCode !== 403 && err.statusCode !== 404)) throw err;
        // 404: the membership ended meanwhile.
        if (err.statusCode === 403) unavailable.push({ id: m.id, name: m.name, reason: err.code });
      }
    }
    // As on each organization's page: done last, then by due date (none last), then organization, scope, grade, title.
    items.sort(
      (a, b) =>
        Number(a.status === 'done') - Number(b.status === 'done') ||
        (a.dueOn ?? '9999').localeCompare(b.dueOn ?? '9999') ||
        a.orgName.localeCompare(b.orgName) ||
        a.scopeName.localeCompare(b.scopeName) ||
        a.grade - b.grade ||
        a.title.localeCompare(b.title),
    );
    const counts = { open: 0, overdue: 0, dueSoon: 0 };
    for (const o of organizations) {
      counts.open += o.open;
      counts.overdue += o.overdue;
      counts.dueSoon += o.dueSoon;
    }
    return { items: items.slice(0, 2000), counts, organizations, unavailable };
  });

  app.post('/api/orgs/:orgId/scopes/:scopeId/duplicate', async (req, reply) => {
    const { orgId, scopeId } = parse(ScopeParams, req.params);
    const { name } = parse(z.object({ name: z.string().trim().min(1).max(120) }), req.body);
    const created = await inOrg(ctx, req, orgId, 'editor', async (trx, { user }) => {
      const source = await getScope(trx, orgId, scopeId);
      await lockOrg(trx, orgId);
      await assertScopeAvailable(trx, orgId, await getEntitlements(trx, orgId, grace));
      const copy = await trx
        .insertInto('scopes')
        .values({ org_id: orgId, catalog_version_id: source.catalog_version_id, name, description: source.description, created_by: user.id })
        .returningAll()
        .executeTakeFirstOrThrow()
        .catch((err) => {
          throw isUniqueViolation(err) ? conflict('A scope with this name already exists', 'SCOPE_NAME_TAKEN') : err;
        });
      await sql`
        INSERT INTO scope_items (scope_id, org_id, catalog_version_id, material_id, added_by, note, assignee_id, status, due_on, annotated_by, annotated_at)
        SELECT ${copy.id}, org_id, catalog_version_id, material_id, ${user.id}, note, assignee_id, status, due_on, annotated_by, annotated_at
        FROM scope_items WHERE scope_id = ${source.id}`.execute(trx);
      await recordAudit(trx, actorFromRequest(req), { orgId, action: 'scope.duplicated', targetType: 'scope', targetId: copy.id, metadata: { from: source.id, name } }, requestMeta(req));
      return copy;
    });
    return reply.status(201).send({ scope: { id: created.id, name: created.name } });
  });

  // Preview of carrying a scope to another published catalogue version (usually the next academic year).
  app.get('/api/orgs/:orgId/scopes/:scopeId/carry-forward', async (req) => {
    const { orgId, scopeId } = parse(ScopeParams, req.params);
    const { to } = parse(z.object({ to: zUuid }), req.query);
    return inOrg(ctx, req, orgId, 'viewer', async (trx) => {
      const { scope, source, target, plan } = await carryPlanFor(trx, orgId, scopeId, to);
      const version = (t: typeof source) => ({ id: t.version.id, academicYear: t.version.academicYear, label: t.version.label });
      // Notes and assignees follow carried books; those on books with no counterpart are not kept.
      const annotated = new Set((await scopeAnnotations(trx, scope.id)).map((a) => a.materialId));
      const missing = plan.subjects.flatMap((s) => s.missing.map((m) => m.fromId));
      const notesCarried = plan.subjects.flatMap((s) => s.carried).filter((c) => annotated.has(c.fromId)).length;
      const notesLost = missing.filter((id) => annotated.has(id)).length;
      return { scope: { id: scope.id, name: scope.name }, from: version(source), to: version(target), suggestedName: carriedName(scope.name, target.version.academicYear), plan, notes: { carried: notesCarried, lost: notesLost } };
    });
  });

  // Applies the plan: `copy` creates a new scope in the target version (counts toward the plan's
  // scope limit); `move` switches the scope itself to the target version and replaces its items.
  app.post('/api/orgs/:orgId/scopes/:scopeId/carry-forward', async (req, reply) => {
    const { orgId, scopeId } = parse(ScopeParams, req.params);
    const body = parse(CarryBody, req.body);
    const result = await inOrg(ctx, req, orgId, 'editor', async (trx, { user }) => {
      const { scope, source, target, plan } = await carryPlanFor(trx, orgId, scopeId, body.targetVersionId);
      const ent = await getEntitlements(trx, orgId, grace);
      const add = [...new Set(body.add)];
      if (add.length) {
        const valid = await trx.selectFrom('catalog_materials').select('id').where('version_id', '=', target.version.id).where('id', 'in', add).execute();
        if (valid.length !== add.length) {
          const ok = new Set(valid.map((v) => v.id));
          throw new AppError(400, 'INVALID_MATERIALS', 'Some materials do not belong to the target catalogue version', { invalid: add.filter((id) => !ok.has(id)) });
        }
      }
      const skip = new Set(body.skip);
      const carried = plan.subjects.flatMap((s) => s.carried.map((c) => c.toId)).filter((id) => !skip.has(id));
      const items = [...new Set([...carried, ...add])];
      // Read before a move deletes the old items: notes and assignees follow their carried books.
      const sourceNotes = new Map((await trx.selectFrom('scope_items').select(['material_id', 'note', 'assignee_id', 'status', 'due_on', 'annotated_by', 'annotated_at']).where('scope_id', '=', scope.id)
        .where((eb) => eb.or([eb('note', 'is not', null), eb('assignee_id', 'is not', null), eb('status', 'is not', null), eb('due_on', 'is not', null)])).execute()).map((r) => [r.material_id, r]));
      const noteFor = new Map(plan.subjects.flatMap((s) => s.carried).filter((c) => sourceNotes.has(c.fromId)).map((c) => [c.toId, sourceNotes.get(c.fromId)!]));

      let created: { id: string; name: string };
      if (body.mode === 'move') {
        await assertScopeEditable(trx, orgId, scope.id, ent);
        // Items reference the scope's version, so they go before the scope changes version.
        await trx.deleteFrom('scope_items').where('scope_id', '=', scope.id).execute();
        await trx.updateTable('scopes').set({ catalog_version_id: target.version.id, updated_at: sql`now()` }).where('id', '=', scope.id).execute();
        created = { id: scope.id, name: scope.name };
      } else {
        await lockOrg(trx, orgId);
        await assertScopeAvailable(trx, orgId, ent);
        created = await trx
          .insertInto('scopes')
          .values({ org_id: orgId, catalog_version_id: target.version.id, name: body.name ?? carriedName(scope.name, target.version.academicYear), description: scope.description, created_by: user.id })
          .returning(['id', 'name'])
          .executeTakeFirstOrThrow()
          .catch((err) => {
            throw isUniqueViolation(err) ? conflict('A scope with this name already exists', 'SCOPE_NAME_TAKEN') : err;
          });
      }
      if (items.length) {
        await trx
          .insertInto('scope_items')
          .values(items.map((id) => {
            const n = noteFor.get(id);
            return { scope_id: created.id, org_id: orgId, catalog_version_id: target.version.id, material_id: id, added_by: user.id, note: n?.note ?? null, assignee_id: n?.assignee_id ?? null, status: n?.status ?? null, due_on: n?.due_on ?? null, annotated_by: n?.annotated_by ?? null, annotated_at: n?.annotated_at ?? null };
          }))
          .execute();
      }
      const summary = { mode: body.mode, from: scope.id, fromVersion: source.version.academicYear, toVersion: target.version.academicYear, carried: carried.length, added: add.length, skipped: skip.size, missing: plan.summary.missing, notesCarried: items.filter((id) => noteFor.has(id)).length };
      await recordAudit(trx, actorFromRequest(req), { orgId, action: 'scope.carried_forward', targetType: 'scope', targetId: created.id, metadata: summary }, requestMeta(req));
      return { scope: { id: created.id, name: created.name, catalogVersionId: target.version.id }, itemCount: items.length, ...summary };
    });
    return reply.status(body.mode === 'copy' ? 201 : 200).send(result);
  });

  app.get('/api/orgs/:orgId/scopes/:scopeId/export', async (req, reply) => {
    const { orgId, scopeId } = parse(ScopeParams, req.params);
    const { format } = parse(z.object({ format: z.enum(['txt', 'csv', 'json']).default('txt') }), req.query);
    const out = await inOrg(ctx, req, orgId, 'viewer', async (trx) => {
      const scope = await getScope(trx, orgId, scopeId);
      const ent = await getEntitlements(trx, orgId, grace);
      if (format === 'csv') requireFeature(ent, 'export_csv', 'CSV export');
      if (format === 'json') requireFeature(ent, 'export_json', 'JSON export');
      await consumeUsage(trx, orgId, 'exports', ent.limits.exports_per_month, 'exports');
      const tree = await loadCatalogTree(trx, scope.catalog_version_id, { allowUnpublished: true });
      const rows = selectedRows(tree, new Set(await scopeMaterialIds(trx, scope.id)), await annotationsForExport(trx, scope.id));
      await recordAudit(trx, actorFromRequest(req), { orgId, action: 'scope.exported', targetType: 'scope', targetId: scope.id, metadata: { format, items: rows.length } }, requestMeta(req));
      return { scope, tree, rows };
    });
    const base = `${safeFilename(out.scope.name)}-${out.tree.version.academicYear.replace('/', '-')}`;
    if (format === 'csv') {
      return reply.type('text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="${base}.csv"`).send(toCsv(out.rows));
    }
    if (format === 'json') {
      return reply
        .type('application/json; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${base}.json"`)
        .send(toJson({ id: out.scope.id, name: out.scope.name, description: out.scope.description, updatedAt: out.scope.updated_at }, out.tree, out.rows));
    }
    return reply.type('text/plain; charset=utf-8').header('Content-Disposition', `attachment; filename="${base}.txt"`).send(toText(out.rows));
  });
}
