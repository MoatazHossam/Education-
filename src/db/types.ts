import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type NullableTimestamp = ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
type Json<T> = ColumnType<T, string | T | undefined, string | T>;

export type Role = 'owner' | 'admin' | 'editor' | 'viewer';
export type Locale = 'en' | 'ar';
export type Track = 'moe' | 'sec' | 'bac' | 'ta' | 'intl';
export type SubjectStatus = 'scored' | 'pass' | 'act';
export type MaterialKind = 'moe' | 'lang' | 'ext' | 'prog' | 'exam';
export type VerificationStatus = 'unverified' | 'verified' | 'needs_review';
export type ItemStatus = 'todo' | 'in_progress' | 'done';

/** Editorial verification columns shared by catalogue subjects and materials. */
interface VerificationColumns {
  verification_status: Generated<VerificationStatus>;
  verification_source: string | null;
  verification_url: string | null;
  verification_note: string | null;
  reviewed_by: string | null;
  reviewed_at: Date | null;
}
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due';
export type BillingInterval = 'month' | 'year';

export interface PlanLimits {
  max_members: number | null;
  max_scopes: number | null;
  exports_per_month: number | null;
  api_requests_per_month: number | null;
  audit_log_days: number;
  /** Student accounts the school can create; 0 keeps the student portal off. */
  max_students: number | null;
}

export interface PlanFeatures {
  export_csv: boolean;
  export_json: boolean;
  api_access: boolean;
  require_mfa_policy: boolean;
  priority_support: boolean;
}

export type UserKind = 'staff' | 'student';

