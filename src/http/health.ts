import type { FastifyInstance } from 'fastify';
import { checkDatabase } from '../db/index.js';
import { pendingMigrations } from '../db/migrator.js';
import type { AppContext } from './context.js';

const startedAt = Date.now();

export function registerHealthRoutes(app: FastifyInstance, ctx: AppContext): void {
  // Liveness: the process is up and serving requests. No dependencies checked,
  // so a database outage does not cause the orchestrator to restart-loop the app.
  app.get('/healthz', { config: { rateLimit: false } }, async () => ({ status: 'ok', uptimeSeconds: Math.round((Date.now() - startedAt) / 1000) }));

  // Readiness: safe to receive traffic (database reachable, schema current).
  app.get('/readyz', { config: { rateLimit: false } }, async (_req, reply) => {
    const db = await checkDatabase(ctx.db);
    const pending = db.ok ? await pendingMigrations(ctx.db) : [];
    const ready = db.ok && pending.length === 0;
    return reply.status(ready ? 200 : 503).send({
      status: ready ? 'ready' : 'not_ready',
      checks: {
        database: db.ok ? { status: 'ok', latencyMs: db.latencyMs } : { status: 'error' },
        migrations: pending.length === 0 ? { status: 'ok' } : { status: 'pending', pending },
      },
    });
  });
}
