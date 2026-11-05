import type { FastifyReply, FastifyRequest } from 'fastify';
import { sql } from 'kysely';
import type { AppConfig } from '../config.js';
import type { Executor } from '../db/index.js';
import { rateLimitRowKey } from '../http/rate-limit-store.js';
import { hmacHex, randomToken, sha256Hex } from '../lib/crypto.js';

// Sign-in lockout that cannot be used against the account holder
// (docs/SECURITY_DESIGN.md §2; production findings S-5 and S-7).
//
// Failed passwords and second-factor codes are counted per account and client:
// - a browser that has fully signed in to the account before ("trusted device") is
//   recognised by a random token in its device cookie, and has its own count;
// - any other client is counted by its address.
// One client that fails CLIENT_MAX_FAILURES times within CLIENT_WINDOW_MS is locked out
// of that account for CLIENT_LOCK_MS. Other clients are not: a correct password from
// another address, or from a trusted device on the same school network, still works.
//
// So that many addresses cannot guess without limit, failures from clients the account
// does not know are also counted for the whole account: ACCOUNT_MAX_FAILURES within
// ACCOUNT_WINDOW_MS lock out every unknown client for ACCOUNT_LOCK_MS, while trusted
// devices still sign in. For a student with a test open now or soon
// (classroom/tests-service.ts hasTestNow) that account-wide lock is not applied, so
// nobody can keep a student out of a test from elsewhere.

export const CLIENT_MAX_FAILURES = 5;
export const CLIENT_WINDOW_MS = 15 * 60_000;
export const CLIENT_LOCK_MS = 15 * 60_000;
export const ACCOUNT_MAX_FAILURES = 20;
export const ACCOUNT_WINDOW_MS = 60 * 60_000;
export const ACCOUNT_LOCK_MS = 60 * 60_000;
/** A device cookie lasts a year from the last sign-in; the server forgets a device a year after its last sign-in. */
export const DEVICE_TTL_MS = 365 * 86_400_000;
const ACCOUNT = 'account';
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function deviceCookieName(config: AppConfig): string {
  return config.secureCookies ? '__Host-midad_device' : 'midad_device';
}

export interface LoginClient {
  userId: string;
  /** login_failures.client: 'device:<sha256>' for a trusted device, otherwise 'address:<hmac>'. */
  key: string;
  trusted: boolean;
  /** The browser's device token, trusted for this account or not; reused when it signs in. */
  deviceToken: string | null;
}

function deviceToken(req: FastifyRequest, config: AppConfig): string | null {
  const token = req.cookies?.[deviceCookieName(config)];
  return token && TOKEN.test(token) ? token : null;
}

async function trusted(exec: Executor, userId: string, token: string): Promise<boolean> {
  const row = await exec.selectFrom('login_devices').select('user_id').where('user_id', '=', userId).where('device_hash', '=', sha256Hex(token)).executeTakeFirst();
  return Boolean(row);
}

// The rate-limit key and the handler look up the same client; once per request.
const clients = new WeakMap<FastifyRequest, LoginClient>();

/** The client of a sign-in attempt for this account. */
export async function loginClient(exec: Executor, config: AppConfig, req: FastifyRequest, userId: string): Promise<LoginClient> {
  const known = clients.get(req);
  if (known?.userId === userId) return known;
  const token = deviceToken(req, config);
  const client: LoginClient =
    token && (await trusted(exec, userId, token))
      ? { userId, key: `device:${sha256Hex(token)}`, trusted: true, deviceToken: token }
      : // Addresses are few enough to guess from a plain hash; the HMAC keeps them out of the database.
        { userId, key: `address:${hmacHex(config.SESSION_SECRET, `login-address|${req.ip}`)}`, trusted: false, deviceToken: token };
  clients.set(req, client);
  return client;
}

/** The sign-in routes whose rate limits count per account and client (cleared with the account's locks). */
export const SIGN_IN_RATE_LIMITED = ['POST /api/auth/login', 'POST /api/auth/student-login'] as const;
const rateKey = (userId: string, client: string) => `account:${userId}|${client}`;

/**
 * Rate-limit key for a sign-in route: per account and client, the same client as the lockout counts. So a
 * trusted device has its own allowance for the account (someone else on the same address cannot use it up,
 * and students taking turns at one school computer do not share one), and an unlock gives the clients that
 * were locked out their allowance back (clearLoginFailures). `account` finds the account the request is
 * for; when there is none, `unknown` gives the key (an address and what was typed).
 */
export function loginRateKey(
  exec: Executor,
  config: AppConfig,
  account: (req: FastifyRequest) => Promise<string | null>,
  unknown: (req: FastifyRequest) => string,
): (req: FastifyRequest) => Promise<string> {
  return async (req) => {
    const userId = await account(req).catch(() => null);
    if (!userId) return unknown(req);
    return rateKey(userId, (await loginClient(exec, config, req, userId)).key);
  };
}

