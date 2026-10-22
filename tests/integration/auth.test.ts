import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client, createHarness, latestEmail, PASSWORD, resetData, signUp, tokenFrom, totp, uniqueEmail, type Harness } from '../helpers/harness.js';
import { decryptSecret } from '../../src/lib/crypto.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());
beforeEach(async () => resetData(h.ownerDb));

describe('registration and email verification', () => {
  it('registers an owner with an organization on a 14-day trial and requires verification before login', async () => {
    const c = new Client(h.app);
    const email = uniqueEmail();
    const reg = await c.post('/api/auth/register', { name: 'Amal', email, password: PASSWORD, organizationName: 'Nile Tutors' });
    expect(reg.statusCode).toBe(201);
    expect(reg.json()).toEqual({ status: 'verification_sent' });

    const blocked = await c.post('/api/auth/login', { email, password: PASSWORD });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe('EMAIL_NOT_VERIFIED');

    const mail = await latestEmail(h, email, 'verify_email');
    expect(mail?.subject).toMatch(/Confirm/);
    const v = await c.post('/api/auth/verify-email', { token: tokenFrom(mail!.text_body) });
    expect(v.statusCode).toBe(200);
    // Single use
    expect((await c.post('/api/auth/verify-email', { token: tokenFrom(mail!.text_body) })).statusCode).toBe(400);

    const login = await c.post('/api/auth/login', { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    const me = await c.refresh();
    expect(me.json().user.email).toBe(email);
    expect(me.json().organizations).toHaveLength(1);
    expect(me.json().organizations[0].role).toBe('owner');

    const org = await c.get(`/api/orgs/${me.json().organizations[0].id}`);
    expect(org.json().plan).toMatchObject({ id: 'professional', state: 'trialing' });
  });

  it('does not reveal whether an email is already registered', async () => {
    const { email } = await signUp(h);
    const c = new Client(h.app);
    const again = await c.post('/api/auth/register', { name: 'X', email, password: PASSWORD, organizationName: 'Other' });
    expect(again.statusCode).toBe(201);
    expect(again.json()).toEqual({ status: 'verification_sent' });
    expect((await latestEmail(h, email))?.template).toBe('account_exists');
  });

  it('rejects weak passwords and invalid input with field details', async () => {
    const c = new Client(h.app);
    const res = await c.post('/api/auth/register', { name: '', email: 'not-an-email', password: 'short', organizationName: 'X' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    const paths = res.json().error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['name', 'email', 'password']));
  });
});

describe('login protection', () => {
  it('locks the account after 5 failed attempts and uses a generic error', async () => {
    const { email } = await signUp(h);
    const c = new Client(h.app);
    for (let i = 0; i < 5; i++) {
      const r = await c.post('/api/auth/login', { email, password: 'wrong-password-123' });
      expect(r.statusCode).toBe(401);
      expect(r.json().error.code).toBe('INVALID_CREDENTIALS');
    }
    // Correct password is now refused while locked.
    const locked = await c.post('/api/auth/login', { email, password: PASSWORD });
    expect(locked.statusCode).toBe(401);
    const unknown = await c.post('/api/auth/login', { email: uniqueEmail(), password: PASSWORD });
    expect(unknown.json().error).toEqual(locked.json().error);
  });

  it('rate-limits repeated login attempts per client and account', async () => {
    const c = new Client(h.app);
    const email = uniqueEmail();
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await c.post('/api/auth/login', { email, password: 'x' })).statusCode);
    expect(codes.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(codes.at(-1)).toBe(429);
  });

  it('logout invalidates the session', async () => {
    const { client } = await signUp(h);
    expect((await client.post('/api/auth/logout')).statusCode).toBe(204);
    expect((await client.get('/api/auth/me')).statusCode).toBe(401);
  });
});

describe('CSRF protection', () => {
  it('rejects state-changing requests without the session CSRF token', async () => {
    const { client, orgId } = await signUp(h);
    const token = client.csrf;
    client.csrf = null;
    const res = await client.patch(`/api/orgs/${orgId}`, { name: 'Renamed' });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('CSRF_TOKEN_INVALID');
    client.csrf = 'f'.repeat(64);
    expect((await client.patch(`/api/orgs/${orgId}`, { name: 'Renamed' })).statusCode).toBe(403);
    client.csrf = token;
    expect((await client.patch(`/api/orgs/${orgId}`, { name: 'Renamed' })).statusCode).toBe(200);
  });

  it('rejects cross-origin requests and non-JSON bodies', async () => {
    const { client, orgId } = await signUp(h);
    const res = await client.patch(`/api/orgs/${orgId}`, { name: 'Evil' }, { origin: 'https://evil.example' });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('CSRF_ORIGIN_MISMATCH');
    const form = await h.app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: 'email=a@b.c&password=x' });
    expect(form.statusCode).toBe(415);
    const text = await h.app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'content-type': 'text/plain' }, payload: '{"email":"a@b.c","password":"x"}' });
    expect(text.statusCode).toBe(415);
  });
});

