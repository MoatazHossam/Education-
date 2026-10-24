import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { paymobHmac } from '../../src/billing/providers/paymob.js';
import { withSystemContext } from '../../src/db/index.js';
import { Client, createHarness, PASSWORD, resetData, signUp, type Harness } from '../helpers/harness.js';
import { PaymobSimulator, type Intention } from '../helpers/paymob-simulator.js';

// The real PaymobProvider (BILLING_PROVIDER=paymob) talking HTTP to a local
// simulator of Paymob's documented API. See tests/helpers/paymob-simulator.ts.
const KEYS = { secretKey: 'egy_sk_test_simulator', publicKey: 'egy_pk_test_simulator', hmacSecret: 'simulator-hmac-secret', integrationIds: [4_100_001] };

const PAYMOB_ENV = {
  BILLING_PROVIDER: 'paymob',
  PAYMOB_SECRET_KEY: KEYS.secretKey,
  PAYMOB_PUBLIC_KEY: KEYS.publicKey,
  PAYMOB_HMAC_SECRET: KEYS.hmacSecret,
  PAYMOB_INTEGRATION_IDS: String(KEYS.integrationIds[0]),
};

let h: Harness;
let paymob: PaymobSimulator;
beforeAll(async () => {
  paymob = await PaymobSimulator.start(KEYS);
  h = await createHarness({ ...PAYMOB_ENV, PAYMOB_API_BASE: paymob.baseUrl });
});
afterAll(async () => {
  await h.close();
  await paymob.close();
});
beforeEach(async () => resetData(h.ownerDb));

const invoice = (id: string) => withSystemContext(h.ownerDb, (trx) => trx.selectFrom('invoices').selectAll().where('id', '=', id).executeTakeFirstOrThrow());
const sub = (orgId: string) => withSystemContext(h.ownerDb, (trx) => trx.selectFrom('subscriptions').selectAll().where('org_id', '=', orgId).executeTakeFirstOrThrow());
const payments = (orgId: string) => withSystemContext(h.ownerDb, (trx) => trx.selectFrom('payments').selectAll().where('org_id', '=', orgId).execute());

type Owner = Awaited<ReturnType<typeof signUp>>;

async function startCheckout(owner: Owner, planId = 'starter', interval: 'month' | 'year' = 'month') {
  const res = await owner.client.post(`/api/orgs/${owner.orgId}/billing/checkout`, { planId, interval });
  expect(res.statusCode, res.body).toBe(200);
  const { invoiceId, checkoutUrl } = res.json() as { invoiceId: string; checkoutUrl: string };
  return { invoiceId, checkoutUrl, intention: paymob.intentionForCheckoutUrl(checkoutUrl) };
}

/** Delivers a callback to the notification_url the app gave Paymob. */
function deliver(intention: Intention, cb: { path: string; body: string }) {
  const url = new URL(intention.notification_url!);
  return h.app.inject({ method: 'POST', url: `${url.pathname}${cb.path}`, headers: { 'content-type': 'application/json' }, payload: cb.body });
}

