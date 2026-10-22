import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase, inspectRole } from './db/index.js';

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

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    await db.destroy();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ host: config.HOST, port: config.PORT });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
