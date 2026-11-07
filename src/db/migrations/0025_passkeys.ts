import { sql, type Kysely } from 'kysely';

// Passkeys (WebAuthn): staff sign in with a passkey on their phone, computer or security key instead of a
// password (docs/SECURITY_DESIGN.md §2, roadmap Phase 7). Student accounts do not have them.
//
// - passkeys: one row per credential. The browser's credential id (base64url) is unique; the public key is the
//   COSE key the authenticator made at registration. The signature counter, when an authenticator keeps one,
//   must grow with every sign-in (a copied credential would repeat it).
// - webauthn_challenges: the random challenge of each registration or sign-in, used once and within five
//   minutes, so that any app instance can finish what another started. A registration challenge belongs to the
//   signed-in account that asked for it; a sign-in challenge to nobody yet.
//
// Neither table has an org_id: a passkey belongs to a person, across their schools (like login_devices).
const UP = `
CREATE TABLE passkeys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id text NOT NULL UNIQUE CHECK (credential_id ~ '^[A-Za-z0-9_-]+$' AND length(credential_id) BETWEEN 16 AND 1400),
  public_key bytea NOT NULL CHECK (octet_length(public_key) BETWEEN 32 AND 2048),
  counter bigint NOT NULL DEFAULT 0 CHECK (counter >= 0),
  transports text[] NOT NULL DEFAULT '{}',
  device_type text NOT NULL CHECK (device_type IN ('singleDevice', 'multiDevice')),
  backed_up boolean NOT NULL DEFAULT false,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX passkeys_user_idx ON passkeys (user_id);

CREATE TABLE webauthn_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose text NOT NULL CHECK (purpose IN ('register', 'login')),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  challenge text NOT NULL UNIQUE CHECK (challenge ~ '^[A-Za-z0-9_-]{43,}$'),
  expires_at timestamptz NOT NULL,
  CHECK ((purpose = 'register') = (user_id IS NOT NULL))
);
CREATE INDEX webauthn_challenges_expires_idx ON webauthn_challenges (expires_at);
`;

const DOWN = `
DROP TABLE IF EXISTS webauthn_challenges;
DROP TABLE IF EXISTS passkeys;
`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  await sql.raw(UP).execute(db);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  await sql.raw(DOWN).execute(db);
}
