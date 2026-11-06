import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SandboxProvider } from '../../src/billing/providers/sandbox.js';
import { withSystemContext } from '../../src/db/index.js';
import { createHarness, createPlatformAdmin, resetData, signUp, type Harness } from '../helpers/harness.js';

// A payment provider notification that failed to process is reprocessed by a platform administrator
// (docs/production/BILLING_INTEGRATION_PLAN.md P-2): applied again from the normalized event stored when
// it was received and verified, with the same rules as the provider's own retry, once.

let h: Harness;
let sandbox: SandboxProvider;
beforeAll(async () => {
  h = await createHarness();
  sandbox = new SandboxProvider(h.config.SANDBOX_WEBHOOK_SECRET!, h.config.APP_URL);
});
afterAll(async () => h.close());
beforeEach(async () => resetData(h.ownerDb));

const sys = <T>(fn: Parameters<typeof withSystemContext<T>>[1]) => withSystemContext(h.ownerDb, fn);

function signed(evt: object) {
  const body = JSON.stringify(evt);
  return { body, signature: sandbox.sign(body) };
}

/** An invoice waiting for payment, and the provider's signed "paid" notification for it. */
async function openInvoice() {
  const owner = await signUp(h);
  const res = await owner.client.post(`/api/orgs/${owner.orgId}/billing/checkout`, { planId: 'starter' });
  expect(res.statusCode, res.body).toBe(200);
  const invoiceId = res.json().invoiceId as string;
  const raw = { id: 'evt_lost', type: 'payment.succeeded', data: { invoice_id: invoiceId, txn_id: 'txn_lost', amount_cents: 99_000, currency: 'EGP' } };
  return { owner, invoiceId, raw };
}

/**
 * Records the notification as the webhook route does when processing fails after the signature check
 * (a database error, a deploy in the middle): the normalized event, status failed, the error.
 */
async function failedEvent(raw: object, normalizedOverrides: Record<string, unknown> = {}) {
  const { body, signature } = signed(raw);
  const event = { ...sandbox.parseWebhook({ rawBody: Buffer.from(body), headers: { 'x-sandbox-signature': signature }, query: {} }), ...normalizedOverrides };
  return sys(async (trx) => {
    const row = await trx
      .insertInto('billing_events')
      .values({ provider: 'sandbox', event_id: event.eventId, event_type: event.type, payload: JSON.stringify(event), status: 'failed', error: 'Connection terminated unexpectedly' })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  });
}

const invoice = (id: string) => sys((trx) => trx.selectFrom('invoices').select(['status']).where('id', '=', id).executeTakeFirstOrThrow());
const event = (id: string) => sys((trx) => trx.selectFrom('billing_events').select(['status', 'error', 'org_id']).where('id', '=', id).executeTakeFirstOrThrow());
const audits = () => sys((trx) => trx.selectFrom('audit_logs').select(['action', 'metadata', 'org_id']).where('action', '=', 'admin.billing_event_reprocessed').orderBy('id').execute());

describe('reprocessing a failed payment notification', () => {
  it('applies it once: the invoice is paid, the event processed, the audit records it; a second request and a provider retry change nothing', async () => {
    const { owner, invoiceId, raw } = await openInvoice();
    const id = await failedEvent(raw);
    const admin = await createPlatformAdmin(h);

    const listed = (await admin.get('/api/admin/billing-events?status=failed')).json().events;
    expect(listed).toEqual([expect.objectContaining({ id, status: 'failed', error: 'Connection terminated unexpectedly' })]);

    const res = await admin.post(`/api/admin/billing-events/${id}/reprocess`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ event: { id, status: 'processed', error: null } });
    expect(await invoice(invoiceId)).toEqual({ status: 'paid' });
    expect(await event(id)).toEqual({ status: 'processed', error: null, org_id: owner.orgId });
    const sub = await sys((trx) => trx.selectFrom('subscriptions').select(['plan_id', 'status']).where('org_id', '=', owner.orgId).executeTakeFirstOrThrow());
    expect(sub).toEqual({ plan_id: 'starter', status: 'active' });
    expect(await audits()).toEqual([{ action: 'admin.billing_event_reprocessed', org_id: owner.orgId, metadata: { eventId: 'evt_lost', provider: 'sandbox', type: 'payment.succeeded', result: 'processed', note: null } }]);

    const again = await admin.post(`/api/admin/billing-events/${id}/reprocess`);
    expect([again.statusCode, again.json().error.code]).toEqual([409, 'EVENT_NOT_FAILED']);
    // The provider's own retry of the same notification is a duplicate.
    const { body, signature } = signed(raw);
    const retry = await h.app.inject({ method: 'POST', url: '/api/billing/webhooks/sandbox', headers: { 'content-type': 'application/json', 'x-sandbox-signature': signature }, payload: body });
    expect(retry.json()).toMatchObject({ received: true, duplicate: true });
    const payments = await sys((trx) => trx.selectFrom('payments').select('provider_txn_id').where('org_id', '=', owner.orgId).execute());
    expect(payments).toEqual([{ provider_txn_id: 'txn_lost' }]);
  });

  it('keeps an event that fails again as failed, with the new error, and audits the attempt', async () => {
    const { invoiceId, raw } = await openInvoice();
    // A transaction id the payments table refuses (NOT NULL): the reprocess fails inside the database.
    const id = await failedEvent(raw, { providerTxnId: null });
    const admin = await createPlatformAdmin(h);
    const res = await admin.post(`/api/admin/billing-events/${id}/reprocess`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().event).toMatchObject({ id, status: 'failed' });
    const after = await event(id);
    expect(after.status).toBe('failed');
    expect(after.error).not.toBe('Connection terminated unexpectedly');
    expect(await invoice(invoiceId)).toEqual({ status: 'open' });
    expect((await audits()).map((a) => (a.metadata as { result: string }).result)).toEqual(['failed']);
  });

  it('is for platform administrators, on failed events only', async () => {
    const { owner, raw } = await openInvoice();
    const id = await failedEvent(raw);
    // The admin surface is not revealed to other users.
    expect((await owner.client.post(`/api/admin/billing-events/${id}/reprocess`)).statusCode).toBe(404);
    expect((await event(id)).status).toBe('failed');
    const admin = await createPlatformAdmin(h);
    expect((await admin.post('/api/admin/billing-events/00000000-0000-4000-8000-000000000000/reprocess')).statusCode).toBe(404);
    expect((await admin.post('/api/admin/billing-events/not-a-uuid/reprocess')).statusCode).toBe(400);
    const ignored = await sys((trx) =>
      trx.insertInto('billing_events').values({ provider: 'sandbox', event_id: 'evt_ignored', event_type: 'ignored', payload: JSON.stringify({ type: 'ignored', eventId: 'evt_ignored', reason: 'refund' }), status: 'ignored' }).returning('id').executeTakeFirstOrThrow(),
    );
    expect((await admin.post(`/api/admin/billing-events/${ignored.id}/reprocess`)).statusCode).toBe(409);
  });
});