describe('Paymob checkout (Intention API + Unified Checkout)', () => {
  it('creates an intention as documented and sends the customer to Unified Checkout', async () => {
    const owner = await signUp(h, { name: 'Mona Adel' });
    const { invoiceId, checkoutUrl, intention } = await startCheckout(owner);

    const req = paymob.requests.findLast((r) => r.path === '/v1/intention/')!;
    expect(req.headers.authorization).toBe(`Token ${KEYS.secretKey}`);
    expect(req.headers['content-type']).toBe('application/json');
    expect(req.body).toMatchObject({
      amount: 99_000,
      currency: 'EGP',
      payment_methods: KEYS.integrationIds,
      billing_data: { first_name: 'Mona', last_name: 'Adel', email: owner.email },
      notification_url: `${h.config.APP_URL}/api/billing/webhooks/paymob`,
      redirection_url: `${h.config.APP_URL}/org/${owner.orgId}/billing?invoice=${invoiceId}`,
    });
    expect(intention.special_reference.startsWith(`${invoiceId}.`)).toBe(true);

    const url = new URL(checkoutUrl);
    expect(`${url.origin}${url.pathname}`).toBe(`${paymob.baseUrl}/unifiedcheckout/`);
    expect(url.searchParams.get('publicKey')).toBe(KEYS.publicKey);
    expect((await fetch(checkoutUrl)).status).toBe(200);
    expect((await invoice(invoiceId)).provider_ref).toBe(String(intention.intention_order_id));
  });

  it('turns a Paymob API rejection into a 502 without exposing provider details; retry works', async () => {
    const owner = await signUp(h);
    paymob.failNext(400, { billing_data: { phone_number: ['This field may not be blank.'] } });
    const res = await owner.client.post(`/api/orgs/${owner.orgId}/billing/checkout`, { planId: 'starter', interval: 'month' });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe('PAYMENT_PROVIDER_ERROR');
    expect(res.body).not.toContain('phone_number');
    const open = await withSystemContext(h.ownerDb, (trx) => trx.selectFrom('invoices').select('id').where('org_id', '=', owner.orgId).where('status', '=', 'open').executeTakeFirstOrThrow());
    const retry = await owner.client.post(`/api/orgs/${owner.orgId}/billing/invoices/${open.id}/checkout`);
    expect(retry.statusCode, retry.body).toBe(200);
  });

  it('turns an unreachable Paymob API into a 502 as well', async () => {
    const owner = await signUp(h);
    const offline = await createHarness({ ...PAYMOB_ENV, PAYMOB_API_BASE: 'http://127.0.0.1:9' });
    try {
      const client = new Client(offline.app);
      await client.post('/api/auth/login', { email: owner.email, password: PASSWORD });
      await client.refresh();
      const res = await client.post(`/api/orgs/${owner.orgId}/billing/checkout`, { planId: 'starter', interval: 'month' });
      expect(res.statusCode, res.body).toBe(502);
      expect(res.json().error.code).toBe('PAYMENT_PROVIDER_ERROR');
    } finally {
      await offline.close();
    }
  });
});

