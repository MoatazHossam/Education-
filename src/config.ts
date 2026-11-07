import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { KeyRing } from './lib/crypto.js';

const bool = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((v) => v === 'true' || v === '1' || v === 'yes');

/**
 * Which process reads the configuration. Each container gets only the settings it needs
 * (docker-compose.yml, production finding S-9):
 * - web (the app instances, and tools run in them): everything;
 * - worker: no SESSION_SECRET (it signs no sessions or forms), no Paymob, sandbox or AI keys
 *   (the payment provider and the AI provider are called from the web app only).
 * Migrations use loadMigrationConfig instead: the schema owner's database address and little else.
 */
export type ConfigRole = 'web' | 'worker';

const envSchema = (role: ConfigRole) => z
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
    // The system role (BYPASSRLS, not superuser) for cross-tenant work: billing webhooks,
    // the worker's passes, platform administration (src/db/index.ts, withSystemContext).
    // The application role in DATABASE_URL cannot bypass Row-Level Security at all.
    SYSTEM_DATABASE_URL: z.string().min(1, 'SYSTEM_DATABASE_URL is required (the system role with BYPASSRLS)'),
    SYSTEM_DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),

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
    EMAIL_FROM: z.string().default('Midad <no-reply@localhost>'),

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

    // Where new homework files are kept (docs/CLASSROOM.md §5): in the database, or in an S3-compatible bucket
    // (Amazon S3, Cloudflare R2, Backblaze B2, DigitalOcean Spaces, Wasabi, MinIO, ...). Each object is encrypted
    // with its own key before it leaves the application; that key is kept in the database, encrypted with
    // DATA_ENCRYPTION_KEY. Files already kept elsewhere stay readable while the bucket settings are given;
    // npm run files:move moves them (docs/DEPLOYMENT_GUIDE.md, "Homework files in object storage").
    FILE_STORAGE: z.enum(['database', 's3']).default('database'),
    // The provider's endpoint; leave it out for Amazon S3 in S3_REGION.
    S3_ENDPOINT: z.url().regex(/^https?:\/\//, 'S3_ENDPOINT must be an http(s) URL').optional(),
    // "auto" for Cloudflare R2.
    S3_REGION: z.string().regex(/^[a-z0-9-]{2,40}$/, 'S3_REGION must be a region name such as eu-central-1 or auto').default('us-east-1'),
    S3_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, 'S3_BUCKET must be a bucket name (3-63 lowercase letters, digits, dots and hyphens)').optional(),
    S3_ACCESS_KEY_ID: z.string().min(1).max(256).optional(),
    S3_SECRET_ACCESS_KEY: z.string().min(1).max(256).optional(),
    // Bucket in the path (https://host/bucket/key) instead of the host name; MinIO and some others need it.
    S3_FORCE_PATH_STYLE: bool.default(false),

    // AI assistance (docs/AI_LAYER.md): one provider for the whole server, used
    // only by schools a platform administrator has enabled. "none" turns it off.
    // AI_API_BASE replaces the provider's endpoint (a regional endpoint, a
    // compatible service, or a local simulator in tests).
    AI_PROVIDER: z.enum(['none', 'gemini', 'anthropic', 'openai']).default('none'),
    AI_API_KEY: z.string().min(8).optional(),
    AI_MODEL: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/, 'AI_MODEL must be a model id such as gemini-2.5-pro or claude-opus-5-5').optional(),
    AI_API_BASE: z.url().regex(/^https?:\/\//, 'AI_API_BASE must be an http(s) URL').optional(),
    // Per attempt, and retries after the first attempt of one provider call. With two attempts for a
    // reply of the right shape, a request waits at most about 2 × ((1 + retries) × timeout + 10 s
    // per retry): 4 min 20 s with these defaults (src/ai/service.ts aiWorstCaseMs, finding A-4).
    AI_TIMEOUT_MS: z.coerce.number().int().min(5000).max(600_000).default(60_000),
    AI_MAX_RETRIES: z.coerce.number().int().min(0).max(3).default(1),
    AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).max(64_000).default(16_000),
    // Requests one member may make per day in one school (production finding A-5); 0: no daily cap.
    AI_USER_DAILY_LIMIT: z.coerce.number().int().min(0).max(10_000).default(50),
    // What all schools' AI requests may cost in a month, in US dollars, priced from ai_model_prices
    // (production finding A-2); 0: no platform cap. Reached, new requests get 503 AI_PAUSED.
    AI_MONTHLY_BUDGET_USD: z.coerce.number().min(0).max(1_000_000).default(0),
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
      if (env.AI_API_BASE && !env.AI_API_BASE.startsWith('https://')) {
        ctx.addIssue({ code: 'custom', path: ['AI_API_BASE'], message: 'AI_API_BASE must use https in production' });
      }
      if (!env.FILE_SCAN) {
        ctx.addIssue({ code: 'custom', path: ['FILE_SCAN'], message: 'FILE_SCAN must be set in production: clamav (scan homework files for viruses) or off' });
      }
      if (env.S3_ENDPOINT && !env.S3_ENDPOINT.startsWith('https://')) {
        ctx.addIssue({ code: 'custom', path: ['S3_ENDPOINT'], message: 'S3_ENDPOINT must use https in production' });
      }
    }
    if (env.SYSTEM_DATABASE_URL === env.DATABASE_URL) {
      ctx.addIssue({ code: 'custom', path: ['SYSTEM_DATABASE_URL'], message: 'SYSTEM_DATABASE_URL must use the system role, not the application role of DATABASE_URL' });
    }
    if (env.FILE_SCAN === 'clamav' && !env.CLAMAV_HOST) {
      ctx.addIssue({ code: 'custom', path: ['CLAMAV_HOST'], message: 'CLAMAV_HOST is required when FILE_SCAN=clamav' });
    }
    if (env.FILE_STORAGE === 's3' && !env.S3_BUCKET) {
      ctx.addIssue({ code: 'custom', path: ['S3_BUCKET'], message: 'S3_BUCKET is required when FILE_STORAGE=s3' });
    }
    if (env.S3_BUCKET) {
      for (const key of ['S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const) {
        if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: `${key} is required when S3_BUCKET is set` });
      }
    }
    if (env.DATA_ENCRYPTION_KEYS_PREVIOUS.includes(env.DATA_ENCRYPTION_KEY)) {
      ctx.addIssue({ code: 'custom', path: ['DATA_ENCRYPTION_KEYS_PREVIOUS'], message: 'DATA_ENCRYPTION_KEYS_PREVIOUS must not contain the current DATA_ENCRYPTION_KEY' });
    }
    if (env.EMAIL_TRANSPORT === 'smtp' && !env.SMTP_URL) {
      ctx.addIssue({ code: 'custom', path: ['SMTP_URL'], message: 'SMTP_URL is required when EMAIL_TRANSPORT=smtp' });
    }
    // Keys the worker never gets: only the web app calls the payment and AI providers.
    if (role === 'worker') return;
    if (env.BILLING_PROVIDER === 'sandbox' && !env.SANDBOX_WEBHOOK_SECRET) {
      ctx.addIssue({ code: 'custom', path: ['SANDBOX_WEBHOOK_SECRET'], message: 'SANDBOX_WEBHOOK_SECRET is required for the sandbox provider' });
    }
    if (env.AI_PROVIDER !== 'none') {
      for (const key of ['AI_API_KEY', 'AI_MODEL'] as const) {
        if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: `${key} is required when AI_PROVIDER=${env.AI_PROVIDER}` });
      }
    }
    if (env.BILLING_PROVIDER === 'paymob') {
      for (const key of ['PAYMOB_SECRET_KEY', 'PAYMOB_PUBLIC_KEY', 'PAYMOB_HMAC_SECRET', 'PAYMOB_INTEGRATION_IDS'] as const) {
        if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: `${key} is required when BILLING_PROVIDER=paymob` });
      }
    }
  });

