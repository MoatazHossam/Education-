import { sql } from 'kysely';
import type { Executor } from '../db/index.js';
import type { PlanFeatures, PlanLimits, Subscription, UsageMetric } from '../db/types.js';
import { featureUnavailable, limitReached } from '../lib/errors.js';
import { addDays, periodKey } from '../lib/time.js';
import { FREE_PLAN_ID } from './plans.js';

/** Classroom file storage per school when neither the plan nor an override sets max_storage_mb. */
export const DEFAULT_STORAGE_MB = 1024;

export interface Entitlements {
  planId: string;
  planName: string;
  /** Effective billing state as of now, computed even if the worker has not run yet. */
  state: 'trialing' | 'active' | 'past_due' | 'free';
  limits: PlanLimits;
  features: PlanFeatures;
  subscription: Subscription | null;
}

/**
 * The plan whose limits apply right now. Time-based transitions are evaluated
 * here as well as in the worker, so a delayed worker never extends access.
 */
export function effectivePlan(sub: Subscription | null | undefined, now: Date, graceDays: number): { planId: string; state: Entitlements['state'] } {
  if (!sub || sub.plan_id === FREE_PLAN_ID) return { planId: FREE_PLAN_ID, state: 'free' };
  if (sub.status === 'trialing') {
    return sub.trial_ends_at && sub.trial_ends_at > now ? { planId: sub.plan_id, state: 'trialing' } : { planId: FREE_PLAN_ID, state: 'free' };
  }
  if (sub.status === 'past_due') {
    return sub.grace_until && sub.grace_until > now ? { planId: sub.plan_id, state: 'past_due' } : { planId: FREE_PLAN_ID, state: 'free' };
  }
  // active
  if (!sub.current_period_end) return { planId: sub.plan_id, state: 'active' }; // manual / open-ended (e.g. enterprise)
  if (sub.current_period_end > now) return { planId: sub.plan_id, state: 'active' };
  if (sub.cancel_at_period_end) return { planId: FREE_PLAN_ID, state: 'free' };
  return addDays(sub.current_period_end, graceDays) > now ? { planId: sub.plan_id, state: 'past_due' } : { planId: FREE_PLAN_ID, state: 'free' };
}

export async function getEntitlements(exec: Executor, orgId: string, graceDays: number, now = new Date()): Promise<Entitlements> {
  const sub = (await exec.selectFrom('subscriptions').selectAll().where('org_id', '=', orgId).executeTakeFirst()) ?? null;
  const { planId, state } = effectivePlan(sub, now, graceDays);
  const plan = await exec.selectFrom('plans').selectAll().where('id', '=', planId).executeTakeFirstOrThrow();
  const overrides = state === 'free' ? {} : (sub?.limit_overrides ?? {});
  const limits = { ...plan.limits, ...overrides };
  // A plan row saved without max_students keeps the student portal off.
  if (limits.max_students === undefined) limits.max_students = 0;
  if (limits.max_storage_mb === undefined) limits.max_storage_mb = DEFAULT_STORAGE_MB;
  // AI assistance stays off until a platform administrator sets an allowance (docs/AI_LAYER.md).
  if (limits.ai_requests_per_month === undefined) limits.ai_requests_per_month = 0;
  return {
    planId,
    planName: plan.name,
    state,
    limits,
    features: plan.features,
    subscription: sub,
  };
}

export function requireFeature(ent: Entitlements, feature: keyof PlanFeatures, label: string): void {
  if (!ent.features[feature]) throw featureUnavailable(label);
}

/** Serialises limit checks for one organization (members, scopes) within the transaction. */
export async function lockOrg(exec: Executor, orgId: string): Promise<void> {
  await sql`SELECT id FROM organizations WHERE id = ${orgId} FOR UPDATE`.execute(exec);
}

export async function countSeats(exec: Executor, orgId: string): Promise<{ members: number; pendingInvites: number }> {
  const m = await exec.selectFrom('memberships').select((eb) => eb.fn.countAll<string>().as('n')).where('org_id', '=', orgId).executeTakeFirstOrThrow();
  const i = await exec
    .selectFrom('invitations')
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .where('org_id', '=', orgId)
    .where('accepted_at', 'is', null)
    .where('revoked_at', 'is', null)
    .where('expires_at', '>', new Date())
    .executeTakeFirstOrThrow();
  return { members: Number(m.n), pendingInvites: Number(i.n) };
}

