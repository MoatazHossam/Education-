import { sql, type Kysely } from 'kysely';

// How long a school keeps classroom data (docs/CLASSROOM.md §11). Each school
// may set three periods, counted from a homework's due time or a test's end:
//   monitoring_days  a test's monitoring events (left the page, pasting, …)
//   work_days        students' work: homework answers and files, test answers
//   records_days     the homework or test itself, with marks and comments
// Unset (null) means kept; nothing is deleted until a school sets a period.
//
// Owners and admins are told before anything is deleted: the worker records a
// notice for each homework or test and stage, at least NOTICE_DAYS before its
// delete_after time (classroom/retention.ts). An item on hold is never deleted.
const UP = `
CREATE TABLE classroom_retention (
  org_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  monitoring_days integer CHECK (monitoring_days BETWEEN 1 AND 3650),
  work_days integer CHECK (work_days BETWEEN 1 AND 3650),
  records_days integer CHECK (records_days BETWEEN 1 AND 3650),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Work and monitoring cannot outlive the record they belong to.
  CHECK (records_days IS NULL OR ((work_days IS NULL OR work_days <= records_days) AND (monitoring_days IS NULL OR monitoring_days <= records_days)))
);

ALTER TABLE homework
  ADD COLUMN work_removed_at timestamptz,
  ADD COLUMN retention_hold boolean NOT NULL DEFAULT false;
ALTER TABLE tests
  ADD COLUMN work_removed_at timestamptz,
  ADD COLUMN monitoring_removed_at timestamptz,
  ADD COLUMN retention_hold boolean NOT NULL DEFAULT false;
CREATE INDEX homework_org_due_idx ON homework (org_id, due_at);
CREATE INDEX tests_org_closes_idx ON tests (org_id, closes_at);

CREATE TABLE classroom_retention_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  homework_id uuid,
  test_id uuid,
  item_id uuid GENERATED ALWAYS AS (coalesce(homework_id, test_id)) STORED,
  stage text NOT NULL CHECK (stage IN ('monitoring', 'work', 'records')),
  delete_after timestamptz NOT NULL,
  notified_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(homework_id, test_id) = 1),
  CHECK (stage <> 'monitoring' OR test_id IS NOT NULL),
  UNIQUE (item_id, stage),
  FOREIGN KEY (homework_id, org_id) REFERENCES homework(id, org_id) ON DELETE CASCADE,
  FOREIGN KEY (test_id, org_id) REFERENCES tests(id, org_id) ON DELETE CASCADE
);
CREATE INDEX classroom_retention_notices_org_idx ON classroom_retention_notices (org_id, delete_after);

-- Staff of the school only; a student's request sees neither table.
ALTER TABLE classroom_retention ENABLE ROW LEVEL SECURITY;
ALTER TABLE classroom_retention FORCE ROW LEVEL SECURITY;
CREATE POLICY classroom_retention_isolation ON classroom_retention
  USING (app_rls_bypass() OR (org_id = app_current_org() AND app_current_student() IS NULL))
  WITH CHECK (app_rls_bypass() OR (org_id = app_current_org() AND app_current_student() IS NULL));

ALTER TABLE classroom_retention_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE classroom_retention_notices FORCE ROW LEVEL SECURITY;
CREATE POLICY classroom_retention_notices_isolation ON classroom_retention_notices
  USING (app_rls_bypass() OR (org_id = app_current_org() AND app_current_student() IS NULL))
  WITH CHECK (app_rls_bypass() OR (org_id = app_current_org() AND app_current_student() IS NULL));
`;

const DOWN = `
DROP TABLE IF EXISTS classroom_retention_notices;
DROP TABLE IF EXISTS classroom_retention;
DROP INDEX IF EXISTS tests_org_closes_idx;
DROP INDEX IF EXISTS homework_org_due_idx;
ALTER TABLE tests DROP COLUMN IF EXISTS retention_hold, DROP COLUMN IF EXISTS monitoring_removed_at, DROP COLUMN IF EXISTS work_removed_at;
ALTER TABLE homework DROP COLUMN IF EXISTS retention_hold, DROP COLUMN IF EXISTS work_removed_at;
`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  await sql.raw(UP).execute(db);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  await sql.raw(DOWN).execute(db);
}
