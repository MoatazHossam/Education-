import { sql, type Kysely } from 'kysely';

// Tenant isolation hardening (docs/production/SECURITY_GAP_ANALYSIS.md S-1, S-2).
//
// 1. The RLS bypass is no longer a setting. Until now every policy honoured
//    app_rls_bypass(), which read `app.rls_bypass`, a value any statement of the
//    application role could set; an SQL injection anywhere would have read every
//    school's data. From here it is always false: cross-tenant work runs as a
//    separate system role with BYPASSRLS (SYSTEM_DATABASE_URL, src/db/index.ts),
//    and the application role has no way to bypass a policy.
//
// 2. The three tables that had no policy get one:
//    - notifications: the recipient's organization or the recipient;
//    - email_outbox: anyone may queue an email, only the system role (the worker)
//      reads, sends or deletes them;
//    - billing_events: payment provider events, the system role only.
const UP = `
CREATE OR REPLACE FUNCTION app_rls_bypass() RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT false
$$;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY notifications_isolation ON notifications
  USING (org_id = app_current_org() OR user_id = app_current_user())
  WITH CHECK (org_id = app_current_org() OR user_id = app_current_user());

ALTER TABLE email_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_outbox FORCE ROW LEVEL SECURITY;
CREATE POLICY email_outbox_enqueue ON email_outbox FOR INSERT WITH CHECK (true);

ALTER TABLE billing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_events FORCE ROW LEVEL SECURITY;
`;

const DOWN = `
DROP POLICY IF EXISTS notifications_isolation ON notifications;
ALTER TABLE notifications NO FORCE ROW LEVEL SECURITY;
ALTER TABLE notifications DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_outbox_enqueue ON email_outbox;
ALTER TABLE email_outbox NO FORCE ROW LEVEL SECURITY;
ALTER TABLE email_outbox DISABLE ROW LEVEL SECURITY;
ALTER TABLE billing_events NO FORCE ROW LEVEL SECURITY;
ALTER TABLE billing_events DISABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION app_rls_bypass() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.rls_bypass', true), '') = 'on'
$$;
`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  await sql.raw(UP).execute(db);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  await sql.raw(DOWN).execute(db);
}
