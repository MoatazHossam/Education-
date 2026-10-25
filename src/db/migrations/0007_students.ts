import { sql, type Kysely } from 'kysely';

// Student accounts created by a school (docs/STUDENT_ACCOUNTS.md). They live in
// the same users and sessions tables as staff, so there is one sign-in system,
// but they never hold a membership: every staff route keeps rejecting them.
// A student has no email address; they sign in with the school code and a
// username the school chose. The student portal is off unless the school's
// plan or a platform administrator's override sets max_students above 0.
const UP = `
ALTER TABLE users ADD COLUMN kind text NOT NULL DEFAULT 'staff' CHECK (kind IN ('staff', 'student'));
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users ADD CONSTRAINT users_kind_identity CHECK (
  (kind = 'staff' AND email IS NOT NULL)
  OR (kind = 'student' AND email IS NULL AND NOT is_platform_admin AND NOT mfa_enabled)
);

-- An account never changes kind: staff code paths rely on it.
CREATE OR REPLACE FUNCTION users_kind_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind IS DISTINCT FROM OLD.kind THEN
    RAISE EXCEPTION 'users.kind cannot change' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER users_kind_immutable BEFORE UPDATE OF kind ON users FOR EACH ROW EXECUTE FUNCTION users_kind_immutable();

-- Memberships (staff roles) are for staff accounts only.
CREATE OR REPLACE FUNCTION memberships_check_kind() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id = NEW.user_id AND u.kind = 'staff') THEN
    RAISE EXCEPTION 'memberships are for staff accounts only' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER memberships_kind_check BEFORE INSERT OR UPDATE OF user_id ON memberships
  FOR EACH ROW EXECUTE FUNCTION memberships_check_kind();

-- Lets students reference a scope of their own school only.
ALTER TABLE scopes ADD CONSTRAINT scopes_id_org_key UNIQUE (id, org_id);

CREATE TABLE students (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  username text NOT NULL CHECK (username ~ '^[a-z0-9][a-z0-9._-]{1,38}[a-z0-9]$'),
  grade smallint NOT NULL CHECK (grade BETWEEN 1 AND 12),
  scope_id uuid,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, username),
  FOREIGN KEY (scope_id, org_id) REFERENCES scopes(id, org_id) ON DELETE SET NULL (scope_id)
);
CREATE INDEX students_org_idx ON students (org_id, grade, username);
CREATE INDEX students_scope_idx ON students (scope_id) WHERE scope_id IS NOT NULL;
CREATE TRIGGER students_updated_at BEFORE UPDATE ON students FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION students_check_kind() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id = NEW.user_id AND u.kind = 'student') THEN
    RAISE EXCEPTION 'students.user_id must reference a student account' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER students_kind_check BEFORE INSERT OR UPDATE OF user_id ON students
  FOR EACH ROW EXECUTE FUNCTION students_check_kind();

-- A student account exists only as part of its school: removing the student
-- (or deleting the school, which cascades here) deletes the account, its
-- sessions and its notifications.
CREATE OR REPLACE FUNCTION students_delete_account() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM users WHERE id = OLD.user_id AND kind = 'student';
  RETURN NULL;
END
$$;
CREATE TRIGGER students_delete_account AFTER DELETE ON students FOR EACH ROW EXECUTE FUNCTION students_delete_account();

ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE students FORCE ROW LEVEL SECURITY;
CREATE POLICY students_isolation ON students
  USING (app_rls_bypass() OR org_id = app_current_org() OR user_id = app_current_user())
  WITH CHECK (app_rls_bypass() OR org_id = app_current_org());

-- New limit, 0 (off) on every existing plan: prices and current behaviour are unchanged.
UPDATE plans SET limits = limits || '{"max_students": 0}'::jsonb WHERE NOT (limits ? 'max_students');
`;

const DOWN = `
UPDATE plans SET limits = limits - 'max_students';
DROP TABLE IF EXISTS students;
DROP FUNCTION IF EXISTS students_delete_account();
DROP FUNCTION IF EXISTS students_check_kind();
ALTER TABLE scopes DROP CONSTRAINT IF EXISTS scopes_id_org_key;
DROP TRIGGER IF EXISTS memberships_kind_check ON memberships;
DROP FUNCTION IF EXISTS memberships_check_kind();
DROP TRIGGER IF EXISTS users_kind_immutable ON users;
DROP FUNCTION IF EXISTS users_kind_immutable();
DELETE FROM users WHERE kind = 'student';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_kind_identity;
ALTER TABLE users ALTER COLUMN email SET NOT NULL;
ALTER TABLE users DROP COLUMN kind;
`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  await sql.raw(UP).execute(db);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  await sql.raw(DOWN).execute(db);
}
