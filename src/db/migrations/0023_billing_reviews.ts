import { sql, type Kysely } from 'kysely';

// Payments an operator must look at (docs/production/BILLING_INTEGRATION_PLAN.md P-4, gap B-G3): a refund or
// void reported by the payment provider, a payment whose amount or currency does not match its invoice, and a
// payment on an invoice that was already closed. Before, these were only audited and their notification
// marked ignored. One review per provider notification (provider, event_id), so a provider's retry or an
// administrator's reprocess cannot add a second one. The operator resolves it with a note of what was done
// (reopened the invoice, changed the plan, refunded through the provider's dashboard, nothing needed).
// Kept like the other billing records.
const UP = `
CREATE TABLE billing_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL,
  payment_id uuid REFERENCES payments(id) ON DELETE SET NULL,
  provider text NOT NULL,
  event_id text NOT NULL,
  provider_txn_id text,
  kind text NOT NULL CHECK (kind IN ('refund', 'void', 'amount_mismatch', 'payment_on_closed_invoice')),
  amount_cents integer CHECK (amount_cents >= 0),
  currency text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolution text CHECK (length(resolution) BETWEEN 1 AND 1000),
  resolved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, event_id),
  CHECK ((status = 'resolved') = (resolved_at IS NOT NULL AND resolution IS NOT NULL))
);
CREATE INDEX billing_reviews_open_idx ON billing_reviews (created_at) WHERE status = 'open';
CREATE INDEX billing_reviews_org_idx ON billing_reviews (org_id, created_at DESC);

ALTER TABLE billing_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY billing_reviews_isolation ON billing_reviews
  USING (app_rls_bypass() OR org_id = app_current_org())
  WITH CHECK (app_rls_bypass() OR org_id = app_current_org());
`;

const DOWN = `
DROP TABLE IF EXISTS billing_reviews;
`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  await sql.raw(UP).execute(db);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  await sql.raw(DOWN).execute(db);
}
