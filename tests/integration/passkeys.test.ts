import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withSystemContext } from '../../src/db/index.js';
import { runCleanup } from '../../src/jobs/tasks.js';
import { MAX_PASSKEYS } from '../../src/auth/passkeys.js';
import { Client, createHarness, createPlatformAdmin, createStudent, enableStudents, latestEmail, PASSWORD, resetData, signUp, studentLogin, type Harness } from '../helpers/harness.js';
import { SoftAuthenticator, type Tamper } from '../helpers/soft-authenticator.js';

// Passkeys for staff accounts (src/auth/passkeys.ts, migration 0025), against a software authenticator that
// builds real WebAuthn responses (tests/helpers/soft-authenticator.ts).

let h: Harness;
beforeAll(async () => {
  h = await createHarness({ RATE_LIMIT_ENABLED: 'false' });
});
afterAll(async () => h.close());
beforeEach(async () => resetData(h.ownerDb));

const ORIGIN = 'http://localhost:3000'; // the test configuration's APP_URL

async function addPasskey(client: Client, device: SoftAuthenticator, name = 'Laptop', tamper: Tamper = {}) {
  const opts = await client.post('/api/auth/passkeys/register/options', { password: PASSWORD });
  expect(opts.statusCode, opts.body).toBe(200);
  const response = device.create(opts.json().options, tamper);
  return { res: await client.post('/api/auth/passkeys/register', { name, response }), response, options: opts.json().options };
}

async function passkeySignIn(device: SoftAuthenticator, tamper: Tamper = {}, client = new Client(h.app)) {
  const opts = await client.post('/api/auth/passkeys/login/options');
  expect(opts.statusCode, opts.body).toBe(200);
  const response = device.get(opts.json().options, tamper);
  return { res: await client.post('/api/auth/passkeys/login', { response }), client, response };
}

const audit = (action: string) =>
  withSystemContext(h.ownerDb, (trx) => trx.selectFrom('audit_logs').select(['actor_user_id', 'target_id', 'metadata']).where('action', '=', action).orderBy('id').execute());

