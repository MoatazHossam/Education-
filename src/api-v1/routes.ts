import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { consumeUsage, getEntitlements, requireFeature } from '../billing/entitlements.js';
import { listPublishedVersions, loadCatalogTree } from '../catalog/service.js';
import { withOrgContext, withSystemContext, type Trx } from '../db/index.js';
import type { AppContext, AuthState } from '../http/context.js';
import { sha256Hex } from '../lib/crypto.js';
import { AppError, notFound, unauthorized } from '../lib/errors.js';
import { parse } from '../lib/validation.js';
import { selectedRows, toJson } from '../scopes/export.js';
import { getScope, listScopes, scopeMaterialIds } from '../scopes/service.js';

const KEY_RE = /^cs_live_[A-Za-z0-9_-]{43}$/;

/** Resolves `Authorization: Bearer cs_live_…`. Lookup by hash happens before the tenant is known (system context). */
export async function resolveApiKey(ctx: AppContext, req: FastifyRequest): Promise<AuthState> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const key = header.slice(7).trim();
  if (!KEY_RE.test(key)) return null;
  const row = await withSystemContext(ctx.db, (trx) =>
    trx
      .selectFrom('api_keys as k')
      .innerJoin('organizations as o', 'o.id', 'k.org_id')
      .select(['k.id', 'k.org_id', 'k.name', 'k.last_used_at', 'o.status'])
      .where('k.key_hash', '=', sha256Hex(key))
      .where('k.revoked_at', 'is', null)
      .executeTakeFirst(),
  );
  if (!row || row.status !== 'active') return null;
  if (!row.last_used_at || Date.now() - row.last_used_at.getTime() > 60_000) {
    await withSystemContext(ctx.db, (trx) => trx.updateTable('api_keys').set({ last_used_at: new Date() }).where('id', '=', row.id).execute());
  }
  return { kind: 'api_key', orgId: row.org_id, keyId: row.id, keyName: row.name };
}

export function registerApiV1Routes(app: FastifyInstance, ctx: AppContext): void {
  const grace = ctx.config.GRACE_DAYS;

  // Every v1 call: authenticated key, plan includes API access, monthly quota consumed.
  async function withApi<T>(req: FastifyRequest, fn: (trx: Trx, orgId: string) => Promise<T>): Promise<T> {
    const auth = req.auth;
    if (auth?.kind !== 'api_key') throw unauthorized('A valid API key is required (Authorization: Bearer cs_live_…)');
    return withOrgContext(ctx.db, { orgId: auth.orgId }, async (trx) => {
      const ent = await getEntitlements(trx, auth.orgId, grace);
      requireFeature(ent, 'api_access', 'API access');
      await consumeUsage(trx, auth.orgId, 'api_requests', ent.limits.api_requests_per_month, 'API requests');
      return fn(trx, auth.orgId);
    });
  }

  const rl = { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } };

  app.get('/api/v1/scopes', rl, async (req) => withApi(req, async (trx, orgId) => ({ scopes: await listScopes(trx, orgId) })));

  app.get('/api/v1/scopes/:scopeId', rl, async (req) => {
    const { scopeId } = parse(z.object({ scopeId: z.string() }), req.params);
    return withApi(req, async (trx, orgId) => {
      const scope = await getScope(trx, orgId, scopeId);
      const tree = await loadCatalogTree(trx, scope.catalog_version_id, { allowUnpublished: true });
      const rows = selectedRows(tree, new Set(await scopeMaterialIds(trx, scope.id)));
      return toJson({ id: scope.id, name: scope.name, description: scope.description, updatedAt: scope.updated_at }, tree, rows);
    });
  });

  app.get('/api/v1/catalog/versions', rl, async (req) => withApi(req, async (trx) => ({ versions: await listPublishedVersions(trx) })));

  app.get('/api/v1/catalog/versions/:id', rl, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    if (!z.uuid().safeParse(id).success) throw notFound('Catalog version');
    return withApi(req, (trx) => loadCatalogTree(trx, id));
  });

  app.all('/api/v1/*', async () => {
    throw new AppError(404, 'NOT_FOUND', 'Unknown API endpoint');
  });
}