export type Env = z.infer<ReturnType<typeof envSchema>>;

/** Every setting the application reads (tests/unit/compose-env.test.ts checks that docker-compose.yml passes each one). */
export const CONFIG_KEYS: readonly string[] = Object.keys(envSchema('web').shape);

export interface AppConfig extends Env {
  /** DATA_ENCRYPTION_KEY and the previous keys, for encryptSecret/decryptSecret. */
  dataKeys: KeyRing;
  isProduction: boolean;
  isTest: boolean;
  secureCookies: boolean;
  appOrigin: string;
}

/**
 * The secret settings, each of which can instead be read from a file named by `<NAME>_FILE` (Docker or Kubernetes
 * secrets, systemd credentials, a secret manager's agent; docker-compose.secrets.yml). A secret read from a file is
 * not in the process environment, so `docker inspect`, `/proc/<pid>/environ` and child processes do not show it.
 */
export const FILE_SETTINGS = [
  'SESSION_SECRET', 'DATA_ENCRYPTION_KEY', 'DATA_ENCRYPTION_KEYS_PREVIOUS',
  'DATABASE_URL', 'SYSTEM_DATABASE_URL', 'MIGRATION_DATABASE_URL', 'SMTP_URL',
  'SANDBOX_WEBHOOK_SECRET', 'PAYMOB_SECRET_KEY', 'PAYMOB_PUBLIC_KEY', 'PAYMOB_HMAC_SECRET', 'AI_API_KEY', 'ALERT_WEBHOOK_URL',
  'S3_SECRET_ACCESS_KEY',
] as const;