describe('passkeys', () => {
  it('are added with the password, then sign in without it, as a two-step verified session', async () => {
    const owner = await signUp(h, { name: 'Owner Olfat' });
    const device = new SoftAuthenticator(ORIGIN, { synced: true });

    // The account's password is asked first.
    expect((await owner.client.post('/api/auth/passkeys/register/options', { password: 'wrong-password-1' })).json().error.code).toBe('INVALID_PASSWORD');
    const opts = await owner.client.post('/api/auth/passkeys/register/options', { password: PASSWORD });
    expect(opts.json().options).toMatchObject({
      rp: { id: 'localhost', name: 'Midad' },
      user: { name: owner.email, displayName: 'Owner Olfat' },
      attestation: 'none',
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    });
    const added = await owner.client.post('/api/auth/passkeys/register', { name: 'Olfat’s phone', response: device.create(opts.json().options) });
    expect(added.statusCode, added.body).toBe(200);
    expect(added.json().passkey).toMatchObject({ name: 'Olfat’s phone', backedUp: true, lastUsedAt: null });
    expect((await owner.client.get('/api/auth/passkeys')).json().passkeys).toHaveLength(1);
    // The owner is told by email, and it is in the audit log.
    expect((await latestEmail(h, owner.email, 'passkey_added'))?.text_body).toContain('Olfat’s phone');
    expect(await audit('auth.passkey_added')).toEqual([{ actor_user_id: owner.userId, target_id: added.json().passkey.id, metadata: { name: 'Olfat’s phone', backedUp: true } }]);

    // Signing in on another browser, without an email or a password.
    const { res, client } = await passkeySignIn(device);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().user).toMatchObject({ id: owner.userId, email: owner.email });
    const session = await h.ownerDb.selectFrom('sessions').select(['state', 'mfa_verified']).where('user_id', '=', owner.userId).orderBy('created_at', 'desc').executeTakeFirstOrThrow();
    expect(session).toEqual({ state: 'active', mfa_verified: true });
    expect((await client.get('/api/auth/me')).json().user.id).toBe(owner.userId);
    expect((await client.get('/api/auth/passkeys')).json().passkeys[0].lastUsedAt).not.toBeNull();
    const logins = await audit('auth.login');
    expect(logins.at(-1)).toMatchObject({ actor_user_id: owner.userId, metadata: { passkey: added.json().passkey.id } });
    // The account export lists it.
    expect((await client.get('/api/auth/account/export')).json().passkeys).toEqual([expect.objectContaining({ name: 'Olfat’s phone', backed_up: true })]);
  });

  it('a registration answer counts once, only for its own account, and the same device cannot be added twice', async () => {
    const a = await signUp(h);
    const b = await signUp(h);
    const device = new SoftAuthenticator(ORIGIN);
    const { res, response } = await addPasskey(a.client, device);
    expect(res.statusCode).toBe(200);
    // The same answer again: its challenge is used.
    expect((await a.client.post('/api/auth/passkeys/register', { name: 'Again', response })).json().error.code).toBe('PASSKEY_INVALID');
    // The device is listed for exclusion, so the browser refuses to add it again.
    const next = await a.client.post('/api/auth/passkeys/register/options', { password: PASSWORD });
    expect(next.json().options.excludeCredentials).toEqual([expect.objectContaining({ id: response.id })]);
    // B answering A's challenge.
    const aOptions = (await a.client.post('/api/auth/passkeys/register/options', { password: PASSWORD })).json().options;
    const other = new SoftAuthenticator(ORIGIN);
    expect((await b.client.post('/api/auth/passkeys/register', { name: 'Stolen', response: other.create(aOptions) })).json().error.code).toBe('PASSKEY_INVALID');
    expect((await b.client.get('/api/auth/passkeys')).json().passkeys).toEqual([]);
  });

  it('registration is refused for another site or origin, or without the person verified on the device', async () => {
    const owner = await signUp(h);
    for (const tamper of [{ origin: 'https://evil.example' }, { rpId: 'evil.example' }, { userVerified: false }, { challenge: 'A'.repeat(43) }]) {
      const { res } = await addPasskey(owner.client, new SoftAuthenticator(ORIGIN), 'Bad', tamper);
      expect(res.json().error?.code, JSON.stringify(tamper)).toBe('PASSKEY_INVALID');
    }
    expect((await owner.client.get('/api/auth/passkeys')).json().passkeys).toEqual([]);
  });

  it('sign-in is refused for a replayed answer, another site or origin, an unverified person, a bad signature or a counter that went back', async () => {
    const owner = await signUp(h);
    const device = new SoftAuthenticator(ORIGIN, { counting: true });
    await addPasskey(owner.client, device);

    const first = await passkeySignIn(device);
    expect(first.res.statusCode).toBe(200);
    // The same answer, sent again.
    expect((await new Client(h.app).post('/api/auth/passkeys/login', { response: first.response })).json().error.code).toBe('PASSKEY_INVALID');
    for (const tamper of [{ origin: 'https://evil.example' }, { rpId: 'evil.example' }, { userVerified: false }, { badSignature: true }, { counter: 1 }]) {
      const { res } = await passkeySignIn(device, tamper);
      expect(res.statusCode, JSON.stringify(tamper)).toBe(401);
      expect(res.json().error.code).toBe('PASSKEY_INVALID');
    }
    // A user handle that is not the passkey's account.
    const other = await signUp(h);
    const handle = Buffer.from(other.userId.replace(/-/g, ''), 'hex').toString('base64url');
    expect((await passkeySignIn(device, { userHandle: handle })).res.json().error.code).toBe('PASSKEY_INVALID');
    expect(await audit('auth.passkey_login_failed')).toHaveLength(7);
    // Still works afterwards.
    expect((await passkeySignIn(device)).res.statusCode).toBe(200);
  });

  it('a sign-in challenge expires after five minutes and cannot be a registration challenge', async () => {
    const owner = await signUp(h);
    const device = new SoftAuthenticator(ORIGIN);
    await addPasskey(owner.client, device);
    const client = new Client(h.app);
    const options = (await client.post('/api/auth/passkeys/login/options')).json().options;
    await h.ownerDb.updateTable('webauthn_challenges').set({ expires_at: new Date(Date.now() - 1000) }).where('challenge', '=', options.challenge).execute();
    expect((await client.post('/api/auth/passkeys/login', { response: device.get(options) })).json().error.code).toBe('PASSKEY_INVALID');
    // A registration challenge answered at sign-in.
    const reg = (await owner.client.post('/api/auth/passkeys/register/options', { password: PASSWORD })).json().options;
    expect((await client.post('/api/auth/passkeys/login', { response: device.get({ challenge: reg.challenge, rpId: 'localhost' }) })).json().error.code).toBe('PASSKEY_INVALID');
    // The worker removes expired challenges.
    const before = await h.ownerDb.selectFrom('webauthn_challenges').select('id').execute();
    expect(before.length).toBeGreaterThanOrEqual(1);
    await h.ownerDb.updateTable('webauthn_challenges').set({ expires_at: new Date(Date.now() - 1000) }).execute();
    expect((await runCleanup(h.db, h.config)).passkeyChallenges).toBe(before.length);
  });

  it('can be renamed and removed by their owner only; a removed passkey no longer signs in', async () => {
    const owner = await signUp(h);
    const stranger = await signUp(h);
    const device = new SoftAuthenticator(ORIGIN);
    const { res } = await addPasskey(owner.client, device);
    const id = res.json().passkey.id as string;
    expect((await stranger.client.patch(`/api/auth/passkeys/${id}`, { name: 'Mine now' })).statusCode).toBe(404);
    expect((await stranger.client.delete(`/api/auth/passkeys/${id}`)).statusCode).toBe(404);
    expect((await owner.client.patch(`/api/auth/passkeys/${id}`, { name: '  Work laptop  ' })).json().passkeys[0].name).toBe('Work laptop');
    expect((await owner.client.patch(`/api/auth/passkeys/${id}`, { name: '' })).statusCode).toBe(400);
    expect((await owner.client.delete(`/api/auth/passkeys/${id}`)).json().passkeys).toEqual([]);
    expect(await audit('auth.passkey_removed')).toEqual([{ actor_user_id: owner.userId, target_id: id, metadata: { name: 'Work laptop' } }]);
    const after = await passkeySignIn(device);
    expect(after.res.statusCode).toBe(401);
    expect(after.res.json().error.code).toBe('PASSKEY_UNKNOWN');
  });

  it(`an account has at most ${MAX_PASSKEYS}`, async () => {
    const owner = await signUp(h);
    expect((await addPasskey(owner.client, new SoftAuthenticator(ORIGIN), 'Key 1')).res.statusCode).toBe(200);
    const first = await h.ownerDb.selectFrom('passkeys').select('public_key').executeTakeFirstOrThrow();
    await h.ownerDb
      .insertInto('passkeys')
      .values(Array.from({ length: MAX_PASSKEYS - 1 }, (_, i) => ({ user_id: owner.userId, credential_id: `key-${i + 2}-${'x'.repeat(20)}`, public_key: first.public_key, device_type: 'singleDevice' as const, name: `Key ${i + 2}` })))
      .execute();
    const res = await owner.client.post('/api/auth/passkeys/register/options', { password: PASSWORD });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('PASSKEY_LIMIT');
  });

  it('a suspended account cannot sign in with one, and a school that requires two-step verification accepts one', async () => {
    const owner = await signUp(h);
    const device = new SoftAuthenticator(ORIGIN);
    await addPasskey(owner.client, device);
    expect((await owner.client.patch(`/api/orgs/${owner.orgId}`, { requireMfaForAdmins: true })).statusCode).toBe(200);
    // Password only (no two-step): the school's pages are refused.
    const byPassword = new Client(h.app);
    await byPassword.post('/api/auth/login', { email: owner.email, password: PASSWORD });
    expect((await byPassword.get(`/api/orgs/${owner.orgId}/scopes`)).json().error.code).toBe('MFA_REQUIRED_BY_ORG');
    // Passkey: allowed.
    const { client } = await passkeySignIn(device);
    expect((await client.get(`/api/orgs/${owner.orgId}/scopes`)).statusCode).toBe(200);

    await h.ownerDb.updateTable('users').set({ status: 'suspended' }).where('id', '=', owner.userId).execute();
    const suspended = await passkeySignIn(device);
    expect(suspended.res.statusCode).toBe(403);
    expect(suspended.res.json().error.code).toBe('ACCOUNT_SUSPENDED');
  });

  it('a platform administrator’s passkey session counts as two-step verified for the admin pages', async () => {
    const admin = await createPlatformAdmin(h);
    const device = new SoftAuthenticator(ORIGIN);
    expect((await addPasskey(admin, device)).res.statusCode).toBe(200);
    const { res, client } = await passkeySignIn(device);
    expect(res.json().user.isPlatformAdmin).toBe(true);
    expect((await client.get('/api/admin/overview')).statusCode).toBe(200);
  });

  it('are for staff accounts: students and signed-out visitors cannot add one', async () => {
    expect((await new Client(h.app).post('/api/auth/passkeys/register/options', { password: PASSWORD })).statusCode).toBe(401);
    expect((await new Client(h.app).get('/api/auth/passkeys')).statusCode).toBe(401);
    const owner = await signUp(h);
    await enableStudents(h, owner.orgId);
    const student = await studentLogin(h, await createStudent(h, owner.client, owner.orgId));
    for (const res of [await student.post('/api/auth/passkeys/register/options', { password: PASSWORD }), await student.get('/api/auth/passkeys')]) {
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('STAFF_ONLY');
    }
  });
});
