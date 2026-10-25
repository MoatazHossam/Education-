import type { FastifyReply } from 'fastify';
import type { AppConfig } from '../config.js';
import type { Database, Executor } from '../db/index.js';
import type { Session, User } from '../db/types.js';
import { hmacHex, randomToken, sha256Hex } from '../lib/crypto.js';

const ABSOLUTE_TTL_MS = 30 * 86_400_000;
const ADMIN_ABSOLUTE_TTL_MS = 12 * 3_600_000;
// Students often use shared school computers: their sessions end the same day.
const STUDENT_ABSOLUTE_TTL_MS = 12 * 3_600_000;
const MFA_PENDING_TTL_MS = 10 * 60_000;
export const IDLE_TIMEOUT_MS = 7 * 86_400_000;
const TOUCH_INTERVAL_MS = 5 * 60_000;

export function sessionCookieName(config: AppConfig): string {
  // The __Host- prefix forces Secure, Path=/ and no Domain, preventing subdomain cookie injection.
  return config.secureCookies ? '__Host-sid' : 'sid';
}

export function csrfTokenFor(config: AppConfig, sessionId: string): string {
  return hmacHex(config.SESSION_SECRET, `csrf:${sessionId}`);
}

function ttlFor(user: Pick<User, 'is_platform_admin' | 'kind'>, state: Session['state']): number {
  if (state === 'mfa_pending') return MFA_PENDING_TTL_MS;
  if (user.kind === 'student') return STUDENT_ABSOLUTE_TTL_MS;
  return user.is_platform_admin ? ADMIN_ABSOLUTE_TTL_MS : ABSOLUTE_TTL_MS;
}

export async function createSession(
  exec: Executor,
  user: Pick<User, 'id' | 'is_platform_admin' | 'kind'>,
  opts: { state: Session['state']; mfaVerified: boolean; ip: string | null; userAgent: string | null },
): Promise<{ token: string; session: Session }> {
  const token = randomToken(32);
  const session = await exec
    .insertInto('sessions')
    .values({
      id: sha256Hex(token),
      user_id: user.id,
      state: opts.state,
      mfa_verified: opts.mfaVerified,
      ip: opts.ip,
      user_agent: opts.userAgent,
      expires_at: new Date(Date.now() + ttlFor(user, opts.state)),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return { token, session };
}

/** Looks up a session by its raw cookie token, enforcing absolute and idle expiry. */
export async function resolveSession(db: Database, token: string): Promise<{ session: Session; user: User } | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const id = sha256Hex(token);
  const session = await db.selectFrom('sessions').selectAll().where('id', '=', id).executeTakeFirst();
  if (!session) return null;
  const now = Date.now();
  if (session.expires_at.getTime() <= now || session.last_seen_at.getTime() + IDLE_TIMEOUT_MS <= now) {
    await db.deleteFrom('sessions').where('id', '=', id).execute();
    return null;
  }
  const user = await db.selectFrom('users').selectAll().where('id', '=', session.user_id).executeTakeFirst();
  if (!user || user.status !== 'active') return null;
  if (now - session.last_seen_at.getTime() > TOUCH_INTERVAL_MS) {
    await db.updateTable('sessions').set({ last_seen_at: new Date() }).where('id', '=', id).execute();
  }
  return { session, user };
}

export async function revokeSession(exec: Executor, sessionId: string): Promise<void> {
  await exec.deleteFrom('sessions').where('id', '=', sessionId).execute();
}

export async function revokeUserSessions(exec: Executor, userId: string, exceptSessionId?: string): Promise<number> {
  let q = exec.deleteFrom('sessions').where('user_id', '=', userId);
  if (exceptSessionId) q = q.where('id', '!=', exceptSessionId);
  const res = await q.executeTakeFirst();
  return Number(res.numDeletedRows);
}

export function setSessionCookie(reply: FastifyReply, config: AppConfig, token: string, expiresAt: Date): void {
  reply.setCookie(sessionCookieName(config), token, {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export function clearSessionCookie(reply: FastifyReply, config: AppConfig): void {
  reply.clearCookie(sessionCookieName(config), { path: '/', secure: config.secureCookies, httpOnly: true, sameSite: 'lax' });
}
