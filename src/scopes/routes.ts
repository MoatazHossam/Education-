import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { actorFromRequest, recordAudit, requestMeta } from '../audit/audit.js';
import { inOrg } from '../auth/guards.js';
import { assertScopeAvailable, assertScopeEditable, consumeUsage, getEntitlements, lockOrg, requireFeature } from '../billing/entitlements.js';
import { loadCatalogTree } from '../catalog/service.js';
import type { Executor } from '../db/index.js';
import type { AppContext } from '../http/context.js';
import { AppError, badRequest, conflict } from '../lib/errors.js';
import { parse, zUuid } from '../lib/validation.js';
import { planCarryForward } from './carry.js';
import { selectedRows, toCsv, toJson, toText } from './export.js';
import { getScope, listScopes, scopeMaterialIds } from './service.js';

const MAX_BATCH = 2000;
const ScopeParams = z.object({ orgId: z.string(), scopeId: z.string() });
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
    return inOrg(ctx, req, orgId, 'viewer', async (trx) => {
      const ent = await getEntitlements(trx, orgId, grace);
      const scopes = await listScopes(trx, orgId);
      const max = ent.limits.max_scopes;
      // Oldest scopes stay editable when an org holds more than its plan allows.
      return { scopes: scopes.map((s, i) => ({ ...s, readOnly: max !== null && i >= max })), limit: max };
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

  app.get('/api/orgs/:orgId/scopes/:scopeId', async (req) => {
    const { orgId, scopeId } = parse(ScopeParams, req.params);
    return inOrg(ctx, req, orgId, 'viewer', async (trx) => {
      const scope = await getScope(trx, orgId, scopeId);
      const materialIds = await scopeMaterialIds(trx, scope.id);
      return {
        scope: { id: scope.id, name: scope.name, description: scope.description, catalogVersionId: scope.catalog_version_id, createdAt: scope.created_at, updatedAt: scope.updated_at },
        materialIds,
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
        INSERT INTO scope_items (scope_id, org_id, catalog_version_id, material_id, added_by)
        SELECT ${copy.id}, org_id, catalog_version_id, material_id, ${user.id} FROM scope_items WHERE scope_id = ${source.id}`.execute(trx);
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
      return { scope: { id: scope.id, name: scope.name }, from: version(source), to: version(target), suggestedName: carriedName(scope.name, target.version.academicYear), plan };
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
          .values(items.map((id) => ({ scope_id: created.id, org_id: orgId, catalog_version_id: target.version.id, material_id: id, added_by: user.id })))
          .execute();
      }
      const summary = { mode: body.mode, from: scope.id, fromVersion: source.version.academicYear, toVersion: target.version.academicYear, carried: carried.length, added: add.length, skipped: skip.size, missing: plan.summary.missing };
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
      const rows = selectedRows(tree, new Set(await scopeMaterialIds(trx, scope.id)));
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
