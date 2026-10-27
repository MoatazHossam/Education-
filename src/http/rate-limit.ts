import type { FastifyRequest } from 'fastify';

/**
 * Route options for a dedicated limit. Route-level `config.rateLimit` replaces
 * the global limiter for that route (a separate `rateLimit()` preHandler would
 * be skipped because the global hook already ran). Runs at preHandler so the
 * key generator can use the parsed body (e.g. per-account login limits).
 */
export function rateLimited(max: number, timeWindow: string, keyGenerator?: (req: FastifyRequest) => string) {
  return { config: { rateLimit: { max, timeWindow, hook: 'preHandler' as const, ...(keyGenerator ? { keyGenerator } : {}) } } };
}

/**
 * Key for limits on what a signed-in person does (a student's answers, heartbeats, hand-ins): their
 * account once the session is verified, otherwise the client address. Students of one school often
 * share one address (the school's NAT); per address, a class would exhaust a limit meant for one
 * person. The session is resolved in an onRequest hook, before these preHandler limits run, so a
 * forged cookie never gets an allowance of its own.
 */
export const perAccount = (req: FastifyRequest): string => (req.auth?.kind === 'session' ? `account:${req.auth.user.id}` : `address:${req.ip}`);

/** The global flood guard (per process, per minute): an address without a session cookie. */
export const ADDRESS_MAX = 600;
/** The same for requests that carry a session cookie: a whole school can share one address. */
export const SIGNED_IN_ADDRESS_MAX = 6000;
/** After the session is checked: one account, or one address whose cookie was not a valid session. */
export const ACCOUNT_MAX = 600;
