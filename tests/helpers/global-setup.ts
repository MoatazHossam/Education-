import pg from 'pg';
import { loadConfig } from '../../src/config.js';
import { createDatabase } from '../../src/db/index.js';
import { grantAppRole, migrateToLatest } from '../../src/db/migrator.js';
import { seedCatalog, seedPlans } from '../../src/db/seed.js';
import { ADMIN_URL, OWNER_URL, TEST_DB, TEST_ENV } from './env.js';

/**
 * Creates a fresh test database owned by a non-superuser owner role, migrates
 * it, and grants a separate least-privilege application role — the same split
 * as production, so Row-Level Security is actually enforced in tests.
 */
export default async function setup(): Promise<void> {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`, [TEST_DB]);
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
    // The system role bypasses Row-Level Security (withSystemContext); the others never do.
    for (const [role, pw, bypass] of [['midad_test_owner', 'owner-test-pw', 'NOBYPASSRLS'], ['midad_test_app', 'app-test-pw', 'NOBYPASSRLS'], ['midad_test_system', 'system-test-pw', 'BYPASSRLS']]) {
      const exists = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
      if (!exists.rowCount) await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${pw}' NOSUPERUSER ${bypass} NOCREATEROLE`);
    }
    await admin.query(`CREATE DATABASE ${TEST_DB} OWNER midad_test_owner`);
  } finally {
    await admin.end();
  }

  const config = loadConfig(TEST_ENV);
  const db = createDatabase(OWNER_URL, { poolMax: 2 });
  try {
    await migrateToLatest(db);
    await grantAppRole(db, 'midad_test_app', 'app');
    await grantAppRole(db, 'midad_test_system', 'system');
    await seedPlans(db, config.BILLING_CURRENCY);
    await seedCatalog(db);
  } finally {
    await db.destroy();
  }
}
