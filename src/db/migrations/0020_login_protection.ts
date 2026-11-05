import { sql, type Kysely } from 'kysely';

// Sign-in lockout that cannot be used against the account holder
// (docs/production/SECURITY_GAP_ANALYSIS.md S-5, S-7; docs/SECURITY_DESIGN.md §2).
//
// Until now five wrong passwords from anywhere locked the account for everyone for
// 15 minutes, so anyone who knew a teacher's email or a student's username could keep
// them out, for example just before an online test. Failed sign-ins are now counted
// per account and client (src/auth/login-protection.ts):
//
// - login_failures: one row per account and client. The client is a browser the
//   account has fully signed in from before ('device:<hash of its cookie>'), or else
//   the address ('address:<HMAC of the address>'). The row 'account' counts the
//   failures of all clients the account does not know, for an account-wide cap.
//   The counters are updated in one statement each, so parallel attempts are all
//   counted (S-7).
// - login_devices: the browsers an account has fully signed in from (password, and
//   second factor when it is on); the browser keeps a random token in a cookie, the
//   database keeps its SHA-256.
//
// users.failed_login_count and users.locked_until are no longer used. They stay
// until a later release, so that the previous release still runs on this schema
// (expand/contract, docs/DEPLOYMENT_GUIDE.md §4).
const UP = `
CREATE TABLE login_failures (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client text NOT NULL CHECK (length(client) BETWEEN 1 AND 100),
  failures integer NOT NULL CHECK (failures >= 0),
  window_started_at timestamptz NOT NULL,
  locked_until timestamptz,
  PRIMARY KEY (user_id, client)
);
CREATE INDEX login_failures_window_idx ON login_failures (window_started_at);

CREATE TABLE login_devices (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_hash text NOT NULL CHECK (device_hash ~ '^[0-9a-f]{64}$'),
  last_signed_in_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, device_hash)
);
CREATE INDEX login_devices_last_idx ON login_devices (last_signed_in_at);
`;

const DOWN = `
DROP TABLE IF EXISTS login_devices;
DROP TABLE IF EXISTS login_failures;
`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  await sql.raw(UP).execute(db);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  await sql.raw(DOWN).execute(db);
}
