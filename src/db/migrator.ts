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
import * as m0010 from './migrations/0010_due_reminders.js';
import * as m0011 from './migrations/0011_assignment_digest.js';
import * as m0012 from './migrations/0012_webhooks.js';
import * as m0013 from './migrations/0013_classroom.js';
import * as m0014 from './migrations/0014_online_tests.js';
import * as m0015 from './migrations/0015_classroom_retention.js';
import * as m0016 from './migrations/0016_file_checks.js';
import * as m0017 from './migrations/0017_ai_requests.js';
import * as m0018 from './migrations/0018_teaching_plans.js';
import * as m0019 from './migrations/0019_system_role.js';

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
  '0010_due_reminders': m0010,
  '0011_assignment_digest': m0011,
  '0012_webhooks': m0012,
  '0013_classroom': m0013,
  '0014_online_tests': m0014,
  '0015_classroom_retention': m0015,
  '0016_file_checks': m0016,
  '0017_ai_requests': m0017,
  '0018_teaching_plans': m0018,
  '0019_system_role': m0019,
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

export interface MigrationStatus {
  /** This release's migrations the database has not applied. */
  pending: string[];
  /** Migrations the database has applied that this release does not know: a later release ran them. */
  newer: string[];
}

/** Compares the migrations the database has applied with this release's. A database never migrated has them all pending. */
export async function migrationStatus(db: Database): Promise<MigrationStatus> {
  const { rows } = await sql<{ t: string | null }>`SELECT to_regclass('kysely_migration')::text AS t`.execute(db);
  const applied = rows[0]?.t ? (await sql<{ name: string }>`SELECT name FROM kysely_migration`.execute(db)).rows.map((r) => r.name) : [];
  const done = new Set(applied);
  return { pending: Object.keys(MIGRATIONS).sort().filter((n) => !done.has(n)), newer: applied.filter((n) => !(n in MIGRATIONS)).sort() };
}

/**
 * Applies this release's pending migrations and returns their names.
 *
 * A database ahead of this release is accepted: an older image started after a newer one migrated the
 * database, which is a rollback (docs/DEPLOYMENT_GUIDE.md §4.3). Migrations follow the expand/contract rule,
 * so the older release runs on the newer schema, provided the newer migrations all come after this release's
 * and this release's are all applied. Anything else is refused with what was found. Kysely alone refuses any
 * database with a migration it does not know, which stopped `migrate`, and with it the app, on every rollback.
 */
export async function migrateToLatest(db: Database): Promise<string[]> {
  const { pending, newer } = await migrationStatus(db);
  if (newer.length) {
    const misplaced = newer.filter((n) => n < LATEST_MIGRATION);
    if (misplaced.length) {
      throw new Error(`The database has migrations this release does not know among its own (${misplaced.join(', ')}): it was migrated by another branch or release line.`);
    }
    if (pending.length) {
      throw new Error(`The database has migrations from a later release (${newer.join(', ')}) but lacks this release's ${pending.join(', ')}: restore a backup, or migrate with the release that applied them.`);
    }
    return [];
  }
  const { error, results } = await createMigrator(db).migrateToLatest();
  if (error) throw error instanceof Error ? error : new Error(String(error));
  return (results ?? []).filter((r) => r.status === 'Success').map((r) => r.migrationName);
}

/**
 * Grants a runtime role the minimum privileges it needs:
 * - "app", the web application's role (no BYPASSRLS): audit_logs is append-only for
 *   it (no UPDATE, no DELETE);
 * - "system", the role with BYPASSRLS behind withSystemContext (src/db/index.ts):
 *   the same, but it may DELETE audit rows, for the retention cleanup.
 */
export async function grantAppRole(db: Database, role: string, kind: 'app' | 'system' = 'app'): Promise<void> {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role)) throw new Error(`Invalid role name: ${role}`);
  const r = sql.id(role);
  await sql`GRANT USAGE ON SCHEMA public TO ${r}`.execute(db);
  await sql`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${r}`.execute(db);
  await sql`REVOKE UPDATE ON audit_logs FROM ${r}`.execute(db);
  if (kind === 'app') await sql`REVOKE DELETE ON audit_logs FROM ${r}`.execute(db);
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
