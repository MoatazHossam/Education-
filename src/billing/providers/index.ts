import type { AppConfig } from '../../config.js';
import { PaymobProvider } from './paymob.js';
import { SandboxProvider } from './sandbox.js';
import type { PaymentProvider } from './types.js';

export function createPaymentProvider(config: AppConfig): PaymentProvider | null {
  switch (config.BILLING_PROVIDER) {
    case 'sandbox':
      return new SandboxProvider(config.SANDBOX_WEBHOOK_SECRET!, config.APP_URL);
    case 'paymob':
      return new PaymobProvider({
        apiBase: config.PAYMOB_API_BASE,
        secretKey: config.PAYMOB_SECRET_KEY!,
        publicKey: config.PAYMOB_PUBLIC_KEY!,
        hmacSecret: config.PAYMOB_HMAC_SECRET!,
        integrationIds: config.PAYMOB_INTEGRATION_IDS!.split(',').map((s) => Number(s.trim())).filter(Number.isFinite),
      });
    case 'disabled':
      return null;
  }
}
