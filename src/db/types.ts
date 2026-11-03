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
  /** Classroom files (homework and submissions) per school, in MB. Not set on a plan: 1024. */
  max_storage_mb?: number | null;
  /** Requests to the AI provider per month (docs/AI_LAYER.md). Not set on a plan: 0, AI off. */
  ai_requests_per_month?: number | null;
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
  due_reminder_emails: Generated<boolean>;
  /** How assignment emails arrive: right away, or in one summary each morning. */
  assignment_email_frequency: Generated<AssignmentEmailFrequency>;
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

export type ReminderKind = 'due_soon' | 'overdue';

/** A customer system told about scope changes (migration 0012). */
export interface WebhookEndpointsTable {
  id: Generated<string>;
  org_id: string;
  url: string;
  description: string | null;
  events: string[];
  /** Signing secret, AES-GCM encrypted with DATA_ENCRYPTION_KEY (it is needed to sign). */
  secret_enc: string;
  secret_prefix: string;
  enabled: Generated<boolean>;
  disabled_reason: 'failing' | null;
  consecutive_failures: Generated<number>;
  created_by: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface WebhookDeliveriesTable {
  id: Generated<string>;
  org_id: string;
  endpoint_id: string;
  event_id: string;
  event_type: string;
  payload: Json<Record<string, unknown>>;
  coalesce_key: string | null;
  status: Generated<'pending' | 'delivered' | 'failed'>;
  attempts: Generated<number>;
  next_attempt_at: Generated<Date>;
  last_status_code: number | null;
  last_error: string | null;
  created_at: Generated<Date>;
  delivered_at: NullableTimestamp;
}
export type AssignmentEmailFrequency = 'instant' | 'daily';

/** An assignment waiting for the member's morning summary. */
export interface AssignmentDigestItemsTable {
  org_id: string;
  user_id: string;
  scope_id: string;
  material_id: string;
  assigned_by: string | null;
  assigned_at: Generated<Date>;
}

/** One reminder the worker sent for a book, its assignee and its due date (never repeated). */
export interface ItemRemindersTable {
  org_id: string;
  scope_id: string;
  material_id: string;
  assignee_id: string;
  due_on: string;
  kind: ReminderKind;
  sent_at: Generated<Date>;
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

export type UsageMetric = 'exports' | 'api_requests' | 'ai_requests';

export interface UsageCountersTable {
  org_id: string;
  metric: UsageMetric;
  period: string;
  quantity: Generated<number>;
  updated_at: Generated<Date>;
}

export interface AiRequestsTable {
  id: Generated<string>;
  org_id: string;
  user_id: string | null;
  feature: string;
  provider: 'gemini' | 'anthropic' | 'openai';
  model: string;
  status: 'ok' | 'refused' | 'invalid_output' | 'too_long' | 'failed';
  error_kind: 'auth' | 'rate_limited' | 'unavailable' | 'timeout' | 'bad_request' | 'other' | null;
  attempts: Generated<number>;
  input_tokens: number | null;
  output_tokens: number | null;
  duration_ms: number;
  created_at: Generated<Date>;
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

// ---------------------------------------------------------------- classes and homework (docs/CLASSROOM.md)
/** numeric columns arrive as strings (exact decimals); write numbers or strings. */
type NullableDecimal = ColumnType<string | null, number | string | null | undefined, number | string | null>;

export interface ClassesTable {
  id: Generated<string>;
  org_id: string;
  name: string;
  grade: number;
  scope_id: string | null;
  archived_at: NullableTimestamp;
  created_by: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ClassStudentsTable {
  class_id: string;
  org_id: string;
  student_id: string;
  added_at: Generated<Date>;
}

export interface ClassTeachersTable {
  id: Generated<string>;
  class_id: string;
  org_id: string;
  user_id: string;
  subject_en: string;
  subject_ar: string;
  created_at: Generated<Date>;
}

export interface HomeworkMaterial {
  id: string;
  kind: MaterialKind;
  title: string;
}

export interface HomeworkTable {
  id: Generated<string>;
  org_id: string;
  class_id: string;
  subject_en: string;
  subject_ar: string;
  title: string;
  instructions: Generated<string>;
  materials: Json<HomeworkMaterial[]>;
  publish_at: Timestamp;
  due_at: Timestamp;
  max_points: NullableDecimal;
  allow_late: Generated<boolean>;
  notified_at: NullableTimestamp;
  /** Students' work was deleted under the school's retention periods (migration 0015). */
  work_removed_at: NullableTimestamp;
  /** Kept whatever the retention periods say, until an admin lifts the hold. */
  retention_hold: Generated<boolean>;
  created_by: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export type SubmissionStatus = 'draft' | 'submitted' | 'returned';

export interface HomeworkSubmissionsTable {
  id: Generated<string>;
  org_id: string;
  homework_id: string;
  student_id: string;
  body: Generated<string>;
  status: Generated<SubmissionStatus>;
  submitted_at: NullableTimestamp;
  late: Generated<boolean>;
  points: NullableDecimal;
  feedback: string | null;
  graded_by: string | null;
  graded_at: NullableTimestamp;
  returned_at: NullableTimestamp;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export type ClassroomFileType = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';

/** docs/CLASSROOM.md §5: checked by the worker before anyone can open it. */
export type ClassroomFileStatus = 'pending' | 'ready' | 'infected' | 'unreadable';

export interface ClassroomFilesTable {
  id: Generated<string>;
  org_id: string;
  homework_id: string | null;
  submission_id: string | null;
  name: string;
  content_type: ClassroomFileType;
  size_bytes: number;
  sha256: string;
  /** Null once the file is blocked (infected or unreadable). */
  data: Buffer | null;
  uploaded_by: string | null;
  created_at: Generated<Date>;
  status: Generated<ClassroomFileStatus>;
  scanned_at: Date | null;
  virus_name: string | null;
  /** Set when a photo was resized or re-encoded: its size as uploaded. */
  original_size_bytes: number | null;
  check_attempts: Generated<number>;
  check_error: string | null;
  checked_at: Date | null;
}

// ---------------------------------------------------------------- online tests and exams (docs/ONLINE_TESTS.md)
export type QuestionType = 'single' | 'multiple' | 'true_false' | 'short' | 'essay';
export type ResultsMode = 'after_submit' | 'after_close' | 'manual';
export interface QuestionOption {
  id: string;
  text: string;
}
/** single: ["a"]; multiple: ["a","c"]; true_false: boolean; short: accepted answers; essay: a marking guide. */
export type AnswerKey = string[] | boolean | { guide: string | null };
/** single: "a"; multiple: ["a","c"]; true_false: boolean; short and essay: text. */
export type GivenAnswer = string | string[] | boolean;

export interface TestsTable {
  id: Generated<string>;
  org_id: string;
  class_id: string;
  subject_en: string;
  subject_ar: string;
  title: string;
  instructions: Generated<string>;
  kind: Generated<'quiz' | 'exam'>;
  status: Generated<'draft' | 'published'>;
  opens_at: Timestamp;
  closes_at: Timestamp;
  duration_minutes: number | null;
  max_attempts: Generated<number>;
  shuffle_questions: Generated<boolean>;
  shuffle_options: Generated<boolean>;
  results: Generated<ResultsMode>;
  show_answers: Generated<boolean>;
  results_released_at: NullableTimestamp;
  access_code: string | null;
  one_device: Generated<boolean>;
  closed_early_at: NullableTimestamp;
  max_extra_minutes: Generated<number>;
  published_at: NullableTimestamp;
  notified_at: NullableTimestamp;
  /** Students' answers were deleted under the school's retention periods (migration 0015). */
  work_removed_at: NullableTimestamp;
  /** The monitoring events were deleted under the school's retention periods. */
  monitoring_removed_at: NullableTimestamp;
  retention_hold: Generated<boolean>;
  created_by: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface TestQuestionsTable {
  id: Generated<string>;
  org_id: string;
  test_id: string;
  position: number;
  type: QuestionType;
  prompt: string;
  options: Json<QuestionOption[]>;
  points: ColumnType<string, number | string, number | string>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface TestQuestionKeysTable {
  question_id: string;
  org_id: string;
  test_id: string;
  key: Json<AnswerKey>;
}

export interface TestStudentOverridesTable {
  test_id: string;
  org_id: string;
  student_id: string;
  extra_minutes: Generated<number>;
  extra_attempts: Generated<number>;
  updated_at: Generated<Date>;
}

export interface TestAttemptsTable {
  id: Generated<string>;
  org_id: string;
  test_id: string;
  student_id: string;
  number: number;
  status: Generated<'in_progress' | 'submitted'>;
  started_at: Generated<Date>;
  deadline_at: Timestamp;
  extra_minutes: Generated<number>;
  submitted_at: NullableTimestamp;
  submit_reason: 'student' | 'time' | 'teacher' | 'closed' | null;
  session_id: string | null;
  question_order: Json<string[]>;
  option_order: Json<Record<string, string[]>>;
  last_seen_at: Generated<Date>;
  max_points: ColumnType<string, number | string, number | string>;
  auto_points: NullableDecimal;
  manual_points: NullableDecimal;
  score: NullableDecimal;
  needs_marking: Generated<boolean>;
  marked_at: NullableTimestamp;
  events_count: Generated<number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface TestAnswersTable {
  attempt_id: string;
  org_id: string;
  question_id: string;
  answer: Json<GivenAnswer>;
  saved_at: Generated<Date>;
  auto_points: NullableDecimal;
  manual_points: NullableDecimal;
  feedback: string | null;
}

export type TestEventKind = 'started' | 'resumed' | 'left_page' | 'returned' | 'paste' | 'offline' | 'online' | 'other_device' | 'device_allowed' | 'extra_time' | 'forced_submit' | 'time_up' | 'closed' | 'submitted';

export interface TestEventsTable {
  id: Generated<string>;
  org_id: string;
  attempt_id: string;
  kind: TestEventKind;
  at: Generated<Date>;
  detail: Json<Record<string, unknown>>;
}

// ---------------------------------------------------------------- classroom data retention (migration 0015)
export type RetentionStage = 'monitoring' | 'work' | 'records';

export interface ClassroomRetentionTable {
  org_id: string;
  monitoring_days: number | null;
  work_days: number | null;
  records_days: number | null;
  updated_by: string | null;
  updated_at: Generated<Date>;
}

export interface ClassroomRetentionNoticesTable {
  id: Generated<string>;
  org_id: string;
  homework_id: string | null;
  test_id: string | null;
  item_id: ColumnType<string, never, never>;
  stage: RetentionStage;
  delete_after: Timestamp;
  notified_at: Generated<Date>;
}

// ---------------------------------------------------------------- teaching plans (migration 0018)
export type TeachingPlanKind = 'lesson' | 'pacing';

export interface TeachingPlansTable {
  id: Generated<string>;
  org_id: string;
  scope_id: string;
  kind: TeachingPlanKind;
  grade: number;
  subject_en: string;
  subject_ar: string;
  title: string;
  language: 'ar' | 'en';
  /** The plan, checked by src/scopes/plans.ts (LessonContent or PacingContent). */
  content: Json<Record<string, unknown>>;
  ai_assisted: Generated<boolean>;
  created_by: string | null;
  updated_by: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface DB {
  users: UsersTable;
  organizations: OrganizationsTable;
  memberships: MembershipsTable;
  sessions: SessionsTable;
  students: StudentsTable;
  classes: ClassesTable;
  class_students: ClassStudentsTable;
  class_teachers: ClassTeachersTable;
  homework: HomeworkTable;
  homework_submissions: HomeworkSubmissionsTable;
  classroom_files: ClassroomFilesTable;
  tests: TestsTable;
  test_questions: TestQuestionsTable;
  test_question_keys: TestQuestionKeysTable;
  test_student_overrides: TestStudentOverridesTable;
  test_attempts: TestAttemptsTable;
  test_answers: TestAnswersTable;
  test_events: TestEventsTable;
  classroom_retention: ClassroomRetentionTable;
  classroom_retention_notices: ClassroomRetentionNoticesTable;
  user_tokens: UserTokensTable;
  invitations: InvitationsTable;
  catalog_versions: CatalogVersionsTable;
  catalog_sources: CatalogSourcesTable;
  catalog_subjects: CatalogSubjectsTable;
  catalog_materials: CatalogMaterialsTable;
  scopes: ScopesTable;
  scope_items: ScopeItemsTable;
  teaching_plans: TeachingPlansTable;
  item_reminders: ItemRemindersTable;
  assignment_digest_items: AssignmentDigestItemsTable;
  webhook_endpoints: WebhookEndpointsTable;
  webhook_deliveries: WebhookDeliveriesTable;
  api_keys: ApiKeysTable;
  plans: PlansTable;
  subscriptions: SubscriptionsTable;
  invoices: InvoicesTable;
  payments: PaymentsTable;
  checkout_sessions: CheckoutSessionsTable;
  catalog_notices: CatalogNoticesTable;
  billing_events: BillingEventsTable;
  usage_counters: UsageCountersTable;
  ai_requests: AiRequestsTable;
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
export type SchoolClass = Selectable<ClassesTable>;
export type Homework = Selectable<HomeworkTable>;
export type HomeworkSubmission = Selectable<HomeworkSubmissionsTable>;
export type Test = Selectable<TestsTable>;
export type TestQuestion = Selectable<TestQuestionsTable>;
export type TestAttempt = Selectable<TestAttemptsTable>;
export type Organization = Selectable<OrganizationsTable>;
export type Session = Selectable<SessionsTable>;
export type Plan = Selectable<PlansTable>;
export type Subscription = Selectable<SubscriptionsTable>;
export type Invoice = Selectable<InvoicesTable>;
export type NewUser = Insertable<UsersTable>;
export type UserUpdate = Updateable<UsersTable>;