/** Whether this client may not try a password or code for the account now. */
export async function isLocked(exec: Executor, client: LoginClient, opts: { accountLock: boolean }): Promise<boolean> {
  const rows = await exec
    .selectFrom('login_failures')
    .select('client')
    .where('user_id', '=', client.userId)
    .where('client', 'in', [client.key, ACCOUNT])
    .where('locked_until', '>', sql<Date>`now()`)
    .execute();
  return rows.some((r) => r.client === client.key || (r.client === ACCOUNT && !client.trusted && opts.accountLock));
}

/**
 * Counts one failure in a single statement (parallel attempts are all counted) and returns whether the
 * row is locked now. A failure after the window has passed starts a new count.
 */
async function countFailure(exec: Executor, userId: string, client: string, max: number, windowMs: number, lockMs: number): Promise<boolean> {
  const fresh = sql`f.window_started_at <= now() - make_interval(secs => ${windowMs / 1000})`;
  const lockUntil = sql`now() + make_interval(secs => ${lockMs / 1000})`;
  const { rows } = await sql<{ locked: boolean }>`
    INSERT INTO login_failures AS f (user_id, client, failures, window_started_at, locked_until)
    VALUES (${userId}, ${client}, 1, now(), CASE WHEN 1 >= ${max} THEN ${lockUntil} END)
    ON CONFLICT (user_id, client) DO UPDATE SET
      failures = CASE WHEN ${fresh} THEN 1 ELSE f.failures + 1 END,
      window_started_at = CASE WHEN ${fresh} THEN now() ELSE f.window_started_at END,
      locked_until = CASE WHEN (CASE WHEN ${fresh} THEN 1 ELSE f.failures + 1 END) >= ${max} THEN ${lockUntil} ELSE f.locked_until END
    RETURNING coalesce(locked_until > now(), false) AS locked`.execute(exec);
  return rows[0]?.locked ?? false;
}

export interface FailureResult {
  /** This client is now locked out of the account. */
  clientLocked: boolean;
  /** Every client the account does not know is now locked out (not applied while `accountLock` is off). */
  accountLocked: boolean;
}

export async function recordFailure(exec: Executor, client: LoginClient, opts: { accountLock: boolean }): Promise<FailureResult> {
  const clientLocked = await countFailure(exec, client.userId, client.key, CLIENT_MAX_FAILURES, CLIENT_WINDOW_MS, CLIENT_LOCK_MS);
  const accountLocked = client.trusted ? false : await countFailure(exec, client.userId, ACCOUNT, ACCOUNT_MAX_FAILURES, ACCOUNT_WINDOW_MS, ACCOUNT_LOCK_MS);
  return { clientLocked, accountLocked: accountLocked && opts.accountLock };
}

/**
 * After a full sign-in (password, and the second factor when it is on): clears this client's count and
 * remembers the browser as a trusted device for the account, giving it a device token if it has none.
 * One token serves every account that signs in from the browser.
 */
export async function recordSuccess(exec: Executor, config: AppConfig, reply: FastifyReply, client: LoginClient): Promise<void> {
  await exec.deleteFrom('login_failures').where('user_id', '=', client.userId).where('client', '=', client.key).execute();
  const token = client.deviceToken ?? randomToken(32);
  await sql`
    INSERT INTO login_devices (user_id, device_hash, last_signed_in_at) VALUES (${client.userId}, ${sha256Hex(token)}, now())
    ON CONFLICT (user_id, device_hash) DO UPDATE SET last_signed_in_at = now()`.execute(exec);
  reply.setCookie(deviceCookieName(config), token, {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'strict',
    path: '/',
    expires: new Date(Date.now() + DEVICE_TTL_MS),
  });
}

/**
 * Lifts every lock on the account (a staff unlock, a new password), and gives each client that had failed
 * its sign-in rate limit back, so that an unlocked student is not then told to wait.
 */
export async function clearLoginFailures(exec: Executor, config: AppConfig, userId: string): Promise<void> {
  const rows = await exec.deleteFrom('login_failures').where('user_id', '=', userId).returning('client').execute();
  const keys = rows
    .filter((r) => r.client !== ACCOUNT)
    .flatMap((r) => SIGN_IN_RATE_LIMITED.map((route) => rateLimitRowKey(config.SESSION_SECRET, route, rateKey(userId, r.client))));
  if (keys.length) await exec.deleteFrom('rate_limits').where('key', 'in', keys).execute();
}

/** For staff pages: the accounts among `userIds` that some client is locked out of now. */
export async function lockedAccounts(exec: Executor, userIds: string[]): Promise<Map<string, Date>> {
  if (!userIds.length) return new Map();
  const rows = await exec
    .selectFrom('login_failures')
    .select(['user_id', (eb) => eb.fn.max('locked_until').as('until')])
    .where('user_id', 'in', userIds)
    .where('locked_until', '>', sql<Date>`now()`)
    .groupBy('user_id')
    .execute();
  return new Map(rows.filter((r) => r.until).map((r) => [r.user_id, new Date(r.until as unknown as Date)]));
}
