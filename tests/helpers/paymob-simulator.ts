import { createHmac, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Local stand-in for Paymob's Intention API, Unified Checkout and transaction
 * callbacks, written from Paymob's developer documentation (Create Intention;
 * HMAC Transaction Callback) and cross-checked with Odoo's payment_paymob
 * module. It enforces what those sources document; anything they do not
 * describe (e.g. exact error bodies, refund callback shape) is an assumption
 * marked below. Passing against it does not replace a test-mode run against
 * Paymob itself (`npm run paymob:check`).
 *
 * Signatures are computed here independently of src/billing/providers/paymob.ts,
 * using the documented algorithm: flatten the transaction, take the 20 listed
 * keys sorted lexicographically, concatenate their values, HMAC-SHA512 (hex).
 */

export interface SimulatorKeys {
  secretKey: string;
  publicKey: string;
  hmacSecret: string;
  integrationIds: number[];
}

export interface Intention {
  id: string;
  intention_order_id: number;
  client_secret: string;
  special_reference: string;
  amount: number;
  currency: string;
  payment_methods: number[];
  notification_url?: string;
  redirection_url?: string;
}

export interface RecordedRequest {
  method: string;
  path: string;
  headers: IncomingMessage['headers'];
  body: unknown;
}

export type Outcome = 'success' | 'declined' | 'pending' | 'refunded';

const SIGNED_KEYS = [
  'success', 'source_data.type', 'source_data.sub_type', 'source_data.pan', 'pending', 'owner', 'order', 'is_voided',
  'is_standalone_payment', 'is_refunded', 'is_capture', 'is_auth', 'is_3d_secure', 'integration_id', 'id',
  'has_parent_transaction', 'error_occured', 'currency', 'created_at', 'amount_cents',
].sort();

function flatten(obj: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'order' && v && typeof v === 'object') out[prefix + k] = (v as { id: unknown }).id;
    else if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(out, flatten(v as Record<string, unknown>, `${prefix}${k}.`));
    else out[prefix + k] = v;
  }
  return out;
}

export class PaymobSimulator {
  readonly requests: RecordedRequest[] = [];
  readonly intentions = new Map<string, Intention>();
  private nextOrderId = 310_000_000;
  private nextTxnId = 190_000_000;
  private failNextWith: { status: number; body: unknown } | null = null;

  private constructor(
    private readonly server: Server,
    readonly baseUrl: string,
    readonly keys: SimulatorKeys,
  ) {}

