import { sql, type Kysely } from 'kysely';

// Assignment emails as one summary a day (docs/PROJECT_STATUS.md). Each member
// chooses how emails about books assigned to them arrive: right away (the
// default, as before) or in one summary each morning. Assignments for members
// who chose the summary wait in assignment_digest_items until the worker sends
// it; rows go with the book, the scope and the membership. Members may delete
// their own waiting rows (switching back to emails right away).
const UP = `
ALTER TABLE users ADD COLUMN assignment_email_frequency text NOT NULL DEFAULT 'instant'
  CHECK (assignment_email_frequency IN ('instant', 'daily'));

CREATE TABLE assignment_digest_items (
  org_id uuid NOT NULL,
  user_id uuid NOT NULL,
  scope_id uuid NOT NULL,
  material_id uuid NOT NULL,
  assigned_by uuid REFERENCES users(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, scope_id, material_id),
  FOREIGN KEY (scope_id, org_id) REFERENCES scopes (id, org_id) ON DELETE CASCADE,
  FOREIGN KEY (scope_id, material_id) REFERENCES scope_items (scope_id, material_id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, user_id) REFERENCES memberships (org_id, user_id) ON DELETE CASCADE
);
CREATE INDEX assignment_digest_items_org_idx ON assignment_digest_items (org_id);
CREATE INDEX assignment_digest_items_assigned_idx ON assignment_digest_items (assigned_at);
ALTER TABLE assignment_digest_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignment_digest_items FORCE ROW LEVEL SECURITY;
CREATE POLICY assignment_digest_items_isolation ON assignment_digest_items
  USING (app_rls_bypass() OR org_id = app_current_org() OR user_id = app_current_user())
  WITH CHECK (app_rls_bypass() OR org_id = app_current_org());
`;

const DOWN = `
DROP TABLE IF EXISTS assignment_digest_items;
ALTER TABLE users DROP COLUMN IF EXISTS assignment_email_frequency;
`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  await sql.raw(UP).execute(db);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  await sql.raw(DOWN).execute(db);
}
