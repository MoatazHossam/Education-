import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { recordAudit, recordPlatformAudit, requestMeta } from '../audit/audit.js';
import { getEntitlements } from '../billing/entitlements.js';
import { setOrgContext, withOrgContext, withSystemContext, withUserContext, type Executor } from '../db/index.js';
import { studentsEnabled } from '../students/service.js';
import type { Locale, StaffUser, User } from '../db/types.js';
import type { AppContext } from '../http/context.js';
import { rateLimited } from '../http/rate-limit.js';
import { decryptSecret, encryptSecret, randomToken, sha256Hex } from '../lib/crypto.js';
import { AppError, badRequest, forbidden, notFound, unauthorized } from '../lib/errors.js';
import { parse, zEmail, zLocale, zName, zPassword } from '../lib/validation.js';
import { enqueueEmail, notify } from '../notifications/email.js';
import { createOrganization } from '../orgs/service.js';
import { asStaff, requireUser } from './guards.js';
import { enrollmentPayload, generateRecoveryCodes, generateTotpSecret, normalizeRecoveryCode, verifyTotp } from './mfa.js';
import { burnPasswordCheck, hashPassword, verifyPassword } from './password.js';
import {
  clearSessionCookie,
  createSession,
  csrfTokenFor,
  revokeSession,
  revokeUserSessions,
  setSessionCookie,
} from './sessions.js';

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MS = 15 * 60_000;
const VERIFY_TTL_MS = 48 * 3_600_000;
const RESET_TTL_MS = 3_600_000;

export function publicUser(u: User) {
  return {
    id: u.id,
    kind: u.kind,
    email: u.email,
    name: u.name,
    locale: u.locale,
    isPlatformAdmin: u.is_platform_admin,
    mfaEnabled: u.mfa_enabled,
    emailVerified: Boolean(u.email_verified_at),
    catalogEmails: u.catalog_emails,
    assignmentEmails: u.assignment_emails,
    dueReminderEmails: u.due_reminder_emails,
    assignmentEmailFrequency: u.assignment_email_frequency,
    createdAt: u.created_at,
  };
}

export async function issueUserToken(exec: Executor, userId: string, purpose: 'verify_email' | 'reset_password', ttlMs: number): Promise<string> {
  const token = randomToken(32);
  // Only the newest token of each purpose stays valid.
  await exec.updateTable('user_tokens').set({ used_at: new Date() }).where('user_id', '=', userId).where('purpose', '=', purpose).where('used_at', 'is', null).execute();
  await exec.insertInto('user_tokens').values({ user_id: userId, purpose, token_hash: sha256Hex(token), expires_at: new Date(Date.now() + ttlMs) }).execute();
  return token;
}

/** Atomically marks a token used and returns its user, or null if invalid, used or expired. */
async function consumeUserToken(exec: Executor, token: string, purpose: 'verify_email' | 'reset_password'): Promise<string | null> {
  const row = await exec
    .updateTable('user_tokens')
    .set({ used_at: new Date() })
    .where('token_hash', '=', sha256Hex(token))
    .where('purpose', '=', purpose)
    .where('used_at', 'is', null)
    .where('expires_at', '>', new Date())
    .returning('user_id')
    .executeTakeFirst();
  return row?.user_id ?? null;
}

function link(ctx: AppContext, path: string): string {
  return `${ctx.config.APP_URL}${path}`;
}

/** The staff account with this email. Student accounts have no email, so they never match. */
async function staffByEmail(exec: Executor, email: string): Promise<StaffUser | undefined> {
  const user = await exec.selectFrom('users').selectAll().where('email', '=', email).executeTakeFirst();
  return user ? asStaff(user) : undefined;
}

