import { sql, type Kysely } from 'kysely';

// Follow-up on a selected book: a status (to do, in progress, done) and a due
// date, next to its note and assignee (0008). Members choose whether they get
// an email when books are assigned to them (on by default, like catalogue emails).
const UP = `
ALTER TABLE scope_items
  ADD COLUMN status text CHECK (status IS NULL OR status IN ('todo', 'in_progress', 'done')),
  ADD COLUMN due_on date CHECK (due_on IS NULL OR due_on BETWEEN DATE '2000-01-01' AND DATE '2100-12-31');
ALTER TABLE users ADD COLUMN assignment_emails boolean NOT NULL DEFAULT true;
`;

const DOWN = `
ALTER TABLE users DROP COLUMN IF EXISTS assignment_emails;
ALTER TABLE scope_items DROP COLUMN IF EXISTS due_on, DROP COLUMN IF EXISTS status;
`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  await sql.raw(UP).execute(db);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  await sql.raw(DOWN).execute(db);
}
