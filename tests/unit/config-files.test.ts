import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { FILE_SETTINGS, loadConfig, loadMigrationConfig } from '../../src/config.js';

// Secrets from files (Docker or Kubernetes secrets, systemd credentials, a secret manager's agent;
// docker-compose.secrets.yml): every secret setting can be given as <NAME>_FILE instead of <NAME>.
const dir = mkdtempSync(join(tmpdir(), 'midad-secrets-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const file = (name: string, contents: string) => {
  const path = join(dir, name);
  writeFileSync(path, contents);
  return path;
};

const KEY = Buffer.alloc(32, 9).toString('base64');
const SECRET = 'q'.repeat(48);
const base = {
  NODE_ENV: 'production',
  APP_URL: 'https://midad.example',
  DATABASE_URL: 'postgres://midad_app:pw@db/midad',
  SYSTEM_DATABASE_URL: 'postgres://midad_system:pw@db/midad',
  EMAIL_TRANSPORT: 'smtp',
  SMTP_URL: 'smtp://mail.example:587',
  BILLING_PROVIDER: 'disabled',
  FILE_SCAN: 'off',
};

describe('secret settings read from files', () => {
  it('reads each one from <NAME>_FILE, without the line ending an editor adds', () => {
    const config = loadConfig({
      ...base,
      SESSION_SECRET_FILE: file('session_secret', `${SECRET}\n`),
      DATA_ENCRYPTION_KEY_FILE: file('data_key', `${KEY}\r\n`),
      AI_PROVIDER: 'gemini', AI_MODEL: 'gemini-2.5-pro',
      AI_API_KEY_FILE: file('ai_key', 'ai-key-from-file'),
    });
    expect(config.SESSION_SECRET).toBe(SECRET);
    expect(config.dataKeys.current).toBe(KEY);
    expect(config.AI_API_KEY).toBe('ai-key-from-file');
  });

  it('is used when Compose passes the setting itself as empty (an unset variable in the env file)', () => {
    const config = loadConfig({ ...base, SESSION_SECRET: '', SESSION_SECRET_FILE: file('s2', SECRET), DATA_ENCRYPTION_KEY: KEY });
    expect(config.SESSION_SECRET).toBe(SECRET);
  });

  it('cannot be given twice, and the message never shows the secret', () => {
    const run = () => loadConfig({ ...base, SESSION_SECRET: SECRET, SESSION_SECRET_FILE: file('s3', 'other'.repeat(10)), DATA_ENCRYPTION_KEY: KEY });
    expect(run).toThrow(/SESSION_SECRET: set SESSION_SECRET or SESSION_SECRET_FILE, not both/);
    try { run(); } catch (err) { expect(String((err as Error).message)).not.toContain(SECRET); }
  });

  it('names the setting and the path when the file cannot be read', () => {
    const missing = join(dir, 'nope');
    expect(() => loadConfig({ ...base, SESSION_SECRET: SECRET, DATA_ENCRYPTION_KEY_FILE: missing })).toThrow(`DATA_ENCRYPTION_KEY_FILE: cannot read ${missing} (ENOENT)`);
    expect(() => loadConfig({ ...base, SESSION_SECRET: SECRET, DATA_ENCRYPTION_KEY_FILE: dir })).toThrow(/DATA_ENCRYPTION_KEY_FILE: cannot read .* \(EISDIR\)/);
    if (process.getuid?.() !== 0) {
      // Root reads any file, so this case runs only as another user.
      const locked = file('locked', KEY);
      chmodSync(locked, 0o000);
      expect(() => loadConfig({ ...base, SESSION_SECRET: SECRET, DATA_ENCRYPTION_KEY_FILE: locked })).toThrow(/\(EACCES\)/);
    }
  });

  it('an empty file means "not set", and a missing required setting says where it can come from', () => {
    expect(() => loadConfig({ ...base, SESSION_SECRET_FILE: file('empty', '\n'), DATA_ENCRYPTION_KEY: KEY }))
      .toThrow('SESSION_SECRET: SESSION_SECRET is required (or SESSION_SECRET_FILE, a file that holds it)');
  });

  it('works for the worker and for migrations', () => {
    const worker = loadConfig({ ...base, DATA_ENCRYPTION_KEY_FILE: file('wk', KEY), SMTP_URL: undefined, SMTP_URL_FILE: file('smtp', 'smtp://u:p@mail.example:587') }, 'worker');
    expect(worker.dataKeys.current).toBe(KEY);
    expect(worker.SMTP_URL).toBe('smtp://u:p@mail.example:587');
    expect(loadMigrationConfig({ NODE_ENV: 'production', MIGRATION_DATABASE_URL_FILE: file('owner', 'postgres://owner:pw@db/midad\n') }).databaseUrl).toBe('postgres://owner:pw@db/midad');
    expect(() => loadMigrationConfig({ NODE_ENV: 'production' })).toThrow('MIGRATION_DATABASE_URL is required (or MIGRATION_DATABASE_URL_FILE, a file that holds it)');
  });

  it('covers exactly the secret settings; other settings have no file form', () => {
    expect([...FILE_SETTINGS].sort()).toEqual([
      'AI_API_KEY', 'ALERT_WEBHOOK_URL', 'DATABASE_URL', 'DATA_ENCRYPTION_KEY', 'DATA_ENCRYPTION_KEYS_PREVIOUS', 'MIGRATION_DATABASE_URL',
      'PAYMOB_HMAC_SECRET', 'PAYMOB_PUBLIC_KEY', 'PAYMOB_SECRET_KEY', 'S3_SECRET_ACCESS_KEY', 'SANDBOX_WEBHOOK_SECRET', 'SESSION_SECRET', 'SMTP_URL',
      'SYSTEM_DATABASE_URL',
    ]);
    const config = loadConfig({ ...base, SESSION_SECRET: SECRET, DATA_ENCRYPTION_KEY: KEY, APP_URL_FILE: file('url', 'https://other.example') });
    expect(config.APP_URL).toBe('https://midad.example');
  });
});
