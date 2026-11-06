import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SandboxProvider } from '../../src/billing/providers/sandbox.js';
import { withOrgContext, withSystemContext } from '../../src/db/index.js';
import { evaluate, ServerErrorCounter } from '../../src/ops/alerts.js';
import { createHarness, createPlatformAdmin, resetData, signUp, type Harness } from '../helpers/harness.js';

// Payments an operator must look at (docs/production/BILLING_INTEGRATION_PLAN.md P-4): refunds and voids the
// provider reports, amounts that do not match the invoice, payments on closed invoices. Each provider
// notification opens one review; nothing about the invoice or the plan changes on its own; a platform
// administrator resolves it with a note, and an operational alert fires while any is open.

let h: Harness;
let sandbox: SandboxProvider;
beforeAll(async () => {
  h = await createHarness();
  sandbox = new SandboxProvider(h.config.SANDBOX_WEBHOOK_SECRET!, h.config.APP_URL);
});
afterAll(async () => h.close());
beforeEach(async () => resetData(h.ownerDb));

const sys = <T>(fn: Parameters<typeof withSystemContext<T>>[1]) => withSystemContext(h.ownerDb, fn);

function webhook(evt: object) {
  const body = JSON.stringify(evt);
  return h.app.inject({ method: 'POST', url: '/api/billing/webhooks/sandbox', headers: { 'content-type': 'application/json', 'x-sandbox-signature': sandbox.sign(body) }, payload: body });
}

async function checkout() {
  const owner = await signUp(h);
  const res = await owner.client.post(`/api/orgs/${owner.orgId}/billing/checkout`, { planId: 'starter' });
  expect(res.statusCode, res.body).toBe(200);
  return { owner, invoiceId: res.json().invoiceId as string };
}

const evt = (id: string, type: string, invoiceId: string, txn: string, amount = 99_000, currency = 'EGP') => ({ id, type, data: { invoice_id: invoiceId, txn_id: txn, amount_cents: amount, currency } });
const reviews = () => sys((trx) => trx.selectFrom('billing_reviews').selectAll().orderBy('created_at').execute());
const invoiceStatus = async (id: string) => (await sys((trx) => trx.selectFrom('invoices').select('status').where('id', '=', id).executeTakeFirstOrThrow())).status;
const reviewAlert = async () => (await evaluate(h.db, h.config, new ServerErrorCounter())).find((o) => o.key === 'billing_review_needed');

