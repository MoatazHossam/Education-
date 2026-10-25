import { sql, type Kysely } from 'kysely';

// A short note and a responsible member on any selected book of a scope
// (e.g. "waiting for the 2027 edition", assigned to the person following it up).
// The assignee must be a member of the scope's organization: the foreign key
// goes to memberships, so removing the member clears their assignments.
const UP = `
ALTER TABLE scope_items
  ADD COLUMN note text CHECK (note IS NULL OR length(note) BETWEEN 1 AND 500),
  ADD COLUMN assignee_id uuid,
  ADD COLUMN annotated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN annotated_at timestamptz,
  ADD CONSTRAINT scope_items_assignee_member FOREIGN KEY (org_id, assignee_id)
    REFERENCES memberships (org_id, user_id) ON DELETE SET NULL (assignee_id);
CREATE INDEX scope_items_assignee_idx ON scope_items (org_id, assignee_id) WHERE assignee_id IS NOT NULL;
`;

const DOWN = `
DROP INDEX IF EXISTS scope_items_assignee_idx;
ALTER TABLE scope_items
  DROP CONSTRAINT IF EXISTS scope_items_assignee_member,
  DROP COLUMN IF EXISTS annotated_at,
  DROP COLUMN IF EXISTS annotated_by,
  DROP COLUMN IF EXISTS assignee_id,
  DROP COLUMN IF EXISTS note;
`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  await sql.raw(UP).execute(db);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  await sql.raw(DOWN).execute(db);
}
