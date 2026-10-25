import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase, inspectRole } from './db/index.js';
import { AlertMonitor, alertChannels } from './ops/alerts.js';

async function main() {
  const config = loadConfig();
  const db = createDatabase(config.DATABASE_URL, { poolMax: config.DATABASE_POOL_MAX, ssl: config.DATABASE_SSL });
  const app = await buildApp({ config, db });

  // Row-Level Security is silently skipped for superusers and BYPASSRLS roles.
  const role = await inspectRole(db);
  if (role.superuser || role.bypassRls) {
    const msg = `Database role "${role.role}" bypasses Row-Level Security; connect with the least-privilege application role`;
    if (config.isProduction) throw new Error(msg);
    app.log.warn(msg);
  }

  // Behind a load balancer, /readyz first reports "draining" for SHUTDOWN_DRAIN_MS so no new
  // requests are routed here; closing then finishes the requests in flight. A second signal
  // exits at once.
  const monitor = new AlertMonitor({ db, config, log: app.log, errors: app.serverErrors, channels: alertChannels(config, app.log) });
  let stopAlerts = () => {};
  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) process.exit(1);
    stopping = true;
    app.log.info({ signal, drainMs: config.SHUTDOWN_DRAIN_MS }, 'shutting down');
    stopAlerts();
    app.lifecycle.draining = true;
    if (config.SHUTDOWN_DRAIN_MS > 0) await new Promise((r) => setTimeout(r, config.SHUTDOWN_DRAIN_MS));
    await app.close();
    await db.destroy();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ host: config.HOST, port: config.PORT });
  stopAlerts = monitor.start();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
