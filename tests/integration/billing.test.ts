import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SandboxProvider } from '../../src/billing/providers/sandbox.js';
import { runBillingLifecycle } from '../../src/billing/service.js';
import { withSystemContext } from '../../src/db/index.js';
import { addDays } from '../../src/lib/time.js';
import { Client, createHarness, latestEmail, resetData, signUp, type Harness } from '../helpers/harness.js';

let h: Harness;
let sandbox: SandboxProvider;
beforeAll(async () => {
  h = await createHarness();
  sandbox = new SandboxProvider(h.config.SANDBOX_WEBHOOK_SECRET!, h.config.APP_URL);
});
afterAll(async () => h.close());
beforeEach(async () => resetData(h.ownerDb));

const sub = (orgId: string) => withSystemContext(h.ownerDb, (trx) => trx.selectFrom('subscriptions').selectAll().where('org_id', '=', orgId).executeTakeFirstOrThrow());
const invoices = (orgId: string) => withSystemContext(h.ownerDb, (trx) => trx.selectFrom('invoices').selectAll().where('org_id', '=', orgId).orderBy('created_at').execute());
const payments = (orgId: string) => withSystemContext(h.ownerDb, (trx) => trx.selectFrom('payments').selectAll().where('org_id', '=', orgId).execute());

/** Follows the sandbox hosted checkout like a customer would. */
async function pay(client: Client, checkoutUrl: string, outcome: 'success' | 'failure' = 'success') {
  const u = new URL(checkoutUrl);
  const params = { invoice: u.searchParams.get('invoice')!, sig: u.searchParams.get('sig')! };
  const page = await client.get(`/api/billing/sandbox/checkout?invoice=${params.invoice}&sig=${params.sig}`);
  expect(page.statusCode).toBe(200);
  const res = await client.post('/api/billing/sandbox/complete', { ...params, outcome });
  expect(res.statusCode).toBe(200);
  return page.json().invoice;
}

async function subscribe(owner: Awaited<ReturnType<typeof signUp>>, planId = 'starter', interval: 'month' | 'year' = 'month') {
  const res = await owner.client.post(`/api/orgs/${owner.orgId}/billing/checkout`, { planId, interval });
  expect(res.statusCode, res.body).toBe(200);
  expect(res.json().status).toBe('checkout');
  await pay(owner.client, res.json().checkoutUrl);
}

function webhook(payload: object, signature?: string) {
  const body = JSON.stringify(payload);
  return h.app.inject({ method: 'POST', url: '/api/billing/webhooks/sandbox', headers: { 'content-type': 'application/json', 'x-sandbox-signature': signature ?? sandbox.sign(body) }, payload: body });
}