describe('payments to review', () => {
  it('a refund of a received payment opens one review linked to it; the invoice and plan stay as they are', async () => {
    const { owner, invoiceId } = await checkout();
    expect((await webhook(evt('evt_paid', 'payment.succeeded', invoiceId, 'txn_1'))).json()).toMatchObject({ status: 'processed' });
    expect(await invoiceStatus(invoiceId)).toBe('paid');

    const refund = evt('evt_refund', 'payment.refunded', invoiceId, 'txn_1');
    expect((await webhook(refund)).json()).toMatchObject({ received: true, status: 'processed' });
    expect((await webhook(refund)).json()).toMatchObject({ received: true, duplicate: true });
    const payment = await sys((trx) => trx.selectFrom('payments').select('id').where('provider_txn_id', '=', 'txn_1').executeTakeFirstOrThrow());
    expect(await reviews()).toEqual([
      expect.objectContaining({ org_id: owner.orgId, invoice_id: invoiceId, payment_id: payment.id, provider: 'sandbox', event_id: 'evt_refund', provider_txn_id: 'txn_1', kind: 'refund', amount_cents: 99_000, currency: 'EGP', status: 'open', resolution: null }),
    ]);
    expect(await invoiceStatus(invoiceId)).toBe('paid');
    const sub = await sys((trx) => trx.selectFrom('subscriptions').select(['plan_id', 'status']).where('org_id', '=', owner.orgId).executeTakeFirstOrThrow());
    expect(sub).toEqual({ plan_id: 'starter', status: 'active' });
    const audit = await sys((trx) => trx.selectFrom('audit_logs').select('metadata').where('action', '=', 'billing.payment_reversed').executeTakeFirstOrThrow());
    expect(audit.metadata).toEqual({ kind: 'refund', providerTxnId: 'txn_1', amountCents: 99_000, currency: 'EGP' });
    // The school's own data is isolated as everywhere: another school sees none of it.
    const other = await signUp(h);
    const seen = await withOrgContext(h.db, { orgId: other.orgId, userId: other.userId }, (trx) => trx.selectFrom('billing_reviews').select('id').execute());
    expect(seen).toEqual([]);
  });

  it('a void, a mismatched amount and a payment on a closed invoice each open a review', async () => {
    const a = await checkout();
    await webhook(evt('evt_void', 'payment.voided', a.invoiceId, 'txn_void'));
    const b = await checkout();
    expect((await webhook(evt('evt_short', 'payment.succeeded', b.invoiceId, 'txn_short', 50_000))).json()).toMatchObject({ status: 'ignored' });
    const c = await checkout();
    await webhook(evt('evt_c1', 'payment.succeeded', c.invoiceId, 'txn_c1'));
    await webhook(evt('evt_c2', 'payment.succeeded', c.invoiceId, 'txn_c2'));
    expect((await reviews()).map((r) => [r.event_id, r.kind, r.payment_id === null])).toEqual([
      ['evt_void', 'void', true],
      ['evt_short', 'amount_mismatch', false],
      ['evt_c2', 'payment_on_closed_invoice', false],
    ]);
    expect(await invoiceStatus(a.invoiceId)).toBe('open');
    expect(await invoiceStatus(b.invoiceId)).toBe('open');
  });

  it('a platform administrator lists and resolves reviews with a note; the alert fires while any is open', async () => {
    const { owner, invoiceId } = await checkout();
    expect(await reviewAlert()).toBeUndefined();
    await webhook(evt('evt_void', 'payment.voided', invoiceId, 'txn_v'));
    expect(await reviewAlert()).toMatchObject({ summary: '1 payment needs review (refund, void or mismatched amount)', details: { openReviews: 1 } });

    const admin = await createPlatformAdmin(h);
    const list = (await admin.get('/api/admin/billing-reviews')).json();
    expect(list.open).toBe(1);
    expect(list.reviews).toEqual([expect.objectContaining({ orgId: owner.orgId, invoiceId, invoiceStatus: 'open', kind: 'void', amountCents: 99_000, currency: 'EGP', providerTxnId: 'txn_v', status: 'open' })]);
    const id = list.reviews[0].id as string;

    // The admin surface is not revealed to other users.
    expect((await owner.client.post(`/api/admin/billing-reviews/${id}/resolve`, { resolution: 'x' })).statusCode).toBe(404);
    expect((await admin.post(`/api/admin/billing-reviews/${id}/resolve`, { resolution: '   ' })).statusCode).toBe(400);
    expect((await admin.post('/api/admin/billing-reviews/00000000-0000-4000-8000-000000000000/resolve', { resolution: 'x' })).statusCode).toBe(404);
    const res = await admin.post(`/api/admin/billing-reviews/${id}/resolve`, { resolution: 'Voided by the bank; invoice left open for the owner to pay again.' });
    expect(res.statusCode, res.body).toBe(200);
    const again = await admin.post(`/api/admin/billing-reviews/${id}/resolve`, { resolution: 'twice' });
    expect([again.statusCode, again.json().error.code]).toEqual([409, 'REVIEW_RESOLVED']);

    expect(await reviewAlert()).toBeUndefined();
    expect((await admin.get('/api/admin/billing-reviews')).json()).toEqual({ open: 0, reviews: [] });
    const resolved = (await admin.get('/api/admin/billing-reviews?status=resolved')).json().reviews;
    expect(resolved).toEqual([expect.objectContaining({ id, status: 'resolved', resolution: 'Voided by the bank; invoice left open for the owner to pay again.', resolvedBy: expect.stringContaining('@') })]);
    const audit = await sys((trx) => trx.selectFrom('audit_logs').select(['metadata', 'org_id']).where('action', '=', 'admin.billing_review_resolved').executeTakeFirstOrThrow());
    expect(audit).toEqual({ org_id: owner.orgId, metadata: { kind: 'void', invoiceId, resolution: 'Voided by the bank; invoice left open for the owner to pay again.' } });
  });
});