describe('Paymob transaction callbacks', () => {
  it('a successful payment marks the invoice paid and activates the plan; retried callbacks are deduplicated', async () => {
    const owner = await signUp(h);
    const { invoiceId, intention } = await startCheckout(owner);
    const cb = paymob.callback(paymob.transaction(intention, 'success'));

    const first = await deliver(intention, cb);
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json()).toEqual({ received: true, status: 'processed' });
    expect((await invoice(invoiceId)).status).toBe('paid');
    expect(await sub(owner.orgId)).toMatchObject({ plan_id: 'starter', status: 'active' });

    const again = await deliver(intention, cb);
    expect(again.json()).toEqual({ received: true, duplicate: true });
    expect(await payments(owner.orgId)).toHaveLength(1);
  });

  it('a declined payment is recorded and the invoice stays open; a new checkout attempt can then be paid', async () => {
    const owner = await signUp(h);
    const { invoiceId, intention } = await startCheckout(owner, 'professional', 'year');
    const declined = await deliver(intention, paymob.callback(paymob.transaction(intention, 'declined')));
    expect(declined.json()).toEqual({ received: true, status: 'processed' });
    expect((await invoice(invoiceId)).status).toBe('open');
    expect((await payments(owner.orgId)).map((p) => [p.status, p.failure_reason])).toEqual([['failed', 'Do not honour']]);

    const retry = await owner.client.post(`/api/orgs/${owner.orgId}/billing/invoices/${invoiceId}/checkout`);
    const second = paymob.intentionForCheckoutUrl(retry.json().checkoutUrl);
    expect(second.intention_order_id).not.toBe(intention.intention_order_id);
    expect(second.special_reference).not.toBe(intention.special_reference);
    await deliver(second, paymob.callback(paymob.transaction(second, 'success')));
    expect(await sub(owner.orgId)).toMatchObject({ plan_id: 'professional', billing_interval: 'year', status: 'active' });
  });

  it('applies a payment made on an earlier checkout attempt of the same invoice', async () => {
    const owner = await signUp(h);
    const { invoiceId, intention: firstAttempt } = await startCheckout(owner);
    await owner.client.post(`/api/orgs/${owner.orgId}/billing/invoices/${invoiceId}/checkout`);
    const res = await deliver(firstAttempt, paymob.callback(paymob.transaction(firstAttempt, 'success')));
    expect(res.json().status).toBe('processed');
    expect((await invoice(invoiceId)).status).toBe('paid');
  });

  it('rejects callbacks with a missing or wrong HMAC, a tampered body or an unsupported type', async () => {
    const owner = await signUp(h);
    const { invoiceId, intention } = await startCheckout(owner);
    const txn = paymob.transaction(intention, 'success');
    const good = paymob.callback(txn);

    const tampered = { path: good.path, body: good.body.replace(`"amount_cents":${intention.amount}`, '"amount_cents":100') };
    expect(tampered.body).not.toBe(good.body);
    expect((await deliver(intention, tampered)).statusCode).toBe(400);
    expect((await deliver(intention, { path: '', body: good.body })).statusCode).toBe(400);
    expect((await deliver(intention, paymob.callback(txn, 'some-other-secret'))).statusCode).toBe(400);
    expect((await deliver(intention, { path: good.path, body: '{"type":"TOKEN","obj":{}}' })).statusCode).toBe(400);
    expect((await invoice(invoiceId)).status).toBe('open');
  });

  it('binds the payment to the signed Paymob order, not to the unsigned merchant_order_id', async () => {
    const payer = await signUp(h);
    const victim = await signUp(h);
    const paid = await startCheckout(payer);
    const other = await startCheckout(victim);

    // merchant_order_id is outside the HMAC: rewriting it keeps the signature valid.
    const txn = paymob.transaction(paid.intention, 'success');
    const rewritten = { ...txn, order: { ...(txn.order as object), merchant_order_id: `${other.invoiceId}.x` } };
    expect(paymob.sign(rewritten)).toBe(paymob.sign(txn));

    const res = await deliver(paid.intention, paymob.callback(rewritten));
    expect(res.json().status).toBe('processed');
    expect((await invoice(paid.invoiceId)).status).toBe('paid');
    expect((await invoice(other.invoiceId)).status).toBe('open');
    const audit = await withSystemContext(h.ownerDb, (trx) => trx.selectFrom('audit_logs').select(['action', 'org_id']).where('action', '=', 'billing.reference_mismatch').execute());
    expect(audit).toEqual([{ action: 'billing.reference_mismatch', org_id: payer.orgId }]);
  });

  it('the browser redirect is signed over the same fields (what `npm run paymob:check` verifies)', async () => {
    const owner = await signUp(h);
    const { intention } = await startCheckout(owner);
    const q = Object.fromEntries(paymob.redirectQuery(paymob.transaction(intention, 'success')));
    expect(paymobHmac(KEYS.hmacSecret, q)).toBe(q.hmac);
    expect(q.order).toBe(String(intention.intention_order_id));
  });

  it('ignores signed callbacks for orders this app did not create', async () => {
    const owner = await signUp(h);
    const { invoiceId } = await startCheckout(owner);
    const foreign = await paymob.createIntentionDirectly({
      amount: 99_000,
      currency: 'EGP',
      payment_methods: KEYS.integrationIds,
      billing_data: { first_name: 'A', last_name: 'B', email: 'a@example.test', phone_number: '+201000000000' },
      special_reference: `${invoiceId}.foreign`,
    });
    const res = await deliver({ ...foreign, notification_url: `${h.config.APP_URL}/api/billing/webhooks/paymob` }, paymob.callback(paymob.transaction(foreign, 'success')));
    expect(res.json().status).toBe('ignored');
    expect((await invoice(invoiceId)).status).toBe('open');
  });

  it('does not apply pending, refunded or wrong-amount transactions', async () => {
    const owner = await signUp(h);
    const { invoiceId, intention } = await startCheckout(owner);
    for (const txn of [paymob.transaction(intention, 'pending'), paymob.transaction(intention, 'refunded'), paymob.transaction(intention, 'success', { amountCents: 50_000 })]) {
      const res = await deliver(intention, paymob.callback(txn));
      expect(res.json().status, JSON.stringify(txn)).toBe('ignored');
    }
    expect((await invoice(invoiceId)).status).toBe('open');
    expect((await sub(owner.orgId)).status).toBe('trialing');
  });
});
