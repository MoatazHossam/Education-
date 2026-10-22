import { hmacHex, safeEqual } from '../../lib/crypto.js';
import { WebhookSignatureError, type CheckoutRequest, type CheckoutResult, type NormalizedEvent, type PaymentProvider, type WebhookInput } from './types.js';

const TOLERANCE_S = 300;

/**
 * Development/test provider. Its hosted "checkout" page is served by this app
 * and completes payments by sending a signed webhook through the same code
 * path real providers use. Config validation forbids it in production.
 */
export class SandboxProvider implements PaymentProvider {
  readonly name = 'sandbox';
  constructor(
    private readonly secret: string,
    private readonly appUrl: string,
  ) {}

  checkoutSignature(invoiceId: string): string {
    return hmacHex(this.secret, `checkout:${invoiceId}`);
  }

  async createCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
    const sig = this.checkoutSignature(req.invoiceId);
    return { checkoutUrl: `${this.appUrl}/billing/sandbox-checkout?invoice=${req.invoiceId}&sig=${sig}`, providerRef: `sbx_${req.invoiceId}` };
  }

  /** Stripe-style signature header: t=<unix seconds>,v1=<hmac_sha256(secret, "t.body")>. */
  sign(body: string, timestamp = Math.floor(Date.now() / 1000)): string {
    return `t=${timestamp},v1=${hmacHex(this.secret, `${timestamp}.${body}`)}`;
  }

  parseWebhook(input: WebhookInput): NormalizedEvent {
    const header = input.headers['x-sandbox-signature'];
    if (typeof header !== 'string') throw new WebhookSignatureError('missing signature');
    const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
    const t = Number(parts.t);
    if (!Number.isFinite(t) || !parts.v1) throw new WebhookSignatureError('malformed signature');
    // The timestamp is signed, so an old captured request cannot be replayed later.
    if (Math.abs(Date.now() / 1000 - t) > TOLERANCE_S) throw new WebhookSignatureError('timestamp outside tolerance');
    if (!safeEqual(parts.v1, hmacHex(this.secret, `${t}.${input.rawBody.toString('utf8')}`))) throw new WebhookSignatureError('bad signature');

    const evt = JSON.parse(input.rawBody.toString('utf8')) as {
      id: string;
      type: string;
      data: { invoice_id: string; txn_id: string; amount_cents: number; currency: string; reason?: string };
    };
    if (evt.type === 'payment.succeeded') {
      return { type: 'payment.succeeded', eventId: evt.id, invoiceId: evt.data.invoice_id, providerTxnId: evt.data.txn_id, amountCents: evt.data.amount_cents, currency: evt.data.currency };
    }
    if (evt.type === 'payment.failed') {
      return { type: 'payment.failed', eventId: evt.id, invoiceId: evt.data.invoice_id, providerTxnId: evt.data.txn_id, amountCents: evt.data.amount_cents, currency: evt.data.currency, reason: evt.data.reason ?? 'declined' };
    }
    return { type: 'ignored', eventId: evt.id, reason: `unhandled type ${evt.type}` };
  }
}
