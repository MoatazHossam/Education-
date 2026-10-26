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

export function createDatabase(connectionString: string, opts: { poolMax?: number; ssl?: boolean } = {}): Database {
  const pool = new pg.Pool({
    connectionString,
    max: opts.poolMax ?? 10,
    ssl: opts.ssl ? { rejectUnauthorized: true } : undefined,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
  });
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
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
 * Every call site must be a deliberate, reviewed exception.
 */
export async function withSystemContext<T>(db: Database, fn: (trx: Trx) => Promise<T>): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await sql`SELECT set_config('app.rls_bypass', 'on', true)`.execute(trx);
    return fn(trx);
  });
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
