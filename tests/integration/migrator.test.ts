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
function migrateCli(cmd: 'up' | 'down', env: Record<string, string> = {}): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/db/migrate-cli.ts', cmd], {
      env: { ...process.env, ...TEST_ENV, MIGRATION_DATABASE_URL: ownerUrl, APP_DB_ROLE: '', SYSTEM_DB_ROLE: '', ...env },
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

describe('a database without a runtime role (one set up before migration 0019 has no system role)', () => {
  const OLD_DB = `${TEST_DB}_migrator_roles`;
  const oldUrl = (() => {
    const u = new URL(OWNER_URL);
    u.pathname = `/${OLD_DB}`;
    return u.toString();
  })();
  let old: Database;

  beforeAll(async () => {
    await admin(async (c) => {
      await c.query(`DROP DATABASE IF EXISTS ${OLD_DB} WITH (FORCE)`);
      await c.query(`CREATE DATABASE ${OLD_DB} OWNER midad_test_owner`);
    });
    old = createDatabase(oldUrl, { poolMax: 1 });
  });
  afterAll(async () => {
    await old.destroy();
    await admin((c) => c.query(`DROP DATABASE IF EXISTS ${OLD_DB} WITH (FORCE)`));
  });

  it('migrate stops before changing anything and says which role is missing and where the fix is', async () => {
    const roles = { MIGRATION_DATABASE_URL: oldUrl, APP_DB_ROLE: 'midad_test_app', SYSTEM_DB_ROLE: 'midad_nosuch_system' };
    const run = await migrateCli('up', roles);
    expect(run.code).toBe(1);
    expect(run.out).toContain('The database has no role "midad_nosuch_system" (the system role, SYSTEM_DB_ROLE)');
    expect(run.out).toContain('docs/DEPLOYMENT_GUIDE.md section 3.3 "Installations made before migration 0019"');
    // Plain ASCII: Windows PowerShell shows other characters from Docker's output garbled.
    expect([...run.out].filter((c) => c.charCodeAt(0) > 127)).toEqual([]);
    expect(run.out).toContain('migrate: Nothing was changed in the database.');
    // Said plainly: no stack trace, no driver error object.
    expect(run.out).not.toMatch(/\n\s+at |code: '42704'/);
    const tables = () => sql<{ n: number }>`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'`.execute(old).then((r) => r.rows[0]!.n);
    expect(await tables()).toBe(0);

    // A wrong app role is named too.
    const app = await migrateCli('up', { ...roles, APP_DB_ROLE: 'midad_nosuch_app', SYSTEM_DB_ROLE: 'midad_test_system' });
    expect(app.code).toBe(1);
    expect(app.out).toContain('The database has no role "midad_nosuch_app" (the app role, APP_DB_ROLE, from DB_APP_USER)');
    expect(app.out).not.toContain('midad_test_system');

    // Once the role exists, the same command migrates and grants.
    const ok = await migrateCli('up', { ...roles, SYSTEM_DB_ROLE: 'midad_test_system' });
    expect(ok.out).toContain('Granted runtime privileges to the system role midad_test_system');
    expect(ok.code).toBe(0);
    expect(await pendingMigrations(old)).toEqual([]);
  });
});
