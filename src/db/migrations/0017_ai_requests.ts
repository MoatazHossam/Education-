import { sql, type Kysely } from 'kysely';

// AI assistance (docs/AI_LAYER.md). Each request to the AI provider counts
// against the school's monthly allowance (usage_counters, metric ai_requests)
// and leaves one row in ai_requests: who asked, for which feature, the
// provider and model, the outcome, the tokens it cost and how long it took.
// Neither the request nor the reply is stored. The worker removes rows after
// AI_REQUEST_RETENTION_DAYS (src/jobs/tasks.ts).
const UP = `
ALTER TABLE usage_counters DROP CONSTRAINT usage_counters_metric_check;
ALTER TABLE usage_counters ADD CONSTRAINT usage_counters_metric_check CHECK (metric IN ('exports', 'api_requests', 'ai_requests'));

CREATE TABLE ai_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  feature text NOT NULL CHECK (feature ~ '^[a-z][a-z0-9_]{1,40}$'),
  provider text NOT NULL CHECK (provider IN ('gemini', 'anthropic', 'openai')),
  model text NOT NULL CHECK (length(model) BETWEEN 1 AND 100),
  status text NOT NULL CHECK (status IN ('ok', 'refused', 'invalid_output', 'too_long', 'failed')),
  error_kind text CHECK (error_kind IN ('auth', 'rate_limited', 'unavailable', 'timeout', 'bad_request', 'other')),
  attempts smallint NOT NULL DEFAULT 1 CHECK (attempts BETWEEN 1 AND 5),
  input_tokens integer CHECK (input_tokens >= 0),
  output_tokens integer CHECK (output_tokens >= 0),
  duration_ms integer NOT NULL CHECK (duration_ms >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'failed') = (error_kind IS NOT NULL))
);
CREATE INDEX ai_requests_org_created_idx ON ai_requests (org_id, created_at DESC);
CREATE INDEX ai_requests_created_idx ON ai_requests (created_at);

ALTER TABLE ai_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY ai_requests_isolation ON ai_requests
  USING (app_rls_bypass() OR org_id = app_current_org())
  WITH CHECK (app_rls_bypass() OR org_id = app_current_org());
`;

const DOWN = `
DROP TABLE IF EXISTS ai_requests;
DELETE FROM usage_counters WHERE metric = 'ai_requests';
ALTER TABLE usage_counters DROP CONSTRAINT usage_counters_metric_check;
ALTER TABLE usage_counters ADD CONSTRAINT usage_counters_metric_check CHECK (metric IN ('exports', 'api_requests'));
`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  await sql.raw(UP).execute(db);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  await sql.raw(DOWN).execute(db);
}
