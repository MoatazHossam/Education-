import { sql, type Kysely } from 'kysely';

// Webhooks to customer systems (docs/API_DOCUMENTATION.md#webhooks): an
// organization registers HTTPS endpoints that are told when its scopes change.
// Each endpoint has its own signing secret, stored encrypted (it must be read
// back to sign). Events are queued in webhook_deliveries in the transaction
// that changes the scope, and the worker sends them with retries. A delivery
// still waiting for its first attempt carries a coalescing key, so several
// quick changes to one scope reach the endpoint as one event with the latest
// state.
const UP = `
CREATE TABLE webhook_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  url text NOT NULL CHECK (length(url) BETWEEN 8 AND 500),
  description text CHECK (description IS NULL OR length(description) BETWEEN 1 AND 120),
  events text[] NOT NULL CHECK (cardinality(events) BETWEEN 1 AND 10),
  secret_enc text NOT NULL,
  secret_prefix text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  disabled_reason text CHECK (disabled_reason IS NULL OR disabled_reason IN ('failing')),
  consecutive_failures integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, org_id)
);
CREATE INDEX webhook_endpoints_org_idx ON webhook_endpoints (org_id);
CREATE TRIGGER webhook_endpoints_updated_at BEFORE UPDATE ON webhook_endpoints FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  endpoint_id uuid NOT NULL,
  event_id uuid NOT NULL,
  event_type text NOT NULL,
  payload json NOT NULL,
  coalesce_key text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_status_code integer,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  FOREIGN KEY (endpoint_id, org_id) REFERENCES webhook_endpoints (id, org_id) ON DELETE CASCADE
);
CREATE INDEX webhook_deliveries_due_idx ON webhook_deliveries (next_attempt_at) WHERE status = 'pending';
CREATE INDEX webhook_deliveries_endpoint_idx ON webhook_deliveries (endpoint_id, created_at DESC);
CREATE INDEX webhook_deliveries_org_idx ON webhook_deliveries (org_id);
CREATE UNIQUE INDEX webhook_deliveries_coalesce_idx ON webhook_deliveries (endpoint_id, coalesce_key)
  WHERE status = 'pending' AND attempts = 0 AND coalesce_key IS NOT NULL;

ALTER TABLE webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_endpoints FORCE ROW LEVEL SECURITY;
CREATE POLICY webhook_endpoints_isolation ON webhook_endpoints
  USING (app_rls_bypass() OR org_id = app_current_org())
  WITH CHECK (app_rls_bypass() OR org_id = app_current_org());
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries FORCE ROW LEVEL SECURITY;
CREATE POLICY webhook_deliveries_isolation ON webhook_deliveries
  USING (app_rls_bypass() OR org_id = app_current_org())
  WITH CHECK (app_rls_bypass() OR org_id = app_current_org());
`;

const DOWN = `
DROP TABLE IF EXISTS webhook_deliveries;
DROP TABLE IF EXISTS webhook_endpoints;
`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  await sql.raw(UP).execute(db);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  await sql.raw(DOWN).execute(db);
}