async function startSession(ctx: AppContext, req: FastifyRequest, reply: FastifyReply, user: User, opts: { mfaPending: boolean; mfaVerified: boolean }) {
  const meta = requestMeta(req);
  const { token, session } = await createSession(ctx.db, user, {
    state: opts.mfaPending ? 'mfa_pending' : 'active',
    mfaVerified: opts.mfaVerified,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  setSessionCookie(reply, ctx.config, token, session.expires_at);
  return session;
}

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, config } = ctx;
  const emailKey = (req: FastifyRequest) => {
    const email = (req.body as { email?: unknown } | undefined)?.email;
    return `${req.ip}|${typeof email === 'string' ? email.trim().toLowerCase() : ''}`;
  };

  // ------------------------------------------------------------ registration
  const RegisterBody = z.object({
    name: zName,
    email: zEmail,
    password: zPassword,
    organizationName: z.string().trim().min(2).max(120).optional(),
    locale: zLocale.default('en'),
    inviteToken: z.string().min(20).max(200).optional(),
  });

  app.post('/api/auth/register', rateLimited(10, '1 hour'), async (req, reply) => {
    const body = parse(RegisterBody, req.body);
    const meta = requestMeta(req);
    if (body.password.toLowerCase() === body.email) throw badRequest('Password must not be your email address');
    const passwordHash = await hashPassword(body.password); // always hashed: equal timing for new/existing emails

    if (body.inviteToken) {
      // Accepting an invitation by creating an account. The emailed token proves
      // control of the address, so the account starts verified.
      const result = await db.transaction().execute(async (trx) => {
        await sql`SELECT set_config('app.rls_bypass', 'on', true)`.execute(trx);
        const invite = await trx
          .selectFrom('invitations')
          .selectAll()
          .where('token_hash', '=', sha256Hex(body.inviteToken!))
          .where('accepted_at', 'is', null)
          .where('revoked_at', 'is', null)
          .where('expires_at', '>', new Date())
          .forUpdate()
          .executeTakeFirst();
        if (!invite) throw new AppError(400, 'INVITATION_INVALID', 'This invitation is invalid or has expired');
        if (invite.email !== body.email) throw new AppError(400, 'INVITATION_EMAIL_MISMATCH', 'Use the email address the invitation was sent to');
        const exists = await trx.selectFrom('users').select('id').where('email', '=', body.email).executeTakeFirst();
        if (exists) throw new AppError(409, 'ACCOUNT_EXISTS', 'An account with this email already exists. Sign in to accept the invitation.');
        const user = await trx
          .insertInto('users')
          // Signed in straight away (below), which counts as the first sign-in.
          .values({ email: body.email, name: body.name, password_hash: passwordHash, locale: body.locale, email_verified_at: new Date(), last_login_at: new Date() })
          .returningAll()
          .executeTakeFirstOrThrow();
        await setOrgContext(trx, invite.org_id, user.id);
        await trx.insertInto('memberships').values({ org_id: invite.org_id, user_id: user.id, role: invite.role }).execute();
        await trx.updateTable('invitations').set({ accepted_at: new Date(), accepted_by: user.id }).where('id', '=', invite.id).execute();
        await recordAudit(trx, { type: 'user', userId: user.id, email: user.email }, { orgId: invite.org_id, action: 'invitation.accepted', targetType: 'invitation', targetId: invite.id, metadata: { role: invite.role, newAccount: true } }, meta);
        return { user, orgId: invite.org_id };
      });
      await startSession(ctx, req, reply, result.user, { mfaPending: false, mfaVerified: false });
      return reply.status(201).send({ status: 'joined', orgId: result.orgId });
    }

    if (!body.organizationName) throw badRequest('Organization name is required', [{ path: 'organizationName', message: 'Required' }]);

    await db.transaction().execute(async (trx) => {
      const existing = await staffByEmail(trx, body.email);
      if (existing) {
        // Do not disclose that the email is registered; tell the owner instead.
        await enqueueEmail(trx, existing.email, 'account_exists', existing.locale, { loginLink: link(ctx, '/login'), resetLink: link(ctx, '/forgot-password') });
        return;
      }
      const user = asStaff(
        await trx
          .insertInto('users')
          .values({ email: body.email, name: body.name, password_hash: passwordHash, locale: body.locale })
          .returningAll()
          .executeTakeFirstOrThrow(),
      );
      const token = await issueUserToken(trx, user.id, 'verify_email', VERIFY_TTL_MS);
      await enqueueEmail(trx, user.email, 'verify_email', user.locale, { name: user.name, link: link(ctx, `/verify-email?token=${token}`) });
      const { org } = await createOrganization(trx, config, { name: body.organizationName!, owner: user, locale: body.locale }, meta);
      await recordAudit(trx, { type: 'user', userId: user.id, email: user.email }, { orgId: org.id, action: 'user.registered', targetType: 'user', targetId: user.id }, meta);
    });
    return reply.status(201).send({ status: 'verification_sent' });
  });

  app.post('/api/auth/verify-email', rateLimited(30, '1 hour'), async (req) => {
    const { token } = parse(z.object({ token: z.string().min(20).max(200) }), req.body);
    const userId = await db.transaction().execute(async (trx) => {
      const id = await consumeUserToken(trx, token, 'verify_email');
      if (id) await trx.updateTable('users').set({ email_verified_at: new Date() }).where('id', '=', id).where('email_verified_at', 'is', null).execute();
      return id;
    });
    if (!userId) throw new AppError(400, 'TOKEN_INVALID', 'This verification link is invalid or has expired');
    await recordPlatformAudit(db, { type: 'user', userId }, { action: 'user.email_verified', targetType: 'user', targetId: userId }, requestMeta(req));
    return { status: 'verified' };
  });

  app.post('/api/auth/resend-verification', rateLimited(5, '1 hour', emailKey), async (req, reply) => {
    const { email } = parse(z.object({ email: zEmail }), req.body);
    await db.transaction().execute(async (trx) => {
      const user = await staffByEmail(trx, email);
      if (!user || user.email_verified_at || user.status !== 'active') return;
      const token = await issueUserToken(trx, user.id, 'verify_email', VERIFY_TTL_MS);
      await enqueueEmail(trx, user.email, 'verify_email', user.locale, { name: user.name, link: link(ctx, `/verify-email?token=${token}`) });
    });
    return reply.status(202).send({ status: 'accepted' });
  });

  // ------------------------------------------------------------ login / logout
  app.post('/api/auth/login', rateLimited(10, '15 minutes', emailKey), async (req, reply) => {
    const { email, password } = parse(z.object({ email: zEmail, password: z.string().min(1).max(256) }), req.body);
    const meta = requestMeta(req);
    const invalid = new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password, or the account is temporarily locked');
    const user = await staffByEmail(db, email);
    if (!user) {
      await burnPasswordCheck(password);
      throw invalid;
    }
    if (user.locked_until && user.locked_until > new Date()) {
      await burnPasswordCheck(password);
      await recordPlatformAudit(db, { type: 'anonymous', email }, { action: 'auth.login_blocked_locked', targetType: 'user', targetId: user.id }, meta);
      throw invalid;
    }
    if (!(await verifyPassword(user.password_hash, password))) {
      const failures = user.failed_login_count + 1;
      const lock = failures >= MAX_FAILED_LOGINS;
      await db
        .updateTable('users')
        .set({ failed_login_count: lock ? 0 : failures, locked_until: lock ? new Date(Date.now() + LOCKOUT_MS) : user.locked_until })
        .where('id', '=', user.id)
        .execute();
      await recordPlatformAudit(db, { type: 'anonymous', email }, { action: lock ? 'auth.account_locked' : 'auth.login_failed', targetType: 'user', targetId: user.id }, meta);
      throw invalid;
    }
    if (user.status !== 'active') throw forbidden('This account is suspended. Contact support.', 'ACCOUNT_SUSPENDED');
    if (!user.email_verified_at) throw new AppError(403, 'EMAIL_NOT_VERIFIED', 'Confirm your email address before signing in');

    await db
      .updateTable('users')
      .set({ ...(user.mfa_enabled ? {} : { failed_login_count: 0 }), locked_until: null, last_login_at: new Date() })
      .where('id', '=', user.id)
      .execute();
    // Never keep a previous session alive across a new sign-in on this browser.
    if (req.auth?.kind === 'session') await revokeSession(db, req.auth.session.id);
    await startSession(ctx, req, reply, user, { mfaPending: user.mfa_enabled, mfaVerified: false });
    await recordPlatformAudit(db, { type: user.is_platform_admin ? 'platform_admin' : 'user', userId: user.id, email: user.email }, { action: user.mfa_enabled ? 'auth.password_ok_mfa_pending' : 'auth.login', targetType: 'user', targetId: user.id }, meta);
    return { mfaRequired: user.mfa_enabled, user: user.mfa_enabled ? null : publicUser(user) };
  });

  // Student accounts sign in with their school's code (the organization slug),
  // the username the school gave them and their password. Same sessions,
  // lockout and audit as staff sign-in; the audit entries go to the school.
  const studentKey = (req: FastifyRequest) => {
    const b = (req.body ?? {}) as { school?: unknown; username?: unknown };
    const s = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : '');
    return `${req.ip}|${s(b.school)}|${s(b.username)}`;
  };
  app.post('/api/auth/student-login', rateLimited(10, '15 minutes', studentKey), async (req, reply) => {
    const body = parse(
      z.object({ school: z.string().trim().toLowerCase().min(1).max(64), username: z.string().trim().toLowerCase().min(1).max(40), password: z.string().min(1).max(256) }),
      req.body,
    );
    const meta = requestMeta(req);
    const invalid = new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect school code, username or password, or the account is temporarily locked');
    const org = await db.selectFrom('organizations').select(['id', 'status']).where('slug', '=', body.school).executeTakeFirst();
    const found = org
      ? await withOrgContext(db, { orgId: org.id }, (trx) =>
          trx.selectFrom('students as s').innerJoin('users as u', 'u.id', 's.user_id').selectAll('u').where('s.org_id', '=', org.id).where('s.username', '=', body.username).executeTakeFirst(),
        )
      : undefined;
    if (!org || !found) {
      await burnPasswordCheck(body.password);
      throw invalid;
    }
    const user: User = found;
    const audit = (action: string) =>
      withOrgContext(db, { orgId: org.id }, (trx) => recordAudit(trx, { type: 'user', userId: user.id }, { orgId: org.id, action, targetType: 'student', targetId: user.id, metadata: { username: body.username } }, meta));
    if (user.locked_until && user.locked_until > new Date()) {
      await burnPasswordCheck(body.password);
      await audit('auth.student_login_blocked_locked');
      throw invalid;
    }
    if (!(await verifyPassword(user.password_hash, body.password))) {
      const failures = user.failed_login_count + 1;
      const lock = failures >= MAX_FAILED_LOGINS;
      await db
        .updateTable('users')
        .set({ failed_login_count: lock ? 0 : failures, locked_until: lock ? new Date(Date.now() + LOCKOUT_MS) : user.locked_until })
        .where('id', '=', user.id)
        .execute();
      await audit(lock ? 'auth.student_locked' : 'auth.student_login_failed');
      throw invalid;
    }
    if (user.status !== 'active') throw forbidden('This account is suspended. Ask your school.', 'ACCOUNT_SUSPENDED');
    if (org.status !== 'active') throw forbidden('Your school’s account is suspended. Ask your school.', 'ORG_SUSPENDED');
    const enabled = await withOrgContext(db, { orgId: org.id }, async (trx) => studentsEnabled(await getEntitlements(trx, org.id, config.GRACE_DAYS)));
    if (!enabled) throw forbidden('Your school has not turned on the student portal. Ask your school.', 'STUDENT_PORTAL_OFF');

    await db.updateTable('users').set({ failed_login_count: 0, locked_until: null, last_login_at: new Date() }).where('id', '=', user.id).execute();
    if (req.auth?.kind === 'session') await revokeSession(db, req.auth.session.id);
    await startSession(ctx, req, reply, user, { mfaPending: false, mfaVerified: false });
    await audit('auth.student_login');
    return { mfaRequired: false, user: publicUser(user) };
  });

  app.post('/api/auth/mfa/verify', rateLimited(10, '15 minutes'), async (req, reply) => {
    const auth = req.auth;
    if (auth?.kind !== 'session' || auth.session.state !== 'mfa_pending') throw unauthorized('Sign in first');
    const body = parse(z.object({ code: z.string().max(20).optional(), recoveryCode: z.string().max(40).optional() }), req.body);
    const user = auth.user;
    const meta = requestMeta(req);
    let ok = false;
    if (body.code && user.mfa_secret_enc) {
      const step = verifyTotp(decryptSecret(config.dataKeys, user.mfa_secret_enc), body.code, user.mfa_last_step === null ? null : Number(user.mfa_last_step));
      if (step !== null) {
        await db.updateTable('users').set({ mfa_last_step: step }).where('id', '=', user.id).execute();
        ok = true;
      }
    } else if (body.recoveryCode) {
      const hash = sha256Hex(normalizeRecoveryCode(body.recoveryCode));
      const res = await db
        .updateTable('users')
        .set({ mfa_recovery_hashes: sql<string[]>`array_remove(mfa_recovery_hashes, ${hash})` })
        .where('id', '=', user.id)
        .where(sql<boolean>`${hash} = ANY(mfa_recovery_hashes)`)
        .executeTakeFirst();
      ok = Number(res.numUpdatedRows) === 1;
      if (ok) await recordPlatformAudit(db, { type: 'user', userId: user.id, email: user.email }, { action: 'auth.recovery_code_used', targetType: 'user', targetId: user.id }, meta);
    }
    if (!ok) {
      // Failed second factors count toward the same lockout as failed passwords,
      // and a locked account loses its half-authenticated session.
      const failures = user.failed_login_count + 1;
      const lock = failures >= MAX_FAILED_LOGINS;
      await db
        .updateTable('users')
        .set({ failed_login_count: lock ? 0 : failures, locked_until: lock ? new Date(Date.now() + LOCKOUT_MS) : user.locked_until })
        .where('id', '=', user.id)
        .execute();
      if (lock) {
        await revokeSession(db, auth.session.id);
        clearSessionCookie(reply, config);
      }
      await recordPlatformAudit(db, { type: 'user', userId: user.id, email: user.email }, { action: lock ? 'auth.account_locked' : 'auth.mfa_failed', targetType: 'user', targetId: user.id }, meta);
      throw new AppError(401, 'MFA_INVALID', 'The code is incorrect or has already been used');
    }
    await db.updateTable('users').set({ failed_login_count: 0 }).where('id', '=', user.id).execute();
    // Rotate: the pre-MFA session token is discarded.
    await revokeSession(db, auth.session.id);
    await startSession(ctx, req, reply, user, { mfaPending: false, mfaVerified: true });
    await recordPlatformAudit(db, { type: user.is_platform_admin ? 'platform_admin' : 'user', userId: user.id, email: user.email }, { action: 'auth.login', targetType: 'user', targetId: user.id, metadata: { mfa: true } }, meta);
    return { user: publicUser(user) };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    if (req.auth?.kind === 'session') await revokeSession(db, req.auth.session.id);
    clearSessionCookie(reply, config);
    return reply.status(204).send();
  });

  app.post('/api/auth/logout-others', async (req) => {
    const { user, session } = requireUser(req);
    const revoked = await revokeUserSessions(db, user.id, session.id);
    await recordPlatformAudit(db, { type: 'user', userId: user.id, email: user.email }, { action: 'auth.sessions_revoked', targetType: 'user', targetId: user.id, metadata: { revoked } }, requestMeta(req));
    return { revoked };
  });

  app.get('/api/auth/me', async (req) => {
    const auth = req.auth;
    if (auth?.kind !== 'session') throw unauthorized();
    if (auth.session.state === 'mfa_pending') return { mfaPending: true, csrfToken: csrfTokenFor(config, auth.session.id) };
    if (auth.user.kind === 'student') {
      const student = await withUserContext(db, auth.user.id, (trx) =>
        trx
          .selectFrom('students as s')
          .innerJoin('organizations as o', 'o.id', 's.org_id')
          .select(['s.username', 's.grade', 'o.id as orgId', 'o.name as orgName', 'o.slug as orgSlug', 'o.locale as orgLocale'])
          .where('s.user_id', '=', auth.user.id)
          .executeTakeFirstOrThrow(),
      );
      // Homework notices (docs/CLASSROOM.md): the portal's bell shows the unread count.
      const unread = await db.selectFrom('notifications').select((eb) => eb.fn.countAll<string>().as('n')).where('user_id', '=', auth.user.id).where('read_at', 'is', null).executeTakeFirstOrThrow();
      return {
        mfaPending: false,
        user: publicUser(auth.user),
        student: { username: student.username, grade: student.grade, school: { id: student.orgId, name: student.orgName, code: student.orgSlug, locale: student.orgLocale } },
        session: { mfaVerified: false, expiresAt: auth.session.expires_at },
        csrfToken: csrfTokenFor(config, auth.session.id),
        organizations: [],
        unreadNotifications: Number(unread.n),
      };
    }
    const memberships = await withUserContext(db, auth.user.id, (trx) =>
      trx
        .selectFrom('memberships as m')
        .innerJoin('organizations as o', 'o.id', 'm.org_id')
        .select(['o.id', 'o.name', 'o.slug', 'o.status', 'o.locale', 'm.role'])
        .where('m.user_id', '=', auth.user.id)
        .orderBy('o.name')
        .execute(),
    );
    const unread = await db
      .selectFrom('notifications')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('user_id', '=', auth.user.id)
      .where('read_at', 'is', null)
      .executeTakeFirstOrThrow();
    return {
      mfaPending: false,
      user: publicUser(auth.user),
      session: { mfaVerified: auth.session.mfa_verified, expiresAt: auth.session.expires_at },
      csrfToken: csrfTokenFor(config, auth.session.id),
      organizations: memberships.map((m) => ({ id: m.id, name: m.name, slug: m.slug, status: m.status, locale: m.locale, role: m.role })),
      unreadNotifications: Number(unread.n),
    };
  });

  // ------------------------------------------------------------ password management
  app.post('/api/auth/password/forgot', rateLimited(5, '1 hour', emailKey), async (req, reply) => {
    const { email } = parse(z.object({ email: zEmail }), req.body);
    await db.transaction().execute(async (trx) => {
      const user = await staffByEmail(trx, email);
      if (!user || user.status !== 'active') return;
      const token = await issueUserToken(trx, user.id, 'reset_password', RESET_TTL_MS);
      await enqueueEmail(trx, user.email, 'reset_password', user.locale, { name: user.name, link: link(ctx, `/reset-password?token=${token}`) });
    });
    return reply.status(202).send({ status: 'accepted' });
  });

  app.post('/api/auth/password/reset', rateLimited(10, '1 hour'), async (req) => {
    const { token, password } = parse(z.object({ token: z.string().min(20).max(200), password: zPassword }), req.body);
    const passwordHash = await hashPassword(password);
    const user = await db.transaction().execute(async (trx) => {
      const userId = await consumeUserToken(trx, token, 'reset_password');
      if (!userId) return null;
      const u = await trx
        .updateTable('users')
        .set({
          password_hash: passwordHash,
          password_changed_at: new Date(),
          failed_login_count: 0,
          locked_until: null,
          // Receiving the reset email proves control of the address.
          email_verified_at: sql`coalesce(email_verified_at, now())`,
        })
        .where('id', '=', userId)
        .returningAll()
        .executeTakeFirstOrThrow()
        .then(asStaff);
      await revokeUserSessions(trx, userId);
      await enqueueEmail(trx, u.email, 'password_changed', u.locale, { name: u.name, resetLink: link(ctx, '/forgot-password') });
      return u;
    });
    if (!user) throw new AppError(400, 'TOKEN_INVALID', 'This reset link is invalid or has expired');
    await recordPlatformAudit(db, { type: 'user', userId: user.id, email: user.email }, { action: 'auth.password_reset', targetType: 'user', targetId: user.id }, requestMeta(req));
    return { status: 'password_reset' };
  });

  app.post('/api/auth/password/change', rateLimited(10, '15 minutes'), async (req) => {
    const { user, session } = requireUser(req);
    const body = parse(z.object({ currentPassword: z.string().min(1).max(256), newPassword: zPassword }), req.body);
    if (!(await verifyPassword(user.password_hash, body.currentPassword))) throw new AppError(400, 'INVALID_PASSWORD', 'Current password is incorrect');
    const passwordHash = await hashPassword(body.newPassword);
    await db.transaction().execute(async (trx) => {
      await trx.updateTable('users').set({ password_hash: passwordHash, password_changed_at: new Date() }).where('id', '=', user.id).execute();
      await revokeUserSessions(trx, user.id, session.id);
      await enqueueEmail(trx, user.email, 'password_changed', user.locale, { name: user.name, resetLink: link(ctx, '/forgot-password') });
    });
    await recordPlatformAudit(db, { type: 'user', userId: user.id, email: user.email }, { action: 'auth.password_changed', targetType: 'user', targetId: user.id }, requestMeta(req));
    return { status: 'password_changed' };
  });

  app.patch('/api/auth/profile', async (req) => {
    const { user } = requireUser(req);
    const body = parse(z.object({ name: zName.optional(), locale: zLocale.optional(), catalogEmails: z.boolean().optional(), assignmentEmails: z.boolean().optional(), assignmentEmailFrequency: z.enum(['instant', 'daily']).optional(), dueReminderEmails: z.boolean().optional() }), req.body);
    const updated = await db
      .updateTable('users')
      .set({
        ...(body.name ? { name: body.name } : {}),
        ...(body.locale ? { locale: body.locale as Locale } : {}),
        ...(body.catalogEmails !== undefined ? { catalog_emails: body.catalogEmails } : {}),
        ...(body.assignmentEmails !== undefined ? { assignment_emails: body.assignmentEmails } : {}),
        ...(body.dueReminderEmails !== undefined ? { due_reminder_emails: body.dueReminderEmails } : {}),
        ...(body.assignmentEmailFrequency ? { assignment_email_frequency: body.assignmentEmailFrequency } : {}),
      })
      .where('id', '=', user.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    // No more daily summary: drop what was waiting for it (the in-app notices were sent).
    if (!updated.assignment_emails || updated.assignment_email_frequency !== 'daily') {
      await withUserContext(db, user.id, (trx) => trx.deleteFrom('assignment_digest_items').where('user_id', '=', user.id).execute());
    }
    return { user: publicUser(updated) };
  });

  // ------------------------------------------------------------ personal data (data-subject rights)
  app.get('/api/auth/account/export', rateLimited(10, '1 hour'), async (req, reply) => {
    const { user } = requireUser(req);
    const memberships = await withUserContext(db, user.id, (trx) =>
      trx.selectFrom('memberships as m').innerJoin('organizations as o', 'o.id', 'm.org_id').select(['o.id', 'o.name', 'm.role', 'm.created_at']).where('m.user_id', '=', user.id).execute(),
    );
    const sessions = await db.selectFrom('sessions').select(['ip', 'user_agent', 'created_at', 'last_seen_at']).where('user_id', '=', user.id).execute();
    const notifications = await db.selectFrom('notifications').select(['kind', 'title', 'body', 'created_at', 'read_at']).where('user_id', '=', user.id).execute();
    const audit = await withSystemContext(db, (trx) =>
      trx.selectFrom('audit_logs').select(['action', 'org_id', 'ip', 'user_agent', 'created_at']).where('actor_user_id', '=', user.id).orderBy('id', 'desc').limit(1000).execute(),
    );
    await recordPlatformAudit(db, { type: 'user', userId: user.id, email: user.email }, { action: 'user.data_exported', targetType: 'user', targetId: user.id }, requestMeta(req));
    reply.header('Content-Disposition', 'attachment; filename="my-data.json"');
    return {
      exportedAt: new Date().toISOString(),
      profile: { ...publicUser(user), lastLoginAt: user.last_login_at, passwordChangedAt: user.password_changed_at },
      memberships: memberships.map((m) => ({ organizationId: m.id, organization: m.name, role: m.role, since: m.created_at })),
      sessions,
      notifications,
      activity: audit,
    };
  });

  app.delete('/api/auth/account', rateLimited(5, '1 hour'), async (req, reply) => {
    const { user } = requireUser(req);
    const { password } = parse(z.object({ password: z.string().min(1).max(256) }), req.body);
    if (!(await verifyPassword(user.password_hash, password))) throw new AppError(400, 'INVALID_PASSWORD', 'Password is incorrect');
    if (user.is_platform_admin) throw forbidden('Platform administrator accounts are removed by another administrator');
    const owned = await withUserContext(db, user.id, (trx) =>
      trx.selectFrom('memberships as m').innerJoin('organizations as o', 'o.id', 'm.org_id').select(['o.name']).where('m.user_id', '=', user.id).where('m.role', '=', 'owner').execute(),
    );
    if (owned.length) {
      throw new AppError(409, 'OWNS_ORGANIZATIONS', `Transfer or delete the organizations you own first: ${owned.map((o) => o.name).join(', ')}`);
    }
    // Memberships, sessions, tokens and notifications cascade; authored records keep a NULL author.
    await db.deleteFrom('users').where('id', '=', user.id).execute();
    await recordPlatformAudit(db, { type: 'user', userId: user.id, email: null }, { action: 'user.deleted', targetType: 'user', targetId: user.id }, requestMeta(req));
    clearSessionCookie(reply, config);
    return { status: 'deleted' };
  });

  // ------------------------------------------------------------ sessions
  app.get('/api/auth/sessions', async (req) => {
    const { user, session } = requireUser(req);
    const rows = await db
      .selectFrom('sessions')
      .select(['id', 'ip', 'user_agent', 'created_at', 'last_seen_at', 'expires_at', 'mfa_verified'])
      .where('user_id', '=', user.id)
      .where('state', '=', 'active')
      .orderBy('last_seen_at', 'desc')
      .execute();
    return {
      sessions: rows.map((s) => ({
        id: s.id.slice(0, 16),
        current: s.id === session.id,
        ip: s.ip,
        userAgent: s.user_agent,
        createdAt: s.created_at,
        lastSeenAt: s.last_seen_at,
        expiresAt: s.expires_at,
        mfaVerified: s.mfa_verified,
      })),
    };
  });

  app.delete('/api/auth/sessions/:id', async (req) => {
    const { user } = requireUser(req);
    const { id } = parse(z.object({ id: z.string().regex(/^[0-9a-f]{16}$/) }), req.params);
    const res = await db.deleteFrom('sessions').where('user_id', '=', user.id).where(sql<boolean>`left(id, 16) = ${id}`).executeTakeFirst();
    if (!Number(res.numDeletedRows)) throw notFound('Session');
    return { status: 'revoked' };
  });

  // ------------------------------------------------------------ MFA management
  app.post('/api/auth/mfa/setup', async (req) => {
    const { user } = requireUser(req);
    if (user.mfa_enabled) throw new AppError(409, 'MFA_ALREADY_ENABLED', 'Two-factor authentication is already enabled');
    const secret = generateTotpSecret();
    await db.updateTable('users').set({ mfa_pending_secret_enc: encryptSecret(config.dataKeys, secret) }).where('id', '=', user.id).execute();
    return enrollmentPayload(user.email, secret);
  });

  app.post('/api/auth/mfa/enable', rateLimited(10, '15 minutes'), async (req, reply) => {
    const { user, session } = requireUser(req);
    const { code } = parse(z.object({ code: z.string().min(6).max(10) }), req.body);
    if (!user.mfa_pending_secret_enc) throw badRequest('Start two-factor setup first');
    const secretEnc = user.mfa_pending_secret_enc;
    const step = verifyTotp(decryptSecret(config.dataKeys, secretEnc), code, null);
    if (step === null) throw new AppError(400, 'MFA_INVALID', 'The code is incorrect. Check your device clock and try again.');
    const { codes, hashes } = generateRecoveryCodes();
    const updated = await db
      .updateTable('users')
      .set({ mfa_enabled: true, mfa_secret_enc: secretEnc, mfa_pending_secret_enc: null, mfa_last_step: step, mfa_recovery_hashes: hashes })
      .where('id', '=', user.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    // Privilege change: rotate the session so the new MFA-verified session has a fresh token.
    await revokeSession(db, session.id);
    await startSession(ctx, req, reply, updated, { mfaPending: false, mfaVerified: true });
    await recordPlatformAudit(db, { type: 'user', userId: user.id, email: user.email }, { action: 'auth.mfa_enabled', targetType: 'user', targetId: user.id }, requestMeta(req));
    return { recoveryCodes: codes };
  });

  app.post('/api/auth/mfa/disable', rateLimited(10, '15 minutes'), async (req) => {
    const { user } = requireUser(req);
    const body = parse(z.object({ password: z.string().min(1).max(256), code: z.string().min(6).max(10) }), req.body);
    if (!user.mfa_enabled || !user.mfa_secret_enc) throw badRequest('Two-factor authentication is not enabled');
    if (user.is_platform_admin) throw forbidden('Platform administrators cannot disable two-factor authentication');
    if (!(await verifyPassword(user.password_hash, body.password))) throw new AppError(400, 'INVALID_PASSWORD', 'Password is incorrect');
    const step = verifyTotp(decryptSecret(config.dataKeys, user.mfa_secret_enc), body.code, user.mfa_last_step === null ? null : Number(user.mfa_last_step));
    if (step === null) throw new AppError(400, 'MFA_INVALID', 'The code is incorrect');
    await db
      .updateTable('users')
      .set({ mfa_enabled: false, mfa_secret_enc: null, mfa_pending_secret_enc: null, mfa_last_step: null, mfa_recovery_hashes: [] })
      .where('id', '=', user.id)
      .execute();
    await db.updateTable('sessions').set({ mfa_verified: false }).where('user_id', '=', user.id).execute();
    await recordPlatformAudit(db, { type: 'user', userId: user.id, email: user.email }, { action: 'auth.mfa_disabled', targetType: 'user', targetId: user.id }, requestMeta(req));
    return { status: 'disabled' };
  });

  app.post('/api/auth/mfa/recovery-codes', rateLimited(5, '15 minutes'), async (req) => {
    const { user } = requireUser(req);
    const { code } = parse(z.object({ code: z.string().min(6).max(10) }), req.body);
    if (!user.mfa_enabled || !user.mfa_secret_enc) throw badRequest('Two-factor authentication is not enabled');
    const step = verifyTotp(decryptSecret(config.dataKeys, user.mfa_secret_enc), code, user.mfa_last_step === null ? null : Number(user.mfa_last_step));
    if (step === null) throw new AppError(400, 'MFA_INVALID', 'The code is incorrect');
    const { codes, hashes } = generateRecoveryCodes();
    await db.updateTable('users').set({ mfa_recovery_hashes: hashes, mfa_last_step: step }).where('id', '=', user.id).execute();
    await recordPlatformAudit(db, { type: 'user', userId: user.id, email: user.email }, { action: 'auth.recovery_codes_regenerated', targetType: 'user', targetId: user.id }, requestMeta(req));
    return { recoveryCodes: codes };
  });

  // ------------------------------------------------------------ invitations (token holder side)
  app.get('/api/invitations/:token', rateLimited(30, '15 minutes'), async (req) => {
    const { token } = parse(z.object({ token: z.string().min(20).max(200) }), req.params);
    const row = await withSystemContext(db, (trx) =>
      trx
        .selectFrom('invitations as i')
        .innerJoin('organizations as o', 'o.id', 'i.org_id')
        .leftJoin('users as u', 'u.id', 'i.invited_by')
        .select(['i.email', 'i.role', 'i.expires_at', 'o.name as orgName', 'u.name as inviterName'])
        .where('i.token_hash', '=', sha256Hex(token))
        .where('i.accepted_at', 'is', null)
        .where('i.revoked_at', 'is', null)
        .where('i.expires_at', '>', new Date())
        .executeTakeFirst(),
    );
    if (!row) throw new AppError(404, 'INVITATION_INVALID', 'This invitation is invalid or has expired');
    const account = await db.selectFrom('users').select('id').where('email', '=', row.email).executeTakeFirst();
    return { email: row.email, role: row.role, expiresAt: row.expires_at, orgName: row.orgName, inviterName: row.inviterName, hasAccount: Boolean(account) };
  });

  app.post('/api/invitations/accept', rateLimited(20, '15 minutes'), async (req) => {
    const { user } = requireUser(req);
    const { token } = parse(z.object({ token: z.string().min(20).max(200) }), req.body);
    const meta = requestMeta(req);
    const orgId = await db.transaction().execute(async (trx) => {
      // Token lookup happens before the caller is a member, so it runs with the
      // RLS bypass; the token itself is the authorization.
      await sql`SELECT set_config('app.rls_bypass', 'on', true)`.execute(trx);
      const invite = await trx
        .selectFrom('invitations')
        .selectAll()
        .where('token_hash', '=', sha256Hex(token))
        .where('accepted_at', 'is', null)
        .where('revoked_at', 'is', null)
        .where('expires_at', '>', new Date())
        .forUpdate()
        .executeTakeFirst();
      if (!invite) throw new AppError(400, 'INVITATION_INVALID', 'This invitation is invalid or has expired');
      if (invite.email !== user.email) throw new AppError(403, 'INVITATION_EMAIL_MISMATCH', `This invitation was sent to a different email address`);
      const org = await trx.selectFrom('organizations').select(['status', 'name']).where('id', '=', invite.org_id).executeTakeFirstOrThrow();
      if (org.status !== 'active') throw forbidden('This organization is suspended', 'ORG_SUSPENDED');
      await sql`SELECT set_config('app.rls_bypass', '', true)`.execute(trx);
      await setOrgContext(trx, invite.org_id, user.id);
      await trx
        .insertInto('memberships')
        .values({ org_id: invite.org_id, user_id: user.id, role: invite.role })
        .onConflict((oc) => oc.columns(['org_id', 'user_id']).doNothing())
        .execute();
      await trx.updateTable('invitations').set({ accepted_at: new Date(), accepted_by: user.id }).where('id', '=', invite.id).execute();
      await recordAudit(trx, { type: 'user', userId: user.id, email: user.email }, { orgId: invite.org_id, action: 'invitation.accepted', targetType: 'invitation', targetId: invite.id, metadata: { role: invite.role } }, meta);
      if (invite.invited_by) {
        await notify(trx, { userId: invite.invited_by, orgId: invite.org_id, kind: 'invitation_accepted', title: `${user.name} joined ${org.name}`, body: `${user.email} accepted your invitation as ${invite.role}.`, link: `/org/${invite.org_id}/members` });
      }
      return invite.org_id;
    });
    return { status: 'joined', orgId };
  });
}