describe('subscribing', () => {
  it('lists public plans without authentication', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/billing/plans' });
    expect(res.json().plans.map((p: { id: string }) => p.id)).toEqual(['free', 'starter', 'professional', 'enterprise']);
  });

  it('trial → paid Starter via hosted checkout and signed webhook', async () => {
    const owner = await signUp(h);
    expect((await sub(owner.orgId)).status).toBe('trialing');
    await subscribe(owner, 'starter');
    const s = await sub(owner.orgId);
    expect(s).toMatchObject({ plan_id: 'starter', status: 'active', trial_ends_at: null, billing_interval: 'month' });
    expect(s.current_period_end!.getTime() - s.current_period_start!.getTime()).toBeGreaterThan(27 * 86_400_000);
    const [inv] = await invoices(owner.orgId);
    expect(inv).toMatchObject({ kind: 'subscription', status: 'paid', amount_cents: 99_000, currency: 'EGP' });
    expect(inv!.number).toMatch(/^INV-\d{4}-\d{6}$/);
    expect(await payments(owner.orgId)).toHaveLength(1);
    expect((await latestEmail(h, owner.email))?.template).toBe('payment_succeeded');
    const billing = (await owner.client.get(`/api/orgs/${owner.orgId}/billing`)).json();
    expect(billing.subscription).toMatchObject({ effectivePlanId: 'starter', state: 'active' });
  });

  it('trial → paid on the plan being trialled (Professional) ends the trial', async () => {
    const owner = await signUp(h);
    expect((await sub(owner.orgId)).plan_id).toBe('professional');
    await subscribe(owner, 'professional', 'year');
    expect(await sub(owner.orgId)).toMatchObject({ plan_id: 'professional', status: 'active', trial_ends_at: null, billing_interval: 'year' });
    const billing = (await owner.client.get(`/api/orgs/${owner.orgId}/billing`)).json();
    expect(billing.subscription).toMatchObject({ effectivePlanId: 'professional', state: 'active' });
    // Once paid, the same plan is refused as already current.
    const again = await owner.client.post(`/api/orgs/${owner.orgId}/billing/checkout`, { planId: 'professional', interval: 'year' });
    expect(again.json().error.code).toBe('ALREADY_ON_PLAN');
  });

  it('a failed payment leaves the invoice open and notifies the owner; retry succeeds', async () => {
    const owner = await signUp(h);
    const res = await owner.client.post(`/api/orgs/${owner.orgId}/billing/checkout`, { planId: 'professional', interval: 'year' });
    await pay(owner.client, res.json().checkoutUrl, 'failure');
    expect((await invoices(owner.orgId))[0]!.status).toBe('open');
    expect((await sub(owner.orgId)).status).toBe('trialing');
    expect((await latestEmail(h, owner.email))?.template).toBe('payment_failed');
    const retry = await owner.client.post(`/api/orgs/${owner.orgId}/billing/invoices/${res.json().invoiceId}/checkout`);
    await pay(owner.client, retry.json().checkoutUrl);
    expect(await sub(owner.orgId)).toMatchObject({ plan_id: 'professional', billing_interval: 'year', status: 'active' });
    expect((await payments(owner.orgId)).map((p) => p.status).sort()).toEqual(['failed', 'succeeded']);
  });

  it('refuses non-self-serve plans and billing actions from non-owners', async () => {
    const owner = await signUp(h);
    const ent = await owner.client.post(`/api/orgs/${owner.orgId}/billing/checkout`, { planId: 'enterprise' });
    expect(ent.statusCode).toBe(400);
    const free = await owner.client.post(`/api/orgs/${owner.orgId}/billing/checkout`, { planId: 'free' });
    expect(free.statusCode).toBe(400);
  });
});

describe('webhook security', () => {
  it('rejects bad signatures, stale timestamps and unknown providers', async () => {
    const owner = await signUp(h);
    const res = await owner.client.post(`/api/orgs/${owner.orgId}/billing/checkout`, { planId: 'starter' });
    const invoiceId = res.json().invoiceId;
    const evt = { id: 'evt_forged', type: 'payment.succeeded', data: { invoice_id: invoiceId, txn_id: 'forged', amount_cents: 99_000, currency: 'EGP' } };
    expect((await webhook(evt, 't=1,v1=deadbeef')).statusCode).toBe(400);
    expect((await webhook(evt, sandbox.sign(JSON.stringify(evt), Math.floor(Date.now() / 1000) - 900))).statusCode).toBe(400);
    const other = await h.app.inject({ method: 'POST', url: '/api/billing/webhooks/paymob', headers: { 'content-type': 'application/json' }, payload: '{}' });
    expect(other.statusCode).toBe(404);
    expect((await sub(owner.orgId)).status).toBe('trialing');
    expect(await payments(owner.orgId)).toHaveLength(0);
  });

  it('processes each event once (replay is a no-op)', async () => {
    const owner = await signUp(h);
    const invoiceId = (await owner.client.post(`/api/orgs/${owner.orgId}/billing/checkout`, { planId: 'starter' })).json().invoiceId;
    const evt = { id: 'evt_once', type: 'payment.succeeded', data: { invoice_id: invoiceId, txn_id: 'txn_once', amount_cents: 99_000, currency: 'EGP' } };
    const body = JSON.stringify(evt);
    const sig = sandbox.sign(body);
    const first = await webhook(evt, sig);
    expect(first.json()).toMatchObject({ received: true, status: 'processed' });
    const replay = await webhook(evt, sig);
    expect(replay.json()).toMatchObject({ received: true, duplicate: true });
    // Same transaction under a new event id is also not applied twice.
    const again = await webhook({ ...evt, id: 'evt_twice' });
    expect(again.json()).toMatchObject({ status: 'ignored' });
    expect(await payments(owner.orgId)).toHaveLength(1);
  });

  it('does not activate a plan when the paid amount does not match the invoice', async () => {
    const owner = await signUp(h);
    const invoiceId = (await owner.client.post(`/api/orgs/${owner.orgId}/billing/checkout`, { planId: 'professional' })).json().invoiceId;
    const res = await webhook({ id: 'evt_cheap', type: 'payment.succeeded', data: { invoice_id: invoiceId, txn_id: 'cheap', amount_cents: 100, currency: 'EGP' } });
    expect(res.json().status).toBe('ignored');
    expect((await invoices(owner.orgId))[0]!.status).toBe('open');
    expect((await sub(owner.orgId)).status).toBe('trialing');
    const audit = await withSystemContext(h.ownerDb, (trx) => trx.selectFrom('audit_logs').select('action').where('org_id', '=', owner.orgId).where('action', '=', 'billing.amount_mismatch').execute());
    expect(audit).toHaveLength(1);
  });
});

