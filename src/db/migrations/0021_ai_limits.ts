import { sql, type Kysely } from 'kysely';

// AI cost controls, first part (docs/production/AI_COST_CONTROL_PLAN.md AI-4, AI-5; docs/AI_LAYER.md §3):
//
// - usage_counters metric ai_tokens: a school's monthly token budget (limit ai_tokens_per_month). An
//   estimate is taken before each provider call and settled to the tokens the reply reports, so
//   concurrent requests overrun the budget by at most what one request was estimated at.
// - ai_user_daily: requests per member per day in a school (AI_USER_DAILY_LIMIT), so one account
//   cannot use up the school's allowance. A unit is taken before the call, in one statement, and
//   given back when the provider failed without answering, like the monthly request unit.
//   The worker removes rows after a week (src/jobs/tasks.ts).
const UP = `
ALTER TABLE usage_counters DROP CONSTRAINT usage_counters_metric_check;
ALTER TABLE usage_counters ADD CONSTRAINT usage_counters_metric_check CHECK (metric IN ('exports', 'api_requests', 'ai_requests', 'ai_tokens'));

CREATE TABLE ai_user_daily (
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day date NOT NULL,
  requests integer NOT NULL DEFAULT 0 CHECK (requests >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id, day)
);
CREATE INDEX ai_user_daily_day_idx ON ai_user_daily (day);

ALTER TABLE ai_user_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_user_daily FORCE ROW LEVEL SECURITY;
CREATE POLICY ai_user_daily_isolation ON ai_user_daily
  USING (app_rls_bypass() OR org_id = app_current_org())
  WITH CHECK (app_rls_bypass() OR org_id = app_current_org());
`;

const DOWN = `
DROP TABLE IF EXISTS ai_user_daily;
DELETE FROM usage_counters WHERE metric = 'ai_tokens';
ALTER TABLE usage_counters DROP CONSTRAINT usage_counters_metric_check;
ALTER TABLE usage_counters ADD CONSTRAINT usage_counters_metric_check CHECK (metric IN ('exports', 'api_requests', 'ai_requests'));
`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  await sql.raw(UP).execute(db);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  await sql.raw(DOWN).execute(db);
}
