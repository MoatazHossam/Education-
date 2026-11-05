import { describe, expect, it } from 'vitest';
import { loadConfig, loadMigrationConfig } from '../../src/config.js';

// Each process reads only the settings its container gets (docker-compose.yml, production finding S-9).
const KEY = Buffer.alloc(32, 7).toString('base64');
const runtime = {
  NODE_ENV: 'production',
  APP_URL: 'https://midad.example',
  DATABASE_URL: 'postgres://midad_app:pw@db/midad',
  SYSTEM_DATABASE_URL: 'postgres://midad_system:pw@db/midad',
  DATA_ENCRYPTION_KEY: KEY,
  EMAIL_TRANSPORT: 'smtp',
  SMTP_URL: 'smtp://mail.example:587',
  BILLING_PROVIDER: 'paymob',
  FILE_SCAN: 'off',
};
const web = {
  ...runtime,
  SESSION_SECRET: 's'.repeat(48),
  PAYMOB_SECRET_KEY: 'sk',
  PAYMOB_PUBLIC_KEY: 'pk',
  PAYMOB_HMAC_SECRET: 'hmac',
  PAYMOB_INTEGRATION_IDS: '1',
  AI_PROVIDER: 'gemini',
  AI_API_KEY: 'ai-key-123',
  AI_MODEL: 'gemini-2.5-pro',
};

describe('settings per process', () => {
  it('the web app needs SESSION_SECRET and the provider keys its settings name', () => {
    expect(loadConfig(web).SESSION_SECRET).toBe(web.SESSION_SECRET);
    const { SESSION_SECRET: _s, ...noSession } = web;
    expect(() => loadConfig(noSession)).toThrow(/SESSION_SECRET/);
    expect(() => loadConfig({ ...web, PAYMOB_HMAC_SECRET: '' })).toThrow(/PAYMOB_HMAC_SECRET/);
    expect(() => loadConfig({ ...web, AI_API_KEY: '' })).toThrow(/AI_API_KEY/);
  });

  it('the worker starts without SESSION_SECRET, payment or AI keys, and cannot depend on a session secret', () => {
    const one = loadConfig({ ...runtime, AI_PROVIDER: 'gemini' }, 'worker');
    const two = loadConfig(runtime, 'worker');
    // A random stand-in, different in every process: nothing the worker made with it would verify anywhere.
    expect(one.SESSION_SECRET.length).toBeGreaterThanOrEqual(32);
    expect(one.SESSION_SECRET).not.toBe(two.SESSION_SECRET);
    expect(one.PAYMOB_SECRET_KEY).toBeUndefined();
    expect(one.dataKeys.current).toBe(KEY);
    // What the worker does use is still checked.
    expect(() => loadConfig({ ...runtime, SMTP_URL: '' }, 'worker')).toThrow(/SMTP_URL/);
    expect(() => loadConfig({ ...runtime, DATA_ENCRYPTION_KEY: '' }, 'worker')).toThrow(/DATA_ENCRYPTION_KEY/);
    expect(() => loadConfig({ ...runtime, BILLING_PROVIDER: 'sandbox' }, 'worker')).toThrow(/sandbox billing provider/);
  });

  it('migrations need only the schema owner database', () => {
    const config = loadMigrationConfig({ NODE_ENV: 'production', MIGRATION_DATABASE_URL: 'postgres://owner:pw@db/midad', BILLING_CURRENCY: 'SAR' });
    expect(config).toEqual({ databaseUrl: 'postgres://owner:pw@db/midad', DATABASE_SSL: false, BILLING_CURRENCY: 'SAR', isProduction: true });
    // The owner, not the app role, when both are set; the app role's address in development.
    expect(loadMigrationConfig({ MIGRATION_DATABASE_URL: 'postgres://owner@db/x', DATABASE_URL: 'postgres://app@db/x' }).databaseUrl).toBe('postgres://owner@db/x');
    expect(loadMigrationConfig({ DATABASE_URL: 'postgres://dev@db/x', DATABASE_SSL: 'true' })).toMatchObject({ databaseUrl: 'postgres://dev@db/x', DATABASE_SSL: true, BILLING_CURRENCY: 'EGP' });
    expect(() => loadMigrationConfig({ NODE_ENV: 'production' })).toThrow(/MIGRATION_DATABASE_URL is required/);
  });
});