export async function assertSeatAvailable(exec: Executor, orgId: string, ent: Entitlements): Promise<void> {
  const max = ent.limits.max_members;
  if (max === null) return;
  const { members, pendingInvites } = await countSeats(exec, orgId);
  if (members + pendingInvites >= max) {
    throw limitReached(`Your ${ent.planName} plan allows ${max} members (including pending invitations)`, { limit: 'max_members', max, used: members + pendingInvites });
  }
}

export async function countScopes(exec: Executor, orgId: string): Promise<number> {
  const r = await exec.selectFrom('scopes').select((eb) => eb.fn.countAll<string>().as('n')).where('org_id', '=', orgId).executeTakeFirstOrThrow();
  return Number(r.n);
}

export async function assertScopeAvailable(exec: Executor, orgId: string, ent: Entitlements): Promise<void> {
  const max = ent.limits.max_scopes;
  if (max === null) return;
  const used = await countScopes(exec, orgId);
  if (used >= max) throw limitReached(`Your ${ent.planName} plan allows ${max} content scope${max === 1 ? '' : 's'}`, { limit: 'max_scopes', max, used });
}

/**
 * After a downgrade an organization may hold more scopes than its plan allows.
 * Nothing is deleted: the oldest `max_scopes` stay editable and newer ones
 * become read-only until the organization upgrades or deletes some.
 */
export async function assertScopeEditable(exec: Executor, orgId: string, scopeId: string, ent: Entitlements): Promise<void> {
  const max = ent.limits.max_scopes;
  if (max === null) return;
  const editable = await exec
    .selectFrom('scopes')
    .select('id')
    .where('org_id', '=', orgId)
    .orderBy('created_at')
    .orderBy('id')
    .limit(max)
    .execute();
  if (!editable.some((s) => s.id === scopeId)) {
    throw limitReached(`This scope is read-only: your ${ent.planName} plan allows ${max} editable scope${max === 1 ? '' : 's'}`, { limit: 'max_scopes', max });
  }
}

/**
 * Atomically increments a monthly usage counter if it is below the limit.
 * The conditional upsert makes concurrent requests unable to exceed the limit.
 */
export async function consumeUsage(
  exec: Executor,
  orgId: string,
  metric: UsageMetric,
  limit: number | null,
  label: string,
): Promise<number> {
  if (limit === 0) throw limitReached(`Your plan does not include ${label}`, { limit: metric, max: 0 });
  const period = periodKey();
  const res = await sql<{ quantity: number }>`
    INSERT INTO usage_counters (org_id, metric, period, quantity)
    VALUES (${orgId}, ${metric}, ${period}, 1)
    ON CONFLICT (org_id, metric, period) DO UPDATE
      SET quantity = usage_counters.quantity + 1, updated_at = now()
      WHERE ${limit === null ? sql`true` : sql`usage_counters.quantity < ${limit}`}
    RETURNING quantity`.execute(exec);
  const row = res.rows[0];
  if (!row) throw limitReached(`Monthly ${label} limit reached (${limit})`, { limit: metric, max: limit, period });
  return row.quantity;
}

/**
 * Gives back one unit taken by consumeUsage in the same period, when the work it
 * paid for did not happen (an AI provider that failed before answering).
 */
export async function releaseUsage(exec: Executor, orgId: string, metric: UsageMetric, period: string): Promise<void> {
  await exec
    .updateTable('usage_counters')
    .set((eb) => ({ quantity: eb('quantity', '-', 1), updated_at: new Date() }))
    .where('org_id', '=', orgId)
    .where('metric', '=', metric)
    .where('period', '=', period)
    .where('quantity', '>', 0)
    .execute();
}

export async function usageFor(exec: Executor, orgId: string): Promise<Record<UsageMetric, number>> {
  const rows = await exec.selectFrom('usage_counters').select(['metric', 'quantity']).where('org_id', '=', orgId).where('period', '=', periodKey()).execute();
  const out = { exports: 0, api_requests: 0, ai_requests: 0 };
  for (const r of rows) out[r.metric] = r.quantity;
  return out;
}
