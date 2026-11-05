import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { CONFIG_KEYS } from '../../src/config.js';

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
    expect(secrets('worker')).toEqual(['DATABASE_URL', 'DATA_ENCRYPTION_KEY', 'DATA_ENCRYPTION_KEYS_PREVIOUS', 'SMTP_URL', 'SYSTEM_DATABASE_URL']);
  });

  it('the app instances get what the web app uses, and not the schema owner', () => {
    for (const app of ['app', 'app2']) {
      expect(secrets(app)).toEqual([
        'AI_API_KEY', 'ALERT_WEBHOOK_URL', 'DATABASE_URL', 'DATA_ENCRYPTION_KEY', 'DATA_ENCRYPTION_KEYS_PREVIOUS', 'PAYMOB_HMAC_SECRET',
        'PAYMOB_PUBLIC_KEY', 'PAYMOB_SECRET_KEY', 'SANDBOX_WEBHOOK_SECRET', 'SESSION_SECRET', 'SMTP_URL', 'SYSTEM_DATABASE_URL',
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
