import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerAdminRoutes } from './admin/routes.js';
import { registerApiV1Routes, resolveApiKey } from './api-v1/routes.js';
import { csrfTokenFor, resolveSession, sessionCookieName } from './auth/sessions.js';
import { registerAuthRoutes } from './auth/routes.js';
import { createPaymentProvider } from './billing/providers/index.js';
import { registerBillingRoutes } from './billing/routes.js';
import { registerCatalogRoutes } from './catalog/routes.js';
import type { AppConfig } from './config.js';
import type { Database } from './db/index.js';
import type { AppContext } from './http/context.js';
import { registerHealthRoutes } from './http/health.js';
import { rateLimitStore } from './http/rate-limit-store.js';
import { ServerErrorCounter } from './ops/alerts.js';
import { AppError } from './lib/errors.js';
import { safeEqual } from './lib/crypto.js';
import { registerNotificationRoutes } from './notifications/routes.js';
import { registerOrgRoutes } from './orgs/routes.js';
import { registerScopeRoutes } from './scopes/routes.js';
import { registerStudentRoutes } from './students/routes.js';
import { registerClassroomRoutes } from './classroom/routes.js';
import { registerStudentClassroomRoutes } from './classroom/student-routes.js';
import { registerTestRoutes } from './classroom/tests-routes.js';
import { registerStudentTestRoutes } from './classroom/tests-student-routes.js';
import { registerWebhookRoutes } from './webhooks/routes.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const CSRF_EXEMPT_PREFIXES = ['/api/billing/webhooks/'];

export interface BuildAppOptions {
  config: AppConfig;
  db: Database;
  logger?: FastifyServerOptions['logger'];
}

export async function buildApp({ config, db, logger }: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: logger ?? {
      level: config.LOG_LEVEL,
      redact: { paths: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-csrf-token"]'], remove: true },
    },
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 1_048_576,
    genReqId: () => crypto.randomUUID(),
  });

  const ctx: AppContext = { config, db, log: app.log, payments: createPaymentProvider(config) };

  // Only JSON bodies are accepted (webhooks register their own raw parser).
  // Cross-site HTML forms cannot send application/json, which blocks login CSRF.
  app.removeContentTypeParser('text/plain');

  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        objectSrc: ["'none'"],
        ...(config.secureCookies ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    hsts: config.secureCookies ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    referrerPolicy: { policy: 'no-referrer' },
    crossOriginEmbedderPolicy: false,
  });
  await app.register(cookie);
  // Route-specific limits count in PostgreSQL, so every app instance enforces the
  // same limits; the global limit is a per-process flood guard (rate-limit-store.ts).
  await app.register(rateLimit, {
    store: rateLimitStore(db, config.SESSION_SECRET),
    global: config.RATE_LIMIT_ENABLED,
    max: 600,
    timeWindow: '1 minute',
    allowList: (req) => !req.url.startsWith('/api/'),
    errorResponseBuilder: (_req, ctx2) => ({
      statusCode: 429,
      error: { code: 'RATE_LIMITED', message: `Too many requests. Try again in ${Math.ceil(ctx2.ttl / 1000)} seconds.` },
    }),
  });

  app.decorateRequest('auth', null);

  // Registered routes, used by tests to prove every admin/org route is protected.
  const routeList: { method: string; url: string }[] = [];
  app.decorate('routeList', routeList);
  app.decorate('lifecycle', { draining: false });
  app.decorate('serverErrors', new ServerErrorCounter());
  app.addHook('onResponse', async (req, reply) => {
    if (reply.statusCode >= 500 && req.url !== '/readyz' && req.url !== '/healthz') app.serverErrors.record();
  });
  app.addHook('onRoute', (r) => {
    for (const m of ([] as string[]).concat(r.method)) if (m !== 'HEAD') routeList.push({ method: m, url: r.url });
  });

  // Resolve the caller: session cookie for the web app, API key for /api/v1.
  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/')) return;
    if (req.url.startsWith('/api/v1/')) {
      req.auth = await resolveApiKey(ctx, req);
      return;
    }
    const token = req.cookies[sessionCookieName(config)];
    if (token) {
      const resolved = await resolveSession(db, token);
      if (resolved) req.auth = { kind: 'session', ...resolved };
    }
  });

  // CSRF defence in depth: Origin check for every state-changing request, and a
  // per-session HMAC token (synchronizer pattern) for cookie-authenticated ones.
  app.addHook('preHandler', async (req) => {
    if (!MUTATING.has(req.method) || !req.url.startsWith('/api/')) return;
    if (CSRF_EXEMPT_PREFIXES.some((p) => req.url.startsWith(p))) return;
    const origin = req.headers.origin;
    if (origin && origin !== config.appOrigin) throw new AppError(403, 'CSRF_ORIGIN_MISMATCH', 'Cross-origin request blocked');
    if (req.headers['sec-fetch-site'] === 'cross-site') throw new AppError(403, 'CSRF_ORIGIN_MISMATCH', 'Cross-site request blocked');
    if (req.auth?.kind === 'session') {
      const sent = req.headers['x-csrf-token'];
      if (typeof sent !== 'string' || !safeEqual(sent, csrfTokenFor(config, req.auth.session.id))) {
        throw new AppError(403, 'CSRF_TOKEN_INVALID', 'Missing or invalid CSRF token. Reload the page and try again.');
      }
    }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    const e = err as { statusCode?: number; code?: string; message: string; validation?: unknown };
    if (e.statusCode === 429) return reply.status(429).send(err);
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) {
      const code = e.statusCode === 415 ? 'UNSUPPORTED_MEDIA_TYPE' : e.statusCode === 413 ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST';
      return reply.status(e.statusCode).send({ error: { code, message: e.message } });
    }
    const pgCode = (err as { code?: string }).code;
    if (pgCode === '23505') return reply.status(409).send({ error: { code: 'CONFLICT', message: 'A record with these details already exists' } });
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.', requestId: req.id } });
  });

  registerHealthRoutes(app, ctx);
  registerAuthRoutes(app, ctx);
  registerNotificationRoutes(app, ctx);
  registerOrgRoutes(app, ctx);
  registerCatalogRoutes(app, ctx);
  registerScopeRoutes(app, ctx);
  registerWebhookRoutes(app, ctx);
  registerStudentRoutes(app, ctx);
  await registerClassroomRoutes(app, ctx);
  await registerStudentClassroomRoutes(app, ctx);
  registerTestRoutes(app, ctx);
  registerStudentTestRoutes(app, ctx);
  await registerBillingRoutes(app, ctx);
  registerAdminRoutes(app, ctx);
  registerApiV1Routes(app, ctx);

  // Front end: static files, self-hosted fonts, SPA fallback for client routes.
  const publicDir = join(ROOT, 'public');
  await app.register(fastifyStatic, { root: publicDir, prefix: '/', wildcard: false, index: ['index.html'] });
  for (const font of ['readex-pro', 'ibm-plex-mono']) {
    const dir = join(ROOT, 'node_modules', '@fontsource', font);
    if (existsSync(dir)) {
      await app.register(fastifyStatic, { root: dir, prefix: `/vendor/${font}/`, decorateReply: false, allowedPath: (p) => /\.(css|woff2?)$/.test(p) });
    }
  }
  app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && !req.url.startsWith('/api/') && !/\.[a-z0-9]+$/i.test(req.url.split('?')[0] ?? '')) {
      return reply.type('text/html').sendFile('index.html', publicDir);
    }
    return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Not found' } });
  });

  return app;
}
