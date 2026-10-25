import { sql, type Kysely } from 'kysely';

// Counters for the route-specific rate limits (login, two-factor codes, password
// reset, registration, invitations, checkout, the v1 API quota), shared by every
// app instance: fixed windows timed by the database clock. Keys are HMACs of the
// route and the client key, so no IP address or email is stored. UNLOGGED:
// counters are short-lived and need no crash safety; after a crash or failover
// they start from zero, as they did when they were kept in each process's
// memory. The worker deletes expired rows.
const UP = `
CREATE UNLOGGED TABLE rate_limits (
  key text PRIMARY KEY,
  count integer NOT NULL,
  expires_at timestamptz NOT NULL
);
`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  await sql.raw(UP).execute(db);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  await sql.raw('DROP TABLE IF EXISTS rate_limits;').execute(db);
}
