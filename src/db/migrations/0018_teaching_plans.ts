import { sql, type Kysely } from 'kysely';

// Teaching plans (docs/TEACHING_PLANS.md): lesson plans and pacing plans (how a
// subject's curriculum is spread over the weeks of a term), kept per curriculum
// scope, grade and subject. Members write them by hand or start from a draft
// written by the AI provider; `ai_assisted` records which. The plan itself is
// the JSON in `content`, checked by the application (src/scopes/plans.ts).
// Removing the scope removes its plans.
const UP = `
CREATE TABLE teaching_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scope_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('lesson', 'pacing')),
  grade smallint NOT NULL CHECK (grade BETWEEN 1 AND 12),
  subject_en text NOT NULL CHECK (length(subject_en) BETWEEN 1 AND 120),
  subject_ar text NOT NULL CHECK (length(subject_ar) BETWEEN 1 AND 120),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  language text NOT NULL CHECK (language IN ('ar', 'en')),
  content jsonb NOT NULL CHECK (jsonb_typeof(content) = 'object' AND octet_length(content::text) <= 200000),
  ai_assisted boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (scope_id, org_id) REFERENCES scopes(id, org_id) ON DELETE CASCADE
);
CREATE INDEX teaching_plans_scope_idx ON teaching_plans (scope_id, grade, subject_en, kind);
CREATE INDEX teaching_plans_org_idx ON teaching_plans (org_id);
CREATE TRIGGER teaching_plans_updated_at BEFORE UPDATE ON teaching_plans FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE teaching_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE teaching_plans FORCE ROW LEVEL SECURITY;
CREATE POLICY teaching_plans_isolation ON teaching_plans
  USING (app_rls_bypass() OR org_id = app_current_org())
  WITH CHECK (app_rls_bypass() OR org_id = app_current_org());
`;

const DOWN = `
DROP TABLE IF EXISTS teaching_plans;
`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  await sql.raw(UP).execute(db);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  await sql.raw(DOWN).execute(db);
}