export interface UsersTable {
  id: Generated<string>;
  kind: Generated<UserKind>;
  /** Always set for staff; always null for students (database constraint users_kind_identity). */
  email: string | null;
  name: string;
  password_hash: string;
  locale: Generated<Locale>;
  status: Generated<'active' | 'suspended'>;
  is_platform_admin: Generated<boolean>;
  email_verified_at: NullableTimestamp;
  mfa_enabled: Generated<boolean>;
  mfa_secret_enc: string | null;
  mfa_pending_secret_enc: string | null;
  mfa_last_step: ColumnType<string | null, string | number | null | undefined, string | number | null>;
  mfa_recovery_hashes: Generated<string[]>;
  failed_login_count: Generated<number>;
  locked_until: NullableTimestamp;
  last_login_at: NullableTimestamp;
  password_changed_at: Generated<Date>;
  trial_used: Generated<boolean>;
  catalog_emails: Generated<boolean>;
  assignment_emails: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface OrganizationsTable {
  id: Generated<string>;
  name: string;
  slug: string;
  status: Generated<'active' | 'suspended'>;
  suspended_reason: string | null;
  locale: Generated<Locale>;
  require_mfa_for_admins: Generated<boolean>;
  created_by: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface MembershipsTable {
  org_id: string;
  user_id: string;
  role: Role;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface SessionsTable {
  id: string;
  user_id: string;
  state: 'active' | 'mfa_pending';
  mfa_verified: Generated<boolean>;
  ip: string | null;
  user_agent: string | null;
  created_at: Generated<Date>;
  last_seen_at: Generated<Date>;
  expires_at: Timestamp;
}

export interface UserTokensTable {
  id: Generated<string>;
  user_id: string;
  purpose: 'verify_email' | 'reset_password';
  token_hash: string;
  expires_at: Timestamp;
  used_at: NullableTimestamp;
  created_at: Generated<Date>;
}

export interface StudentsTable {
  user_id: string;
  org_id: string;
  username: string;
  grade: number;
  scope_id: string | null;
  created_by: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface InvitationsTable {
  id: Generated<string>;
  org_id: string;
  email: string;
  role: Exclude<Role, 'owner'>;
  token_hash: string;
  invited_by: string | null;
  expires_at: Timestamp;
  accepted_at: NullableTimestamp;
  accepted_by: string | null;
  revoked_at: NullableTimestamp;
  created_at: Generated<Date>;
}

export interface CatalogVersionsTable {
  id: Generated<string>;
  academic_year: string;
  label: string;
  status: Generated<'draft' | 'published' | 'archived'>;
  notice: string | null;
  grade_notes: Json<Record<string, string>>;
  published_at: NullableTimestamp;
  created_by: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface CatalogSourcesTable {
  id: Generated<string>;
  version_id: string;
  title: string;
  url: string;
  sort_order: Generated<number>;
}

export interface CatalogSubjectsTable extends VerificationColumns {
  id: Generated<string>;
  version_id: string;
  grade: number;
  track: Track;
  block: string;
  code: string;
  name_en: string;
  name_ar: string;
  status: SubjectStatus;
  note: string | null;
  sort_order: Generated<number>;
}

export interface CatalogMaterialsTable extends VerificationColumns {
  id: Generated<string>;
  subject_id: string;
  version_id: string;
  kind: MaterialKind;
  title: string;
  sort_order: Generated<number>;
}

export interface ScopesTable {
  id: Generated<string>;
  org_id: string;
  catalog_version_id: string;
  name: string;
  description: string | null;
  created_by: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ScopeItemsTable {
  scope_id: string;
  org_id: string;
  catalog_version_id: string;
  material_id: string;
  added_by: string | null;
  added_at: Generated<Date>;
  /** Short note on the selected book (1–500 characters). */
  note: string | null;
  /** Member responsible for the book; a membership of the same organization. */
  assignee_id: string | null;
  annotated_by: string | null;
  annotated_at: NullableTimestamp;
  status: ItemStatus | null;
  /** Due date (a calendar day, returned as YYYY-MM-DD). */
  due_on: ColumnType<string | null, string | null | undefined, string | null>;
}

export interface ApiKeysTable {
  id: Generated<string>;
  org_id: string;
  name: string;
  prefix: string;
  key_hash: string;
  created_by: string | null;
  created_at: Generated<Date>;
  last_used_at: NullableTimestamp;
  revoked_at: NullableTimestamp;
}

export interface PlansTable {
  id: string;
  name: string;
  description: string | null;
  price_monthly_cents: number;
  price_yearly_cents: number | null;
  currency: string;
  limits: Json<PlanLimits>;
  features: Json<PlanFeatures>;
  is_public: Generated<boolean>;
  is_self_serve: Generated<boolean>;
  active: Generated<boolean>;
  sort_order: Generated<number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface SubscriptionsTable {
  id: Generated<string>;
  org_id: string;
  plan_id: string;
  billing_interval: Generated<BillingInterval>;
  status: SubscriptionStatus;
  trial_ends_at: NullableTimestamp;
  current_period_start: NullableTimestamp;
  current_period_end: NullableTimestamp;
  cancel_at_period_end: Generated<boolean>;
  canceled_at: NullableTimestamp;
  grace_until: NullableTimestamp;
  pending_plan_id: string | null;
  pending_interval: BillingInterval | null;
  limit_overrides: Json<Partial<PlanLimits>>;
  provider: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface InvoicesTable {
  id: Generated<string>;
  org_id: string;
  number: string;
  kind: 'subscription' | 'renewal' | 'upgrade' | 'manual';
  plan_id: string;
  billing_interval: BillingInterval;
  amount_cents: number;
  currency: string;
  status: Generated<'open' | 'paid' | 'void'>;
  period_start: NullableTimestamp;
  period_end: NullableTimestamp;
  due_at: NullableTimestamp;
  provider: string | null;
  provider_ref: string | null;
  paid_at: NullableTimestamp;
  voided_at: NullableTimestamp;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface PaymentsTable {
  id: Generated<string>;
  org_id: string;
  invoice_id: string;
  provider: string;
  provider_txn_id: string;
  amount_cents: number;
  currency: string;
  status: 'succeeded' | 'failed';
  failure_reason: string | null;
  created_at: Generated<Date>;
}

export interface CheckoutSessionsTable {
  id: Generated<string>;
  org_id: string;
  invoice_id: string;
  provider: string;
  provider_ref: string;
  created_at: Generated<Date>;
}

export interface CatalogNoticesTable {
  org_id: string;
  kind: string;
  ref: string;
  sent_at: Generated<Date>;
}

export interface BillingEventsTable {
  id: Generated<string>;
  provider: string;
  event_id: string;
  event_type: string;
  org_id: string | null;
  payload: Json<unknown>;
  status: 'processed' | 'ignored' | 'failed';
  error: string | null;
  received_at: Generated<Date>;
  processed_at: NullableTimestamp;
}

export interface UsageCountersTable {
  org_id: string;
  metric: 'exports' | 'api_requests';
  period: string;
  quantity: Generated<number>;
  updated_at: Generated<Date>;
}

export interface BillingNoticesTable {
  org_id: string;
  kind: string;
  ref: string;
  sent_at: Generated<Date>;
}

export interface AuditLogsTable {
  id: Generated<string>;
  org_id: string | null;
  actor_user_id: string | null;
  actor_email: string | null;
  actor_type: 'user' | 'platform_admin' | 'system' | 'api_key' | 'anonymous';
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Json<Record<string, unknown>>;
  ip: string | null;
  user_agent: string | null;
  created_at: Generated<Date>;
}

export interface SupportAccessGrantsTable {
  id: Generated<string>;
  org_id: string;
  granted_by: string | null;
  reason: string;
  expires_at: Timestamp;
  revoked_at: NullableTimestamp;
  created_at: Generated<Date>;
}

export interface NotificationsTable {
  id: Generated<string>;
  user_id: string;
  org_id: string | null;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  read_at: NullableTimestamp;
  created_at: Generated<Date>;
}

export interface EmailOutboxTable {
  id: Generated<string>;
  to_email: string;
  template: string;
  subject: string;
  text_body: string;
  status: Generated<'pending' | 'sent' | 'failed'>;
  attempts: Generated<number>;
  last_error: string | null;
  send_after: Generated<Date>;
  created_at: Generated<Date>;
  sent_at: NullableTimestamp;
}

export interface WorkerHeartbeatsTable {
  name: string;
  last_beat_at: Timestamp;
  details: Json<Record<string, unknown>>;
}

export interface RateLimitsTable {
  key: string;
  count: number;
  expires_at: Timestamp;
}

export interface OpsAlertsTable {
  key: string;
  status: 'firing' | 'resolved';
  summary: string;
  details: Json<Record<string, unknown>>;
  first_seen_at: Timestamp;
  last_seen_at: Timestamp;
  notified_at: Timestamp;
  resolved_at: NullableTimestamp;
}

export interface DB {
  users: UsersTable;
  organizations: OrganizationsTable;
  memberships: MembershipsTable;
  sessions: SessionsTable;
  students: StudentsTable;
  user_tokens: UserTokensTable;
  invitations: InvitationsTable;
  catalog_versions: CatalogVersionsTable;
  catalog_sources: CatalogSourcesTable;
  catalog_subjects: CatalogSubjectsTable;
  catalog_materials: CatalogMaterialsTable;
  scopes: ScopesTable;
  scope_items: ScopeItemsTable;
  api_keys: ApiKeysTable;
  plans: PlansTable;
  subscriptions: SubscriptionsTable;
  invoices: InvoicesTable;
  payments: PaymentsTable;
  checkout_sessions: CheckoutSessionsTable;
  catalog_notices: CatalogNoticesTable;
  billing_events: BillingEventsTable;
  usage_counters: UsageCountersTable;
  billing_notices: BillingNoticesTable;
  audit_logs: AuditLogsTable;
  support_access_grants: SupportAccessGrantsTable;
  notifications: NotificationsTable;
  email_outbox: EmailOutboxTable;
  worker_heartbeats: WorkerHeartbeatsTable;
  rate_limits: RateLimitsTable;
  ops_alerts: OpsAlertsTable;
}

export type User = Selectable<UsersTable>;
/** A staff account: signs in with an email address and may hold memberships. */
export type StaffUser = User & { kind: 'staff'; email: string };
export type Student = Selectable<StudentsTable>;
export type Organization = Selectable<OrganizationsTable>;
export type Session = Selectable<SessionsTable>;
export type Plan = Selectable<PlansTable>;
export type Subscription = Selectable<SubscriptionsTable>;
export type Invoice = Selectable<InvoicesTable>;
export type NewUser = Insertable<UsersTable>;
export type UserUpdate = Updateable<UsersTable>;
