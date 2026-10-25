import { sql, type Kysely } from 'kysely';

// Operational alerts (worker stopped, email failing, server errors...). One row
// per alert key holds its state, so with several app instances evaluating the
// same checks only one of them sends each notification: firing, a reminder
// while it stays firing, and the resolution. Counts only, no customer data.
const UP = `
CREATE TABLE ops_alerts (
  key text PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('firing', 'resolved')),
  summary text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}',
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  notified_at timestamptz NOT NULL,
  resolved_at timestamptz
);
`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  await sql.raw(UP).execute(db);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  await sql.raw('DROP TABLE IF EXISTS ops_alerts;').execute(db);
}
