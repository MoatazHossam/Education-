import { sql, type Kysely } from 'kysely';

// Initial schema. Tenant-owned tables carry org_id and are protected by
// Row-Level Security (see the policies at the end). The application connects
// with a non-owner, non-superuser role so these policies always apply; the
// owner role is only used to run migrations.
const UP = `
CREATE OR REPLACE FUNCTION app_current_org() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.current_org', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app_current_user() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.current_user', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app_rls_bypass() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.rls_bypass', true), '') = 'on'
$$;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END
$$;

-- ---------------------------------------------------------------- identity
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL CHECK (email = lower(email) AND length(email) BETWEEN 3 AND 254),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  password_hash text NOT NULL,
  locale text NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'ar')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  is_platform_admin boolean NOT NULL DEFAULT false,
  email_verified_at timestamptz,
  mfa_enabled boolean NOT NULL DEFAULT false,
  mfa_secret_enc text,
  mfa_pending_secret_enc text,
  mfa_last_step bigint,
  mfa_recovery_hashes text[] NOT NULL DEFAULT '{}',
  failed_login_count integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  trial_used boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (email);
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  suspended_reason text,
  locale text NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'ar')),
  require_mfa_for_admins boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX organizations_slug_key ON organizations (slug);
CREATE TRIGGER organizations_updated_at BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE memberships (
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);
-- Exactly zero or one owner per organization at any time.
CREATE UNIQUE INDEX memberships_single_owner ON memberships (org_id) WHERE role = 'owner';
CREATE INDEX memberships_user_idx ON memberships (user_id);
CREATE TRIGGER memberships_updated_at BEFORE UPDATE ON memberships FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE sessions (
  id text PRIMARY KEY CHECK (length(id) = 64),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state text NOT NULL CHECK (state IN ('active', 'mfa_pending')),
  mfa_verified boolean NOT NULL DEFAULT false,
  ip inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

CREATE TABLE user_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX user_tokens_hash_key ON user_tokens (token_hash);
CREATE INDEX user_tokens_user_idx ON user_tokens (user_id, purpose);

CREATE TABLE invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (email = lower(email)),
  role text NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
  token_hash text NOT NULL,
  invited_by uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX invitations_token_key ON invitations (token_hash);
CREATE UNIQUE INDEX invitations_one_open_per_email ON invitations (org_id, email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX invitations_org_idx ON invitations (org_id, created_at DESC);

-- ---------------------------------------------------------------- catalog (global, platform-managed)
CREATE TABLE catalog_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  academic_year text NOT NULL CHECK (academic_year ~ '^[0-9]{4}/[0-9]{4}$'),
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 160),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  notice text,
  grade_notes jsonb NOT NULL DEFAULT '{}'::jsonb,
  published_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX catalog_versions_status_idx ON catalog_versions (status, academic_year DESC);
CREATE TRIGGER catalog_versions_updated_at BEFORE UPDATE ON catalog_versions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE catalog_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES catalog_versions(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  url text NOT NULL CHECK (url ~ '^https?://'),
  sort_order integer NOT NULL DEFAULT 0
);
CREATE INDEX catalog_sources_version_idx ON catalog_sources (version_id, sort_order);

CREATE TABLE catalog_subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES catalog_versions(id) ON DELETE CASCADE,
  grade smallint NOT NULL CHECK (grade BETWEEN 1 AND 12),
  track text NOT NULL CHECK (track IN ('moe', 'sec', 'bac', 'ta', 'intl')),
  block text NOT NULL CHECK (length(block) BETWEEN 1 AND 300),
  code text NOT NULL CHECK (code ~ '^[A-Za-z0-9_-]{1,40}$'),
  name_en text NOT NULL CHECK (length(name_en) BETWEEN 1 AND 200),
  name_ar text NOT NULL CHECK (length(name_ar) BETWEEN 1 AND 200),
  status text NOT NULL CHECK (status IN ('scored', 'pass', 'act')),
  note text,
  sort_order integer NOT NULL DEFAULT 0,
  UNIQUE (version_id, grade, track, block, code)
);
CREATE INDEX catalog_subjects_version_idx ON catalog_subjects (version_id, grade, sort_order);

CREATE TABLE catalog_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id uuid NOT NULL REFERENCES catalog_subjects(id) ON DELETE CASCADE,
  version_id uuid NOT NULL REFERENCES catalog_versions(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('moe', 'lang', 'ext', 'prog', 'exam')),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  sort_order integer NOT NULL DEFAULT 0,
  UNIQUE (subject_id, title),
  UNIQUE (id, version_id)
);
CREATE INDEX catalog_materials_subject_idx ON catalog_materials (subject_id, sort_order);
CREATE INDEX catalog_materials_version_idx ON catalog_materials (version_id);

-- Keep material.version_id consistent with its subject.
CREATE OR REPLACE FUNCTION catalog_materials_check_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM catalog_subjects s WHERE s.id = NEW.subject_id AND s.version_id = NEW.version_id) THEN
    RAISE EXCEPTION 'catalog material version does not match its subject' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER catalog_materials_version_check BEFORE INSERT OR UPDATE ON catalog_materials
  FOR EACH ROW EXECUTE FUNCTION catalog_materials_check_version();

-- ---------------------------------------------------------------- tenant business data
CREATE TABLE scopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  catalog_version_id uuid NOT NULL REFERENCES catalog_versions(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  description text CHECK (description IS NULL OR length(description) <= 2000),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name),
  UNIQUE (id, org_id, catalog_version_id)
);
CREATE INDEX scopes_org_idx ON scopes (org_id, updated_at DESC);
CREATE TRIGGER scopes_updated_at BEFORE UPDATE ON scopes FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Composite foreign keys guarantee that an item belongs to its scope's
-- organization and that the material belongs to the scope's catalog version.
CREATE TABLE scope_items (
  scope_id uuid NOT NULL,
  org_id uuid NOT NULL,
  catalog_version_id uuid NOT NULL,
  material_id uuid NOT NULL,
  added_by uuid REFERENCES users(id) ON DELETE SET NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_id, material_id),
  FOREIGN KEY (scope_id, org_id, catalog_version_id) REFERENCES scopes(id, org_id, catalog_version_id) ON DELETE CASCADE,
  FOREIGN KEY (material_id, catalog_version_id) REFERENCES catalog_materials(id, version_id) ON DELETE RESTRICT
);
CREATE INDEX scope_items_org_idx ON scope_items (org_id);
CREATE INDEX scope_items_material_idx ON scope_items (material_id);

CREATE TABLE api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  prefix text NOT NULL,
  key_hash text NOT NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE UNIQUE INDEX api_keys_hash_key ON api_keys (key_hash);
CREATE INDEX api_keys_org_idx ON api_keys (org_id);

-- ---------------------------------------------------------------- billing
CREATE TABLE plans (
  id text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9_]{1,30}$'),
  name text NOT NULL,
  description text,
  price_monthly_cents integer NOT NULL CHECK (price_monthly_cents >= 0),
  price_yearly_cents integer CHECK (price_yearly_cents IS NULL OR price_yearly_cents >= 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  limits jsonb NOT NULL,
  features jsonb NOT NULL,
  is_public boolean NOT NULL DEFAULT true,
  is_self_serve boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER plans_updated_at BEFORE UPDATE ON plans FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan_id text NOT NULL REFERENCES plans(id),
  billing_interval text NOT NULL DEFAULT 'month' CHECK (billing_interval IN ('month', 'year')),
  status text NOT NULL CHECK (status IN ('trialing', 'active', 'past_due')),
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  canceled_at timestamptz,
  grace_until timestamptz,
  pending_plan_id text REFERENCES plans(id),
  pending_interval text CHECK (pending_interval IS NULL OR pending_interval IN ('month', 'year')),
  limit_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  provider text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'trialing' OR trial_ends_at IS NOT NULL),
  CHECK (status <> 'past_due' OR grace_until IS NOT NULL)
);
CREATE UNIQUE INDEX subscriptions_org_key ON subscriptions (org_id);
CREATE INDEX subscriptions_trial_idx ON subscriptions (trial_ends_at) WHERE status = 'trialing';
CREATE INDEX subscriptions_period_idx ON subscriptions (current_period_end) WHERE status IN ('active', 'past_due');
CREATE TRIGGER subscriptions_updated_at BEFORE UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE SEQUENCE invoice_number_seq START 1000;

CREATE TABLE invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('subscription', 'renewal', 'upgrade', 'manual')),
  plan_id text NOT NULL REFERENCES plans(id),
  billing_interval text NOT NULL CHECK (billing_interval IN ('month', 'year')),
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'void')),
  period_start timestamptz,
  period_end timestamptz,
  due_at timestamptz,
  provider text,
  provider_ref text,
  paid_at timestamptz,
  voided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX invoices_number_key ON invoices (number);
CREATE INDEX invoices_org_idx ON invoices (org_id, created_at DESC);
CREATE INDEX invoices_open_idx ON invoices (org_id) WHERE status = 'open';
CREATE TRIGGER invoices_updated_at BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_txn_id text NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  currency text NOT NULL,
  status text NOT NULL CHECK (status IN ('succeeded', 'failed')),
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX payments_provider_txn_key ON payments (provider, provider_txn_id);
CREATE INDEX payments_invoice_idx ON payments (invoice_id);

-- Webhook receipts. Unique (provider, event_id) makes processing idempotent.
CREATE TABLE billing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  event_id text NOT NULL,
  event_type text NOT NULL,
  org_id uuid,
  payload jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('processed', 'ignored', 'failed')),
  error text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
CREATE UNIQUE INDEX billing_events_provider_event_key ON billing_events (provider, event_id);
CREATE INDEX billing_events_received_idx ON billing_events (received_at DESC);

CREATE TABLE usage_counters (
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  metric text NOT NULL CHECK (metric IN ('exports', 'api_requests')),
  period text NOT NULL CHECK (period ~ '^[0-9]{4}-[0-9]{2}$'),
  quantity integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, metric, period)
);

-- One row per lifecycle notice sent (trial ending, renewal due...) so the
-- worker never sends the same notice twice.
CREATE TABLE billing_notices (
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind text NOT NULL,
  ref text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, kind, ref)
);

-- ---------------------------------------------------------------- operations
CREATE TABLE audit_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id uuid,
  actor_user_id uuid,
  actor_email text,
  actor_type text NOT NULL CHECK (actor_type IN ('user', 'platform_admin', 'system', 'api_key', 'anonymous')),
  action text NOT NULL,
  target_type text,
  target_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_org_idx ON audit_logs (org_id, created_at DESC);
CREATE INDEX audit_logs_created_idx ON audit_logs (created_at DESC);
CREATE INDEX audit_logs_action_idx ON audit_logs (action, created_at DESC);
CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_user_id, created_at DESC);

CREATE TABLE support_access_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  granted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reason text NOT NULL CHECK (length(reason) BETWEEN 5 AND 500),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_access_grants_org_idx ON support_access_grants (org_id, expires_at DESC);

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  link text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);

CREATE TABLE email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  to_email text NOT NULL,
  template text NOT NULL,
  subject text NOT NULL,
  text_body text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  send_after timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX email_outbox_pending_idx ON email_outbox (send_after) WHERE status = 'pending';

CREATE TABLE worker_heartbeats (
  name text PRIMARY KEY,
  last_beat_at timestamptz NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- ---------------------------------------------------------------- row-level security
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY memberships_isolation ON memberships
  USING (app_rls_bypass() OR org_id = app_current_org() OR user_id = app_current_user())
  WITH CHECK (app_rls_bypass() OR org_id = app_current_org());
`;

