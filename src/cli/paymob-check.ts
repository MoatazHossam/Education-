import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { safeEqual } from '../lib/crypto.js';
import { paymobHmac, PaymobProvider } from '../billing/providers/paymob.js';

// Usage (test-mode keys only; live keys are refused):
//   PAYMOB_SECRET_KEY=egy_sk_test_… PAYMOB_PUBLIC_KEY=egy_pk_test_… PAYMOB_HMAC_SECRET=… \
//   PAYMOB_INTEGRATION_IDS=<card integration id> npm run paymob:check [-- --amount 1000 --port 8787]
//
// Runs this application's PaymobProvider against Paymob's real API:
//   1. creates an intention (checks the Authorization header, payload and integration ids);
//   2. prints the Unified Checkout URL to pay with Paymob's test card;
//   3. receives the browser redirect on localhost and verifies its HMAC and order binding.
// The server-to-server callback needs a public URL and is checked in staging (DEPLOYMENT_GUIDE §3.5).
function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main() {
  const apiBase = process.env.PAYMOB_API_BASE?.trim() || 'https://accept.paymob.com';
  const secretKey = required('PAYMOB_SECRET_KEY');
  const publicKey = required('PAYMOB_PUBLIC_KEY');
  const hmacSecret = required('PAYMOB_HMAC_SECRET');
  const integrationIds = required('PAYMOB_INTEGRATION_IDS').split(',').map((s) => Number(s.trim())).filter(Number.isFinite);
  if (!secretKey.includes('_sk_test_') || !publicKey.includes('_pk_test_')) {
    throw new Error('Refusing to run: PAYMOB_SECRET_KEY and PAYMOB_PUBLIC_KEY must be test-mode keys (…_sk_test_…, …_pk_test_…).');
  }
  const amountCents = Number(arg('amount', '1000'));
  const port = Number(arg('port', '8787'));
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error('--amount must be a positive integer (piastres)');

  const provider = new PaymobProvider({ apiBase, secretKey, publicKey, hmacSecret, integrationIds });
  const invoiceId = randomUUID();
  const returnUrl = `http://localhost:${port}/paymob-return`;
  const checkout = await provider.createCheckout({
    invoiceId,
    invoiceNumber: 'PAYMOB-CHECK',
    amountCents,
    currency: 'EGP',
    description: 'Midad integration check',
    customer: { email: arg('email', 'paymob-check@example.com'), name: 'Paymob Check' },
    returnUrl,
    webhookUrl: returnUrl,
  });
  console.log(`✓ Step 1: Paymob accepted the intention (order ${checkout.providerRef}).`);
  console.log(`\nStep 2: open this URL and pay with Paymob's test card:\n\n  ${checkout.checkoutUrl}\n`);
  console.log(`Waiting for the redirect on ${returnUrl} (15 minutes)…`);

  const ok = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      console.error('✗ No redirect received within 15 minutes.');
      server.close();
      resolve(false);
    }, 15 * 60_000);
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', returnUrl);
      if (url.pathname !== '/paymob-return') {
        res.writeHead(404).end();
        return;
      }
      const q = Object.fromEntries(url.searchParams);
      const hmacOk = typeof q.hmac === 'string' && safeEqual(q.hmac.toLowerCase(), paymobHmac(hmacSecret, q));
      const orderOk = q.order === checkout.providerRef;
      const refOk = (q.merchant_order_id ?? '').split('.')[0] === invoiceId;
      const fields = Object.fromEntries(Object.entries(q).filter(([k]) => k !== 'hmac'));
      console.log('\nRedirect fields:', JSON.stringify(fields, null, 2));
      console.log(`${hmacOk ? '✓' : '✗'} Step 3: HMAC over the documented fields ${hmacOk ? 'matches' : 'does NOT match'} Paymob's signature.`);
      console.log(`${orderOk ? '✓' : '✗'} Order id in the redirect ${orderOk ? 'matches' : 'does NOT match'} the intention's order id.`);
      console.log(`${refOk ? '✓' : '✗'} merchant_order_id ${refOk ? 'carries' : 'does NOT carry'} the special_reference sent.`);
      console.log(`  Transaction: success=${q.success} pending=${q.pending} message=${q['data.message'] ?? ''}`);
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end('Paymob check received. You can close this tab and return to the terminal.');
      clearTimeout(timer);
      server.close();
      resolve(hmacOk && orderOk && refOk);
    });
    server.listen(port, '127.0.0.1');
  });
  process.exitCode = ok ? 0 : 1;
}

main().catch((err: unknown) => {
  console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
