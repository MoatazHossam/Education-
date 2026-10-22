import { randomBytes, randomUUID } from 'node:crypto';
import { recordAudit, type AuditActor, type RequestMeta } from '../audit/audit.js';
import { FREE_PLAN_ID, TRIAL_PLAN_ID } from '../billing/plans.js';
import type { AppConfig } from '../config.js';
import { setOrgContext, type Trx } from '../db/index.js';
import type { Locale, Organization, User } from '../db/types.js';
import { addDays } from '../lib/time.js';

export function slugify(name: string): string {
  const base =
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/g, '') || 'org';
  return `${base}-${randomBytes(3).toString('hex')}`;
}

/**
 * Creates an organization owned by `owner` inside the caller's transaction and
 * switches the transaction into the new tenant's context. Each user gets one
 * free trial; later organizations start on the Free plan.
 */
export async function createOrganization(
  trx: Trx,
  config: AppConfig,
  input: { name: string; owner: Pick<User, 'id' | 'email' | 'trial_used'>; locale: Locale },
  meta: RequestMeta | null,
): Promise<{ org: Organization; trial: boolean }> {
  const orgId = randomUUID();
  await setOrgContext(trx, orgId, input.owner.id);
  const org = await trx
    .insertInto('organizations')
    .values({ id: orgId, name: input.name, slug: slugify(input.name), locale: input.locale, created_by: input.owner.id })
    .returningAll()
    .executeTakeFirstOrThrow();
  await trx.insertInto('memberships').values({ org_id: orgId, user_id: input.owner.id, role: 'owner' }).execute();

  const trial = config.TRIAL_DAYS > 0 && !input.owner.trial_used;
  await trx
    .insertInto('subscriptions')
    .values(
      trial
        ? { org_id: orgId, plan_id: TRIAL_PLAN_ID, status: 'trialing', trial_ends_at: addDays(new Date(), config.TRIAL_DAYS) }
        : { org_id: orgId, plan_id: FREE_PLAN_ID, status: 'active' },
    )
    .execute();
  if (trial) await trx.updateTable('users').set({ trial_used: true }).where('id', '=', input.owner.id).execute();

  const actor: AuditActor = { type: 'user', userId: input.owner.id, email: input.owner.email };
  await recordAudit(trx, actor, { orgId, action: 'org.created', targetType: 'organization', targetId: orgId, metadata: { name: input.name, trial } }, meta);
  return { org, trial };
}
