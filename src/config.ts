import { z } from 'zod';
import type { KeyRing } from './lib/crypto.js';

const bool = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((v) => v === 'true' || v === '1' || v === 'yes');

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    APP_URL: z.url().default('http://localhost:3000'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    TRUST_PROXY: bool.default(false),

    DATABASE_URL: z.string().min(1),
    MIGRATION_DATABASE_URL: z.string().min(1).optional(),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    DATABASE_SSL: bool.default(false),

    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
    DATA_ENCRYPTION_KEY: z
      .string()
      .refine((v) => Buffer.from(v, 'base64').length === 32, 'DATA_ENCRYPTION_KEY must be 32 bytes, base64-encoded'),
    // During a key rotation: the keys used before, comma-separated. They only decrypt
    // (docs/DEPLOYMENT_GUIDE.md, "Rotating DATA_ENCRYPTION_KEY").
    DATA_ENCRYPTION_KEYS_PREVIOUS: z
      .string()
      .transform((v) => v.split(',').map((k) => k.trim()).filter(Boolean))
      .pipe(z.array(z.string().refine((v) => Buffer.from(v, 'base64').length === 32, 'each previous key must be 32 bytes, base64-encoded')).max(5))
      .default([]),

    EMAIL_TRANSPORT: z.enum(['smtp', 'log', 'none']).default('log'),
    SMTP_URL: z.string().optional(),
    EMAIL_FROM: z.string().default('Curriculum Scope <no-reply@localhost>'),

    BILLING_PROVIDER: z.enum(['sandbox', 'paymob', 'disabled']).default('sandbox'),
    BILLING_CURRENCY: z.string().regex(/^[A-Z]{3}$/).default('EGP'),
    SALES_EMAIL: z.email().optional(),
    SANDBOX_WEBHOOK_SECRET: z.string().min(16).optional(),
    PAYMOB_API_BASE: z.url().default('https://accept.paymob.com'),
    PAYMOB_SECRET_KEY: z.string().optional(),
    PAYMOB_PUBLIC_KEY: z.string().optional(),
    PAYMOB_HMAC_SECRET: z.string().optional(),
    PAYMOB_INTEGRATION_IDS: z.string().optional(),

    TRIAL_DAYS: z.coerce.number().int().min(0).max(90).default(14),
    GRACE_DAYS: z.coerce.number().int().min(0).max(60).default(7),
    RENEWAL_NOTICE_DAYS: z.coerce.number().int().min(1).max(30).default(7),
    AUDIT_RETENTION_DAYS: z.coerce.number().int().min(30).default(730),

    RATE_LIMIT_ENABLED: bool.default(true),
    WORKER_INTERVAL_MS: z.coerce.number().int().min(1000).default(15000),
    // Behind a load balancer: how long /readyz reports "draining" after SIGTERM before the server closes.
    SHUTDOWN_DRAIN_MS: z.coerce.number().int().min(0).max(60_000).default(0),

    // Operational alerts (src/ops/alerts.ts), sent straight from the app, not via the email outbox.
    ALERT_EMAILS: z
      .string()
      .transform((v) => v.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean))
      .pipe(z.array(z.email()).max(20))
      .default([]),
    ALERT_WEBHOOK_URL: z.url().regex(/^https?:\/\//, 'ALERT_WEBHOOK_URL must be an http(s) URL').optional(),
    ALERT_CHECK_INTERVAL_MS: z.coerce.number().int().min(10_000).default(60_000),

    // Webhooks to customer systems normally reach only https URLs on public addresses
    // (src/webhooks/net.ts). For local development and tests, this also allows http and
    // private or loopback addresses. Refused in production.
    WEBHOOK_ALLOW_INSECURE_TARGETS: bool.default(false),

    // Homework files (docs/CLASSROOM.md §5): the worker scans each one with ClamAV
    // (clamd over TCP) before anyone can open it. "off" keeps only the photo
    // resizing. Production must choose explicitly.
    FILE_SCAN: z.enum(['clamav', 'off']).optional(),
    CLAMAV_HOST: z.string().min(1).optional(),
    CLAMAV_PORT: z.coerce.number().int().min(1).max(65535).default(3310),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') {
      if (env.BILLING_PROVIDER === 'sandbox') {
        ctx.addIssue({ code: 'custom', path: ['BILLING_PROVIDER'], message: 'The sandbox billing provider cannot be used in production' });
      }
      if (env.EMAIL_TRANSPORT !== 'smtp') {
        ctx.addIssue({ code: 'custom', path: ['EMAIL_TRANSPORT'], message: 'EMAIL_TRANSPORT must be smtp in production' });
      }
      if (!env.APP_URL.startsWith('https://')) {
        ctx.addIssue({ code: 'custom', path: ['APP_URL'], message: 'APP_URL must use https in production' });
      }
      if (env.ALERT_WEBHOOK_URL && !env.ALERT_WEBHOOK_URL.startsWith('https://')) {
        ctx.addIssue({ code: 'custom', path: ['ALERT_WEBHOOK_URL'], message: 'ALERT_WEBHOOK_URL must use https in production' });
      }
      if (env.WEBHOOK_ALLOW_INSECURE_TARGETS) {
        ctx.addIssue({ code: 'custom', path: ['WEBHOOK_ALLOW_INSECURE_TARGETS'], message: 'WEBHOOK_ALLOW_INSECURE_TARGETS cannot be used in production' });
      }
      if (!env.FILE_SCAN) {
        ctx.addIssue({ code: 'custom', path: ['FILE_SCAN'], message: 'FILE_SCAN must be set in production: clamav (scan homework files for viruses) or off' });
      }
    }
    if (env.FILE_SCAN === 'clamav' && !env.CLAMAV_HOST) {
      ctx.addIssue({ code: 'custom', path: ['CLAMAV_HOST'], message: 'CLAMAV_HOST is required when FILE_SCAN=clamav' });
    }
    if (env.DATA_ENCRYPTION_KEYS_PREVIOUS.includes(env.DATA_ENCRYPTION_KEY)) {
      ctx.addIssue({ code: 'custom', path: ['DATA_ENCRYPTION_KEYS_PREVIOUS'], message: 'DATA_ENCRYPTION_KEYS_PREVIOUS must not contain the current DATA_ENCRYPTION_KEY' });
    }
    if (env.EMAIL_TRANSPORT === 'smtp' && !env.SMTP_URL) {
      ctx.addIssue({ code: 'custom', path: ['SMTP_URL'], message: 'SMTP_URL is required when EMAIL_TRANSPORT=smtp' });
    }
    if (env.BILLING_PROVIDER === 'sandbox' && !env.SANDBOX_WEBHOOK_SECRET) {
      ctx.addIssue({ code: 'custom', path: ['SANDBOX_WEBHOOK_SECRET'], message: 'SANDBOX_WEBHOOK_SECRET is required for the sandbox provider' });
    }
    if (env.BILLING_PROVIDER === 'paymob') {
      for (const key of ['PAYMOB_SECRET_KEY', 'PAYMOB_PUBLIC_KEY', 'PAYMOB_HMAC_SECRET', 'PAYMOB_INTEGRATION_IDS'] as const) {
        if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: `${key} is required when BILLING_PROVIDER=paymob` });
      }
    }
  });

export type Env = z.infer<typeof EnvSchema>;

export interface AppConfig extends Env {
  /** DATA_ENCRYPTION_KEY and the previous keys, for encryptSecret/decryptSecret. */
  dataKeys: KeyRing;
  isProduction: boolean;
  isTest: boolean;
  secureCookies: boolean;
  appOrigin: string;
}

export function loadConfig(source: Record<string, string | undefined> = process.env): AppConfig {
  // Empty values (e.g. `SALES_EMAIL=` in an env file, or unset variables that
  // Docker Compose interpolates to "") mean "not set".
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v.trim() !== ''));
  const parsed = EnvSchema.safeParse(cleaned);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${details}`);
  }
  const env = parsed.data;
  return {
    ...env,
    dataKeys: { current: env.DATA_ENCRYPTION_KEY, previous: env.DATA_ENCRYPTION_KEYS_PREVIOUS },
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
    secureCookies: env.APP_URL.startsWith('https://'),
    appOrigin: new URL(env.APP_URL).origin,
  };
}
