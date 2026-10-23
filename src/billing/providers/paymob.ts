import { hmacHex, safeEqual } from '../../lib/crypto.js';
import { ProviderRequestError, WebhookSignatureError, type CheckoutRequest, type CheckoutResult, type NormalizedEvent, type PaymentProvider, type WebhookInput } from './types.js';

export interface PaymobConfig {
  apiBase: string;
  secretKey: string;
  publicKey: string;
  hmacSecret: string;
  integrationIds: number[];
}

export interface PaymobTransaction {
  id: number;
  pending: boolean;
  amount_cents: number;
  success: boolean;
  is_auth: boolean;
  is_capture: boolean;
  is_standalone_payment: boolean;
  is_voided: boolean;
  is_refunded: boolean;
  is_3d_secure: boolean;
  integration_id: number;
  has_parent_transaction: boolean;
  created_at: string;
  currency: string;
  error_occured: boolean;
  owner: number;
  order: { id: number; merchant_order_id?: string | null };
  source_data: { pan: string; type: string; sub_type: string };
  data?: { message?: string };
}

// Fields of the "transaction processed" callback HMAC (SHA-512), in Paymob's
// documented order, named as in the flattened redirect query string. Values are
// concatenated without separators. Cross-checked against Odoo's payment_paymob
// module (see tests/unit/security-primitives.test.ts).
const HMAC_KEYS = [
  'amount_cents',
  'created_at',
  'currency',
  'error_occured',
  'has_parent_transaction',
  'id',
  'integration_id',
  'is_3d_secure',
  'is_auth',
  'is_capture',
  'is_refunded',
  'is_standalone_payment',
  'is_voided',
  'order',
  'owner',
  'pending',
  'source_data.pan',
  'source_data.sub_type',
  'source_data.type',
  'success',
] as const;

/** HMAC over flattened fields, e.g. the query string of Paymob's redirect back to `redirection_url`. */
export function paymobHmac(secret: string, fields: Record<string, unknown>): string {
  return hmacHex(secret, HMAC_KEYS.map((k) => String(fields[k])).join(''), 'sha512');
}

/** HMAC of the `obj` of a POSTed transaction callback. */
export function paymobTransactionHmac(secret: string, txn: PaymobTransaction): string {
  return paymobHmac(secret, {
    ...txn,
    order: txn.order.id,
    'source_data.pan': txn.source_data.pan,
    'source_data.sub_type': txn.source_data.sub_type,
    'source_data.type': txn.source_data.type,
  });
}

/**
 * Paymob (Egypt) adapter: Intention API + Unified Checkout for one-off period
 * payments, and the transaction-processed webhook for results.
 * Contract-tested against a simulator built from Paymob's documentation
 * (tests/integration/paymob-contract.test.ts); NOT yet run against Paymob's
 * servers — use `npm run paymob:check` with test-mode keys for that.
 */
export class PaymobProvider implements PaymentProvider {
  readonly name = 'paymob';
  constructor(private readonly cfg: PaymobConfig) {}

  async createCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
    const [first, ...rest] = req.customer.name.trim().split(/\s+/);
    // Paymob requires special_reference to be unique per intention, so each
    // checkout attempt gets a suffix; the invoice id is recovered from the prefix.
    const specialReference = `${req.invoiceId}.${Date.now().toString(36)}`;
    const res = await fetch(`${this.cfg.apiBase}/v1/intention/`, {
      method: 'POST',
      headers: { Authorization: `Token ${this.cfg.secretKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: req.amountCents,
        currency: req.currency,
        payment_methods: this.cfg.integrationIds,
        items: [{ name: req.description.slice(0, 50), amount: req.amountCents, description: req.invoiceNumber, quantity: 1 }],
        billing_data: { first_name: first || 'Customer', last_name: rest.join(' ') || 'NA', email: req.customer.email, phone_number: 'NA' },
        special_reference: specialReference,
        notification_url: req.webhookUrl,
        redirection_url: req.returnUrl,
      }),
      signal: AbortSignal.timeout(15_000),
    }).catch((err: unknown) => {
      throw new ProviderRequestError(`Paymob request failed: ${err instanceof Error ? err.message : String(err)}`);
    });
    if (!res.ok) {
      // Paymob explains rejected fields in the body (e.g. "This field may not be blank").
      const detail = (await res.text().catch(() => '')).slice(0, 500);
      throw new ProviderRequestError(`Paymob intention failed with HTTP ${res.status}: ${detail}`);
    }
    const body = (await res.json()) as { client_secret?: string; intention_order_id?: number | string };
    if (!body.client_secret || body.intention_order_id === undefined || body.intention_order_id === null) {
      throw new ProviderRequestError('Paymob intention response did not include client_secret and intention_order_id');
    }
    const url = new URL('/unifiedcheckout/', this.cfg.apiBase);
    url.searchParams.set('publicKey', this.cfg.publicKey);
    url.searchParams.set('clientSecret', body.client_secret);
    // The Paymob order id is covered by the callback HMAC; merchant_order_id is not.
    return { checkoutUrl: url.toString(), providerRef: String(body.intention_order_id) };
  }

  parseWebhook(input: WebhookInput): NormalizedEvent {
    const sent = input.query.hmac;
    if (typeof sent !== 'string') throw new WebhookSignatureError('missing hmac');
    let payload: { type?: string; obj?: PaymobTransaction };
    try {
      payload = JSON.parse(input.rawBody.toString('utf8'));
    } catch {
      throw new WebhookSignatureError('invalid json');
    }
    const txn = payload.obj;
    if (payload.type !== 'TRANSACTION' || !txn) throw new WebhookSignatureError('unsupported callback type');
    if (!safeEqual(sent.toLowerCase(), paymobTransactionHmac(this.cfg.hmacSecret, txn))) throw new WebhookSignatureError('bad hmac');

    const invoiceId = (txn.order.merchant_order_id ?? '').split('.')[0] ?? '';
    const checkoutRef = String(txn.order.id);
    // One transaction can produce several callbacks (processed, voided, refunded).
    const eventId = `txn_${txn.id}_${txn.success}_${txn.pending}_${txn.is_voided}_${txn.is_refunded}`;
    if (txn.pending) return { type: 'ignored', eventId, reason: 'pending', invoiceId };
    if (txn.is_refunded || txn.is_voided) return { type: 'ignored', eventId, reason: 'refund/void requires manual review', invoiceId };
    if (txn.success) {
      return { type: 'payment.succeeded', eventId, invoiceId, checkoutRef, providerTxnId: String(txn.id), amountCents: txn.amount_cents, currency: txn.currency };
    }
    return { type: 'payment.failed', eventId, invoiceId, checkoutRef, providerTxnId: String(txn.id), amountCents: txn.amount_cents, currency: txn.currency, reason: txn.data?.message ?? 'declined' };
  }
}
