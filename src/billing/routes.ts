import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { actorFromRequest } from '../audit/audit.js';
import { inOrg } from '../auth/guards.js';
import { withOrgContext, withSystemContext } from '../db/index.js';
import type { Plan } from '../db/types.js';
import type { AppContext } from '../http/context.js';
import { rateLimited } from '../http/rate-limit.js';
import { randomToken, safeEqual } from '../lib/crypto.js';
import { AppError, badRequest, conflict, notFound } from '../lib/errors.js';
import { parse, zUuid } from '../lib/validation.js';
import { countScopes, countSeats, getEntitlements, usageFor } from './entitlements.js';
import { SandboxProvider } from './providers/sandbox.js';
import { WebhookSignatureError } from './providers/types.js';
import { applyProviderEvent, cancelAtPeriodEnd, createCheckoutInvoice, resumeSubscription, scheduleChange } from './service.js';

export function publicPlan(p: Plan) {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    priceMonthlyCents: p.price_monthly_cents,
    priceYearlyCents: p.price_yearly_cents,
    currency: p.currency,
    limits: p.limits,
    features: p.features,
    selfServe: p.is_self_serve,
  };
}

const ChangeBody = z.object({ planId: z.string().regex(/^[a-z][a-z0-9_]{1,30}$/), interval: z.enum(['month', 'year']).default('month') });