/**
 * Each `<NAME>_FILE` replaced by the file's contents, without the line ending a text editor adds. A setting and its
 * file cannot both be given; an empty file means "not set", like an empty variable. Messages name the setting and
 * the path, never what a file holds.
 */
function withFiles(source: Record<string, string | undefined>): Record<string, string | undefined> {
  const values = { ...source };
  const problems: string[] = [];
  for (const key of FILE_SETTINGS) {
    const path = source[`${key}_FILE`]?.trim();
    if (!path) continue;
    if (source[key]?.trim()) {
      problems.push(`  - ${key}: set ${key} or ${key}_FILE, not both`);
      continue;
    }
    try {
      values[key] = readFileSync(path, 'utf8').replace(/[\r\n]+$/, '');
    } catch (err) {
      problems.push(`  - ${key}_FILE: cannot read ${path} (${(err as NodeJS.ErrnoException).code ?? 'error'})`);
    }
  }
  if (problems.length) throw new Error(`Invalid configuration:\n${problems.join('\n')}`);
  return values;
}

// Empty values (e.g. `SALES_EMAIL=` in an env file, or unset variables that
// Docker Compose interpolates to "") mean "not set".
function setValues(source: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(withFiles(source)).filter((e): e is [string, string] => e[1] !== undefined && e[1].trim() !== ''));
}

function parsed<T>(schema: z.ZodType<T>, values: Record<string, string>): T {
  const result = schema.safeParse(values);
  if (!result.success) {
    const message = (i: z.core.$ZodIssue) => {
      const key = i.path.join('.');
      // A required setting that is not set at all: say so, and where else it can come from.
      if (i.code !== 'invalid_type' || key in values) return i.message;
      return (FILE_SETTINGS as readonly string[]).includes(key) ? `${key} is required (or ${key}_FILE, a file that holds it)` : `${key} is required`;
    };
    const details = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${message(i)}`).join('\n');
    throw new Error(`Invalid configuration:\n${details}`);
  }
  return result.data;
}

export function loadConfig(source: Record<string, string | undefined> = process.env, role: ConfigRole = 'web'): AppConfig {
  const values = setValues(source);
  // The worker gets no SESSION_SECRET; a random one stands in, so nothing in it can depend on the real one.
  if (role === 'worker') values.SESSION_SECRET ??= randomBytes(48).toString('base64');
  const env = parsed(envSchema(role), values);
  return {
    ...env,
    dataKeys: { current: env.DATA_ENCRYPTION_KEY, previous: env.DATA_ENCRYPTION_KEYS_PREVIOUS },
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
    secureCookies: env.APP_URL.startsWith('https://'),
    appOrigin: new URL(env.APP_URL).origin,
  };
}

const MigrationEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    // The schema owner; DATABASE_URL in development, where one role may own everything.
    MIGRATION_DATABASE_URL: z.string().min(1).optional(),
    DATABASE_URL: z.string().min(1).optional(),
    DATABASE_SSL: bool.default(false),
    BILLING_CURRENCY: z.string().regex(/^[A-Z]{3}$/).default('EGP'),
  })
  .refine((env) => env.MIGRATION_DATABASE_URL || env.DATABASE_URL, { path: ['MIGRATION_DATABASE_URL'], message: 'MIGRATION_DATABASE_URL is required (or MIGRATION_DATABASE_URL_FILE, a file that holds it)' });

export interface MigrationConfig {
  databaseUrl: string;
  DATABASE_SSL: boolean;
  BILLING_CURRENCY: string;
  isProduction: boolean;
}

/**
 * Settings of the migrate job (src/db/migrate-cli.ts, seed-cli --catalog-only): the schema owner's database and
 * nothing of the application's secrets, which the migrate container does not get (docker-compose.yml).
 */
export function loadMigrationConfig(source: Record<string, string | undefined> = process.env): MigrationConfig {
  const env = parsed(MigrationEnvSchema, setValues(source));
  return {
    databaseUrl: (env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL)!,
    DATABASE_SSL: env.DATABASE_SSL,
    BILLING_CURRENCY: env.BILLING_CURRENCY,
    isProduction: env.NODE_ENV === 'production',
  };
}
