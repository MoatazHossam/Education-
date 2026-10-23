import { sql } from 'kysely';
import { recordAudit, type AuditActor } from '../audit/audit.js';
import type { AppConfig } from '../config.js';
import { withSystemContext, type Database, type Executor, type Trx } from '../db/index.js';
import type { BillingInterval, Invoice, Locale, Plan, Subscription } from '../db/types.js';
import { AppError, badRequest, conflict, notFound } from '../lib/errors.js';
import { addDays, addInterval } from '../lib/time.js';
import { enqueueEmail, notify } from '../notifications/email.js';
import { effectivePlan } from './entitlements.js';
import { FREE_PLAN_ID } from './plans.js';
import type { NormalizedEvent } from './providers/types.js';

const SYSTEM: AuditActor = { type: 'system', email: 'billing' };

export function priceFor(plan: Pick<Plan, 'price_monthly_cents' | 'price_yearly_cents'>, interval: BillingInterval): number | null {
  return interval === 'year' ? plan.price_yearly_cents : plan.price_monthly_cents;
}

export function formatMoney(cents: number, currency: string, locale: Locale = 'en'): string {
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-EG', { style: 'currency', currency }).format(cents / 100);
}

/** Prorated charge for moving to a pricier plan mid-period (same interval). */
export function prorationCents(oldPrice: number, newPrice: number, periodStart: Date, periodEnd: Date, now: Date): number {
  const total = periodEnd.getTime() - periodStart.getTime();
  const remaining = Math.max(0, periodEnd.getTime() - now.getTime());
  if (total <= 0 || newPrice <= oldPrice) return 0;
  return Math.ceil(((newPrice - oldPrice) * remaining) / total);
}

/** True when the org is inside a period it has paid for (active or in grace). */
export function hasPaidPeriod(sub: Subscription, plan: Plan, now: Date, graceDays: number): boolean {
  const eff = effectivePlan(sub, now, graceDays);
  return (eff.state === 'active' || eff.state === 'past_due') && sub.current_period_end !== null && plan.price_monthly_cents > 0;
}

async function nextInvoiceNumber(exec: Executor): Promise<string> {
  const { rows } = await sql<{ n: string }>`SELECT nextval('invoice_number_seq') AS n`.execute(exec);
  return `INV-${new Date().getUTCFullYear()}-${String(rows[0]!.n).padStart(6, '0')}`;
}

async function voidOpenInvoices(exec: Executor, orgId: string, kinds: Invoice['kind'][], exceptId?: string): Promise<void> {
  let q = exec.updateTable('invoices').set({ status: 'void', voided_at: new Date() }).where('org_id', '=', orgId).where('status', '=', 'open').where('kind', 'in', kinds);
  if (exceptId) q = q.where('id', '!=', exceptId);
  await q.execute();
}

export async function loadSubscription(exec: Executor, orgId: string, forUpdate = false): Promise<Subscription> {
  let q = exec.selectFrom('subscriptions').selectAll().where('org_id', '=', orgId);
  if (forUpdate) q = q.forUpdate();
  const sub = await q.executeTakeFirst();
  if (!sub) throw notFound('Subscription');
  return sub;
}

async function loadPlan(exec: Executor, planId: string): Promise<Plan> {
  const plan = await exec.selectFrom('plans').selectAll().where('id', '=', planId).executeTakeFirst();
  if (!plan) throw notFound('Plan');
  return plan;
}

export async function ownerOf(exec: Executor, orgId: string) {
  return exec
    .selectFrom('memberships as m')
    .innerJoin('users as u', 'u.id', 'm.user_id')
    .select(['u.id', 'u.email', 'u.name', 'u.locale'])
    .where('m.org_id', '=', orgId)
    .where('m.role', '=', 'owner')
    .executeTakeFirst();
}

/**
 * Creates the invoice for a self-serve purchase and returns it. Decides between
 * a new subscription (full period starting at payment) and a prorated upgrade.
 * Downgrades and interval changes are scheduled instead (scheduleChange).
 */
