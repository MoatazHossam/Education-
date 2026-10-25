import { sql, type Kysely } from 'kysely';

// Reminders for assigned books with a due date (0009): one "due soon" and one
// "overdue" reminder per book, assignee and due date. A row records that the
// worker sent that reminder, so it is never repeated; moving the due date or
// assigning the book to someone else starts afresh. The rows go with the
// selected book (removing it from the scope), the scope, and the assignee's
// membership. Members choose whether reminders also come by email (on by
// default, like the other emails).
const UP = `
CREATE TABLE item_reminders (
  org_id uuid NOT NULL,
  scope_id uuid NOT NULL,
  material_id uuid NOT NULL,
  assignee_id uuid NOT NULL,
  due_on date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('due_soon', 'overdue')),
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_id, material_id, assignee_id, due_on, kind),
  FOREIGN KEY (scope_id, org_id) REFERENCES scopes (id, org_id) ON DELETE CASCADE,
  FOREIGN KEY (scope_id, material_id) REFERENCES scope_items (scope_id, material_id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, assignee_id) REFERENCES memberships (org_id, user_id) ON DELETE CASCADE
);
CREATE INDEX item_reminders_org_idx ON item_reminders (org_id, assignee_id);
CREATE INDEX item_reminders_due_idx ON item_reminders (due_on);
ALTER TABLE item_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_reminders FORCE ROW LEVEL SECURITY;
CREATE POLICY item_reminders_isolation ON item_reminders
  USING (app_rls_bypass() OR org_id = app_current_org())
  WITH CHECK (app_rls_bypass() OR org_id = app_current_org());

-- The worker looks for assigned books due in a few days or a few days ago.
CREATE INDEX scope_items_due_idx ON scope_items (due_on) WHERE assignee_id IS NOT NULL AND due_on IS NOT NULL;

ALTER TABLE users ADD COLUMN due_reminder_emails boolean NOT NULL DEFAULT true;
`;

const DOWN = `
ALTER TABLE users DROP COLUMN IF EXISTS due_reminder_emails;
DROP INDEX IF EXISTS scope_items_due_idx;
DROP TABLE IF EXISTS item_reminders;
`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  await sql.raw(UP).execute(db);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  await sql.raw(DOWN).execute(db);
}
