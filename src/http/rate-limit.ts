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
