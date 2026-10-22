import { hmacHex, safeEqual } from '../../lib/crypto.js';
import { WebhookSignatureError, type CheckoutRequest, type CheckoutResult, type NormalizedEvent, type PaymentProvider, type WebhookInput } from './types.js';

export interface PaymobConfig {
  apiBase: string;
  secretKey: string;
  publicKey: string;
  hmacSecret: string;
  integrationIds: number[];
}

interface PaymobTransaction {
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

// Field order for the "transaction processed" callback HMAC (SHA-512), per
// Paymob's HMAC documentation. Concatenated without separators.
const HMAC_FIELDS: ((t: PaymobTransaction) => unknown)[] = [
  (t) => t.amount_cents,
  (t) => t.created_at,
  (t) => t.currency,
  (t) => t.error_occured,
  (t) => t.has_parent_transaction,
  (t) => t.id,
  (t) => t.integration_id,
  (t) => t.is_3d_secure,
  (t) => t.is_auth,
  (t) => t.is_capture,
  (t) => t.is_refunded,
  (t) => t.is_standalone_payment,
  (t) => t.is_voided,
  (t) => t.order.id,
  (t) => t.owner,
  (t) => t.pending,
  (t) => t.source_data.pan,
  (t) => t.source_data.sub_type,
  (t) => t.source_data.type,
  (t) => t.success,
];

export function paymobTransactionHmac(secret: string, txn: PaymobTransaction): string {
  return hmacHex(secret, HMAC_FIELDS.map((f) => String(f(txn))).join(''), 'sha512');
}

/**
 * Paymob (Egypt) adapter: Intention API + Unified Checkout for one-off period
 * payments, and the transaction-processed webhook for results.
 * NOT VERIFIED against a live Paymob sandbox in this repository (no credentials);
 * the HMAC routine is unit-tested against the documented field order only.
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
    });
    if (!res.ok) throw new Error(`Paymob intention failed with HTTP ${res.status}`);
    const body = (await res.json()) as { id?: string; client_secret?: string };
    if (!body.client_secret) throw new Error('Paymob intention response did not include client_secret');
    const url = new URL('/unifiedcheckout/', this.cfg.apiBase);
    url.searchParams.set('publicKey', this.cfg.publicKey);
    url.searchParams.set('clientSecret', body.client_secret);
    return { checkoutUrl: url.toString(), providerRef: body.id ?? specialReference };
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
    // One transaction can produce several callbacks (processed, voided, refunded).
    const eventId = `txn_${txn.id}_${txn.success}_${txn.pending}_${txn.is_voided}_${txn.is_refunded}`;
    if (txn.pending) return { type: 'ignored', eventId, reason: 'pending', invoiceId };
    if (txn.is_refunded || txn.is_voided) return { type: 'ignored', eventId, reason: 'refund/void requires manual review', invoiceId };
    if (txn.success) {
      return { type: 'payment.succeeded', eventId, invoiceId, providerTxnId: String(txn.id), amountCents: txn.amount_cents, currency: txn.currency };
    }
    return { type: 'payment.failed', eventId, invoiceId, providerTxnId: String(txn.id), amountCents: txn.amount_cents, currency: txn.currency, reason: txn.data?.message ?? 'declined' };
  }
}
