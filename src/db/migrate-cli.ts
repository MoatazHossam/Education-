import { loadConfig } from '../config.js';
import { createDatabase } from './index.js';
import { createMigrator, grantAppRole, migrateToLatest, migrationStatus } from './migrator.js';

// Usage: migrate-cli up|down
// Connects with MIGRATION_DATABASE_URL (schema owner). When APP_DB_ROLE and
// SYSTEM_DB_ROLE are set, grants those runtime roles their permissions afterwards.
// `up` on a database a later release migrated (a rollback) succeeds with nothing to apply.
async function main() {
  const config = loadConfig();
  const db = createDatabase(config.MIGRATION_DATABASE_URL ?? config.DATABASE_URL, { poolMax: 1, ssl: config.DATABASE_SSL });
  const cmd = process.argv[2] ?? 'up';
  try {
    if (cmd === 'up') {
      const applied = await migrateToLatest(db);
      const { newer } = await migrationStatus(db);
      if (applied.length) console.log(`Applied: ${applied.join(', ')}`);
      // A rollback: an older release started on a database a later release migrated. Nothing to apply.
      else if (newer.length) console.log(`Database is ahead of this release (rollback): ${newer.join(', ')} stay applied; this release's migrations are all applied`);
      else console.log('Database already up to date');
      const role = process.env.APP_DB_ROLE;
      if (role) {
        await grantAppRole(db, role, 'app');
        console.log(`Granted runtime privileges to role ${role}`);
      }
      const systemRole = process.env.SYSTEM_DB_ROLE;
      if (systemRole) {
        await grantAppRole(db, systemRole, 'system');
        console.log(`Granted runtime privileges to the system role ${systemRole}`);
      }
    } else if (cmd === 'down') {
      const { newer } = await migrationStatus(db);
      if (newer.length) throw new Error(`The database has migrations this release does not know (${newer.join(', ')}): revert them with the release that applied them.`);
      const { error, results } = await createMigrator(db).migrateDown();
      if (error) throw error;
      console.log(`Reverted: ${(results ?? []).map((r) => r.migrationName).join(', ') || 'nothing'}`);
    } else {
      throw new Error(`Unknown command ${cmd}`);
    }
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