export async function createCheckoutInvoice(
  trx: Trx,
  config: AppConfig,
  orgId: string,
  target: { planId: string; interval: BillingInterval },
  actor: AuditActor,
): Promise<Invoice> {
  const now = new Date();
  const plan = await loadPlan(trx, target.planId);
  if (!plan.active || !plan.is_self_serve || plan.id === FREE_PLAN_ID) throw badRequest('This plan cannot be purchased online. Contact sales.');
  const price = priceFor(plan, target.interval);
  if (!price) throw badRequest(`The ${plan.name} plan is not offered with ${target.interval}ly billing`);

  const sub = await loadSubscription(trx, orgId, true);
  const currentPlan = await loadPlan(trx, sub.plan_id);
  let kind: Invoice['kind'] = 'subscription';
  let amount = price;

  if (hasPaidPeriod(sub, currentPlan, now, config.GRACE_DAYS)) {
    if (sub.status === 'past_due' || (sub.current_period_end && sub.current_period_end <= now)) {
      throw new AppError(409, 'PAYMENT_REQUIRED', 'Pay the outstanding renewal invoice before changing plans');
    }
    if (sub.plan_id === plan.id && sub.billing_interval === target.interval) throw conflict('You are already on this plan', 'ALREADY_ON_PLAN');
    const currentPrice = priceFor(currentPlan, sub.billing_interval) ?? 0;
    if (target.interval !== sub.billing_interval || price <= currentPrice) {
      throw new AppError(409, 'USE_SCHEDULED_CHANGE', 'Downgrades and billing-interval changes take effect at the end of the current period');
    }
    kind = 'upgrade';
    amount = prorationCents(currentPrice, price, sub.current_period_start ?? now, sub.current_period_end!, now);
  }

  // Abandoned checkouts are superseded by the new one.
  await voidOpenInvoices(trx, orgId, ['subscription', 'upgrade']);
  const invoice = await trx
    .insertInto('invoices')
    .values({
      org_id: orgId,
      number: await nextInvoiceNumber(trx),
      kind,
      plan_id: plan.id,
      billing_interval: target.interval,
      amount_cents: amount,
      currency: plan.currency,
      period_start: kind === 'upgrade' ? now : null,
      period_end: kind === 'upgrade' ? sub.current_period_end : null,
      due_at: now,
      provider: config.BILLING_PROVIDER,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await recordAudit(trx, actor, { orgId, action: 'billing.checkout_started', targetType: 'invoice', targetId: invoice.id, metadata: { kind, planId: plan.id, interval: target.interval, amount } });

  if (amount === 0) {
    // Nothing to charge (e.g. upgrade at the very end of a period): apply immediately.
    await markInvoicePaid(trx, config, invoice, actor);
  }
  return invoice;
}

export async function scheduleChange(trx: Trx, config: AppConfig, orgId: string, target: { planId: string; interval: BillingInterval }, actor: AuditActor) {
  const now = new Date();
  const sub = await loadSubscription(trx, orgId, true);
  const currentPlan = await loadPlan(trx, sub.plan_id);
  if (!hasPaidPeriod(sub, currentPlan, now, config.GRACE_DAYS)) throw conflict('Scheduled changes need an active paid subscription', 'NO_PAID_SUBSCRIPTION');
  const plan = await loadPlan(trx, target.planId);
  if (plan.id === FREE_PLAN_ID) return cancelAtPeriodEnd(trx, orgId, actor);
  if (!plan.active || !plan.is_self_serve) throw badRequest('This plan cannot be selected online');
  if (!priceFor(plan, target.interval)) throw badRequest(`The ${plan.name} plan is not offered with ${target.interval}ly billing`);
  if (plan.id === sub.plan_id && target.interval === sub.billing_interval) {
    await trx.updateTable('subscriptions').set({ pending_plan_id: null, pending_interval: null }).where('org_id', '=', orgId).execute();
  } else {
    await trx.updateTable('subscriptions').set({ pending_plan_id: plan.id, pending_interval: target.interval, cancel_at_period_end: false, canceled_at: null }).where('org_id', '=', orgId).execute();
  }
  // A renewal invoice already issued for the old plan is replaced by the worker.
  await voidOpenInvoices(trx, orgId, ['renewal']);
  await trx.deleteFrom('billing_notices').where('org_id', '=', orgId).where('kind', '=', 'renewal_invoice').execute();
  await recordAudit(trx, actor, { orgId, action: 'billing.change_scheduled', targetType: 'subscription', targetId: sub.id, metadata: { planId: plan.id, interval: target.interval, effectiveAt: sub.current_period_end } });
  return { effectiveAt: sub.current_period_end, planId: plan.id, interval: target.interval };
}

export async function cancelAtPeriodEnd(trx: Trx, orgId: string, actor: AuditActor) {
  const sub = await loadSubscription(trx, orgId, true);
  if (!sub.current_period_end || sub.plan_id === FREE_PLAN_ID) throw conflict('There is no paid subscription to cancel', 'NO_PAID_SUBSCRIPTION');
  await trx
    .updateTable('subscriptions')
    .set({ cancel_at_period_end: true, canceled_at: new Date(), pending_plan_id: null, pending_interval: null })
    .where('org_id', '=', orgId)
    .execute();
  await voidOpenInvoices(trx, orgId, ['renewal']);
  await recordAudit(trx, actor, { orgId, action: 'billing.canceled', targetType: 'subscription', targetId: sub.id, metadata: { effectiveAt: sub.current_period_end } });
  return { effectiveAt: sub.current_period_end, planId: FREE_PLAN_ID };
}

export async function resumeSubscription(trx: Trx, orgId: string, actor: AuditActor) {
  const sub = await loadSubscription(trx, orgId, true);
  if (!sub.cancel_at_period_end || !sub.current_period_end || sub.current_period_end <= new Date()) throw conflict('Nothing to resume', 'NOT_CANCELED');
  await trx.updateTable('subscriptions').set({ cancel_at_period_end: false, canceled_at: null }).where('org_id', '=', orgId).execute();
  await trx.deleteFrom('billing_notices').where('org_id', '=', orgId).where('kind', '=', 'renewal_invoice').execute();
  await recordAudit(trx, actor, { orgId, action: 'billing.resumed', targetType: 'subscription', targetId: sub.id });
}

/** Marks an open invoice paid and applies its effect to the subscription. */
export async function markInvoicePaid(trx: Trx, config: AppConfig, invoice: Invoice, actor: AuditActor): Promise<void> {
  const now = new Date();
  await trx.updateTable('invoices').set({ status: 'paid', paid_at: now }).where('id', '=', invoice.id).execute();
  const sub = await loadSubscription(trx, invoice.org_id, true);
  const base = { pending_plan_id: null, pending_interval: null, grace_until: null, provider: config.BILLING_PROVIDER };

  if (invoice.kind === 'subscription') {
    await trx
      .updateTable('subscriptions')
      .set({
        ...base,
        plan_id: invoice.plan_id,
        billing_interval: invoice.billing_interval,
        status: 'active',
        trial_ends_at: null,
        current_period_start: now,
        current_period_end: addInterval(now, invoice.billing_interval),
        cancel_at_period_end: false,
        canceled_at: null,
      })
      .where('id', '=', sub.id)
      .execute();
    await voidOpenInvoices(trx, invoice.org_id, ['renewal', 'subscription', 'upgrade'], invoice.id);
  } else if (invoice.kind === 'upgrade') {
    await trx.updateTable('subscriptions').set({ ...base, plan_id: invoice.plan_id, status: 'active' }).where('id', '=', sub.id).execute();
    await voidOpenInvoices(trx, invoice.org_id, ['renewal'], invoice.id);
    await trx.deleteFrom('billing_notices').where('org_id', '=', invoice.org_id).where('kind', '=', 'renewal_invoice').execute();
  } else {
    // renewal / manual: the invoice carries the period it pays for.
    const start = invoice.period_start ?? sub.current_period_end ?? now;
    const end = invoice.period_end ?? addInterval(start, invoice.billing_interval);
    await trx
      .updateTable('subscriptions')
      .set({ ...base, plan_id: invoice.plan_id, billing_interval: invoice.billing_interval, status: 'active', trial_ends_at: null, current_period_start: start, current_period_end: end, cancel_at_period_end: false, canceled_at: null })
      .where('id', '=', sub.id)
      .execute();
  }
  await recordAudit(trx, actor, { orgId: invoice.org_id, action: 'billing.invoice_paid', targetType: 'invoice', targetId: invoice.id, metadata: { number: invoice.number, kind: invoice.kind, planId: invoice.plan_id, amount: invoice.amount_cents } });
}

/**
 * Applies one verified provider event. Runs inside the webhook transaction
 * (system context). Returns how the event was handled for billing_events.
 */
export async function applyProviderEvent(
  trx: Trx,
  config: AppConfig,
  provider: string,
  event: NormalizedEvent,
): Promise<{ status: 'processed' | 'ignored'; orgId: string | null; note?: string }> {
  let invoiceId = event.invoiceId;
  if (event.type !== 'ignored' && event.checkoutRef !== undefined) {
    // The provider signed its checkout reference, not the invoice id it echoed back.
    const session = await trx
      .selectFrom('checkout_sessions')
      .select(['invoice_id', 'org_id'])
      .where('provider', '=', provider)
      .where('provider_ref', '=', event.checkoutRef)
      .executeTakeFirst();
    if (!session) return { status: 'ignored', orgId: null, note: 'unknown checkout' };
    if (session.invoice_id !== invoiceId) {
      await recordAudit(trx, SYSTEM, { orgId: session.org_id, action: 'billing.reference_mismatch', targetType: 'invoice', targetId: session.invoice_id, metadata: { claimedInvoiceId: String(invoiceId).slice(0, 64), checkoutRef: event.checkoutRef } });
    }
    invoiceId = session.invoice_id;
  }
  const invoice =
    invoiceId && /^[0-9a-f-]{36}$/i.test(invoiceId)
      ? await trx.selectFrom('invoices').selectAll().where('id', '=', invoiceId).forUpdate().executeTakeFirst()
      : undefined;
  if (event.type === 'ignored') return { status: 'ignored', orgId: invoice?.org_id ?? null, note: event.reason };
  if (!invoice) return { status: 'ignored', orgId: null, note: 'unknown invoice' };
  const org = await trx.selectFrom('organizations').select(['name']).where('id', '=', invoice.org_id).executeTakeFirstOrThrow();
  const owner = await ownerOf(trx, invoice.org_id);
  const billingLink = `${config.APP_URL}/org/${invoice.org_id}/billing`;

  const payment = await trx
    .insertInto('payments')
    .values({
      org_id: invoice.org_id,
      invoice_id: invoice.id,
      provider,
      provider_txn_id: event.providerTxnId,
      amount_cents: event.amountCents,
      currency: event.currency,
      status: event.type === 'payment.succeeded' ? 'succeeded' : 'failed',
      failure_reason: event.type === 'payment.failed' ? event.reason.slice(0, 300) : null,
    })
    .onConflict((oc) => oc.columns(['provider', 'provider_txn_id']).doNothing())
    .returning('id')
    .executeTakeFirst();
  if (!payment) return { status: 'ignored', orgId: invoice.org_id, note: 'duplicate transaction' };

  if (event.type === 'payment.failed') {
    await recordAudit(trx, SYSTEM, { orgId: invoice.org_id, action: 'billing.payment_failed', targetType: 'invoice', targetId: invoice.id, metadata: { reason: event.reason } });
    if (owner && invoice.status === 'open') {
      const amount = formatMoney(invoice.amount_cents, invoice.currency, owner.locale);
      await enqueueEmail(trx, owner.email, 'payment_failed', owner.locale, { orgName: org.name, invoiceNumber: invoice.number, amount, link: billingLink });
      await notify(trx, { userId: owner.id, orgId: invoice.org_id, kind: 'payment_failed', title: `Payment failed for ${invoice.number}`, body: `${amount} — ${event.reason}`, link: `/org/${invoice.org_id}/billing` });
    }
    return { status: 'processed', orgId: invoice.org_id };
  }

  if (event.amountCents !== invoice.amount_cents || event.currency !== invoice.currency) {
    await recordAudit(trx, SYSTEM, { orgId: invoice.org_id, action: 'billing.amount_mismatch', targetType: 'invoice', targetId: invoice.id, metadata: { expected: invoice.amount_cents, received: event.amountCents, currency: event.currency } });
    return { status: 'ignored', orgId: invoice.org_id, note: 'amount or currency mismatch — manual review' };
  }
  if (invoice.status !== 'open') {
    await recordAudit(trx, SYSTEM, { orgId: invoice.org_id, action: 'billing.payment_on_closed_invoice', targetType: 'invoice', targetId: invoice.id, metadata: { status: invoice.status } });
    return { status: 'ignored', orgId: invoice.org_id, note: `invoice already ${invoice.status} — refund review` };
  }

  await markInvoicePaid(trx, config, invoice, SYSTEM);
  if (owner) {
    const amount = formatMoney(invoice.amount_cents, invoice.currency, owner.locale);
    await enqueueEmail(trx, owner.email, 'payment_succeeded', owner.locale, { orgName: org.name, invoiceNumber: invoice.number, amount });
    await notify(trx, { userId: owner.id, orgId: invoice.org_id, kind: 'payment_succeeded', title: `Payment received for ${invoice.number}`, body: amount, link: `/org/${invoice.org_id}/billing` });
  }
  return { status: 'processed', orgId: invoice.org_id };
}

// ---------------------------------------------------------------- lifecycle (worker)

async function noticeOnce(trx: Trx, orgId: string, kind: string, ref: string): Promise<boolean> {
  const row = await trx.insertInto('billing_notices').values({ org_id: orgId, kind, ref }).onConflict((oc) => oc.doNothing()).returning('org_id').executeTakeFirst();
  return Boolean(row);
}

async function moveToFree(trx: Trx, config: AppConfig, sub: Subscription, reason: 'trial_expired' | 'canceled' | 'nonpayment'): Promise<void> {
  const previous = sub.plan_id;
  await trx
    .updateTable('subscriptions')
    .set({
      plan_id: FREE_PLAN_ID,
      status: 'active',
      trial_ends_at: null,
      current_period_start: null,
      current_period_end: null,
      cancel_at_period_end: false,
      grace_until: null,
      pending_plan_id: null,
      pending_interval: null,
    })
    .where('id', '=', sub.id)
    .execute();
  await voidOpenInvoices(trx, sub.org_id, ['renewal', 'subscription', 'upgrade']);
  await trx.deleteFrom('billing_notices').where('org_id', '=', sub.org_id).execute();
  await recordAudit(trx, SYSTEM, { orgId: sub.org_id, action: `billing.moved_to_free`, targetType: 'subscription', targetId: sub.id, metadata: { reason, previousPlan: previous } });
  const owner = await ownerOf(trx, sub.org_id);
  const org = await trx.selectFrom('organizations').select('name').where('id', '=', sub.org_id).executeTakeFirstOrThrow();
  if (owner) {
    const link = `${config.APP_URL}/org/${sub.org_id}/billing`;
    if (reason === 'trial_expired') {
      await enqueueEmail(trx, owner.email, 'trial_expired', owner.locale, { orgName: org.name, link });
    } else {
      const plan = await loadPlan(trx, previous);
      await enqueueEmail(trx, owner.email, 'subscription_ended', owner.locale, { orgName: org.name, planName: plan.name, reason: reason === 'canceled' ? 'canceled' : 'unpaid invoice', link });
    }
    await notify(trx, { userId: owner.id, orgId: sub.org_id, kind: 'moved_to_free', title: `${org.name} is now on the Free plan`, body: reason.replace('_', ' '), link: `/org/${sub.org_id}/billing` });
  }
}

export interface LifecycleSummary {
  trialNotices: number;
  trialsExpired: number;
  renewalInvoices: number;
  pastDue: number;
  canceled: number;
  downgradedForNonpayment: number;
}

/**
 * Advances every subscription whose time-based state changed. Each org is
 * handled in its own transaction so one failure does not block the rest.
 * Safe to run repeatedly and concurrently (row locks + notice dedupe).
 */
export async function runBillingLifecycle(db: Database, config: AppConfig, now = new Date()): Promise<LifecycleSummary> {
  const summary: LifecycleSummary = { trialNotices: 0, trialsExpired: 0, renewalInvoices: 0, pastDue: 0, canceled: 0, downgradedForNonpayment: 0 };
  const candidates = await withSystemContext(db, (trx) =>
    trx
      .selectFrom('subscriptions')
      .select('org_id')
      .where((eb) =>
        eb.or([
          eb.and([eb('status', '=', 'trialing'), eb('trial_ends_at', '<=', addDays(now, 3))]),
          eb.and([eb('status', '=', 'active'), eb('current_period_end', 'is not', null), eb('current_period_end', '<=', addDays(now, config.RENEWAL_NOTICE_DAYS))]),
          eb('status', '=', 'past_due'),
        ]),
      )
      .execute(),
  );

  for (const { org_id: orgId } of candidates) {
    await withSystemContext(db, async (trx) => {
      const sub = await loadSubscription(trx, orgId, true);
      const owner = await ownerOf(trx, orgId);
      const org = await trx.selectFrom('organizations').select('name').where('id', '=', orgId).executeTakeFirstOrThrow();
      const link = `${config.APP_URL}/org/${orgId}/billing`;

      if (sub.status === 'trialing' && sub.trial_ends_at) {
        if (sub.trial_ends_at <= now) {
          await moveToFree(trx, config, sub, 'trial_expired');
          summary.trialsExpired++;
        } else if (owner && (await noticeOnce(trx, orgId, 'trial_ending', sub.trial_ends_at.toISOString()))) {
          const days = Math.max(1, Math.ceil((sub.trial_ends_at.getTime() - now.getTime()) / 86_400_000));
          await enqueueEmail(trx, owner.email, 'trial_ending', owner.locale, { orgName: org.name, days: String(days), date: sub.trial_ends_at.toISOString().slice(0, 10), link });
          summary.trialNotices++;
        }
        return;
      }

      if (sub.status === 'past_due') {
        if (sub.grace_until && sub.grace_until <= now) {
          await moveToFree(trx, config, sub, 'nonpayment');
          summary.downgradedForNonpayment++;
        }
        return;
      }

      if (sub.status !== 'active' || !sub.current_period_end) return;
      const periodEnd = sub.current_period_end;

      if (periodEnd <= now) {
        if (sub.cancel_at_period_end || sub.pending_plan_id === FREE_PLAN_ID) {
          await moveToFree(trx, config, sub, 'canceled');
          summary.canceled++;
          return;
        }
        const graceUntil = addDays(periodEnd, config.GRACE_DAYS);
        await trx.updateTable('subscriptions').set({ status: 'past_due', grace_until: graceUntil }).where('id', '=', sub.id).execute();
        await recordAudit(trx, SYSTEM, { orgId, action: 'billing.past_due', targetType: 'subscription', targetId: sub.id, metadata: { graceUntil } });
        const open = await trx.selectFrom('invoices').select('number').where('org_id', '=', orgId).where('kind', '=', 'renewal').where('status', '=', 'open').executeTakeFirst();
        if (owner) await enqueueEmail(trx, owner.email, 'past_due', owner.locale, { orgName: org.name, invoiceNumber: open?.number ?? '—', date: graceUntil.toISOString().slice(0, 10), link });
        summary.pastDue++;
        return;
      }

      // Renewal invoice ahead of period end.
      if (sub.cancel_at_period_end) return;
      const nextPlan = await loadPlan(trx, sub.pending_plan_id ?? sub.plan_id);
      const nextInterval = sub.pending_interval ?? sub.billing_interval;
      const price = priceFor(nextPlan, nextInterval);
      if (!price || !nextPlan.active) return; // manual/enterprise renewals are invoiced by an operator
      if (!(await noticeOnce(trx, orgId, 'renewal_invoice', periodEnd.toISOString()))) return;
      const invoice = await trx
        .insertInto('invoices')
        .values({
          org_id: orgId,
          number: await nextInvoiceNumber(trx),
          kind: 'renewal',
          plan_id: nextPlan.id,
          billing_interval: nextInterval,
          amount_cents: price,
          currency: nextPlan.currency,
          period_start: periodEnd,
          period_end: addInterval(periodEnd, nextInterval),
          due_at: periodEnd,
          provider: config.BILLING_PROVIDER,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await recordAudit(trx, SYSTEM, { orgId, action: 'billing.renewal_invoiced', targetType: 'invoice', targetId: invoice.id, metadata: { number: invoice.number, planId: nextPlan.id, amount: price } });
      if (owner) {
        await enqueueEmail(trx, owner.email, 'renewal_due', owner.locale, {
          orgName: org.name,
          planName: nextPlan.name,
          invoiceNumber: invoice.number,
          amount: formatMoney(price, nextPlan.currency, owner.locale),
          date: periodEnd.toISOString().slice(0, 10),
          link,
        });
      }
      summary.renewalInvoices++;
    });
  }
  return summary;
}
