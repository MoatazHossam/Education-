import { sql, type Kysely } from 'kysely';

// Classes, teachers and homework (docs/CLASSROOM.md). A class belongs to one
// school and groups some of its student accounts; teachers are members of the
// school assigned to a class for a subject. Teachers set homework, students
// hand it in (text and files), teachers mark it and return it.
//
// Student requests run with app.current_student set (withStudentContext), and
// these policies then expose only the student's own classes, the homework
// published to them and their own submissions and files, whatever the query
// asks for. Staff requests leave it empty and see the whole school, as usual;
// which classes a member may use is checked in the routes.
const UP = `
CREATE OR REPLACE FUNCTION app_current_student() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.current_student', true), '')::uuid
$$;

-- Lets class tables reference a student of the same school only.
ALTER TABLE students ADD CONSTRAINT students_user_org_key UNIQUE (user_id, org_id);

CREATE TABLE classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  grade smallint NOT NULL CHECK (grade BETWEEN 1 AND 12),
  scope_id uuid,
  archived_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, org_id),
  FOREIGN KEY (scope_id, org_id) REFERENCES scopes(id, org_id) ON DELETE SET NULL (scope_id)
);
CREATE UNIQUE INDEX classes_name_idx ON classes (org_id, lower(name)) WHERE archived_at IS NULL;
CREATE TRIGGER classes_updated_at BEFORE UPDATE ON classes FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE class_students (
  class_id uuid NOT NULL,
  org_id uuid NOT NULL,
  student_id uuid NOT NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (class_id, student_id),
  FOREIGN KEY (class_id, org_id) REFERENCES classes(id, org_id) ON DELETE CASCADE,
  FOREIGN KEY (student_id, org_id) REFERENCES students(user_id, org_id) ON DELETE CASCADE
);
CREATE INDEX class_students_student_idx ON class_students (student_id);

-- A member teaching a subject in a class. Removing the member from the school removes these rows.
CREATE TABLE class_teachers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL,
  org_id uuid NOT NULL,
  user_id uuid NOT NULL,
  subject_en text NOT NULL CHECK (length(subject_en) BETWEEN 1 AND 120),
  subject_ar text NOT NULL CHECK (length(subject_ar) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (class_id, user_id, subject_en),
  FOREIGN KEY (class_id, org_id) REFERENCES classes(id, org_id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, user_id) REFERENCES memberships(org_id, user_id) ON DELETE CASCADE
);
CREATE INDEX class_teachers_user_idx ON class_teachers (org_id, user_id);

CREATE TABLE homework (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  class_id uuid NOT NULL,
  subject_en text NOT NULL CHECK (length(subject_en) BETWEEN 1 AND 120),
  subject_ar text NOT NULL CHECK (length(subject_ar) BETWEEN 1 AND 120),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  instructions text NOT NULL DEFAULT '' CHECK (length(instructions) <= 5000),
  -- Books from the class's curriculum, copied (id, kind, title) so later catalogue edits do not change them.
  materials jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(materials) = 'array' AND jsonb_array_length(materials) <= 10),
  publish_at timestamptz NOT NULL DEFAULT now(),
  due_at timestamptz NOT NULL,
  max_points numeric(6,2) CHECK (max_points IS NULL OR max_points > 0),
  allow_late boolean NOT NULL DEFAULT true,
  -- Set once the class's students have been told (at once, or by the worker for scheduled homework).
  notified_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, org_id),
  CHECK (due_at > publish_at),
  FOREIGN KEY (class_id, org_id) REFERENCES classes(id, org_id) ON DELETE CASCADE
);
CREATE INDEX homework_class_idx ON homework (class_id, due_at DESC);
CREATE INDEX homework_unnotified_idx ON homework (publish_at) WHERE notified_at IS NULL;
CREATE TRIGGER homework_updated_at BEFORE UPDATE ON homework FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One per student and homework. A teacher may also create one, to mark work handed in on paper.
CREATE TABLE homework_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  homework_id uuid NOT NULL,
  student_id uuid NOT NULL,
  body text NOT NULL DEFAULT '' CHECK (length(body) <= 10000),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'returned')),
  submitted_at timestamptz,
  late boolean NOT NULL DEFAULT false,
  points numeric(6,2) CHECK (points IS NULL OR points >= 0),
  feedback text CHECK (feedback IS NULL OR length(feedback) <= 3000),
  graded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  graded_at timestamptz,
  returned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (homework_id, student_id),
  UNIQUE (id, org_id),
  FOREIGN KEY (homework_id, org_id) REFERENCES homework(id, org_id) ON DELETE CASCADE,
  FOREIGN KEY (student_id, org_id) REFERENCES students(user_id, org_id) ON DELETE CASCADE
);
CREATE INDEX homework_submissions_student_idx ON homework_submissions (student_id);
CREATE TRIGGER homework_submissions_updated_at BEFORE UPDATE ON homework_submissions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Files attached to a homework (by its teacher) or to a submission (by its student).
-- Kept in the database, so backups and school deletion cover them; the type is
-- checked from the file's first bytes, not from the browser's claim.
CREATE TABLE classroom_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  homework_id uuid,
  submission_id uuid,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
  sha256 text NOT NULL,
  data bytea NOT NULL,
  uploaded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(homework_id, submission_id) = 1),
  FOREIGN KEY (homework_id, org_id) REFERENCES homework(id, org_id) ON DELETE CASCADE,
  FOREIGN KEY (submission_id, org_id) REFERENCES homework_submissions(id, org_id) ON DELETE CASCADE
);
CREATE INDEX classroom_files_homework_idx ON classroom_files (homework_id) WHERE homework_id IS NOT NULL;
CREATE INDEX classroom_files_submission_idx ON classroom_files (submission_id) WHERE submission_id IS NOT NULL;
CREATE INDEX classroom_files_org_idx ON classroom_files (org_id);

-- ---------------------------------------------------------------- row-level security
ALTER TABLE classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE classes FORCE ROW LEVEL SECURITY;
CREATE POLICY classes_isolation ON classes
  USING (app_rls_bypass() OR (org_id = app_current_org() AND (app_current_student() IS NULL
    OR id IN (SELECT cs.class_id FROM class_students cs WHERE cs.student_id = app_current_student()))))
  WITH CHECK (app_rls_bypass() OR (org_id = app_current_org() AND app_current_student() IS NULL));

ALTER TABLE class_students ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_students FORCE ROW LEVEL SECURITY;
CREATE POLICY class_students_isolation ON class_students
  USING (app_rls_bypass() OR (org_id = app_current_org() AND (app_current_student() IS NULL OR student_id = app_current_student())))
  WITH CHECK (app_rls_bypass() OR (org_id = app_current_org() AND app_current_student() IS NULL));

ALTER TABLE class_teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_teachers FORCE ROW LEVEL SECURITY;
CREATE POLICY class_teachers_isolation ON class_teachers
  USING (app_rls_bypass() OR (org_id = app_current_org() AND (app_current_student() IS NULL
    OR class_id IN (SELECT cs.class_id FROM class_students cs WHERE cs.student_id = app_current_student()))))
  WITH CHECK (app_rls_bypass() OR (org_id = app_current_org() AND app_current_student() IS NULL));

-- Students see homework of their classes once it is published.
ALTER TABLE homework ENABLE ROW LEVEL SECURITY;
ALTER TABLE homework FORCE ROW LEVEL SECURITY;
CREATE POLICY homework_isolation ON homework
  USING (app_rls_bypass() OR (org_id = app_current_org() AND (app_current_student() IS NULL
    OR (publish_at <= now() AND class_id IN (SELECT cs.class_id FROM class_students cs WHERE cs.student_id = app_current_student())))))
  WITH CHECK (app_rls_bypass() OR (org_id = app_current_org() AND app_current_student() IS NULL));

ALTER TABLE homework_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE homework_submissions FORCE ROW LEVEL SECURITY;
CREATE POLICY homework_submissions_isolation ON homework_submissions
  USING (app_rls_bypass() OR (org_id = app_current_org() AND (app_current_student() IS NULL OR student_id = app_current_student())))
  WITH CHECK (app_rls_bypass() OR (org_id = app_current_org() AND (app_current_student() IS NULL OR student_id = app_current_student())));

-- The subqueries are filtered by the policies above, so a student reaches only
-- files of homework they can see and of their own submissions.
ALTER TABLE classroom_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE classroom_files FORCE ROW LEVEL SECURITY;
CREATE POLICY classroom_files_isolation ON classroom_files
  USING (app_rls_bypass() OR (org_id = app_current_org() AND (app_current_student() IS NULL
    OR homework_id IN (SELECT h.id FROM homework h)
    OR submission_id IN (SELECT s.id FROM homework_submissions s))))
  WITH CHECK (app_rls_bypass() OR (org_id = app_current_org() AND (app_current_student() IS NULL
    OR submission_id IN (SELECT s.id FROM homework_submissions s WHERE s.student_id = app_current_student()))));

-- A student's request sees no other student of the school either.
DROP POLICY students_isolation ON students;
CREATE POLICY students_isolation ON students
  USING (app_rls_bypass() OR (org_id = app_current_org() AND (app_current_student() IS NULL OR user_id = app_current_student())) OR user_id = app_current_user())
  WITH CHECK (app_rls_bypass() OR (org_id = app_current_org() AND app_current_student() IS NULL));
`;

const DOWN = `
DROP POLICY students_isolation ON students;
CREATE POLICY students_isolation ON students
  USING (app_rls_bypass() OR org_id = app_current_org() OR user_id = app_current_user())
  WITH CHECK (app_rls_bypass() OR org_id = app_current_org());
DROP TABLE IF EXISTS classroom_files;
DROP TABLE IF EXISTS homework_submissions;
DROP TABLE IF EXISTS homework;
DROP TABLE IF EXISTS class_teachers;
DROP TABLE IF EXISTS class_students;
DROP TABLE IF EXISTS classes;
ALTER TABLE students DROP CONSTRAINT IF EXISTS students_user_org_key;
DROP FUNCTION IF EXISTS app_current_student();
`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  await sql.raw(UP).execute(db);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  await sql.raw(DOWN).execute(db);
}
