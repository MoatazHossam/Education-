import { spawn } from 'node:child_process';
import pg from 'pg';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../../src/db/index.js';
import { createMigrator, LATEST_MIGRATION, migrateToLatest, migrationStatus, pendingMigrations } from '../../src/db/migrator.js';
import { ADMIN_URL, OWNER_URL, TEST_DB, TEST_ENV } from '../helpers/env.js';

// Rolling back to an older release (docs/DEPLOYMENT_GUIDE.md §4.3, production finding I-3): the older
// image's `migrate` meets a database a newer release migrated. On a scratch database of its own, so the
// other test files' database is never ahead or behind while they run.

const DB_NAME = `${TEST_DB}_migrator`;
const ownerUrl = (() => {
  const u = new URL(OWNER_URL);
  u.pathname = `/${DB_NAME}`;
  return u.toString();
})();
const LATER = '9999_from_a_later_release';

let db: Database;

async function admin<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: ADMIN_URL });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

beforeAll(async () => {
  await admin(async (c) => {
    await c.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await c.query(`CREATE DATABASE ${DB_NAME} OWNER midad_test_owner`);
  });
  db = createDatabase(ownerUrl, { poolMax: 2 });
});

afterAll(async () => {
  await db.destroy();
  await admin((c) => c.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`));
});

/** The `migrate` service's command (src/db/migrate-cli.ts) as its own process, against the scratch database. */
function migrateCli(cmd: 'up' | 'down'): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/db/migrate-cli.ts', cmd], {
      env: { ...process.env, ...TEST_ENV, MIGRATION_DATABASE_URL: ownerUrl, APP_DB_ROLE: '', SYSTEM_DB_ROLE: '' },
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('exit', (code) => resolve({ code, out }));
  });
}

const markApplied = (name: string) => sql`INSERT INTO kysely_migration (name, timestamp) VALUES (${name}, ${new Date().toISOString()})`.execute(db);
const unmark = (name: string) => sql`DELETE FROM kysely_migration WHERE name = ${name}`.execute(db);

describe('migrations and rollbacks', () => {
  it('a new database gets every migration in order, then nothing more', async () => {
    expect(await migrationStatus(db)).toMatchObject({ newer: [] });
    const applied = await migrateToLatest(db);
    expect(applied.at(-1)).toBe(LATEST_MIGRATION);
    expect(applied).toEqual([...applied].sort());
    expect(await migrateToLatest(db)).toEqual([]);
    expect(await migrationStatus(db)).toEqual({ pending: [], newer: [] });
  });

  it('an older release starts on a database a later release migrated: migrate succeeds and the app is ready', async () => {
    // Release N+1 added a migration (and the schema it expands) and ran it; release N is started again.
    await sql`CREATE TABLE from_a_later_release (id int)`.execute(db);
    await markApplied(LATER);

    // Without the fix, Kysely refuses the database, and the migrate service, then the app, fail to start.
    const raw = await createMigrator(db).migrateToLatest();
    expect(String(raw.error)).toContain(`previously executed migration ${LATER} is missing`);

    expect(await migrateToLatest(db)).toEqual([]);
    expect(await migrationStatus(db)).toEqual({ pending: [], newer: [LATER] });
    expect(await pendingMigrations(db)).toEqual([]); // what /readyz checks

    const up = await migrateCli('up');
    expect(up.code, up.out).toBe(0);
    expect(up.out).toContain(`Database is ahead of this release (rollback): ${LATER} stay applied`);

    // The newer migration and its schema stay; going forward again finds nothing to do either.
    expect((await sql<{ n: string }>`SELECT count(*) AS n FROM kysely_migration WHERE name = ${LATER}`.execute(db)).rows[0]!.n).toBe('1');
    expect((await sql`SELECT 1 FROM from_a_later_release`.execute(db)).rows).toEqual([]);

    // Reverting a migration this release does not know is refused, with what to do instead.
    const down = await migrateCli('down');
    expect(down.code).toBe(1);
    expect(down.out).toContain(`revert them with the release that applied them`);
  });

  it('refuses a database that does not fit this release, saying what it found', async () => {
    // A migration unknown to this release among its own: another branch or release line migrated the database.
    const OTHER = '0010a_from_another_branch';
    await markApplied(OTHER);
    await expect(migrateToLatest(db)).rejects.toThrow(`migrations this release does not know among its own (${OTHER})`);
    expect((await migrateCli('up')).code).toBe(1);
    await unmark(OTHER);

    // A later release's migration while one of this release's is missing.
    await unmark(LATEST_MIGRATION);
    await expect(migrateToLatest(db)).rejects.toThrow(`but lacks this release's ${LATEST_MIGRATION}`);
    await markApplied(LATEST_MIGRATION);
    expect(await migrateToLatest(db)).toEqual([]);
  });
});