const TENANT_TABLES = [
  'invitations',
  'scopes',
  'scope_items',
  'api_keys',
  'subscriptions',
  'invoices',
  'payments',
  'usage_counters',
  'billing_notices',
  'audit_logs',
  'support_access_grants',
];

const RLS = TENANT_TABLES.map(
  (t) => `
ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${t} FORCE ROW LEVEL SECURITY;
CREATE POLICY ${t}_isolation ON ${t}
  USING (app_rls_bypass() OR org_id = app_current_org())
  WITH CHECK (app_rls_bypass() OR org_id = app_current_org());`,
).join('\n');

const DOWN = `
DROP TABLE IF EXISTS worker_heartbeats, email_outbox, notifications, support_access_grants, audit_logs, billing_notices,
  usage_counters, billing_events, payments, invoices, subscriptions, plans, api_keys, scope_items, scopes,
  catalog_materials, catalog_subjects, catalog_sources, catalog_versions, invitations, user_tokens, sessions,
  memberships, organizations, users CASCADE;
DROP SEQUENCE IF EXISTS invoice_number_seq;
DROP FUNCTION IF EXISTS catalog_materials_check_version();
DROP FUNCTION IF EXISTS set_updated_at();
DROP FUNCTION IF EXISTS app_rls_bypass();
DROP FUNCTION IF EXISTS app_current_user();
DROP FUNCTION IF EXISTS app_current_org();
`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  await sql.raw(UP + RLS).execute(db);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  await sql.raw(DOWN).execute(db);
}