  static async start(keys: SimulatorKeys): Promise<PaymobSimulator> {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const sim = new PaymobSimulator(server, `http://127.0.0.1:${(server.address() as AddressInfo).port}`, keys);
    server.on('request', (req: IncomingMessage, res: ServerResponse) => void sim.handle(req, res));
    return sim;
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  /** Makes the next Intention API call fail with this response. */
  failNext(status: number, body: unknown): void {
    this.failNextWith = { status, body };
  }

  /** The intention behind a Unified Checkout URL returned to the customer. */
  intentionForCheckoutUrl(checkoutUrl: string): Intention {
    const secret = new URL(checkoutUrl).searchParams.get('clientSecret') ?? '';
    const intention = this.intentions.get(secret);
    if (!intention) throw new Error(`no intention for checkout URL ${checkoutUrl}`);
    return intention;
  }

  /** Creates an intention directly, as another merchant integration would. */
  async createIntentionDirectly(body: Record<string, unknown>): Promise<Intention> {
    const res = await fetch(`${this.baseUrl}/v1/intention/`, {
      method: 'POST',
      headers: { Authorization: `Token ${this.keys.secretKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status !== 201) throw new Error(`intention failed: ${res.status} ${await res.text()}`);
    return (await res.json()) as Intention;
  }

  sign(obj: Record<string, unknown>, secret = this.keys.hmacSecret): string {
    const flat = flatten(obj);
    return createHmac('sha512', secret).update(SIGNED_KEYS.map((k) => String(flat[k])).join('')).digest('hex');
  }

  /** The transaction object Paymob reports after a payment attempt on `intention`. */
  transaction(intention: Intention, outcome: Outcome, overrides: { amountCents?: number } = {}): Record<string, unknown> {
    const success = outcome === 'success' || outcome === 'refunded';
    const created = new Date().toISOString().replace('Z', '000');
    return {
      id: this.nextTxnId++,
      pending: outcome === 'pending',
      amount_cents: overrides.amountCents ?? intention.amount,
      success,
      is_auth: false,
      is_capture: false,
      is_standalone_payment: true,
      is_voided: false,
      // Assumption: a refund is reported as the original transaction with is_refunded=true.
      is_refunded: outcome === 'refunded',
      is_3d_secure: true,
      integration_id: intention.payment_methods[0],
      profile_id: 1_000_001,
      has_parent_transaction: false,
      order: { id: intention.intention_order_id, merchant_order_id: intention.special_reference, amount_cents: intention.amount, currency: intention.currency },
      created_at: created,
      currency: intention.currency,
      error_occured: false,
      owner: 2_000_001,
      source_data: { pan: '2346', type: 'card', sub_type: 'MasterCard' },
      data: { message: success ? 'Approved' : outcome === 'pending' ? 'Pending' : 'Do not honour' },
    };
  }

  /** The POST Paymob sends to `notification_url`: JSON body, HMAC in the query string. */
  callback(txn: Record<string, unknown>, secret = this.keys.hmacSecret): { path: string; body: string } {
    return {
      path: `?hmac=${this.sign(txn, secret)}`,
      body: JSON.stringify({ type: 'TRANSACTION', obj: txn, issuer_bank: null, transaction_processed_callback_responses: '' }),
    };
  }

  /** Query string of the browser redirect to `redirection_url`: flattened fields as strings, plus the HMAC. */
  redirectQuery(txn: Record<string, unknown>, secret = this.keys.hmacSecret): URLSearchParams {
    const flat = flatten(txn);
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(flat)) if (v !== null && v !== undefined) q.set(k, String(v));
    q.set('merchant_order_id', String((txn.order as { merchant_order_id: unknown }).merchant_order_id));
    q.set('hmac', this.sign(txn, secret));
    return q;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', this.baseUrl);
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8');
    let body: unknown = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = raw;
    }
    this.requests.push({ method: req.method ?? '', path: url.pathname, headers: req.headers, body });
    const send = (status: number, payload: unknown) => {
      res.writeHead(status, { 'content-type': typeof payload === 'string' ? 'text/html' : 'application/json' });
      res.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
    };

    if (req.method === 'POST' && url.pathname === '/v1/intention/') {
      if (req.headers.authorization !== `Token ${this.keys.secretKey}`) return send(401, { detail: 'Invalid token.' });
      if (this.failNextWith) {
        const f = this.failNextWith;
        this.failNextWith = null;
        return send(f.status, f.body);
      }
      const problems = this.validateIntention(body);
      if (Object.keys(problems).length) return send(400, problems);
      const b = body as Record<string, unknown>;
      const intention: Intention = {
        id: `pi_test_${randomBytes(16).toString('hex')}`,
        intention_order_id: this.nextOrderId++,
        client_secret: `egy_csk_test_${randomBytes(16).toString('hex')}`,
        special_reference: String(b.special_reference ?? ''),
        amount: b.amount as number,
        currency: b.currency as string,
        payment_methods: b.payment_methods as number[],
        notification_url: b.notification_url as string | undefined,
        redirection_url: b.redirection_url as string | undefined,
      };
      this.intentions.set(intention.client_secret, intention);
      return send(201, { ...intention, status: 'intended', created: new Date().toISOString() });
    }

    if (req.method === 'GET' && url.pathname === '/unifiedcheckout/') {
      const intention = this.intentions.get(url.searchParams.get('clientSecret') ?? '');
      if (!intention || url.searchParams.get('publicKey') !== this.keys.publicKey) return send(404, '<h1>Not found</h1>');
      return send(200, `<h1>Unified Checkout</h1><p>${intention.amount} ${intention.currency}</p>`);
    }

    return send(404, { detail: 'Not found.' });
  }

  /** Field rules from the Create Intention documentation. Error body shape is an assumption. */
  private validateIntention(body: unknown): Record<string, unknown> {
    const problems: Record<string, unknown> = {};
    if (!body || typeof body !== 'object') return { detail: 'JSON body required' };
    const b = body as Record<string, unknown>;
    if (!Number.isInteger(b.amount) || (b.amount as number) <= 0) problems.amount = ['A positive integer in the smallest currency unit is required.'];
    if (typeof b.currency !== 'string' || !/^[A-Z]{3}$/.test(b.currency)) problems.currency = ['A valid ISO 4217 currency is required.'];
    const methods = b.payment_methods;
    if (!Array.isArray(methods) || methods.length === 0) problems.payment_methods = ['At least one integration is required.'];
    else if (methods.some((m) => typeof m === 'number' && !this.keys.integrationIds.includes(m))) problems.payment_methods = ['Integration not found for this merchant.'];
    if (Array.isArray(b.items)) {
      const total = (b.items as { amount?: unknown; quantity?: unknown }[]).reduce((sum, i) => sum + Number(i.amount) * Number(i.quantity ?? 1), 0);
      if (total !== b.amount) problems.items = ['The sum of item amounts must equal the intention amount.'];
      if ((b.items as { name?: unknown }[]).some((i) => typeof i.name !== 'string' || i.name.length === 0 || i.name.length > 50)) problems.items = ['Item names must be 1-50 characters.'];
    }
    const billing = (b.billing_data ?? {}) as Record<string, unknown>;
    const blank = ['first_name', 'last_name', 'email', 'phone_number'].filter((k) => typeof billing[k] !== 'string' || (billing[k] as string).trim() === '');
    if (blank.length) problems.billing_data = Object.fromEntries(blank.map((k) => [k, ['This field may not be blank.']]));
    if (b.special_reference !== undefined && [...this.intentions.values()].some((i) => i.special_reference === b.special_reference)) {
      problems.special_reference = ['special_reference must be unique.'];
    }
    for (const k of ['notification_url', 'redirection_url']) {
      if (b[k] !== undefined && !URL.canParse(String(b[k]))) problems[k] = ['Enter a valid URL.'];
    }
    return problems;
  }
}
