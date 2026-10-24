import type { FastifyInstance, FastifyRequest } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { recordAudit, requestMeta, type AuditActor } from '../audit/audit.js';
import { requirePlatformAdmin } from '../auth/guards.js';
import { revokeUserSessions } from '../auth/sessions.js';
import { effectivePlan } from '../billing/entitlements.js';
import { FREE_PLAN_ID } from '../billing/plans.js';
import { publicPlan } from '../billing/routes.js';
import { markInvoicePaid } from '../billing/service.js';
import { notifyFlaggedForReview, notifyScopesBehind } from '../catalog/notify.js';
import { invalidateCatalogCache, loadCatalogTree } from '../catalog/service.js';
import { checkDatabase, withSystemContext, type Trx } from '../db/index.js';
import { pendingMigrations } from '../db/migrator.js';
import type { AppContext } from '../http/context.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { addInterval } from '../lib/time.js';
import { parse, zUuid } from '../lib/validation.js';
import { selectedRows } from '../scopes/export.js';
import { getScope, listScopes, scopeMaterialIds } from '../scopes/service.js';

const nullableCount = z.number().int().min(0).nullable();
const LimitsSchema = z.object({
  max_members: nullableCount,
  max_scopes: nullableCount,
  exports_per_month: nullableCount,
  api_requests_per_month: nullableCount,
  audit_log_days: z.number().int().min(1).max(3650),
});
const FeaturesSchema = z.object({
  export_csv: z.boolean(),
  export_json: z.boolean(),
  api_access: z.boolean(),
  require_mfa_policy: z.boolean(),
  priority_support: z.boolean(),
});
const SubjectBody = z.object({
  grade: z.number().int().min(1).max(12),
  track: z.enum(['moe', 'sec', 'bac', 'ta', 'intl']),
  block: z.string().trim().min(1).max(300),
  code: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
  nameEn: z.string().trim().min(1).max(200),
  nameAr: z.string().trim().min(1).max(200),
  status: z.enum(['scored', 'pass', 'act']),
  note: z.string().trim().max(1000).nullable().optional(),
  sortOrder: z.number().int().min(0).max(100_000).optional(),
});
const MaterialBody = z.object({
  kind: z.enum(['moe', 'lang', 'ext', 'prog', 'exam']),
  title: z.string().trim().min(1).max(300),
  sortOrder: z.number().int().min(0).max(1000).optional(),
});
const VerificationBody = z
  .object({
    subjectIds: z.array(zUuid).max(500).default([]),
    materialIds: z.array(zUuid).max(2000).default([]),
    status: z.enum(['unverified', 'verified', 'needs_review']),
    source: z.string().trim().min(1).max(300).optional(),
    url: z.url().max(2000).regex(/^https?:\/\//).optional(),
    note: z.string().trim().min(1).max(1000).optional(),
  })
  .refine((b) => b.subjectIds.length + b.materialIds.length > 0, { message: 'Choose at least one subject or material', path: ['subjectIds'] })
  .refine((b) => b.status !== 'verified' || b.source, { message: 'A verified entry needs the source it was checked against', path: ['source'] })
  .refine((b) => b.status !== 'needs_review' || b.note, { message: 'Explain what needs review', path: ['note'] });

// Content edits invalidate an entry's verification: it attested the previous content.
const UNVERIFIED = { verification_status: 'unverified', verification_source: null, verification_url: null, verification_note: null, reviewed_by: null, reviewed_at: null } as const;

function adminActor(req: FastifyRequest): AuditActor {
  const { user } = requirePlatformAdmin(req);
  return { type: 'platform_admin', userId: user.id, email: user.email };
}

async function draftVersionOf(trx: Trx, versionId: string) {
  const v = await trx.selectFrom('catalog_versions').selectAll().where('id', '=', versionId).executeTakeFirst();
  if (!v) throw notFound('Catalog version');
  if (v.status !== 'draft') throw conflict('Published catalogue versions are read-only. Create a new draft version.', 'VERSION_NOT_DRAFT');
  return v;
}

export function registerAdminRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, config } = ctx;
  // Every handler below is a platform-level, cross-tenant operation and therefore
  // runs in an explicit system context after requirePlatformAdmin (MFA enforced).
  const sys = <T>(fn: (trx: Trx) => Promise<T>) => withSystemContext(db, fn);

  // ------------------------------------------------------------ overview & health
  app.get('/api/admin/overview', async (req) => {
    requirePlatformAdmin(req);
    return sys(async (trx) => {
      const now = new Date();
      const [orgs, users, subs, plans, revenue, outbox, failedEvents, signups] = await Promise.all([
        trx.selectFrom('organizations').select(['status', (eb) => eb.fn.countAll<string>().as('n')]).groupBy('status').execute(),
        trx.selectFrom('users').select([(eb) => eb.fn.countAll<string>().as('total'), sql<string>`count(*) FILTER (WHERE email_verified_at IS NOT NULL)`.as('verified'), sql<string>`count(*) FILTER (WHERE status = 'suspended')`.as('suspended')]).executeTakeFirstOrThrow(),
        trx.selectFrom('subscriptions').selectAll().execute(),
        trx.selectFrom('plans').selectAll().execute(),
        trx.selectFrom('invoices').select([sql<string>`coalesce(sum(amount_cents), 0)`.as('cents'), (eb) => eb.fn.countAll<string>().as('n')]).where('status', '=', 'paid').where('paid_at', '>=', new Date(now.getTime() - 30 * 86_400_000)).executeTakeFirstOrThrow(),
        trx.selectFrom('email_outbox').select(['status', (eb) => eb.fn.countAll<string>().as('n')]).where('status', 'in', ['pending', 'failed']).groupBy('status').execute(),
        trx.selectFrom('billing_events').select((eb) => eb.fn.countAll<string>().as('n')).where('status', '=', 'failed').where('received_at', '>=', new Date(now.getTime() - 7 * 86_400_000)).executeTakeFirstOrThrow(),
        trx.selectFrom('organizations').select((eb) => eb.fn.countAll<string>().as('n')).where('created_at', '>=', new Date(now.getTime() - 30 * 86_400_000)).executeTakeFirstOrThrow(),
      ]);
      const planById = new Map(plans.map((p) => [p.id, p]));
      const byPlan: Record<string, number> = {};
      const byState: Record<string, number> = {};
      let mrrCents = 0;
      for (const s of subs) {
        const eff = effectivePlan(s, now, config.GRACE_DAYS);
        byPlan[eff.planId] = (byPlan[eff.planId] ?? 0) + 1;
        byState[eff.state] = (byState[eff.state] ?? 0) + 1;
        const plan = planById.get(eff.planId);
        if (plan && (eff.state === 'active' || eff.state === 'past_due') && s.current_period_end) {
          mrrCents += s.billing_interval === 'year' ? Math.round((plan.price_yearly_cents ?? 0) / 12) : plan.price_monthly_cents;
        }
      }
      return {
        organizations: Object.fromEntries(orgs.map((o) => [o.status, Number(o.n)])),
        users: { total: Number(users.total), verified: Number(users.verified), suspended: Number(users.suspended) },
        subscriptions: { byPlan, byState },
        revenue: { mrrCents, last30DaysCents: Number(revenue.cents), paidInvoicesLast30Days: Number(revenue.n), currency: config.BILLING_CURRENCY },
        operations: { outbox: Object.fromEntries(outbox.map((o) => [o.status, Number(o.n)])), failedWebhooksLast7Days: Number(failedEvents.n) },
        growth: { newOrganizationsLast30Days: Number(signups.n) },
      };
    });
  });

  app.get('/api/admin/health', async (req) => {
    requirePlatformAdmin(req);
    const dbCheck = await checkDatabase(db);
    const pending = dbCheck.ok ? await pendingMigrations(db) : [];
    const beats = dbCheck.ok ? await db.selectFrom('worker_heartbeats').selectAll().execute() : [];
    const mem = process.memoryUsage();
    return {
      database: dbCheck,
      migrations: { pending },
      workers: beats.map((b) => ({ name: b.name, lastBeatAt: b.last_beat_at, ageSeconds: Math.round((Date.now() - b.last_beat_at.getTime()) / 1000), details: b.details })),
      process: { uptimeSeconds: Math.round(process.uptime()), rssMb: Math.round(mem.rss / 1_048_576), heapUsedMb: Math.round(mem.heapUsed / 1_048_576), node: process.version },
      billingProvider: ctx.payments?.name ?? 'disabled',
    };
  });

  // ------------------------------------------------------------ organizations
  app.get('/api/admin/orgs', async (req) => {
    requirePlatformAdmin(req);
    const q = parse(z.object({ q: z.string().trim().max(100).optional(), status: z.enum(['active', 'suspended']).optional(), limit: z.coerce.number().int().min(1).max(100).default(50), offset: z.coerce.number().int().min(0).default(0) }), req.query);
    return sys(async (trx) => {
      let query = trx
        .selectFrom('organizations as o')
        .leftJoin('subscriptions as s', 's.org_id', 'o.id')
        .select((eb) => [
          'o.id', 'o.name', 'o.slug', 'o.status', 'o.created_at', 's.plan_id', 's.status as sub_status', 's.trial_ends_at', 's.current_period_end', 's.grace_until', 's.cancel_at_period_end',
          eb.selectFrom('memberships as m').select((e) => e.fn.countAll<string>().as('n')).whereRef('m.org_id', '=', 'o.id').as('members'),
          eb.selectFrom('scopes as sc').select((e) => e.fn.countAll<string>().as('n')).whereRef('sc.org_id', '=', 'o.id').as('scopes'),
        ])
        .orderBy('o.created_at', 'desc')
        .limit(q.limit)
        .offset(q.offset);
      if (q.q) query = query.where((eb) => eb.or([eb('o.name', 'ilike', `%${q.q!.replace(/[%_\\]/g, '\\$&')}%`), eb('o.slug', 'ilike', `%${q.q!.replace(/[%_\\]/g, '\\$&')}%`)]));
      if (q.status) query = query.where('o.status', '=', q.status);
      const rows = await query.execute();
      const now = new Date();
      return {
        organizations: rows.map((r) => {
          const eff = r.plan_id ? effectivePlan({ plan_id: r.plan_id, status: r.sub_status!, trial_ends_at: r.trial_ends_at, current_period_end: r.current_period_end, grace_until: r.grace_until, cancel_at_period_end: r.cancel_at_period_end ?? false } as never, now, config.GRACE_DAYS) : { planId: FREE_PLAN_ID, state: 'free' };
          return { id: r.id, name: r.name, slug: r.slug, status: r.status, createdAt: r.created_at, planId: eff.planId, billingState: eff.state, members: Number(r.members ?? 0), scopes: Number(r.scopes ?? 0) };
        }),
      };
    });
  });

  app.get('/api/admin/orgs/:orgId', async (req) => {
    requirePlatformAdmin(req);
    const { orgId } = parse(z.object({ orgId: zUuid }), req.params);
    return sys(async (trx) => {
      const org = await trx.selectFrom('organizations').selectAll().where('id', '=', orgId).executeTakeFirst();
      if (!org) throw notFound('Organization');
      const [sub, members, invoices, grants, scopeCount] = await Promise.all([
        trx.selectFrom('subscriptions').selectAll().where('org_id', '=', orgId).executeTakeFirst(),
        trx.selectFrom('memberships as m').innerJoin('users as u', 'u.id', 'm.user_id').select(['u.id', 'u.name', 'u.email', 'u.status', 'u.mfa_enabled', 'm.role']).where('m.org_id', '=', orgId).execute(),
        trx.selectFrom('invoices').selectAll().where('org_id', '=', orgId).orderBy('created_at', 'desc').limit(20).execute(),
        trx.selectFrom('support_access_grants').selectAll().where('org_id', '=', orgId).where('revoked_at', 'is', null).where('expires_at', '>', new Date()).execute(),
        trx.selectFrom('scopes').select((eb) => eb.fn.countAll<string>().as('n')).where('org_id', '=', orgId).executeTakeFirstOrThrow(),
      ]);
      const eff = effectivePlan(sub ?? null, new Date(), config.GRACE_DAYS);
      return {
        organization: { id: org.id, name: org.name, slug: org.slug, status: org.status, suspendedReason: org.suspended_reason, locale: org.locale, createdAt: org.created_at },
        subscription: sub ? { planId: sub.plan_id, status: sub.status, interval: sub.billing_interval, trialEndsAt: sub.trial_ends_at, currentPeriodStart: sub.current_period_start, currentPeriodEnd: sub.current_period_end, cancelAtPeriodEnd: sub.cancel_at_period_end, graceUntil: sub.grace_until, pendingPlanId: sub.pending_plan_id, limitOverrides: sub.limit_overrides, effectivePlanId: eff.planId, state: eff.state } : null,
        members: members.map((m) => ({ userId: m.id, name: m.name, email: m.email, status: m.status, mfaEnabled: m.mfa_enabled, role: m.role })),
        invoices: invoices.map((i) => ({ id: i.id, number: i.number, kind: i.kind, planId: i.plan_id, amountCents: i.amount_cents, currency: i.currency, status: i.status, createdAt: i.created_at, paidAt: i.paid_at })),
        scopeCount: Number(scopeCount.n),
        activeSupportGrants: grants.map((g) => ({ id: g.id, reason: g.reason, expiresAt: g.expires_at })),
      };
    });
  });

  app.post('/api/admin/orgs/:orgId/suspend', async (req) => {
    const actor = adminActor(req);
    const { orgId } = parse(z.object({ orgId: zUuid }), req.params);
    const { reason } = parse(z.object({ reason: z.string().trim().min(3).max(500) }), req.body);
    return sys(async (trx) => {
      const res = await trx.updateTable('organizations').set({ status: 'suspended', suspended_reason: reason }).where('id', '=', orgId).executeTakeFirst();
      if (!Number(res.numUpdatedRows)) throw notFound('Organization');
      await recordAudit(trx, actor, { orgId, action: 'admin.org_suspended', targetType: 'organization', targetId: orgId, metadata: { reason } }, requestMeta(req));
      return { status: 'suspended' };
    });
  });

  app.post('/api/admin/orgs/:orgId/unsuspend', async (req) => {
    const actor = adminActor(req);
    const { orgId } = parse(z.object({ orgId: zUuid }), req.params);
    return sys(async (trx) => {
      const res = await trx.updateTable('organizations').set({ status: 'active', suspended_reason: null }).where('id', '=', orgId).executeTakeFirst();
      if (!Number(res.numUpdatedRows)) throw notFound('Organization');
      await recordAudit(trx, actor, { orgId, action: 'admin.org_unsuspended', targetType: 'organization', targetId: orgId }, requestMeta(req));
      return { status: 'active' };
    });
  });

  // Manual plan assignment (enterprise contracts, goodwill extensions, corrections).
  app.patch('/api/admin/orgs/:orgId/subscription', async (req) => {
    const actor = adminActor(req);
    const { orgId } = parse(z.object({ orgId: zUuid }), req.params);
    const body = parse(
      z.object({
        planId: z.string().regex(/^[a-z][a-z0-9_]{1,30}$/).optional(),
        status: z.enum(['active', 'trialing']).optional(),
        interval: z.enum(['month', 'year']).optional(),
        currentPeriodEnd: z.iso.datetime().nullable().optional(),
        trialEndsAt: z.iso.datetime().optional(),
        limitOverrides: LimitsSchema.partial().optional(),
      }),
      req.body,
    );
    return sys(async (trx) => {
      const sub = await trx.selectFrom('subscriptions').selectAll().where('org_id', '=', orgId).forUpdate().executeTakeFirst();
      if (!sub) throw notFound('Subscription');
      if (body.planId && !(await trx.selectFrom('plans').select('id').where('id', '=', body.planId).executeTakeFirst())) throw badRequest('Unknown plan');
      const status = body.status ?? sub.status;
      if (status === 'trialing' && !body.trialEndsAt && !sub.trial_ends_at) throw badRequest('trialEndsAt is required for a trial');
      const now = new Date();
      await trx
        .updateTable('subscriptions')
        .set({
          ...(body.planId ? { plan_id: body.planId } : {}),
          ...(body.interval ? { billing_interval: body.interval } : {}),
          status,
          ...(body.trialEndsAt ? { trial_ends_at: new Date(body.trialEndsAt) } : {}),
          ...(body.currentPeriodEnd !== undefined ? { current_period_end: body.currentPeriodEnd ? new Date(body.currentPeriodEnd) : null, current_period_start: body.currentPeriodEnd ? now : null } : {}),
          ...(status === 'active' ? { grace_until: null } : {}),
          ...(body.limitOverrides ? { limit_overrides: JSON.stringify(body.limitOverrides) } : {}),
        })
        .where('id', '=', sub.id)
        .execute();
      await recordAudit(trx, actor, { orgId, action: 'admin.subscription_changed', targetType: 'subscription', targetId: sub.id, metadata: { before: { planId: sub.plan_id, status: sub.status, periodEnd: sub.current_period_end }, change: body } }, requestMeta(req));
      return { status: 'updated' };
    });
  });

  // Manual invoice for offline payment (bank transfer, enterprise PO).
  app.post('/api/admin/orgs/:orgId/invoices', async (req, reply) => {
    const actor = adminActor(req);
    const { orgId } = parse(z.object({ orgId: zUuid }), req.params);
    const body = parse(z.object({ planId: z.string(), interval: z.enum(['month', 'year']), amountCents: z.number().int().min(0).max(1_000_000_000), periodStart: z.iso.datetime().optional(), markPaid: z.boolean().default(false) }), req.body);
    const invoice = await sys(async (trx) => {
      const plan = await trx.selectFrom('plans').selectAll().where('id', '=', body.planId).executeTakeFirst();
      if (!plan) throw badRequest('Unknown plan');
      const org = await trx.selectFrom('organizations').select('id').where('id', '=', orgId).executeTakeFirst();
      if (!org) throw notFound('Organization');
      const start = body.periodStart ? new Date(body.periodStart) : new Date();
      const { rows } = await sql<{ n: string }>`SELECT nextval('invoice_number_seq') AS n`.execute(trx);
      const inv = await trx
        .insertInto('invoices')
        .values({ org_id: orgId, number: `INV-${start.getUTCFullYear()}-${String(rows[0]!.n).padStart(6, '0')}`, kind: 'manual', plan_id: plan.id, billing_interval: body.interval, amount_cents: body.amountCents, currency: plan.currency, period_start: start, period_end: addInterval(start, body.interval), due_at: start, provider: 'manual' })
        .returningAll()
        .executeTakeFirstOrThrow();
      await recordAudit(trx, actor, { orgId, action: 'admin.invoice_created', targetType: 'invoice', targetId: inv.id, metadata: { amount: body.amountCents, planId: plan.id, markPaid: body.markPaid } }, requestMeta(req));
      if (body.markPaid) await markInvoicePaid(trx, config, inv, actor);
      return inv;
    });
    return reply.status(201).send({ invoice: { id: invoice.id, number: invoice.number } });
  });

  app.post('/api/admin/invoices/:id/mark-paid', async (req) => {
    const actor = adminActor(req);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    return sys(async (trx) => {
      const inv = await trx.selectFrom('invoices').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!inv) throw notFound('Invoice');
      if (inv.status !== 'open') throw conflict(`Invoice is ${inv.status}`, 'INVOICE_NOT_OPEN');
      await markInvoicePaid(trx, config, inv, actor);
      return { status: 'paid' };
    });
  });

  // ------------------------------------------------------------ users
  app.get('/api/admin/users', async (req) => {
    requirePlatformAdmin(req);
    const q = parse(z.object({ q: z.string().trim().max(100).optional(), limit: z.coerce.number().int().min(1).max(100).default(50), offset: z.coerce.number().int().min(0).default(0) }), req.query);
    return sys(async (trx) => {
      let query = trx
        .selectFrom('users')
        .select(['id', 'email', 'name', 'status', 'is_platform_admin', 'email_verified_at', 'mfa_enabled', 'last_login_at', 'locked_until', 'created_at'])
        .orderBy('created_at', 'desc')
        .limit(q.limit)
        .offset(q.offset);
      if (q.q) {
        const like = `%${q.q.replace(/[%_\\]/g, '\\$&')}%`;
        query = query.where((eb) => eb.or([eb('email', 'ilike', like), eb('name', 'ilike', like)]));
      }
      const rows = await query.execute();
      return { users: rows.map((u) => ({ id: u.id, email: u.email, name: u.name, status: u.status, isPlatformAdmin: u.is_platform_admin, emailVerified: Boolean(u.email_verified_at), mfaEnabled: u.mfa_enabled, lastLoginAt: u.last_login_at, lockedUntil: u.locked_until, createdAt: u.created_at })) };
    });
  });

  for (const action of ['suspend', 'unsuspend'] as const) {
    app.post(`/api/admin/users/:id/${action}`, async (req) => {
      const actor = adminActor(req);
      const { id } = parse(z.object({ id: zUuid }), req.params);
      const body = parse(z.object({ reason: z.string().trim().max(500).optional() }), req.body);
      if (id === actor.userId) throw forbidden('You cannot change your own account status');
      return sys(async (trx) => {
        const res = await trx.updateTable('users').set({ status: action === 'suspend' ? 'suspended' : 'active' }).where('id', '=', id).executeTakeFirst();
        if (!Number(res.numUpdatedRows)) throw notFound('User');
        if (action === 'suspend') await revokeUserSessions(trx, id);
        await recordAudit(trx, actor, { action: `admin.user_${action}ed`, targetType: 'user', targetId: id, metadata: { reason: body.reason ?? null } }, requestMeta(req));
        return { status: action === 'suspend' ? 'suspended' : 'active' };
      });
    });
  }

  app.post('/api/admin/users/:id/unlock', async (req) => {
    const actor = adminActor(req);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    return sys(async (trx) => {
      const res = await trx.updateTable('users').set({ locked_until: null, failed_login_count: 0 }).where('id', '=', id).executeTakeFirst();
      if (!Number(res.numUpdatedRows)) throw notFound('User');
      await recordAudit(trx, actor, { action: 'admin.user_unlocked', targetType: 'user', targetId: id }, requestMeta(req));
      return { status: 'unlocked' };
    });
  });

  // ------------------------------------------------------------ audit & billing events
  app.get('/api/admin/audit-logs', async (req) => {
    requirePlatformAdmin(req);
    const q = parse(
      z.object({ orgId: zUuid.optional(), action: z.string().max(60).optional(), actor: z.string().max(254).optional(), before: z.string().regex(/^\d+$/).optional(), limit: z.coerce.number().int().min(1).max(200).default(100) }),
      req.query,
    );
    return sys(async (trx) => {
      let query = trx.selectFrom('audit_logs').selectAll().orderBy('id', 'desc').limit(q.limit);
      if (q.orgId) query = query.where('org_id', '=', q.orgId);
      if (q.action) query = query.where('action', 'like', `${q.action.replace(/[%_\\]/g, '\\$&')}%`);
      if (q.actor) query = query.where('actor_email', 'ilike', `%${q.actor.replace(/[%_\\]/g, '\\$&')}%`);
      if (q.before) query = query.where('id', '<', q.before);
      const rows = await query.execute();
      return {
        entries: rows.map((r) => ({ id: r.id, orgId: r.org_id, actor: r.actor_email, actorType: r.actor_type, action: r.action, targetType: r.target_type, targetId: r.target_id, metadata: r.metadata, ip: r.ip, createdAt: r.created_at })),
        nextBefore: rows.length === q.limit ? rows.at(-1)!.id : null,
      };
    });
  });

  app.get('/api/admin/billing-events', async (req) => {
    requirePlatformAdmin(req);
    const q = parse(z.object({ status: z.enum(['processed', 'ignored', 'failed']).optional(), limit: z.coerce.number().int().min(1).max(200).default(100) }), req.query);
    return sys(async (trx) => {
      let query = trx.selectFrom('billing_events').select(['id', 'provider', 'event_id', 'event_type', 'org_id', 'status', 'error', 'received_at', 'processed_at']).orderBy('received_at', 'desc').limit(q.limit);
      if (q.status) query = query.where('status', '=', q.status);
      const rows = await query.execute();
      return { events: rows.map((e) => ({ id: e.id, provider: e.provider, eventId: e.event_id, type: e.event_type, orgId: e.org_id, status: e.status, error: e.error, receivedAt: e.received_at, processedAt: e.processed_at })) };
    });
  });

  // ------------------------------------------------------------ plans
  app.get('/api/admin/plans', async (req) => {
    requirePlatformAdmin(req);
    const plans = await db.selectFrom('plans').selectAll().orderBy('sort_order').execute();
    return { plans: plans.map((p) => ({ ...publicPlan(p), active: p.active, isPublic: p.is_public })) };
  });

  app.patch('/api/admin/plans/:id', async (req) => {
    const actor = adminActor(req);
    const { id } = parse(z.object({ id: z.string().max(31) }), req.params);
    const body = parse(
      z.object({
        name: z.string().trim().min(1).max(60).optional(),
        description: z.string().trim().max(300).optional(),
        priceMonthlyCents: z.number().int().min(0).max(100_000_000).optional(),
        priceYearlyCents: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
        limits: LimitsSchema.optional(),
        features: FeaturesSchema.optional(),
        active: z.boolean().optional(),
        isPublic: z.boolean().optional(),
        isSelfServe: z.boolean().optional(),
      }),
      req.body,
    );
    if (id === FREE_PLAN_ID && (body.active === false || (body.priceMonthlyCents ?? 0) > 0)) throw badRequest('The Free plan must stay active and free');
    return sys(async (trx) => {
      const res = await trx
        .updateTable('plans')
        .set({
          ...(body.name ? { name: body.name } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.priceMonthlyCents !== undefined ? { price_monthly_cents: body.priceMonthlyCents } : {}),
          ...(body.priceYearlyCents !== undefined ? { price_yearly_cents: body.priceYearlyCents } : {}),
          ...(body.limits ? { limits: JSON.stringify(body.limits) } : {}),
          ...(body.features ? { features: JSON.stringify(body.features) } : {}),
          ...(body.active !== undefined ? { active: body.active } : {}),
          ...(body.isPublic !== undefined ? { is_public: body.isPublic } : {}),
          ...(body.isSelfServe !== undefined ? { is_self_serve: body.isSelfServe } : {}),
        })
        .where('id', '=', id)
        .executeTakeFirst();
      if (!Number(res.numUpdatedRows)) throw notFound('Plan');
      await recordAudit(trx, actor, { action: 'admin.plan_updated', targetType: 'plan', targetId: id, metadata: body }, requestMeta(req));
      return { status: 'updated' };
    });
  });

  // ------------------------------------------------------------ catalogue management
  app.get('/api/admin/catalog/versions', async (req) => {
    requirePlatformAdmin(req);
    const rows = await db
      .selectFrom('catalog_versions as v')
      .select((eb) => [
        'v.id', 'v.academic_year', 'v.label', 'v.status', 'v.published_at', 'v.created_at', 'v.updated_at',
        eb.selectFrom('catalog_subjects as s').select((e) => e.fn.countAll<string>().as('n')).whereRef('s.version_id', '=', 'v.id').as('subjects'),
        eb.selectFrom('catalog_materials as m').select((e) => e.fn.countAll<string>().as('n')).whereRef('m.version_id', '=', 'v.id').as('materials'),
        eb.selectFrom('catalog_subjects as s').select((e) => e.fn.countAll<string>().as('n')).whereRef('s.version_id', '=', 'v.id').where('s.verification_status', '=', 'verified').as('subjectsVerified'),
      ])
      .orderBy('v.created_at', 'desc')
      .execute();
    return { versions: rows.map((v) => ({ id: v.id, academicYear: v.academic_year, label: v.label, status: v.status, publishedAt: v.published_at, createdAt: v.created_at, updatedAt: v.updated_at, subjects: Number(v.subjects ?? 0), materials: Number(v.materials ?? 0), subjectsVerified: Number(v.subjectsVerified ?? 0) })) };
  });

  app.get('/api/admin/catalog/versions/:id', async (req) => {
    requirePlatformAdmin(req);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    return loadCatalogTree(db, id, { allowUnpublished: true });
  });

  app.post('/api/admin/catalog/versions', async (req, reply) => {
    const actor = adminActor(req);
    const body = parse(z.object({ fromVersionId: zUuid, academicYear: z.string().regex(/^\d{4}\/\d{4}$/), label: z.string().trim().min(1).max(160) }), req.body);
    const id = await sys(async (trx) => {
      const src = await trx.selectFrom('catalog_versions').selectAll().where('id', '=', body.fromVersionId).executeTakeFirst();
      if (!src) throw notFound('Source version');
      const v = await trx
        .insertInto('catalog_versions')
        .values({ academic_year: body.academicYear, label: body.label, status: 'draft', notice: src.notice, grade_notes: JSON.stringify(src.grade_notes), created_by: actor.userId ?? null })
        .returning('id')
        .executeTakeFirstOrThrow();
      await sql`INSERT INTO catalog_sources (version_id, title, url, sort_order) SELECT ${v.id}, title, url, sort_order FROM catalog_sources WHERE version_id = ${src.id}`.execute(trx);
      await sql`INSERT INTO catalog_subjects (version_id, grade, track, block, code, name_en, name_ar, status, note, sort_order)
                SELECT ${v.id}, grade, track, block, code, name_en, name_ar, status, note, sort_order FROM catalog_subjects WHERE version_id = ${src.id}`.execute(trx);
      await sql`INSERT INTO catalog_materials (subject_id, version_id, kind, title, sort_order)
                SELECT ns.id, ${v.id}, m.kind, m.title, m.sort_order
                FROM catalog_materials m
                JOIN catalog_subjects os ON os.id = m.subject_id
                JOIN catalog_subjects ns ON ns.version_id = ${v.id} AND ns.grade = os.grade AND ns.track = os.track AND ns.block = os.block AND ns.code = os.code
                WHERE os.version_id = ${src.id}`.execute(trx);
      if (src.academic_year === body.academicYear) {
        // Same academic year (e.g. a correction): carry verification marks over by natural key.
        // A new year starts unverified, because decrees and editions change between years.
        await sql`UPDATE catalog_subjects ns
                  SET verification_status = os.verification_status, verification_source = os.verification_source, verification_url = os.verification_url,
                      verification_note = os.verification_note, reviewed_by = os.reviewed_by, reviewed_at = os.reviewed_at
                  FROM catalog_subjects os
                  WHERE ns.version_id = ${v.id} AND os.version_id = ${src.id}
                    AND ns.grade = os.grade AND ns.track = os.track AND ns.block = os.block AND ns.code = os.code`.execute(trx);
        await sql`UPDATE catalog_materials nm
                  SET verification_status = om.verification_status, verification_source = om.verification_source, verification_url = om.verification_url,
                      verification_note = om.verification_note, reviewed_by = om.reviewed_by, reviewed_at = om.reviewed_at
                  FROM catalog_materials om
                  JOIN catalog_subjects os ON os.id = om.subject_id
                  JOIN catalog_subjects ns ON ns.version_id = ${v.id} AND ns.grade = os.grade AND ns.track = os.track AND ns.block = os.block AND ns.code = os.code
                  WHERE nm.subject_id = ns.id AND nm.title = om.title AND om.version_id = ${src.id}`.execute(trx);
      }
      await recordAudit(trx, actor, { action: 'admin.catalog_version_created', targetType: 'catalog_version', targetId: v.id, metadata: { from: src.id, academicYear: body.academicYear } }, requestMeta(req));
      return v.id;
    });
    return reply.status(201).send({ id });
  });

  app.patch('/api/admin/catalog/versions/:id', async (req) => {
    const actor = adminActor(req);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const body = parse(
      z.object({
        label: z.string().trim().min(1).max(160).optional(),
        notice: z.string().trim().max(2000).nullable().optional(),
        gradeNotes: z.record(z.string().regex(/^(1[0-2]|[1-9])$/), z.string().max(1000)).optional(),
        sources: z.array(z.object({ title: z.string().trim().min(1).max(300), url: z.url().regex(/^https?:\/\//) })).max(50).optional(),
      }),
      req.body,
    );
    return sys(async (trx) => {
      await draftVersionOf(trx, id);
      await trx
        .updateTable('catalog_versions')
        .set({ ...(body.label ? { label: body.label } : {}), ...(body.notice !== undefined ? { notice: body.notice } : {}), ...(body.gradeNotes ? { grade_notes: JSON.stringify(body.gradeNotes) } : {}) })
        .where('id', '=', id)
        .execute();
      if (body.sources) {
        await trx.deleteFrom('catalog_sources').where('version_id', '=', id).execute();
        if (body.sources.length) await trx.insertInto('catalog_sources').values(body.sources.map((s, i) => ({ version_id: id, title: s.title, url: s.url, sort_order: i }))).execute();
      }
      await recordAudit(trx, actor, { action: 'admin.catalog_version_updated', targetType: 'catalog_version', targetId: id }, requestMeta(req));
      return { status: 'updated' };
    });
  });

  app.post('/api/admin/catalog/versions/:id/publish', async (req) => {
    const actor = adminActor(req);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    return sys(async (trx) => {
      await draftVersionOf(trx, id);
      const counts = await trx.selectFrom('catalog_materials').select((eb) => eb.fn.countAll<string>().as('n')).where('version_id', '=', id).executeTakeFirstOrThrow();
      if (Number(counts.n) === 0) throw badRequest('Cannot publish an empty catalogue version');
      await trx.updateTable('catalog_versions').set({ status: 'published', published_at: new Date() }).where('id', '=', id).execute();
      invalidateCatalogCache(id);
      const { orgs } = await notifyScopesBehind(trx, config, id);
      await recordAudit(trx, actor, { action: 'admin.catalog_version_published', targetType: 'catalog_version', targetId: id, metadata: { notifiedOrgs: orgs } }, requestMeta(req));
      return { status: 'published', notifiedOrgs: orgs };
    });
  });

  app.post('/api/admin/catalog/versions/:id/archive', async (req) => {
    const actor = adminActor(req);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    return sys(async (trx) => {
      const res = await trx.updateTable('catalog_versions').set({ status: 'archived' }).where('id', '=', id).where('status', '=', 'published').executeTakeFirst();
      if (!Number(res.numUpdatedRows)) throw conflict('Only published versions can be archived', 'VERSION_NOT_PUBLISHED');
      invalidateCatalogCache(id);
      // Scopes on the archived version are now behind the newest published one.
      const newest = await trx.selectFrom('catalog_versions').select('id').where('status', '=', 'published').orderBy('academic_year', 'desc').orderBy('published_at', 'desc').executeTakeFirst();
      const { orgs } = newest ? await notifyScopesBehind(trx, config, newest.id) : { orgs: 0 };
      await recordAudit(trx, actor, { action: 'admin.catalog_version_archived', targetType: 'catalog_version', targetId: id, metadata: { notifiedOrgs: orgs } }, requestMeta(req));
      return { status: 'archived', notifiedOrgs: orgs };
    });
  });

  app.delete('/api/admin/catalog/versions/:id', async (req) => {
    const actor = adminActor(req);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    return sys(async (trx) => {
      await draftVersionOf(trx, id);
      await trx.deleteFrom('catalog_versions').where('id', '=', id).execute();
      await recordAudit(trx, actor, { action: 'admin.catalog_version_deleted', targetType: 'catalog_version', targetId: id }, requestMeta(req));
      return { status: 'deleted' };
    });
  });

  app.post('/api/admin/catalog/versions/:id/subjects', async (req, reply) => {
    const actor = adminActor(req);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const body = parse(SubjectBody.extend({ materials: z.array(MaterialBody).max(50).default([]) }), req.body);
    const subjectId = await sys(async (trx) => {
      await draftVersionOf(trx, id);
      const max = await trx.selectFrom('catalog_subjects').select((eb) => eb.fn.max('sort_order').as('m')).where('version_id', '=', id).executeTakeFirst();
      const s = await trx
        .insertInto('catalog_subjects')
        .values({ version_id: id, grade: body.grade, track: body.track, block: body.block, code: body.code, name_en: body.nameEn, name_ar: body.nameAr, status: body.status, note: body.note ?? null, sort_order: body.sortOrder ?? Number(max?.m ?? 0) + 1 })
        .returning('id')
        .executeTakeFirstOrThrow();
      if (body.materials.length) {
        await trx.insertInto('catalog_materials').values(body.materials.map((m, i) => ({ subject_id: s.id, version_id: id, kind: m.kind, title: m.title, sort_order: m.sortOrder ?? i }))).execute();
      }
      await recordAudit(trx, actor, { action: 'admin.catalog_subject_created', targetType: 'catalog_subject', targetId: s.id, metadata: { versionId: id, code: body.code, grade: body.grade } }, requestMeta(req));
      return s.id;
    });
    return reply.status(201).send({ id: subjectId });
  });

  async function subjectInDraft(trx: Trx, subjectId: string) {
    const s = await trx.selectFrom('catalog_subjects').select(['id', 'version_id']).where('id', '=', subjectId).executeTakeFirst();
    if (!s) throw notFound('Subject');
    await draftVersionOf(trx, s.version_id);
    return s;
  }

  app.patch('/api/admin/catalog/subjects/:id', async (req) => {
    const actor = adminActor(req);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const body = parse(SubjectBody.partial(), req.body);
    return sys(async (trx) => {
      await subjectInDraft(trx, id);
      const cur = await trx.selectFrom('catalog_subjects').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
      const contentChanged =
        (body.grade !== undefined && body.grade !== cur.grade) ||
        (body.track !== undefined && body.track !== cur.track) ||
        (body.block !== undefined && body.block !== cur.block) ||
        (body.code !== undefined && body.code !== cur.code) ||
        (body.nameEn !== undefined && body.nameEn !== cur.name_en) ||
        (body.nameAr !== undefined && body.nameAr !== cur.name_ar) ||
        (body.status !== undefined && body.status !== cur.status) ||
        (body.note !== undefined && (body.note || null) !== cur.note);
      await trx
        .updateTable('catalog_subjects')
        .set({
          ...(body.grade !== undefined ? { grade: body.grade } : {}),
          ...(body.track ? { track: body.track } : {}),
          ...(body.block ? { block: body.block } : {}),
          ...(body.code ? { code: body.code } : {}),
          ...(body.nameEn ? { name_en: body.nameEn } : {}),
          ...(body.nameAr ? { name_ar: body.nameAr } : {}),
          ...(body.status ? { status: body.status } : {}),
          ...(body.note !== undefined ? { note: body.note } : {}),
          ...(body.sortOrder !== undefined ? { sort_order: body.sortOrder } : {}),
          ...(contentChanged ? UNVERIFIED : {}),
        })
        .where('id', '=', id)
        .execute();
      await recordAudit(trx, actor, { action: 'admin.catalog_subject_updated', targetType: 'catalog_subject', targetId: id, metadata: body }, requestMeta(req));
      return { status: 'updated' };
    });
  });

  app.delete('/api/admin/catalog/subjects/:id', async (req) => {
    const actor = adminActor(req);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    return sys(async (trx) => {
      await subjectInDraft(trx, id);
      await trx.deleteFrom('catalog_subjects').where('id', '=', id).execute();
      await recordAudit(trx, actor, { action: 'admin.catalog_subject_deleted', targetType: 'catalog_subject', targetId: id }, requestMeta(req));
      return { status: 'deleted' };
    });
  });

  app.post('/api/admin/catalog/subjects/:id/materials', async (req, reply) => {
    const actor = adminActor(req);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const body = parse(MaterialBody, req.body);
    const materialId = await sys(async (trx) => {
      const s = await subjectInDraft(trx, id);
      const max = await trx.selectFrom('catalog_materials').select((eb) => eb.fn.max('sort_order').as('m')).where('subject_id', '=', id).executeTakeFirst();
      const m = await trx
        .insertInto('catalog_materials')
        .values({ subject_id: id, version_id: s.version_id, kind: body.kind, title: body.title, sort_order: body.sortOrder ?? Number(max?.m ?? -1) + 1 })
        .returning('id')
        .executeTakeFirstOrThrow();
      await recordAudit(trx, actor, { action: 'admin.catalog_material_created', targetType: 'catalog_material', targetId: m.id, metadata: { subjectId: id, title: body.title } }, requestMeta(req));
      return m.id;
    });
    return reply.status(201).send({ id: materialId });
  });

  async function materialInDraft(trx: Trx, materialId: string) {
    const m = await trx.selectFrom('catalog_materials').select(['id', 'version_id']).where('id', '=', materialId).executeTakeFirst();
    if (!m) throw notFound('Material');
    await draftVersionOf(trx, m.version_id);
  }

  app.patch('/api/admin/catalog/materials/:id', async (req) => {
    const actor = adminActor(req);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const body = parse(MaterialBody.partial(), req.body);
    return sys(async (trx) => {
      await materialInDraft(trx, id);
      const cur = await trx.selectFrom('catalog_materials').select(['kind', 'title']).where('id', '=', id).executeTakeFirstOrThrow();
      const contentChanged = (body.kind !== undefined && body.kind !== cur.kind) || (body.title !== undefined && body.title !== cur.title);
      await trx
        .updateTable('catalog_materials')
        .set({
          ...(body.kind ? { kind: body.kind } : {}),
          ...(body.title ? { title: body.title } : {}),
          ...(body.sortOrder !== undefined ? { sort_order: body.sortOrder } : {}),
          ...(contentChanged ? UNVERIFIED : {}),
        })
        .where('id', '=', id)
        .execute();
      await recordAudit(trx, actor, { action: 'admin.catalog_material_updated', targetType: 'catalog_material', targetId: id, metadata: body }, requestMeta(req));
      return { status: 'updated' };
    });
  });

  app.delete('/api/admin/catalog/materials/:id', async (req) => {
    const actor = adminActor(req);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    return sys(async (trx) => {
      await materialInDraft(trx, id);
      await trx.deleteFrom('catalog_materials').where('id', '=', id).execute();
      await recordAudit(trx, actor, { action: 'admin.catalog_material_deleted', targetType: 'catalog_material', targetId: id }, requestMeta(req));
      return { status: 'deleted' };
    });
  });

  // Marks subjects and/or materials of one version as verified, needing review, or unverified.
  // Allowed on drafts and published versions (marks are annotations); archived versions are frozen.
  app.post('/api/admin/catalog/versions/:id/verification', async (req) => {
    const actor = adminActor(req);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const body = parse(VerificationBody, req.body);
    const subjectIds = [...new Set(body.subjectIds)];
    const materialIds = [...new Set(body.materialIds)];
    return sys(async (trx) => {
      const version = await trx.selectFrom('catalog_versions').select(['id', 'status']).where('id', '=', id).forUpdate().executeTakeFirst();
      if (!version) throw notFound('Catalog version');
      if (version.status === 'archived') throw conflict('Archived catalogue versions are read-only.', 'VERSION_ARCHIVED');
      const inVersion = async (table: 'catalog_subjects' | 'catalog_materials', ids: string[]) => {
        if (!ids.length) return;
        const row = await trx.selectFrom(table).select((eb) => eb.fn.countAll<string>().as('n')).where('version_id', '=', id).where('id', 'in', ids).executeTakeFirstOrThrow();
        if (Number(row.n) !== ids.length) throw badRequest(`Some ${table === 'catalog_subjects' ? 'subjects' : 'materials'} are not in this catalogue version`);
      };
      await inVersion('catalog_subjects', subjectIds);
      await inVersion('catalog_materials', materialIds);
      // Entries newly flagged for review (or with a changed note): their customers are told.
      const newlyFlagged = async (table: 'catalog_subjects' | 'catalog_materials', ids: string[]) => {
        if (body.status !== 'needs_review' || !ids.length) return [];
        const prev = await trx.selectFrom(table).select(['id', 'verification_status', 'verification_note']).where('id', 'in', ids).execute();
        return prev.filter((r) => r.verification_status !== 'needs_review' || r.verification_note !== body.note).map((r) => r.id);
      };
      const flaggedSubjects = await newlyFlagged('catalog_subjects', subjectIds);
      const flaggedMaterials = await newlyFlagged('catalog_materials', materialIds);
      const values =
        body.status === 'unverified'
          ? UNVERIFIED
          : { verification_status: body.status, verification_source: body.source ?? null, verification_url: body.url ?? null, verification_note: body.note ?? null, reviewed_by: actor.userId ?? null, reviewed_at: new Date() };
      if (subjectIds.length) await trx.updateTable('catalog_subjects').set(values).where('version_id', '=', id).where('id', 'in', subjectIds).execute();
      if (materialIds.length) await trx.updateTable('catalog_materials').set(values).where('version_id', '=', id).where('id', 'in', materialIds).execute();
      if (flaggedSubjects.length || flaggedMaterials.length) {
        const ofSubjects = flaggedSubjects.length ? await trx.selectFrom('catalog_materials').select('id').where('subject_id', 'in', flaggedSubjects).execute() : [];
        await notifyFlaggedForReview(trx, config, [...new Set([...flaggedMaterials, ...ofSubjects.map((m) => m.id)])], body.note!);
      }
      // A new updated_at changes the catalogue ETag and refreshes the cached tree.
      await trx.updateTable('catalog_versions').set({ updated_at: new Date() }).where('id', '=', id).execute();
      invalidateCatalogCache(id);
      await recordAudit(
        trx,
        actor,
        { action: 'admin.catalog_verification_set', targetType: 'catalog_version', targetId: id, metadata: { status: body.status, source: body.source ?? null, subjects: subjectIds.length, materials: materialIds.length } },
        requestMeta(req),
      );
      return { status: body.status, subjects: subjectIds.length, materials: materialIds.length };
    });
  });

  // ------------------------------------------------------------ support access to customer data
  // Platform admins see customer scopes only while the org owner has granted
  // time-limited support access; every read is written to the org's audit log.
  async function withSupportGrant<T>(req: FastifyRequest, orgId: string, fn: (trx: Trx, grantId: string) => Promise<T>): Promise<T> {
    const actor = adminActor(req);
    return sys(async (trx) => {
      const grant = await trx.selectFrom('support_access_grants').select(['id']).where('org_id', '=', orgId).where('revoked_at', 'is', null).where('expires_at', '>', new Date()).orderBy('expires_at', 'desc').executeTakeFirst();
      if (!grant) throw new AppError(403, 'SUPPORT_ACCESS_REQUIRED', 'The organization owner has not granted support access');
      const result = await fn(trx, grant.id);
      await recordAudit(trx, actor, { orgId, action: 'support_access.used', targetType: 'support_access_grant', targetId: grant.id, metadata: { path: req.url } }, requestMeta(req));
      return result;
    });
  }

  app.get('/api/admin/support/orgs/:orgId/scopes', async (req) => {
    const { orgId } = parse(z.object({ orgId: zUuid }), req.params);
    return withSupportGrant(req, orgId, async (trx) => ({ scopes: await listScopes(trx, orgId) }));
  });

  app.get('/api/admin/support/orgs/:orgId/scopes/:scopeId', async (req) => {
    const { orgId, scopeId } = parse(z.object({ orgId: zUuid, scopeId: zUuid }), req.params);
    return withSupportGrant(req, orgId, async (trx) => {
      const scope = await getScope(trx, orgId, scopeId);
      const tree = await loadCatalogTree(trx, scope.catalog_version_id, { allowUnpublished: true });
      return { scope: { id: scope.id, name: scope.name }, items: selectedRows(tree, new Set(await scopeMaterialIds(trx, scope.id))) };
    });
  });
}
