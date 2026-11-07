import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { CONFIG_KEYS, FILE_SETTINGS } from '../../src/config.js';

// Which settings each production container receives (production finding S-9): every container gets
// only what it needs, so one that is broken into gives away only its own secrets. The environment
// of each service is resolved as Compose resolves these files: anchors and merge keys, then the
// production file's settings over the base file's (app2 extends app).
type Service = { environment?: Record<string, unknown>; extends?: { service: string } };
const services = (file: string) => (parse(readFileSync(file, 'utf8'), { merge: true, logLevel: 'error' }) as { services: Record<string, Service> }).services;
const base = services('docker-compose.yml');
const prod = services('docker-compose.prod.yml');
const env = (name: string): string[] => {
  const from = base[name] ?? base[prod[name]?.extends?.service ?? ''];
  return Object.keys({ ...(from?.environment ?? {}), ...(prod[name]?.environment ?? {}) }).sort();
};
const SECRET = /SECRET|PASSWORD|_KEY$|_KEYS_|DATABASE_URL$|SMTP_URL|WEBHOOK_URL/;
const secrets = (name: string) => env(name).filter((k) => SECRET.test(k));

describe('settings per production container', () => {
  it('migrate gets the schema owner database and no application secret', () => {
    expect(secrets('migrate')).toEqual(['MIGRATION_DATABASE_URL']);
    expect(env('migrate')).toEqual(['APP_DB_ROLE', 'BILLING_CURRENCY', 'DATABASE_SSL', 'LOG_LEVEL', 'MIGRATION_DATABASE_URL', 'NODE_ENV', 'NODE_OPTIONS', 'SYSTEM_DB_ROLE']);
  });

  it('the worker gets no session secret, payment, AI or alert keys, and not the schema owner', () => {
    // The bucket's key: the worker reads homework files to check them, and deletes removed ones.
    expect(secrets('worker')).toEqual(['DATABASE_URL', 'DATA_ENCRYPTION_KEY', 'DATA_ENCRYPTION_KEYS_PREVIOUS', 'S3_SECRET_ACCESS_KEY', 'SMTP_URL', 'SYSTEM_DATABASE_URL']);
  });

  it('the app instances get what the web app uses, and not the schema owner', () => {
    for (const app of ['app', 'app2']) {
      expect(secrets(app)).toEqual([
        'AI_API_KEY', 'ALERT_WEBHOOK_URL', 'DATABASE_URL', 'DATA_ENCRYPTION_KEY', 'DATA_ENCRYPTION_KEYS_PREVIOUS', 'PAYMOB_HMAC_SECRET',
        'PAYMOB_PUBLIC_KEY', 'PAYMOB_SECRET_KEY', 'S3_SECRET_ACCESS_KEY', 'SANDBOX_WEBHOOK_SECRET', 'SESSION_SECRET', 'SMTP_URL', 'SYSTEM_DATABASE_URL',
      ]);
    }
  });

  it('database role passwords go to the database service only', () => {
    for (const name of Object.keys({ ...base, ...prod })) {
      const passwords = env(name).filter((k) => /PASSWORD/.test(k));
      if (name === 'postgres') expect(passwords).toEqual(['DB_APP_PASSWORD', 'DB_BACKUP_PASSWORD', 'DB_OWNER_PASSWORD', 'DB_SYSTEM_PASSWORD', 'POSTGRES_PASSWORD']);
      else expect(passwords, name).toEqual([]);
    }
    expect(secrets('caddy')).toEqual([]);
    expect(secrets('clamav')).toEqual([]);
  });

  it('every setting the application reads can still be set for the app instances; the worker and migrate get no unknown ones', () => {
    const fixed = ['HOST', 'PORT', 'MIGRATION_DATABASE_URL']; // fixed by the image, or migrate's only
    expect(CONFIG_KEYS.filter((k) => !fixed.includes(k) && !env('app').includes(k))).toEqual([]);
    const known = new Set([...CONFIG_KEYS, 'NODE_OPTIONS', 'APP_DB_ROLE', 'SYSTEM_DB_ROLE']);
    for (const name of ['app', 'app2', 'worker', 'migrate']) expect(env(name).filter((k) => !known.has(k)), name).toEqual([]);
  });
});

// Production add-on: the session secret and the data encryption key as Docker secrets (files), so they are in no
// container's environment. The application reads them from <NAME>_FILE (src/config.ts, FILE_SETTINGS).
describe('secrets as files (docker-compose.secrets.yml)', () => {
  type Extra = { secrets: Record<string, { file: string }>; services: Record<string, { secrets?: string[]; environment?: Record<string, string> }> };
  const extra = parse(readFileSync('docker-compose.secrets.yml', 'utf8'), { merge: true, logLevel: 'error' }) as Extra;

  it('gives the session secret to the app instances only, and the encryption key to them and the worker', () => {
    expect(Object.keys(extra.secrets).sort()).toEqual(['data_encryption_key', 'session_secret']);
    expect(extra.secrets.session_secret!.file).toMatch(/^\$\{SESSION_SECRET_FILE:\?/);
    expect(extra.secrets.data_encryption_key!.file).toMatch(/^\$\{DATA_ENCRYPTION_KEY_FILE:\?/);
    expect(Object.keys(extra.services).sort()).toEqual(['app', 'app2', 'worker']);
    for (const app of ['app', 'app2']) {
      expect(extra.services[app]).toEqual({
        secrets: ['session_secret', 'data_encryption_key'],
        environment: { SESSION_SECRET_FILE: '/run/secrets/session_secret', DATA_ENCRYPTION_KEY_FILE: '/run/secrets/data_encryption_key' },
      });
    }
    expect(extra.services.worker).toEqual({ secrets: ['data_encryption_key'], environment: { DATA_ENCRYPTION_KEY_FILE: '/run/secrets/data_encryption_key' } });
  });

  it('each _FILE names a setting the application reads from a file, mounted in a container that gets that setting', () => {
    for (const [name, service] of Object.entries(extra.services)) {
      for (const [key, path] of Object.entries(service.environment ?? {})) {
        const setting = key.replace(/_FILE$/, '');
        expect(FILE_SETTINGS).toContain(setting);
        expect(env(name), name).toContain(setting); // the base file passes it, empty when the file is used
        expect(path).toBe(`/run/secrets/${setting.toLowerCase()}`);
        expect(service.secrets).toContain(setting.toLowerCase());
      }
    }
  });

  it('the base file still stops before starting anything when neither a secret nor its file is set', () => {
    const raw = readFileSync('docker-compose.yml', 'utf8');
    expect(raw).toContain('${SESSION_SECRET_FILE:-${SESSION_SECRET:?');
    expect(raw).toContain('${DATA_ENCRYPTION_KEY_FILE:-${DATA_ENCRYPTION_KEY:?');
    // The secrets' files stay out of the repository and of the image.
    expect(readFileSync('.gitignore', 'utf8').split('\n')).toContain('secrets/');
    expect(readFileSync('.dockerignore', 'utf8').split('\n')).toContain('secrets');
  });
});
