import { spawn } from 'node:child_process';
import { createCipheriv, createHmac, randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { authenticator } from 'otplib';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '../../src/auth/password.js';
import { withSystemContext } from '../../src/db/index.js';
import { encryptSecret, keyId } from '../../src/lib/crypto.js';
import { rotateDataKeys } from '../../src/ops/data-keys.js';
import { TEST_ENV } from '../helpers/env.js';
import { Client, createHarness, PASSWORD, resetData, signUp, uniqueEmail, type Harness } from '../helpers/harness.js';

// Three app instances on one database: with the old key only, with the new key and
// the old one as "previous" (during a rotation), and with the new key only (after it).
const OLD = Buffer.alloc(32, 31).toString('base64');
const NEW = Buffer.alloc(32, 32).toString('base64');
const OTHER = Buffer.alloc(32, 33).toString('base64');
const base = { RATE_LIMIT_ENABLED: 'false', WEBHOOK_ALLOW_INSECURE_TARGETS: 'true' };
const BOTH = { current: NEW, previous: [OLD] };

let hOld: Harness;
let hBoth: Harness;
let hNew: Harness;
beforeAll(async () => {
  hOld = await createHarness({ ...base, DATA_ENCRYPTION_KEY: OLD });
  hBoth = await createHarness({ ...base, DATA_ENCRYPTION_KEY: NEW, DATA_ENCRYPTION_KEYS_PREVIOUS: OLD });
  hNew = await createHarness({ ...base, DATA_ENCRYPTION_KEY: NEW });
});
afterAll(async () => {
  for (const h of [hOld, hBoth, hNew]) await h.close();
});
beforeEach(async () => resetData(hOld.ownerDb));

/** The envelope format written before key ids were recorded. */
function v1Envelope(keyBase64: string, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(keyBase64, 'base64'), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

/** A member with two-factor sign-in whose secret is stored with `encrypt`. */
async function mfaUser(encrypt: (secret: string) => string, pending?: string) {
  const email = uniqueEmail('mfa');
  const secret = authenticator.generateSecret();
  const row = await hOld.ownerDb
    .insertInto('users')
    .values({ email, name: 'Two Factor', password_hash: await hashPassword(PASSWORD), email_verified_at: new Date(), mfa_enabled: true, mfa_secret_enc: encrypt(secret), mfa_pending_secret_enc: pending ?? null })
    .returning('id')
    .executeTakeFirstOrThrow();
  return { id: row.id, email, secret };
}

/** Signs in on `h` with password and a current code; returns the code check's status. */
async function signInWithCode(h: Harness, u: { email: string; secret: string }) {
  const c = new Client(h.app);
  expect((await c.post('/api/auth/login', { email: u.email, password: PASSWORD })).statusCode).toBe(200);
  await c.refresh();
  return (await c.post('/api/auth/mfa/verify', { code: authenticator.generate(u.secret) })).statusCode;
}

async function signInOn(h: Harness, email: string) {
  const c = new Client(h.app);
  expect((await c.post('/api/auth/login', { email, password: PASSWORD })).statusCode).toBe(200);
  await c.refresh();
  return c;
}

const stored = (id: string) => hOld.ownerDb.selectFrom('users').select(['mfa_secret_enc', 'mfa_pending_secret_enc']).where('id', '=', id).executeTakeFirstOrThrow();
const columns = (reports: Awaited<ReturnType<typeof rotateDataKeys>>) => Object.fromEntries(reports.map((r) => [`${r.table}.${r.column}`, r]));

async function receiver() {
  const received: { headers: http.IncomingHttpHeaders; body: string }[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => { received.push({ headers: req.headers, body }); res.writeHead(200).end(); });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`, received, close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}
const signedWith = (secret: string, r: { headers: http.IncomingHttpHeaders; body: string }) => {
  const [, t, v1] = /^t=(\d+),v1=([0-9a-f]+)$/.exec(String(r.headers['x-curriculumscope-signature']))!;
  return v1 === createHmac('sha256', secret).update(`${t}.${r.body}`).digest('hex');
};

function runCli(args: string[], env: Record<string, string>): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/cli/rotate-data-key.ts', ...args], { env: { ...process.env, ...TEST_ENV, LOG_LEVEL: 'warn', ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
  });
}

describe('rotating DATA_ENCRYPTION_KEY', () => {
  it('old values keep working during the rotation, are re-encrypted, and then work with the new key alone', async () => {
    const u1 = await mfaUser((s) => encryptSecret(OLD, s));
    const u2 = await mfaUser((s) => v1Envelope(OLD, s), v1Envelope(OLD, authenticator.generateSecret()));
    const u3 = await mfaUser((s) => encryptSecret(OLD, s));
    const owner = await signUp(hOld, { org: 'Key School' });
    const r = await receiver();
    try {
      const hook = (await owner.client.post(`/api/orgs/${owner.orgId}/webhooks`, { url: r.url, events: ['scope.created'] })).json();
      expect(hook.secret).toMatch(/^whsec_/);

      // Before re-encrypting: what would change.
      const before = columns(await rotateDataKeys(hBoth.db, BOTH, { write: false }));
      expect(before['users.mfa_secret_enc']).toMatchObject({ total: 3, current: 0, rewrapped: 3, unreadable: [], byKey: { [keyId(OLD)]: 2, v1: 1 } });
      expect(before['users.mfa_pending_secret_enc']).toMatchObject({ total: 1, rewrapped: 1, byKey: { v1: 1 } });
      expect(before['webhook_endpoints.secret_enc']).toMatchObject({ total: 1, rewrapped: 1, byKey: { [keyId(OLD)]: 1 } });
      expect((await stored(u1.id)).mfa_secret_enc).toMatch(new RegExp(`^v2\\.${keyId(OLD)}\\.`));

      // With both keys configured, values under the old key are read: sign-in and webhook signing work.
      expect(await signInWithCode(hBoth, u1)).toBe(200);
      expect(await signInWithCode(hBoth, u2)).toBe(200);
      const ownerBoth = await signInOn(hBoth, owner.email);
      expect((await ownerBoth.post(`/api/orgs/${owner.orgId}/webhooks/${hook.webhook.id}/test`)).json().delivery.status).toBe('delivered');
      expect(signedWith(hook.secret, r.received[0]!)).toBe(true);

      const done = columns(await rotateDataKeys(hBoth.db, BOTH, { write: true }));
      expect(Object.values(done).map((c) => [c.rewrapped, c.unreadable.length])).toEqual([[3, 0], [1, 0], [1, 0]]);
      for (const u of [u1, u2, u3]) expect((await stored(u.id)).mfa_secret_enc!.startsWith(`v2.${keyId(NEW)}.`)).toBe(true);
      expect((await stored(u2.id)).mfa_pending_secret_enc!.startsWith(`v2.${keyId(NEW)}.`)).toBe(true);
      const webhookSecret = await withSystemContext(hOld.ownerDb, (trx) => trx.selectFrom('webhook_endpoints').select('secret_enc').executeTakeFirstOrThrow());
      expect(webhookSecret.secret_enc.startsWith(`v2.${keyId(NEW)}.`)).toBe(true);

      // Running it again changes nothing.
      const again = columns(await rotateDataKeys(hBoth.db, BOTH, { write: true }));
      expect(again['users.mfa_secret_enc']).toMatchObject({ total: 3, current: 3, rewrapped: 0 });

      // With the new key alone, everything still works; the old key alone no longer reads anything.
      expect(await signInWithCode(hNew, u3)).toBe(200);
      const ownerNew = await signInOn(hNew, owner.email);
      expect((await ownerNew.post(`/api/orgs/${owner.orgId}/webhooks/${hook.webhook.id}/test`)).json().delivery.status).toBe('delivered');
      expect(signedWith(hook.secret, r.received[1]!)).toBe(true);
      const ownerOld = await signInOn(hOld, owner.email);
      expect((await ownerOld.post(`/api/orgs/${owner.orgId}/webhooks/${hook.webhook.id}/test`)).statusCode).toBe(500);
    } finally {
      await r.close();
    }
  });

  it('a value no configured key can read is reported and left as it is', async () => {
    const lost = await mfaUser((s) => encryptSecret(OTHER, s));
    const fine = await mfaUser((s) => encryptSecret(OLD, s));
    const before = (await stored(lost.id)).mfa_secret_enc;
    const report = columns(await rotateDataKeys(hBoth.db, BOTH, { write: true }))['users.mfa_secret_enc']!;
    expect(report).toMatchObject({ total: 2, rewrapped: 1, unreadable: [lost.id] });
    expect((await stored(lost.id)).mfa_secret_enc).toBe(before);
    expect((await stored(fine.id)).mfa_secret_enc!.startsWith(`v2.${keyId(NEW)}.`)).toBe(true);
  });

  it('the command-line tool checks, re-encrypts, records an audit entry, and fails on unreadable values', async () => {
    const u = await mfaUser((s) => encryptSecret(OLD, s));
    const env = { DATA_ENCRYPTION_KEY: NEW, DATA_ENCRYPTION_KEYS_PREVIOUS: OLD };

    const check = await runCli(['--check'], env);
    expect(check.code, check.stderr).toBe(0);
    expect(check.stdout).toContain(`Current key: ${keyId(NEW)}; previous keys: ${keyId(OLD)}`);
    expect(check.stdout).toContain(`users.mfa_secret_enc: 1 values (${keyId(OLD)}: 1); 0 with the current key; 1 to re-encrypt; 0 unreadable`);
    expect(check.stdout).toContain('Run without --check');
    expect((await stored(u.id)).mfa_secret_enc!.startsWith(`v2.${keyId(OLD)}.`)).toBe(true);

    const rotate = await runCli([], env);
    expect(rotate.code, rotate.stderr).toBe(0);
    expect(rotate.stdout).toContain('users.mfa_secret_enc: 1 values');
    expect(rotate.stdout).toContain('1 re-encrypted');
    expect(rotate.stdout).toContain('Every value uses the current key. Remove DATA_ENCRYPTION_KEYS_PREVIOUS');
    expect((await stored(u.id)).mfa_secret_enc!.startsWith(`v2.${keyId(NEW)}.`)).toBe(true);
    const audit = await withSystemContext(hOld.ownerDb, (trx) => trx.selectFrom('audit_logs').select(['action', 'metadata', 'actor_type']).where('action', '=', 'admin.data_key_rotated').execute());
    expect(audit).toEqual([{ action: 'admin.data_key_rotated', actor_type: 'system', metadata: { currentKey: keyId(NEW), reencrypted: 1, unreadable: 0 } }]);
    expect(JSON.stringify(audit)).not.toContain(NEW);

    const lost = await mfaUser((s) => encryptSecret(OTHER, s));
    const failing = await runCli([], env);
    expect(failing.code).toBe(1);
    expect(failing.stderr).toContain('1 values cannot be read with the configured keys');
    expect(failing.stderr).toContain(`users.mfa_secret_enc ${lost.id}`);
  });
});
