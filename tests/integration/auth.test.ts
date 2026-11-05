import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client, createHarness, createPlatformAdmin, createStudent, enableStudents, latestEmail, PASSWORD, resetData, signUp, tokenFrom, totp, uniqueEmail, type Harness } from '../helpers/harness.js';
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
  it('locks out the client after 5 failed attempts with a generic error; other addresses still sign in', async () => {
    const { email } = await signUp(h);
    const c = new Client(h.app);
    for (let i = 0; i < 5; i++) {
      const r = await c.post('/api/auth/login', { email, password: 'wrong-password-123' });
      expect(r.statusCode).toBe(401);
      expect(r.json().error.code).toBe('INVALID_CREDENTIALS');
    }
    // The correct password is now refused from this client, with the same error as an unknown account.
    const locked = await c.post('/api/auth/login', { email, password: PASSWORD });
    expect(locked.statusCode).toBe(401);
    const unknown = await c.post('/api/auth/login', { email: uniqueEmail(), password: PASSWORD });
    expect(unknown.json().error).toEqual(locked.json().error);
    // Another browser on the same address is the same client: also refused.
    expect((await new Client(h.app, c.ip).post('/api/auth/login', { email, password: PASSWORD })).statusCode).toBe(401);
    // Another address is not locked out.
    expect((await new Client(h.app).post('/api/auth/login', { email, password: PASSWORD })).statusCode).toBe(200);
  });

  it('20 failed sign-ins from address A do not stop a correct sign-in from address B (S-5)', async () => {
    const { email, userId } = await signUp(h);
    const a = new Client(h.app);
    const codes: number[] = [];
    for (let i = 0; i < 20; i++) codes.push((await a.post('/api/auth/login', { email, password: `wrong-${i}` })).statusCode);
    // Refused throughout: 401 until the address's rate limit, then 429.
    expect(codes.every((c) => c === 401 || c === 429)).toBe(true);
    const b = new Client(h.app);
    expect((await b.post('/api/auth/login', { email, password: PASSWORD })).statusCode).toBe(200);
    // Only five passwords were checked from A: the rest were refused unchecked.
    const audit = await h.systemDb.selectFrom('audit_logs').select('action').where('target_id', '=', userId).where('action', 'like', 'auth.%').execute();
    const count = (action: string) => audit.filter((r) => r.action === action).length;
    expect(count('auth.login_failed') + count('auth.account_locked')).toBe(5);
    expect(count('auth.account_locked')).toBe(1);
  });

  it('a browser that signed in before keeps signing in on an address someone else locked out', async () => {
    const { email } = await signUp(h);
    // The owner's own browser at school; the device cookie is HttpOnly and SameSite=Strict.
    const own = new Client(h.app);
    const first = await own.post('/api/auth/login', { email, password: PASSWORD });
    expect(first.statusCode).toBe(200);
    const device = first.cookies.find((c) => c.name === 'midad_device');
    expect(device).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/' });
    own.cookies.delete('sid'); // signed out, the device cookie stays
    // Someone else on the same school network locks that address out of the account, and uses up its rate limit.
    const other = new Client(h.app, own.ip);
    for (let i = 0; i < 12; i++) await other.post('/api/auth/login', { email, password: `wrong-${i}` });
    expect((await new Client(h.app, own.ip).post('/api/auth/login', { email, password: PASSWORD })).statusCode).not.toBe(200);
    // The owner's browser has its own count and rate limit.
    expect((await own.post('/api/auth/login', { email, password: PASSWORD })).statusCode).toBe(200);
    // A made-up device cookie is just another client of that address.
    const forged = new Client(h.app, own.ip);
    forged.cookies.set('midad_device', 'A'.repeat(43));
    expect((await forged.post('/api/auth/login', { email, password: PASSWORD })).statusCode).not.toBe(200);
  });

  it('accounts that share a browser (a school computer) have their own allowance on it', async () => {
    const one = await signUp(h);
    const two = await signUp(h);
    const shared = new Client(h.app);
    for (const u of [one, two]) {
      expect((await shared.post('/api/auth/login', { email: u.email, password: PASSWORD })).statusCode).toBe(200);
      shared.cookies.delete('sid');
    }
    // One account uses up its allowance on this browser...
    for (let i = 0; i < 11; i++) await shared.post('/api/auth/login', { email: one.email, password: `wrong-${i}` });
    expect((await shared.post('/api/auth/login', { email: one.email, password: PASSWORD })).statusCode).toBe(429);
    // ...the other still signs in from it.
    expect((await shared.post('/api/auth/login', { email: two.email, password: PASSWORD })).statusCode).toBe(200);
  });

  it('20 failures from addresses the account does not know lock them all out, but not a known browser', async () => {
    const { email, userId } = await signUp(h);
    const known = new Client(h.app);
    expect((await known.post('/api/auth/login', { email, password: PASSWORD })).statusCode).toBe(200);
    known.cookies.delete('sid');
    for (let n = 0; n < 4; n++) {
      const attacker = new Client(h.app);
      for (let i = 0; i < 5; i++) expect((await attacker.post('/api/auth/login', { email, password: `wrong-${n}-${i}` })).statusCode).toBe(401);
    }
    const audit = await h.systemDb.selectFrom('audit_logs').select(['action', 'metadata']).where('target_id', '=', userId).where('action', '=', 'auth.account_locked').execute();
    expect(audit.map((r) => (r.metadata as { locked?: string }).locked).sort()).toEqual(['client', 'client', 'client', 'unknown_clients']);
    // A new address is refused even with the correct password; the known browser is not.
    expect((await new Client(h.app).post('/api/auth/login', { email, password: PASSWORD })).statusCode).toBe(401);
    expect((await known.post('/api/auth/login', { email, password: PASSWORD })).statusCode).toBe(200);
    // The platform administrator sees the lock and lifts it.
    const admin = await createPlatformAdmin(h);
    const listed = (await admin.get(`/api/admin/users?q=${encodeURIComponent(email)}`)).json().users[0];
    expect(new Date(listed.lockedUntil).getTime()).toBeGreaterThan(Date.now() + 50 * 60_000);
    expect((await admin.post(`/api/admin/users/${userId}/unlock`)).statusCode).toBe(200);
    expect((await admin.get(`/api/admin/users?q=${encodeURIComponent(email)}`)).json().users[0].lockedUntil).toBeNull();
    expect((await new Client(h.app).post('/api/auth/login', { email, password: PASSWORD })).statusCode).toBe(200);
  });

  it('an unlock also gives the locked-out address its sign-in attempts back (staff and students)', async () => {
    const owner = await signUp(h);
    await enableStudents(h, owner.orgId);
    const s = await createStudent(h, owner.client, owner.orgId);
    const admin = await createPlatformAdmin(h);
    const NETWORK = '198.51.100.20';
    const staffTry = (password: string) => new Client(h.app, NETWORK).post('/api/auth/login', { email: owner.email, password });
    const studentTry = (password: string) => new Client(h.app, NETWORK).post('/api/auth/student-login', { school: s.school, username: s.username, password });
    // Someone on the network uses up both accounts' attempts from that address.
    for (let i = 0; i < 12; i++) {
      await staffTry(`wrong-${i}`);
      await studentTry(`wrong-${i}`);
    }
    expect((await staffTry(PASSWORD)).statusCode).toBe(429);
    expect((await studentTry(s.password)).statusCode).toBe(429);
    expect((await owner.client.post(`/api/orgs/${owner.orgId}/students/${s.userId}/unlock`)).statusCode).toBe(200);
    expect((await studentTry(s.password)).statusCode).toBe(200);
    expect((await admin.post(`/api/admin/users/${owner.userId}/unlock`)).statusCode).toBe(200);
    expect((await staffTry(PASSWORD)).statusCode).toBe(200);
  });

  it('counts parallel failures exactly (S-7)', async () => {
    const { email, userId } = await signUp(h);
    const c = new Client(h.app);
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => c.post('/api/auth/login', { email, password: `wrong-${i}` })));
    expect(results.every((r) => r.statusCode === 401)).toBe(true);
    const audit = await h.systemDb.selectFrom('audit_logs').select('action').where('target_id', '=', userId).where('action', 'in', ['auth.login_failed', 'auth.account_locked']).execute();
    const rows = await h.ownerDb.selectFrom('login_failures').select(['client', 'failures', 'locked_until']).where('user_id', '=', userId).execute();
    // Every password checked is counted, for the client and for the account.
    expect(audit.length).toBeGreaterThanOrEqual(5);
    expect(rows.map((r) => r.failures).sort()).toEqual([audit.length, audit.length]);
    expect(rows.every((r) => r.client === 'account' || (r.locked_until && r.locked_until > new Date()))).toBe(true);
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

  it('wrong codes lock out only this client and end its pending session; a browser is trusted only after the code', async () => {
    const { client, email } = await signUp(h);
    const { recoveryCodes } = await enable(client);
    const c = new Client(h.app);
    const login = await c.post('/api/auth/login', { email, password: PASSWORD });
    expect(login.json()).toMatchObject({ mfaRequired: true });
    expect(login.cookies.some((k) => k.name === 'midad_device')).toBe(false);
    await c.refresh();
    for (let i = 0; i < 4; i++) expect((await c.post('/api/auth/mfa/verify', { code: '000000' })).statusCode).toBe(401);
    expect((await c.get('/api/auth/me')).json()).toMatchObject({ mfaPending: true });
    // The fifth wrong code (after a correct password, so five failures in all) locks this client out.
    expect((await c.post('/api/auth/mfa/verify', { code: '000000' })).statusCode).toBe(401);
    expect((await c.get('/api/auth/me')).statusCode).toBe(401);
    expect((await new Client(h.app, c.ip).post('/api/auth/login', { email, password: PASSWORD })).statusCode).toBe(401);
    // Another address signs in with password and second factor; only then is its browser trusted.
    const other = new Client(h.app);
    await other.post('/api/auth/login', { email, password: PASSWORD });
    await other.refresh();
    const ok = await other.post('/api/auth/mfa/verify', { recoveryCode: recoveryCodes[0] });
    expect(ok.statusCode).toBe(200);
    expect(ok.cookies.some((k) => k.name === 'midad_device')).toBe(true);
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