export async function registerBillingRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { db, config } = ctx;
  const grace = config.GRACE_DAYS;

  app.get('/api/billing/plans', async () => {
    const plans = await db.selectFrom('plans').selectAll().where('active', '=', true).where('is_public', '=', true).orderBy('sort_order').execute();
    return { plans: plans.map(publicPlan), provider: ctx.payments?.name ?? null };
  });

  app.get('/api/orgs/:orgId/billing', async (req) => {
    const { orgId } = parse(z.object({ orgId: z.string() }), req.params);
    return inOrg(ctx, req, orgId, 'admin', async (trx) => {
      const ent = await getEntitlements(trx, orgId, grace);
      const sub = ent.subscription!;
      const [invoices, payments, seats, scopes, usage] = await Promise.all([
        trx.selectFrom('invoices').selectAll().where('org_id', '=', orgId).orderBy('created_at', 'desc').limit(24).execute(),
        trx.selectFrom('payments').selectAll().where('org_id', '=', orgId).orderBy('created_at', 'desc').limit(24).execute(),
        countSeats(trx, orgId),
        countScopes(trx, orgId),
        usageFor(trx, orgId),
      ]);
      const plans = await trx.selectFrom('plans').selectAll().where('active', '=', true).where('is_public', '=', true).orderBy('sort_order').execute();
      return {
        subscription: {
          planId: sub.plan_id,
          status: sub.status,
          effectivePlanId: ent.planId,
          effectivePlanName: ent.planName,
          state: ent.state,
          billingInterval: sub.billing_interval,
          trialEndsAt: sub.trial_ends_at,
          currentPeriodStart: sub.current_period_start,
          currentPeriodEnd: sub.current_period_end,
          cancelAtPeriodEnd: sub.cancel_at_period_end,
          graceUntil: sub.grace_until,
          pendingPlanId: sub.pending_plan_id,
          pendingInterval: sub.pending_interval,
        },
        limits: ent.limits,
        features: ent.features,
        usage: { members: seats.members, pendingInvites: seats.pendingInvites, scopes, ...usage },
        plans: plans.map(publicPlan),
        invoices: invoices.map((i) => ({ id: i.id, number: i.number, kind: i.kind, planId: i.plan_id, interval: i.billing_interval, amountCents: i.amount_cents, currency: i.currency, status: i.status, periodStart: i.period_start, periodEnd: i.period_end, dueAt: i.due_at, paidAt: i.paid_at, createdAt: i.created_at })),
        payments: payments.map((p) => ({ id: p.id, invoiceId: p.invoice_id, amountCents: p.amount_cents, currency: p.currency, status: p.status, failureReason: p.failure_reason, createdAt: p.created_at })),
        provider: ctx.payments?.name ?? null,
      };
    });
  });

  /** Opens a hosted checkout for an open invoice. Network call happens outside the DB transaction. */
  async function checkoutFor(orgId: string, invoiceId: string, customer: { email: string; name: string }) {
    if (!ctx.payments) throw new AppError(503, 'BILLING_DISABLED', 'Online payments are not enabled. Contact sales to subscribe.');
    const invoice = await withOrgContext(db, { orgId }, (trx) => trx.selectFrom('invoices').selectAll().where('id', '=', invoiceId).where('org_id', '=', orgId).executeTakeFirst());
    if (!invoice) throw notFound('Invoice');
    if (invoice.status !== 'open') throw conflict(`Invoice is ${invoice.status}`, 'INVOICE_NOT_OPEN');
    const plan = await db.selectFrom('plans').select('name').where('id', '=', invoice.plan_id).executeTakeFirstOrThrow();
    const result = await ctx.payments.createCheckout({
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      amountCents: invoice.amount_cents,
      currency: invoice.currency,
      description: `${plan.name} (${invoice.billing_interval}ly)`,
      customer,
      returnUrl: `${config.APP_URL}/org/${orgId}/billing?invoice=${invoice.id}`,
      webhookUrl: `${config.APP_URL}/api/billing/webhooks/${ctx.payments.name}`,
    });
    await withOrgContext(db, { orgId }, (trx) => trx.updateTable('invoices').set({ provider_ref: result.providerRef, provider: ctx.payments!.name }).where('id', '=', invoice.id).execute());
    return { invoiceId: invoice.id, checkoutUrl: result.checkoutUrl };
  }

  app.post('/api/orgs/:orgId/billing/checkout', rateLimited(20, '1 hour'), async (req) => {
    const { orgId } = parse(z.object({ orgId: z.string() }), req.params);
    const body = parse(ChangeBody, req.body);
    if (!ctx.payments) throw new AppError(503, 'BILLING_DISABLED', 'Online payments are not enabled. Contact sales to subscribe.');
    const { invoice, user } = await inOrg(ctx, req, orgId, 'owner', async (trx, access) => ({
      invoice: await createCheckoutInvoice(trx, config, orgId, body, actorFromRequest(req)),
      user: access.user,
    }));
    if (invoice.amount_cents === 0) return { status: 'applied', invoiceId: invoice.id };
    return { status: 'checkout', ...(await checkoutFor(orgId, invoice.id, { email: user.email, name: user.name })) };
  });

  app.post('/api/orgs/:orgId/billing/invoices/:invoiceId/checkout', rateLimited(20, '1 hour'), async (req) => {
    const { orgId, invoiceId } = parse(z.object({ orgId: z.string(), invoiceId: zUuid }), req.params);
    const { user } = await inOrg(ctx, req, orgId, 'owner', async (_trx, access) => access);
    return { status: 'checkout', ...(await checkoutFor(orgId, invoiceId, { email: user.email, name: user.name })) };
  });

  app.post('/api/orgs/:orgId/billing/change', async (req) => {
    const { orgId } = parse(z.object({ orgId: z.string() }), req.params);
    const body = parse(ChangeBody, req.body);
    return inOrg(ctx, req, orgId, 'owner', (trx) => scheduleChange(trx, config, orgId, body, actorFromRequest(req)));
  });

  app.post('/api/orgs/:orgId/billing/cancel', async (req) => {
    const { orgId } = parse(z.object({ orgId: z.string() }), req.params);
    return inOrg(ctx, req, orgId, 'owner', (trx) => cancelAtPeriodEnd(trx, orgId, actorFromRequest(req)));
  });

  app.post('/api/orgs/:orgId/billing/resume', async (req) => {
    const { orgId } = parse(z.object({ orgId: z.string() }), req.params);
    await inOrg(ctx, req, orgId, 'owner', (trx) => resumeSubscription(trx, orgId, actorFromRequest(req)));
    return { status: 'resumed' };
  });

  // ------------------------------------------------------------ provider webhooks
  await app.register(async (scope) => {
    // Raw body is required to verify the provider signature byte-for-byte.
    scope.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

    scope.post('/api/billing/webhooks/:provider', async (req, reply) => {
      const { provider: name } = parse(z.object({ provider: z.string().max(20) }), req.params);
      const provider = ctx.payments;
      if (!provider || provider.name !== name) throw notFound();
      const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
      let event;
      try {
        event = provider.parseWebhook({ rawBody, headers: req.headers, query: req.query as Record<string, unknown> });
      } catch (err) {
        if (err instanceof WebhookSignatureError) {
          req.log.warn({ provider: name, reason: err.message }, 'rejected webhook');
          throw new AppError(400, 'INVALID_SIGNATURE', 'Webhook signature verification failed');
        }
        throw err;
      }
      try {
        const result = await withSystemContext(db, async (trx) => {
          // Idempotency: an event id is processed once; failed attempts may be retried.
          const claimed = await sql<{ id: string }>`
            INSERT INTO billing_events (provider, event_id, event_type, payload, status)
            VALUES (${name}, ${event.eventId}, ${event.type}, ${JSON.stringify(event)}::jsonb, 'processed')
            ON CONFLICT (provider, event_id) DO UPDATE SET received_at = now(), error = NULL
              WHERE billing_events.status = 'failed'
            RETURNING id`.execute(trx);
          const row = claimed.rows[0];
          if (!row) return { duplicate: true as const };
          const applied = await applyProviderEvent(trx, config, name, event);
          await trx
            .updateTable('billing_events')
            .set({ status: applied.status, org_id: applied.orgId, error: applied.note ?? null, processed_at: new Date() })
            .where('id', '=', row.id)
            .execute();
          return { duplicate: false as const, ...applied };
        });
        return reply.send(result.duplicate ? { received: true, duplicate: true } : { received: true, status: result.status });
      } catch (err) {
        req.log.error({ err, eventId: event.eventId }, 'webhook processing failed');
        await withSystemContext(db, (trx) =>
          sql`INSERT INTO billing_events (provider, event_id, event_type, payload, status, error)
              VALUES (${name}, ${event.eventId}, ${event.type}, ${JSON.stringify(event)}::jsonb, 'failed', ${String((err as Error).message).slice(0, 500)})
              ON CONFLICT (provider, event_id) DO UPDATE SET status = 'failed', error = EXCLUDED.error`.execute(trx),
        );
        // Non-2xx makes the provider retry later.
        return reply.status(500).send({ received: false });
      }
    });
  });

  // ------------------------------------------------------------ sandbox checkout (development/test only)
  const sandbox = ctx.payments instanceof SandboxProvider ? ctx.payments : null;
  if (sandbox) {
    const SandboxQuery = z.object({ invoice: zUuid, sig: z.string().regex(/^[0-9a-f]{64}$/) });
    const loadSandboxInvoice = async (invoiceId: string, sig: string) => {
      if (!safeEqual(sig, sandbox.checkoutSignature(invoiceId))) throw new AppError(403, 'INVALID_SIGNATURE', 'Invalid checkout link');
      const row = await withSystemContext(db, (trx) =>
        trx
          .selectFrom('invoices as i')
          .innerJoin('organizations as o', 'o.id', 'i.org_id')
          .innerJoin('plans as p', 'p.id', 'i.plan_id')
          .select(['i.id', 'i.org_id', 'i.number', 'i.amount_cents', 'i.currency', 'i.status', 'i.billing_interval', 'o.name as orgName', 'p.name as planName'])
          .where('i.id', '=', invoiceId)
          .executeTakeFirst(),
      );
      if (!row) throw notFound('Invoice');
      return row;
    };

    app.get('/api/billing/sandbox/checkout', async (req) => {
      const q = parse(SandboxQuery, req.query);
      const inv = await loadSandboxInvoice(q.invoice, q.sig);
      return { invoice: { id: inv.id, number: inv.number, amountCents: inv.amount_cents, currency: inv.currency, status: inv.status, interval: inv.billing_interval, orgId: inv.org_id, orgName: inv.orgName, planName: inv.planName } };
    });

    app.post('/api/billing/sandbox/complete', async (req) => {
      const body = parse(SandboxQuery.extend({ outcome: z.enum(['success', 'failure']) }), req.body);
      const inv = await loadSandboxInvoice(body.invoice, body.sig);
      if (inv.status !== 'open') throw conflict(`Invoice is ${inv.status}`, 'INVOICE_NOT_OPEN');
      const payload = JSON.stringify({
        id: `evt_${randomToken(12)}`,
        type: body.outcome === 'success' ? 'payment.succeeded' : 'payment.failed',
        data: { invoice_id: inv.id, txn_id: `sbx_txn_${randomToken(9)}`, amount_cents: inv.amount_cents, currency: inv.currency, reason: 'card_declined (sandbox)' },
      });
      // Deliver through the real webhook endpoint so signature and idempotency checks are exercised.
      const res = await app.inject({ method: 'POST', url: '/api/billing/webhooks/sandbox', headers: { 'content-type': 'application/json', 'x-sandbox-signature': sandbox.sign(payload) }, payload });
      if (res.statusCode !== 200) throw badRequest('Sandbox webhook delivery failed');
      return { status: body.outcome === 'success' ? 'paid' : 'failed', orgId: inv.org_id };
    });
  }
}
