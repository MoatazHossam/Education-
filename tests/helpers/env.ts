// Shared test configuration. TEST_PG_ADMIN_URL must point at a role that can
// create roles and databases (a local superuser or the CI service container).
export const ADMIN_URL = process.env.TEST_PG_ADMIN_URL ?? 'postgres://postgres@127.0.0.1:5432/postgres';
export const TEST_DB = process.env.TEST_DB_NAME ?? 'curriculum_scope_test';

function withCredentials(url: string, user: string, password: string, db: string): string {
  const u = new URL(url);
  u.username = user;
  u.password = password;
  u.pathname = `/${db}`;
  return u.toString();
}

export const OWNER_URL = withCredentials(ADMIN_URL, 'cs_test_owner', 'owner-test-pw', TEST_DB);
export const APP_URL_DB = withCredentials(ADMIN_URL, 'cs_test_app', 'app-test-pw', TEST_DB);

export const TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  APP_URL: 'http://localhost:3000',
  LOG_LEVEL: 'silent',
  DATABASE_URL: APP_URL_DB,
  MIGRATION_DATABASE_URL: OWNER_URL,
  SESSION_SECRET: 'test-session-secret-0123456789-abcdefghijklmnop',
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  EMAIL_TRANSPORT: 'none',
  BILLING_PROVIDER: 'sandbox',
  SANDBOX_WEBHOOK_SECRET: 'sandbox-test-secret-123456',
  TRIAL_DAYS: '14',
  GRACE_DAYS: '7',
};
