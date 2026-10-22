import { loadConfig } from '../config.js';
import { createDatabase } from './index.js';
import { createMigrator, grantAppRole, migrateToLatest } from './migrator.js';

// Usage: migrate-cli up|down
// Connects with MIGRATION_DATABASE_URL (schema owner). When APP_DB_ROLE is set,
// grants that runtime role its least-privilege permissions afterwards.
async function main() {
  const config = loadConfig();
  const db = createDatabase(config.MIGRATION_DATABASE_URL ?? config.DATABASE_URL, { poolMax: 1, ssl: config.DATABASE_SSL });
  const cmd = process.argv[2] ?? 'up';
  try {
    if (cmd === 'up') {
      const applied = await migrateToLatest(db);
      console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database already up to date');
      const role = process.env.APP_DB_ROLE;
      if (role) {
        await grantAppRole(db, role);
        console.log(`Granted runtime privileges to role ${role}`);
      }
    } else if (cmd === 'down') {
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
