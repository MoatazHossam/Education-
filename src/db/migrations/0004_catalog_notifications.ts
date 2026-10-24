import { sql, type Kysely } from 'kysely';

// Catalogue change notifications: a per-user choice to receive the emails
// (in-app notifications are always created), and a record of which
// organizations were already told about a new academic year's catalogue
// (ref = academic year), so publishing, corrections and archiving notify an
// organization about a given year once.
const UP = `
ALTER TABLE users ADD COLUMN catalog_emails boolean NOT NULL DEFAULT true;

CREATE TABLE catalog_notices (
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind text NOT NULL,
  ref text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, kind, ref)
);
ALTER TABLE catalog_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_notices FORCE ROW LEVEL SECURITY;
CREATE POLICY catalog_notices_isolation ON catalog_notices
  USING (app_rls_bypass() OR org_id = app_current_org())
  WITH CHECK (app_rls_bypass() OR org_id = app_current_org());
`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  await sql.raw(UP).execute(db);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  await sql.raw('DROP TABLE IF EXISTS catalog_notices; ALTER TABLE users DROP COLUMN IF EXISTS catalog_emails;').execute(db);
}
