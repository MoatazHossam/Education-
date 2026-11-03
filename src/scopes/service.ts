import type { Executor } from '../db/index.js';
import { notFound } from '../lib/errors.js';

export async function getScope(exec: Executor, orgId: string, scopeId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(scopeId)) throw notFound('Scope');
  const scope = await exec.selectFrom('scopes').selectAll().where('id', '=', scopeId).where('org_id', '=', orgId).executeTakeFirst();
  if (!scope) throw notFound('Scope');
  return scope;
}

export async function scopeMaterialIds(exec: Executor, scopeId: string): Promise<string[]> {
  const rows = await exec.selectFrom('scope_items').select('material_id').where('scope_id', '=', scopeId).execute();
  return rows.map((r) => r.material_id);
}

export async function listScopes(exec: Executor, orgId: string) {
  const rows = await exec
    .selectFrom('scopes as s')
    .innerJoin('catalog_versions as v', 'v.id', 's.catalog_version_id')
    .leftJoin('users as u', 'u.id', 's.created_by')
    .select((eb) => [
      's.id',
      's.name',
      's.description',
      's.catalog_version_id',
      's.created_at',
      's.updated_at',
      'v.academic_year',
      'u.name as createdBy',
      eb.selectFrom('scope_items as i').select((e) => e.fn.countAll<string>().as('n')).whereRef('i.scope_id', '=', 's.id').as('itemCount'),
      eb.selectFrom('teaching_plans as p').select((e) => e.fn.countAll<string>().as('n')).whereRef('p.scope_id', '=', 's.id').as('planCount'),
    ])
    .where('s.org_id', '=', orgId)
    .orderBy('s.created_at')
    .execute();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    catalogVersionId: r.catalog_version_id,
    academicYear: r.academic_year,
    itemCount: Number(r.itemCount ?? 0),
    planCount: Number(r.planCount ?? 0),
    createdBy: r.createdBy,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}
