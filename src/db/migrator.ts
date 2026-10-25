import { Migrator, sql, type Migration, type MigrationProvider } from 'kysely';
import type { Database } from './index.js';
import * as m0001 from './migrations/0001_initial.js';
import * as m0002 from './migrations/0002_checkout_sessions.js';
import * as m0003 from './migrations/0003_catalog_verification.js';
import * as m0004 from './migrations/0004_catalog_notifications.js';
import * as m0005 from './migrations/0005_rate_limits.js';
import * as m0006 from './migrations/0006_ops_alerts.js';
import * as m0007 from './migrations/0007_students.js';
import * as m0008 from './migrations/0008_item_notes.js';
import * as m0009 from './migrations/0009_item_tracking.js';

// Static registry: works identically under tsx and the compiled dist build.
const MIGRATIONS: Record<string, Migration> = {
  '0001_initial': m0001,
  '0002_checkout_sessions': m0002,
  '0003_catalog_verification': m0003,
  '0004_catalog_notifications': m0004,
  '0005_rate_limits': m0005,
  '0006_ops_alerts': m0006,
  '0007_students': m0007,
  '0008_item_notes': m0008,
  '0009_item_tracking': m0009,
};

class StaticProvider implements MigrationProvider {
  async getMigrations(): Promise<Record<string, Migration>> {
    return MIGRATIONS;
  }
}

export function createMigrator(db: Database): Migrator {
  return new Migrator({ db, provider: new StaticProvider() });
}

export const LATEST_MIGRATION = Object.keys(MIGRATIONS).sort().at(-1)!;

export async function migrateToLatest(db: Database): Promise<string[]> {
  const { error, results } = await createMigrator(db).migrateToLatest();
  if (error) throw error instanceof Error ? error : new Error(String(error));
  return (results ?? []).filter((r) => r.status === 'Success').map((r) => r.migrationName);
}

/**
 * Grants the runtime application role the minimum privileges it needs.
 * audit_logs is append-only for the application (no UPDATE).
 */
export async function grantAppRole(db: Database, role: string): Promise<void> {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role)) throw new Error(`Invalid role name: ${role}`);
  const r = sql.id(role);
  await sql`GRANT USAGE ON SCHEMA public TO ${r}`.execute(db);
  await sql`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${r}`.execute(db);
  await sql`REVOKE UPDATE ON audit_logs FROM ${r}`.execute(db);
  await sql`REVOKE ALL ON kysely_migration, kysely_migration_lock FROM ${r}`.execute(db);
  await sql`GRANT SELECT ON kysely_migration TO ${r}`.execute(db);
  await sql`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${r}`.execute(db);
}

export async function pendingMigrations(db: Database): Promise<string[]> {
  try {
    const { rows } = await sql<{ name: string }>`SELECT name FROM kysely_migration`.execute(db);
    const applied = new Set(rows.map((r) => r.name));
    return Object.keys(MIGRATIONS).filter((n) => !applied.has(n));
  } catch {
    return Object.keys(MIGRATIONS);
  }
}
