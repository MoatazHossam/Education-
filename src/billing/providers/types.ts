/**
 * Payment provider abstraction. Providers only move money and report what
 * happened; all subscription state lives in our database and is changed by
 * the billing service in response to normalized, signature-verified events.
 * No card data ever reaches this application (hosted checkout pages only).
 */
export interface CheckoutRequest {
  invoiceId: string;
  invoiceNumber: string;
  amountCents: number;
  currency: string;
  description: string;
  customer: { email: string; name: string };
  returnUrl: string;
  webhookUrl: string;
}

export interface CheckoutResult {
  checkoutUrl: string;
  providerRef: string;
}

/**
 * `checkoutRef` is set by providers whose signature covers the checkout they
 * created (CheckoutResult.providerRef) but not the invoice id they echo back;
 * the invoice is then resolved from the recorded checkout session instead.
 */
export type NormalizedEvent =
  | { type: 'payment.succeeded'; eventId: string; invoiceId: string; checkoutRef?: string; providerTxnId: string; amountCents: number; currency: string }
  | { type: 'payment.failed'; eventId: string; invoiceId: string; checkoutRef?: string; providerTxnId: string; amountCents: number; currency: string; reason: string }
  | { type: 'ignored'; eventId: string; reason: string; invoiceId?: string | null };

export interface WebhookInput {
  rawBody: Buffer;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, unknown>;
}

export class WebhookSignatureError extends Error {}

/** The provider's API refused or failed a request (details are for server logs only). */
export class ProviderRequestError extends Error {}

export interface PaymentProvider {
  readonly name: string;
  createCheckout(req: CheckoutRequest): Promise<CheckoutResult>;
  /** Throws WebhookSignatureError when the payload is not authentic. */
  parseWebhook(input: WebhookInput): NormalizedEvent;
}