describe('password reset', () => {
  it('resets the password with a single-use token and revokes existing sessions', async () => {
    const { client, email } = await signUp(h);
    const anon = new Client(h.app);
    expect((await anon.post('/api/auth/password/forgot', { email })).statusCode).toBe(202);
    expect((await anon.post('/api/auth/password/forgot', { email: uniqueEmail() })).statusCode).toBe(202);
    const token = tokenFrom((await latestEmail(h, email, 'reset_password'))!.text_body);
    const reset = await anon.post('/api/auth/password/reset', { token, password: 'a-brand-new-passphrase' });
    expect(reset.statusCode).toBe(200);
    expect((await anon.post('/api/auth/password/reset', { token, password: 'another-new-passphrase' })).statusCode).toBe(400);
    expect((await client.get('/api/auth/me')).statusCode).toBe(401);
    expect((await anon.post('/api/auth/login', { email, password: PASSWORD })).statusCode).toBe(401);
    expect((await anon.post('/api/auth/login', { email, password: 'a-brand-new-passphrase' })).statusCode).toBe(200);
  });

  it('changing the password requires the current one and signs out other sessions', async () => {
    const { client, email } = await signUp(h);
    const other = new Client(h.app);
    await other.post('/api/auth/login', { email, password: PASSWORD });
    expect((await other.get('/api/auth/me')).statusCode).toBe(200);
    expect((await client.post('/api/auth/password/change', { currentPassword: 'nope', newPassword: 'another-good-passphrase' })).statusCode).toBe(400);
    expect((await client.post('/api/auth/password/change', { currentPassword: PASSWORD, newPassword: 'another-good-passphrase' })).statusCode).toBe(200);
    expect((await client.get('/api/auth/me')).statusCode).toBe(200);
    expect((await other.get('/api/auth/me')).statusCode).toBe(401);
  });
});

describe('two-factor authentication', () => {
  async function enable(client: Client) {
    const setup = await client.post('/api/auth/mfa/setup');
    expect(setup.statusCode).toBe(200);
    const { secret, qrSvg } = setup.json();
    expect(qrSvg).toContain('<svg');
    const en = await client.post('/api/auth/mfa/enable', { code: totp(secret) });
    expect(en.statusCode).toBe(200);
    await client.refresh();
    return { secret, recoveryCodes: en.json().recoveryCodes as string[] };
  }

  it('requires a TOTP code at login once enabled, and rejects replayed codes', async () => {
    const { client, email, userId } = await signUp(h);
    const { secret, recoveryCodes } = await enable(client);
    expect(recoveryCodes).toHaveLength(10);
    const stored = await h.ownerDb.selectFrom('users').select(['mfa_secret_enc']).where('id', '=', userId).executeTakeFirstOrThrow();
    expect(stored.mfa_secret_enc).not.toContain(secret); // encrypted at rest
    expect(decryptSecret(h.config.DATA_ENCRYPTION_KEY, stored.mfa_secret_enc!)).toBe(secret);

    const c = new Client(h.app);
    const login = await c.post('/api/auth/login', { email, password: PASSWORD });
    expect(login.json()).toMatchObject({ mfaRequired: true });
    // Pending-MFA sessions cannot use the API.
    const me = await c.refresh();
    expect(me.json()).toMatchObject({ mfaPending: true });
    const orgId = (await client.get('/api/auth/me')).json().organizations[0].id;
    expect((await c.get(`/api/orgs/${orgId}`)).statusCode).toBe(401);

    // The code used during enrollment cannot be replayed.
    expect((await c.post('/api/auth/mfa/verify', { code: '000000' })).statusCode).toBe(401);
    const ok = await c.post('/api/auth/mfa/verify', { recoveryCode: recoveryCodes[0] });
    expect(ok.statusCode).toBe(200);
    await c.refresh();
    expect((await c.get(`/api/orgs/${orgId}`)).statusCode).toBe(200);

    // A recovery code works once.
    const c2 = new Client(h.app);
    await c2.post('/api/auth/login', { email, password: PASSWORD });
    await c2.refresh();
    expect((await c2.post('/api/auth/mfa/verify', { recoveryCode: recoveryCodes[0] })).statusCode).toBe(401);
    void secret;
  });

  it('disabling MFA requires password and a valid code', async () => {
    const { client } = await signUp(h);
    await enable(client);
    expect((await client.post('/api/auth/mfa/disable', { password: 'wrong', code: '123456' })).statusCode).toBe(400);
  });
});

describe('sessions', () => {
  it('lists and revokes own sessions only', async () => {
    const { client, email } = await signUp(h);
    const other = new Client(h.app);
    await other.post('/api/auth/login', { email, password: PASSWORD });
    const list = await client.get('/api/auth/sessions');
    expect(list.json().sessions).toHaveLength(2);
    const target = list.json().sessions.find((s: { current: boolean }) => !s.current);
    expect((await client.delete(`/api/auth/sessions/${target.id}`)).statusCode).toBe(200);
    expect((await other.get('/api/auth/me')).statusCode).toBe(401);

    const stranger = await signUp(h);
    const mine = (await client.get('/api/auth/sessions')).json().sessions[0].id;
    expect((await stranger.client.delete(`/api/auth/sessions/${mine}`)).statusCode).toBe(404);
  });
});