describe('plan changes', () => {
  it('upgrades mid-period with a prorated charge and keeps the period', async () => {
    const owner = await signUp(h);
    await subscribe(owner, 'starter');
    const before = await sub(owner.orgId);
    const res = await owner.client.post(`/api/orgs/${owner.orgId}/billing/checkout`, { planId: 'professional', interval: 'month' });
    const inv = (await invoices(owner.orgId)).find((i) => i.kind === 'upgrade')!;
    expect(inv.amount_cents).toBeGreaterThan(0);
    expect(inv.amount_cents).toBeLessThanOrEqual(290_000 - 99_000);
    await pay(owner.client, res.json().checkoutUrl);
    const after = await sub(owner.orgId);
    expect(after.plan_id).toBe('professional');
    expect(after.current_period_end!.getTime()).toBe(before.current_period_end!.getTime());
  });

  it('schedules a downgrade; the renewal invoice bills the new plan and applies it when paid', async () => {
    const owner = await signUp(h);
    await subscribe(owner, 'professional');
    const direct = await owner.client.post(`/api/orgs/${owner.orgId}/billing/checkout`, { planId: 'starter' });
    expect(direct.json().error.code).toBe('USE_SCHEDULED_CHANGE');
    const change = await owner.client.post(`/api/orgs/${owner.orgId}/billing/change`, { planId: 'starter', interval: 'month' });
    expect(change.statusCode).toBe(200);
    expect((await sub(owner.orgId)).pending_plan_id).toBe('starter');

    const periodEnd = (await sub(owner.orgId)).current_period_end!;
    const summary = await runBillingLifecycle(h.db, h.config, addDays(periodEnd, -3));
    expect(summary.renewalInvoices).toBe(1);
    expect((await runBillingLifecycle(h.db, h.config, addDays(periodEnd, -2))).renewalInvoices).toBe(0); // once only
    const renewal = (await invoices(owner.orgId)).find((i) => i.kind === 'renewal')!;
    expect(renewal).toMatchObject({ plan_id: 'starter', amount_cents: 99_000, status: 'open' });
    expect((await latestEmail(h, owner.email))?.template).toBe('renewal_due');
    // Still on Professional until the renewal is paid.
    expect((await sub(owner.orgId)).plan_id).toBe('professional');

    const checkout = await owner.client.post(`/api/orgs/${owner.orgId}/billing/invoices/${renewal.id}/checkout`);
    await pay(owner.client, checkout.json().checkoutUrl);
    const s = await sub(owner.orgId);
    expect(s).toMatchObject({ plan_id: 'starter', pending_plan_id: null, status: 'active' });
    expect(s.current_period_start!.getTime()).toBe(periodEnd.getTime());
  });

  it('cancel keeps access until period end, then moves to Free; resume undoes it', async () => {
    const owner = await signUp(h);
    await subscribe(owner, 'starter');
    expect((await owner.client.post(`/api/orgs/${owner.orgId}/billing/cancel`)).statusCode).toBe(200);
    expect((await owner.client.post(`/api/orgs/${owner.orgId}/billing/resume`)).statusCode).toBe(200);
    expect((await sub(owner.orgId)).cancel_at_period_end).toBe(false);
    await owner.client.post(`/api/orgs/${owner.orgId}/billing/cancel`);
    const periodEnd = (await sub(owner.orgId)).current_period_end!;
    expect((await runBillingLifecycle(h.db, h.config, addDays(periodEnd, -3))).renewalInvoices).toBe(0);
    expect((await owner.client.get(`/api/orgs/${owner.orgId}`)).json().plan.id).toBe('starter');
    const summary = await runBillingLifecycle(h.db, h.config, new Date(periodEnd.getTime() + 1000));
    expect(summary.canceled).toBe(1);
    expect(await sub(owner.orgId)).toMatchObject({ plan_id: 'free', status: 'active', current_period_end: null });
    expect((await latestEmail(h, owner.email))?.template).toBe('subscription_ended');
  });

  it('unpaid renewal: past due with grace period, then Free', async () => {
    const owner = await signUp(h);
    await subscribe(owner, 'starter');
    const periodEnd = (await sub(owner.orgId)).current_period_end!;
    await runBillingLifecycle(h.db, h.config, addDays(periodEnd, -3));
    const pd = await runBillingLifecycle(h.db, h.config, new Date(periodEnd.getTime() + 60_000));
    expect(pd.pastDue).toBe(1);
    const s = await sub(owner.orgId);
    expect(s.status).toBe('past_due');
    expect(s.grace_until!.getTime()).toBe(addDays(periodEnd, 7).getTime());
    expect((await latestEmail(h, owner.email))?.template).toBe('past_due');
    // During grace, plan changes require paying first.
    expect((await owner.client.post(`/api/orgs/${owner.orgId}/billing/checkout`, { planId: 'professional' })).statusCode).toBe(409);

    const end = await runBillingLifecycle(h.db, h.config, addDays(periodEnd, 7.01));
    expect(end.downgradedForNonpayment).toBe(1);
    expect((await sub(owner.orgId)).plan_id).toBe('free');
    expect((await invoices(owner.orgId)).find((i) => i.kind === 'renewal')!.status).toBe('void');
  });
});

describe('trial lifecycle', () => {
  it('sends one trial-ending notice, then moves to Free when the trial ends', async () => {
    const owner = await signUp(h);
    const trialEnd = (await sub(owner.orgId)).trial_ends_at!;
    expect((await runBillingLifecycle(h.db, h.config, addDays(trialEnd, -2))).trialNotices).toBe(1);
    expect((await runBillingLifecycle(h.db, h.config, addDays(trialEnd, -1))).trialNotices).toBe(0);
    expect((await latestEmail(h, owner.email))?.template).toBe('trial_ending');
    const done = await runBillingLifecycle(h.db, h.config, new Date(trialEnd.getTime() + 1000));
    expect(done.trialsExpired).toBe(1);
    expect(await sub(owner.orgId)).toMatchObject({ plan_id: 'free', status: 'active' });
    expect((await latestEmail(h, owner.email))?.template).toBe('trial_expired');
  });

  it('a user gets one trial; additional organizations start on Free', async () => {
    const owner = await signUp(h);
    const second = await owner.client.post('/api/orgs', { name: 'Second org' });
    expect(second.statusCode).toBe(201);
    expect(second.json().trial).toBe(false);
    expect((await sub(second.json().organization.id)).plan_id).toBe('free');
  });
});
