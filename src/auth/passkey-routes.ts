import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { recordPlatformAudit, requestMeta } from '../audit/audit.js';
import type { AppContext } from '../http/context.js';
import { rateLimited } from '../http/rate-limit.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import { parse } from '../lib/validation.js';
import { enqueueEmail } from '../notifications/email.js';
import { isStaff, requireUser } from './guards.js';
import { loginClient, recordSuccess } from './login-protection.js';
import { AuthenticationResponse, finishLogin, finishRegistration, listPasskeys, loginOptions, registrationOptions, RegistrationResponse, relyingParty } from './passkeys.js';
import { verifyPassword } from './password.js';
import { publicUser, startSession } from './routes.js';
import { revokeSession } from './sessions.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const zPasskeyName = z.string().trim().min(1).max(60);

/**
 * Passkeys for staff accounts (src/auth/passkeys.ts). Adding one needs the account's password, as a session
 * alone (a borrowed laptop, a stolen cookie) must not be enough to give someone lasting access. Signing in with
 * one gives a session that counts as two-step verified.
 */
export function registerPasskeyRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, config } = ctx;
  const rp = relyingParty(config);

  app.get('/api/auth/passkeys', async (req) => {
    const { user } = requireUser(req);
    return { passkeys: await listPasskeys(db, user.id) };
  });

  app.post('/api/auth/passkeys/register/options', rateLimited(10, '15 minutes'), async (req) => {
    const { user } = requireUser(req);
    const { password } = parse(z.object({ password: z.string().min(1).max(256) }), req.body);
    if (!(await verifyPassword(user.password_hash, password))) throw new AppError(400, 'INVALID_PASSWORD', 'Password is incorrect');
    return { options: await registrationOptions(db, rp, user) };
  });

  app.post('/api/auth/passkeys/register', rateLimited(10, '15 minutes'), async (req) => {
    const { user } = requireUser(req);
    const body = parse(z.object({ name: zPasskeyName, response: RegistrationResponse }), req.body);
    const passkey = await finishRegistration(db, rp, user, body.response, body.name, (err) => req.log.info({ err: String(err) }, 'passkey registration refused'));
    await enqueueEmail(db, user.email, 'passkey_added', user.locale, { name: user.name, passkeyName: passkey.name, accountLink: `${config.APP_URL}/account` });
    await recordPlatformAudit(db, { type: 'user', userId: user.id, email: user.email }, { action: 'auth.passkey_added', targetType: 'passkey', targetId: passkey.id, metadata: { name: passkey.name, backedUp: passkey.backedUp } }, requestMeta(req));
    return { passkey };
  });

  app.patch('/api/auth/passkeys/:id', async (req) => {
    const { user } = requireUser(req);
    const { id } = req.params as { id: string };
    const { name } = parse(z.object({ name: zPasskeyName }), req.body);
    if (!UUID_RE.test(id)) throw notFound('Passkey');
    const row = await db.updateTable('passkeys').set({ name }).where('id', '=', id).where('user_id', '=', user.id).returning('id').executeTakeFirst();
    if (!row) throw notFound('Passkey');
    return { passkeys: await listPasskeys(db, user.id) };
  });

  app.delete('/api/auth/passkeys/:id', async (req) => {
    const { user } = requireUser(req);
    const { id } = req.params as { id: string };
    if (!UUID_RE.test(id)) throw notFound('Passkey');
    const row = await db.deleteFrom('passkeys').where('id', '=', id).where('user_id', '=', user.id).returning(['id', 'name']).executeTakeFirst();
    if (!row) throw notFound('Passkey');
    await recordPlatformAudit(db, { type: 'user', userId: user.id, email: user.email }, { action: 'auth.passkey_removed', targetType: 'passkey', targetId: row.id, metadata: { name: row.name } }, requestMeta(req));
    return { passkeys: await listPasskeys(db, user.id) };
  });

  // ------------------------------------------------------------ signing in
  app.post('/api/auth/passkeys/login/options', rateLimited(30, '15 minutes'), async () => ({ options: await loginOptions(db, rp) }));

  app.post('/api/auth/passkeys/login', rateLimited(10, '15 minutes'), async (req, reply) => {
    const { response } = parse(z.object({ response: AuthenticationResponse }), req.body);
    const meta = requestMeta(req);
    const result = await finishLogin(db, rp, response, (err) => req.log.info({ err: String(err) }, 'passkey sign-in refused'));
    if (!result.ok) {
      if (result.reason === 'unknown') throw new AppError(401, 'PASSKEY_UNKNOWN', 'This passkey is not registered with Midad. Sign in with your password, then add it again.');
      await recordPlatformAudit(db, { type: 'anonymous' }, { action: 'auth.passkey_login_failed', targetType: 'user', targetId: result.userId }, meta);
      throw new AppError(401, 'PASSKEY_INVALID', 'The passkey could not be checked. Try again.');
    }
    const user = await db.selectFrom('users').selectAll().where('id', '=', result.userId).executeTakeFirstOrThrow();
    if (!isStaff(user)) throw forbidden('Student accounts sign in with their school code and password', 'STAFF_ONLY');
    if (user.status !== 'active') throw forbidden('This account is suspended. Contact support.', 'ACCOUNT_SUSPENDED');
    if (!user.email_verified_at) throw new AppError(403, 'EMAIL_NOT_VERIFIED', 'Confirm your email address before signing in');

    await db.updateTable('users').set({ last_login_at: new Date() }).where('id', '=', user.id).execute();
    // As after a full password sign-in: this browser becomes one the account knows (auth/login-protection.ts).
    await recordSuccess(db, config, reply, await loginClient(db, config, req, user.id));
    if (req.auth?.kind === 'session') await revokeSession(db, req.auth.session.id);
    // A passkey is something the person has (the device) and is or knows (fingerprint, face or PIN, checked by the
    // device): the session is two-step verified, as after a password and a code.
    await startSession(ctx, req, reply, user, { mfaPending: false, mfaVerified: true });
    await recordPlatformAudit(db, { type: user.is_platform_admin ? 'platform_admin' : 'user', userId: user.id, email: user.email }, { action: 'auth.login', targetType: 'user', targetId: user.id, metadata: { passkey: result.passkeyId } }, meta);
    return { user: publicUser(user) };
  });
}
