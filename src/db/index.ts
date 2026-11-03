import { Kysely, PostgresDialect, sql, type Transaction } from 'kysely';
import pg from 'pg';
import type { DB } from './types.js';

export type Database = Kysely<DB>;
export type Trx = Transaction<DB>;
/** Either the root database handle or a transaction; query code accepts both. */
export type Executor = Kysely<DB> | Transaction<DB>;

// Return int8/bigint columns (COUNT, identity ids) as strings to avoid precision loss;
// callers convert counts explicitly.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => v);
// DATE columns are calendar days: keep 'YYYY-MM-DD' rather than a Date at local midnight.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

export interface DatabaseOptions {
  poolMax?: number;
  ssl?: boolean;
  /**
   * Address of the system role (BYPASSRLS, never superuser) used by withSystemContext.
   * The application role cannot bypass Row-Level Security at all (migration 0019), so
   * cross-tenant work runs on this second, separate pool.
   */
  systemUrl?: string;
  systemPoolMax?: number;
}

// The system pool that goes with each application pool (see withSystemContext).
const systemPools = new WeakMap<Database, Database>();

function newPool(connectionString: string, max: number, ssl: boolean | undefined): Database {
  const pool = new pg.Pool({
    connectionString,
    max,
    ssl: ssl ? { rejectUnauthorized: true } : undefined,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
  });
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
}

export function createDatabase(connectionString: string, opts: DatabaseOptions = {}): Database {
  const db = newPool(connectionString, opts.poolMax ?? 10, opts.ssl);
  if (opts.systemUrl) {
    const system = newPool(opts.systemUrl, opts.systemPoolMax ?? 5, opts.ssl);
    systemPools.set(db, system);
    const destroy = db.destroy.bind(db);
    db.destroy = async () => {
      await Promise.all([destroy(), system.destroy()]);
    };
  }
  return db;
}

/** A connection for the system role only: withSystemContext on it uses it directly. */
export function createSystemDatabase(connectionString: string, opts: Omit<DatabaseOptions, 'systemUrl' | 'systemPoolMax'> = {}): Database {
  const db = newPool(connectionString, opts.poolMax ?? 5, opts.ssl);
  systemPools.set(db, db);
  return db;
}

/** The application pool and its system pool, as the server, worker and command-line tools use them. */
export function createAppDatabase(
  config: { DATABASE_URL: string; SYSTEM_DATABASE_URL: string; DATABASE_SSL: boolean; SYSTEM_DATABASE_POOL_MAX: number },
  poolMax: number,
): Database {
  return createDatabase(config.DATABASE_URL, { poolMax, ssl: config.DATABASE_SSL, systemUrl: config.SYSTEM_DATABASE_URL, systemPoolMax: config.SYSTEM_DATABASE_POOL_MAX });
}

/** The system pool that goes with `db`, if any. */
export function systemDatabaseOf(db: Database): Database | undefined {
  return systemPools.get(db);
}

/**
 * Runs `fn` in a transaction scoped to one tenant. Row-Level Security policies
 * only expose rows whose org_id matches `orgId`, so a query that forgets its
 * WHERE org_id clause still cannot read or write another tenant's data.
 */
export async function withOrgContext<T>(
  db: Database,
  ctx: { orgId: string; userId?: string | null },
  fn: (trx: Trx) => Promise<T>,
): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await sql`SELECT set_config('app.current_org', ${ctx.orgId}, true), set_config('app.current_user', ${ctx.userId ?? ''}, true)`.execute(trx);
    return fn(trx);
  });
}

/**
 * Runs `fn` in the tenant context of a student's school with app.current_student
 * set: the classroom policies then expose only that student's classes, published
 * homework and own work (migration 0013), even to a query that forgets to filter.
 */
export async function withStudentContext<T>(db: Database, ctx: { orgId: string; studentId: string }, fn: (trx: Trx) => Promise<T>): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await sql`SELECT set_config('app.current_org', ${ctx.orgId}, true), set_config('app.current_user', ${ctx.studentId}, true), set_config('app.current_student', ${ctx.studentId}, true)`.execute(trx);
    return fn(trx);
  });
}

/** Sets tenant context inside an already-open transaction (e.g. right after creating the org). */
export async function setOrgContext(trx: Trx, orgId: string, userId?: string | null): Promise<void> {
  await sql`SELECT set_config('app.current_org', ${orgId}, true), set_config('app.current_user', ${userId ?? ''}, true)`.execute(trx);
}

/** Transaction scoped to one user (own memberships visible, no tenant data). */
export async function withUserContext<T>(db: Database, userId: string, fn: (trx: Trx) => Promise<T>): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await sql`SELECT set_config('app.current_user', ${userId}, true)`.execute(trx);
    return fn(trx);
  });
}

/**
 * Cross-tenant transaction for platform-level work (billing webhooks, the
 * background worker, platform administration aggregates, token lookups).
 * It runs on the system role's own pool (BYPASSRLS), never on the application
 * role, which cannot bypass Row-Level Security by any setting (migration 0019).
 * Every call site must be a deliberate, reviewed exception: the list is checked
 * by tests/unit/system-context-allowlist.test.ts.
 */
export async function withSystemContext<T>(db: Database, fn: (trx: Trx) => Promise<T>): Promise<T> {
  const system = systemPools.get(db);
  if (!system) throw new Error('No system database connection: set SYSTEM_DATABASE_URL (the role with BYPASSRLS)');
  return system.transaction().execute(fn);
}

export async function checkDatabase(db: Database): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = performance.now();
  try {
    await sql`SELECT 1`.execute(db);
    return { ok: true, latencyMs: Math.round(performance.now() - start) };
  } catch (err) {
    return { ok: false, latencyMs: Math.round(performance.now() - start), error: (err as Error).message };
  }
}

/**
 * Detects connection roles that silently disable Row-Level Security
 * (superusers and BYPASSRLS roles). Production refuses to start with one.
 */
export async function inspectRole(db: Database): Promise<{ role: string; superuser: boolean; bypassRls: boolean }> {
  const { rows } = await sql<{ role: string; rolsuper: boolean; rolbypassrls: boolean }>`
    SELECT current_user AS role, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`.execute(db);
  const r = rows[0];
  return { role: r?.role ?? 'unknown', superuser: Boolean(r?.rolsuper), bypassRls: Boolean(r?.rolbypassrls) };
}

/**
 * The roles' problems, if any: the application role must not bypass Row-Level
 * Security, and the system role must (BYPASSRLS) without being a superuser.
 * Production refuses to start with any of them (server.ts, worker.ts).
 */
export async function databaseRoleProblems(db: Database): Promise<string[]> {
  const problems: string[] = [];
  const app = await inspectRole(db);
  if (app.superuser || app.bypassRls) {
    problems.push(`Database role "${app.role}" bypasses Row-Level Security; DATABASE_URL must use the least-privilege application role`);
  }
  const systemDb = systemPools.get(db);
  if (!systemDb) {
    problems.push('No system database connection (SYSTEM_DATABASE_URL)');
  } else {
    const system = await inspectRole(systemDb);
    if (system.role === app.role) problems.push(`SYSTEM_DATABASE_URL uses the application role "${app.role}"; it needs the separate system role`);
    else if (system.superuser) problems.push(`The system role "${system.role}" is a superuser; give it BYPASSRLS instead (NOSUPERUSER)`);
    else if (!system.bypassRls) problems.push(`The system role "${system.role}" lacks BYPASSRLS, so cross-tenant work (billing, the worker) would see no data`);
  }
  return problems;
}
