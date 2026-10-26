import { sql, type Kysely } from 'kysely';

// Online tests and exams (docs/ONLINE_TESTS.md). A teacher writes a test for a
// class: questions with answer keys, a time window, an optional time limit,
// attempts, and how results are shown. Students take it in the portal; the
// server enforces the times, marks what it can and records what the teacher
// monitors (leaving the page, pasting, another device).
//
// Answer keys live in their own table. A student's request (app.current_student)
// can read a key only when the teacher chose to show answers and the test is
// over (and released, when results are released by hand), so a student cannot
// reach the answers while the test runs, whatever the query.
const UP = `
CREATE TABLE tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  class_id uuid NOT NULL,
  subject_en text NOT NULL CHECK (length(subject_en) BETWEEN 1 AND 120),
  subject_ar text NOT NULL CHECK (length(subject_ar) BETWEEN 1 AND 120),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  instructions text NOT NULL DEFAULT '' CHECK (length(instructions) <= 5000),
  kind text NOT NULL DEFAULT 'quiz' CHECK (kind IN ('quiz', 'exam')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  opens_at timestamptz NOT NULL,
  closes_at timestamptz NOT NULL,
  duration_minutes integer CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 1 AND 600),
  max_attempts smallint NOT NULL DEFAULT 1 CHECK (max_attempts BETWEEN 1 AND 10),
  shuffle_questions boolean NOT NULL DEFAULT false,
  shuffle_options boolean NOT NULL DEFAULT false,
  results text NOT NULL DEFAULT 'after_close' CHECK (results IN ('after_submit', 'after_close', 'manual')),
  show_answers boolean NOT NULL DEFAULT false,
  results_released_at timestamptz,
  -- Given out in the room; required to start when set.
  access_code text CHECK (access_code IS NULL OR access_code ~ '^[A-Z2-9]{6}$'),
  -- An attempt continues only in the browser session that started it, unless the teacher allows another.
  one_device boolean NOT NULL DEFAULT false,
  closed_early_at timestamptz,
  -- The most extra time any student was given: results "when the test closes" and answer keys wait for it.
  max_extra_minutes integer NOT NULL DEFAULT 0 CHECK (max_extra_minutes BETWEEN 0 AND 600),
  published_at timestamptz,
  notified_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, org_id),
  CHECK (closes_at > opens_at),
  CHECK ((status = 'published') = (published_at IS NOT NULL)),
  FOREIGN KEY (class_id, org_id) REFERENCES classes(id, org_id) ON DELETE CASCADE
);
CREATE INDEX tests_class_idx ON tests (class_id, opens_at DESC);
CREATE INDEX tests_unnotified_idx ON tests (published_at) WHERE notified_at IS NULL AND status = 'published';
CREATE TRIGGER tests_updated_at BEFORE UPDATE ON tests FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE test_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  test_id uuid NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  type text NOT NULL CHECK (type IN ('single', 'multiple', 'true_false', 'short', 'essay')),
  prompt text NOT NULL CHECK (length(prompt) BETWEEN 1 AND 2000),
  -- [{ "id": "a", "text": "…" }] for single and multiple choice.
  options jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(options) = 'array' AND jsonb_array_length(options) <= 10),
  points numeric(6,2) NOT NULL CHECK (points > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, org_id),
  UNIQUE (id, test_id, org_id),
  FOREIGN KEY (test_id, org_id) REFERENCES tests(id, org_id) ON DELETE CASCADE
);
CREATE INDEX test_questions_test_idx ON test_questions (test_id, position);
CREATE TRIGGER test_questions_updated_at BEFORE UPDATE ON test_questions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- single: ["a"]; multiple: ["a","c"]; true_false: true|false; short: ["accepted", …]; essay: {"guide": "…"|null}
CREATE TABLE test_question_keys (
  question_id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  test_id uuid NOT NULL,
  key jsonb NOT NULL,
  FOREIGN KEY (question_id, test_id, org_id) REFERENCES test_questions(id, test_id, org_id) ON DELETE CASCADE
);
CREATE INDEX test_question_keys_test_idx ON test_question_keys (test_id);

-- Per-student allowances the teacher gives: more time, another attempt.
CREATE TABLE test_student_overrides (
  test_id uuid NOT NULL,
  org_id uuid NOT NULL,
  student_id uuid NOT NULL,
  extra_minutes integer NOT NULL DEFAULT 0 CHECK (extra_minutes BETWEEN 0 AND 600),
  extra_attempts integer NOT NULL DEFAULT 0 CHECK (extra_attempts BETWEEN 0 AND 10),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (test_id, student_id),
  FOREIGN KEY (test_id, org_id) REFERENCES tests(id, org_id) ON DELETE CASCADE,
  FOREIGN KEY (student_id, org_id) REFERENCES students(user_id, org_id) ON DELETE CASCADE
);
CREATE TRIGGER test_student_overrides_updated_at BEFORE UPDATE ON test_student_overrides FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE test_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  test_id uuid NOT NULL,
  student_id uuid NOT NULL,
  number smallint NOT NULL CHECK (number >= 1),
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'submitted')),
  started_at timestamptz NOT NULL DEFAULT now(),
  deadline_at timestamptz NOT NULL,
  extra_minutes integer NOT NULL DEFAULT 0 CHECK (extra_minutes BETWEEN 0 AND 600),
  submitted_at timestamptz,
  submit_reason text CHECK (submit_reason IS NULL OR submit_reason IN ('student', 'time', 'teacher', 'closed')),
  -- The browser session (sessions.id) that started it; null once the teacher allows another device.
  session_id text,
  question_order jsonb NOT NULL,
  option_order jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  max_points numeric(8,2) NOT NULL,
  auto_points numeric(8,2),
  manual_points numeric(8,2),
  score numeric(8,2),
  -- Essays (or other answers) still waiting for the teacher's mark.
  needs_marking boolean NOT NULL DEFAULT false,
  marked_at timestamptz,
  events_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (test_id, student_id, number),
  UNIQUE (id, org_id),
  CHECK ((status = 'submitted') = (submitted_at IS NOT NULL)),
  FOREIGN KEY (test_id, org_id) REFERENCES tests(id, org_id) ON DELETE CASCADE,
  FOREIGN KEY (student_id, org_id) REFERENCES students(user_id, org_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX test_attempts_one_open_idx ON test_attempts (test_id, student_id) WHERE status = 'in_progress';
CREATE INDEX test_attempts_deadline_idx ON test_attempts (deadline_at) WHERE status = 'in_progress';
CREATE INDEX test_attempts_unmarked_idx ON test_attempts (submitted_at) WHERE status = 'submitted' AND marked_at IS NULL;
CREATE INDEX test_attempts_student_idx ON test_attempts (student_id);
CREATE TRIGGER test_attempts_updated_at BEFORE UPDATE ON test_attempts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE test_answers (
  attempt_id uuid NOT NULL,
  org_id uuid NOT NULL,
  question_id uuid NOT NULL,
  -- single: "a"; multiple: ["a","c"]; true_false: true|false; short and essay: "text"
  answer jsonb NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now(),
  auto_points numeric(6,2),
  manual_points numeric(6,2) CHECK (manual_points IS NULL OR manual_points >= 0),
  feedback text CHECK (feedback IS NULL OR length(feedback) <= 2000),
  PRIMARY KEY (attempt_id, question_id),
  FOREIGN KEY (attempt_id, org_id) REFERENCES test_attempts(id, org_id) ON DELETE CASCADE,
  FOREIGN KEY (question_id, org_id) REFERENCES test_questions(id, org_id) ON DELETE CASCADE
);

-- What the teacher's monitor shows besides answers. Bounded per attempt by the API.
CREATE TABLE test_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('started', 'resumed', 'left_page', 'returned', 'paste', 'offline', 'online', 'other_device',
    'device_allowed', 'extra_time', 'forced_submit', 'time_up', 'closed', 'submitted')),
  at timestamptz NOT NULL DEFAULT now(),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (attempt_id, org_id) REFERENCES test_attempts(id, org_id) ON DELETE CASCADE
);
CREATE INDEX test_events_attempt_idx ON test_events (attempt_id, id);

-- ---------------------------------------------------------------- row-level security
-- Staff (no app.current_student): the whole school, as elsewhere. A student:
ALTER TABLE tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE tests FORCE ROW LEVEL SECURITY;
CREATE POLICY tests_isolation ON tests
  USING (app_rls_bypass() OR (org_id = app_current_org() AND (app_current_student() IS NULL
    OR (status = 'published' AND class_id IN (SELECT cs.class_id FROM class_students cs WHERE cs.student_id = app_current_student())))))
  WITH CHECK (app_rls_bypass() OR (org_id = app_current_org() AND app_current_student() IS NULL));

-- Questions of tests the student has started.
ALTER TABLE test_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_questions FORCE ROW LEVEL SECURITY;
CREATE POLICY test_questions_isolation ON test_questions
  USING (app_rls_bypass() OR (org_id = app_current_org() AND (app_current_student() IS NULL
    OR test_id IN (SELECT a.test_id FROM test_attempts a WHERE a.student_id = app_current_student()))))
  WITH CHECK (app_rls_bypass() OR (org_id = app_current_org() AND app_current_student() IS NULL));

-- Keys: only once the test is over for everyone (closed early, or closed and any extra time run out), the teacher
-- shows answers, the results are out, and the student has submitted.
ALTER TABLE test_question_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_question_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY test_question_keys_isolation ON test_question_keys
  USING (app_rls_bypass() OR (org_id = app_current_org() AND (app_current_student() IS NULL
    OR (test_id IN (SELECT t.id FROM tests t WHERE t.show_answers
          AND (t.closed_early_at IS NOT NULL OR t.closes_at + make_interval(mins => t.max_extra_minutes) <= now())
          AND (t.results <> 'manual' OR t.results_released_at IS NOT NULL))
        AND test_id IN (SELECT a.test_id FROM test_attempts a WHERE a.student_id = app_current_student() AND a.status = 'submitted')))))
  WITH CHECK (app_rls_bypass() OR (org_id = app_current_org() AND app_current_student() IS NULL));

ALTER TABLE test_student_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_student_overrides FORCE ROW LEVEL SECURITY;
CREATE POLICY test_student_overrides_isolation ON test_student_overrides
  USING (app_rls_bypass() OR (org_id = app_current_org() AND (app_current_student() IS NULL OR student_id = app_current_student())))
  WITH CHECK (app_rls_bypass() OR (org_id = app_current_org() AND app_current_student() IS NULL));

ALTER TABLE test_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_attempts FORCE ROW LEVEL SECURITY;
CREATE POLICY test_attempts_isolation ON test_attempts
  USING (app_rls_bypass() OR (org_id = app_current_org() AND (app_current_student() IS NULL OR student_id = app_current_student())))
  WITH CHECK (app_rls_bypass() OR (org_id = app_current_org() AND (app_current_student() IS NULL OR student_id = app_current_student())));

ALTER TABLE test_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_answers FORCE ROW LEVEL SECURITY;
CREATE POLICY test_answers_isolation ON test_answers
  USING (app_rls_bypass() OR (org_id = app_current_org() AND (app_current_student() IS NULL
    OR attempt_id IN (SELECT a.id FROM test_attempts a WHERE a.student_id = app_current_student()))))
  WITH CHECK (app_rls_bypass() OR (org_id = app_current_org() AND (app_current_student() IS NULL
    OR attempt_id IN (SELECT a.id FROM test_attempts a WHERE a.student_id = app_current_student() AND a.status = 'in_progress'))));

ALTER TABLE test_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_events FORCE ROW LEVEL SECURITY;
CREATE POLICY test_events_isolation ON test_events
  USING (app_rls_bypass() OR (org_id = app_current_org() AND (app_current_student() IS NULL
    OR attempt_id IN (SELECT a.id FROM test_attempts a WHERE a.student_id = app_current_student()))))
  WITH CHECK (app_rls_bypass() OR (org_id = app_current_org() AND (app_current_student() IS NULL
    OR attempt_id IN (SELECT a.id FROM test_attempts a WHERE a.student_id = app_current_student()))));
`;

const DOWN = `
DROP TABLE IF EXISTS test_events;
DROP TABLE IF EXISTS test_answers;
DROP TABLE IF EXISTS test_attempts;
DROP TABLE IF EXISTS test_student_overrides;
DROP TABLE IF EXISTS test_question_keys;
DROP TABLE IF EXISTS test_questions;
DROP TABLE IF EXISTS tests;
`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  await sql.raw(UP).execute(db);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  await sql.raw(DOWN).execute(db);
}
