import { sql, type Kysely } from 'kysely';

// One row per hosted-checkout attempt. Some providers (Paymob) sign the order
// they created but not the merchant reference echoed in the callback, so the
// invoice is resolved from the signed provider reference recorded here.
const UP = `
CREATE TABLE checkout_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_ref text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX checkout_sessions_provider_ref_key ON checkout_sessions (provider, provider_ref);
CREATE INDEX checkout_sessions_invoice_idx ON checkout_sessions (invoice_id);

ALTER TABLE checkout_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkout_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY checkout_sessions_isolation ON checkout_sessions
  USING (app_rls_bypass() OR org_id = app_current_org())
  WITH CHECK (app_rls_bypass() OR org_id = app_current_org());
`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  await sql.raw(UP).execute(db);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  await sql.raw('DROP TABLE IF EXISTS checkout_sessions;').execute(db);
}
