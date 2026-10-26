# Database design

PostgreSQL 16. Schema defined in migrations under `src/db/migrations/` (`0001_initial`, `0002_checkout_sessions`, `0003_catalog_verification`, `0004_catalog_notifications`, `0005_rate_limits`, `0006_ops_alerts`, `0007_students`, `0008_item_notes`, `0009_item_tracking`, `0010_due_reminders`, `0011_assignment_digest`, `0012_webhooks`)
(Kysely migrator, static registry in `src/db/migrator.ts`). TypeScript row types: `src/db/types.ts`.

## 1. Entity relationship diagram

```mermaid
erDiagram
  users ||--o{ memberships : "has"
  organizations ||--o{ memberships : "has"
  users ||--o{ sessions : "signs in"
  users ||--o{ user_tokens : "verify/reset"
  users ||--o{ notifications : "receives"
  users ||--o| students : "student account"
  organizations ||--o{ students : "enrols"
  scopes |o--o{ students : "curriculum"
  organizations ||--o{ invitations : "issues"
  organizations ||--|| subscriptions : "has one"
  plans ||--o{ subscriptions : "plan / pending plan"
  organizations ||--o{ invoices : "billed"
  plans ||--o{ invoices : "for"
  invoices ||--o{ payments : "paid by"
  invoices ||--o{ checkout_sessions : "checkout attempts"
  organizations ||--o{ usage_counters : "meters"
  organizations ||--o{ billing_notices : "dedupe"
  organizations ||--o{ api_keys : "owns"
  organizations ||--o{ support_access_grants : "grants"
  organizations ||--o{ scopes : "owns"
  catalog_versions ||--o{ catalog_sources : "cites"
  catalog_versions ||--o{ catalog_subjects : "contains"
  catalog_subjects ||--o{ catalog_materials : "lists"
  catalog_versions ||--o{ scopes : "targeted by"
  scopes ||--o{ scope_items : "selects"
  catalog_materials ||--o{ scope_items : "selected as"
  memberships |o--o{ scope_items : "assignee"
  scope_items ||--o{ item_reminders : "reminded about"
  memberships ||--o{ item_reminders : "reminded"
  scope_items ||--o{ assignment_digest_items : "waits in summary"
  memberships ||--o{ assignment_digest_items : "summary for"
  organizations ||--o{ webhook_endpoints : "tells"
  webhook_endpoints ||--o{ webhook_deliveries : "sends"
  organizations ||..o{ audit_logs : "org_id (no FK)"
  billing_events }o..o| organizations : "org_id (no FK)"
```

## 2. Tables

| Table | Purpose | Key constraints | RLS |
| --- | --- | --- | --- |
| `users` | Accounts | `kind` `staff`/`student` (never changes: trigger); `email` lower-case, unique, required for staff and absent for students (check `users_kind_identity`, which also forbids students from being platform admins or using MFA); status; MFA fields (secret AES-GCM encrypted); lockout counters; `trial_used`; `catalog_emails` (catalogue update emails opt-out); `assignment_emails` (emails when books are assigned) and `assignment_email_frequency` (`instant`, the default, or `daily` for one summary each morning); `due_reminder_emails` (due-date reminder emails) | — |
| `organizations` | Tenants | slug unique & pattern-checked; status `active/suspended` | — (read via membership) |
| `memberships` | User ↔ org with role | PK `(org_id, user_id)`; **partial unique index: one owner per org**; staff accounts only (trigger) | org **or** own user rows |
| `students` | School-created student accounts (`docs/STUDENT_ACCOUNTS.md`) | PK `user_id` (a `kind = 'student'` user: trigger); unique `(org_id, username)`; username pattern; grade 1–12; `(scope_id, org_id)` references `scopes(id, org_id)` with `ON DELETE SET NULL (scope_id)`; deleting the row deletes the account (trigger) | org **or** own user row |
| `classes` | A school's classes (`docs/CLASSROOM.md`) | name 1–60, unique per school among active classes (`lower(name)`); grade 1–12; optional curriculum `(scope_id, org_id)` → scopes (cleared if the scope is deleted); `archived_at` | ✓ (students: only their classes) |
| `class_students` | Class ↔ student | PK `(class_id, student_id)`; composite FKs keep class and student in the same school (`students_user_org_key`) | ✓ (students: own rows) |
| `class_teachers` | Class ↔ member teaching a subject | unique `(class_id, user_id, subject_en)`; FK `(org_id, user_id)` → memberships `ON DELETE CASCADE` | ✓ (students: their classes) |
| `homework` | Homework set for a class | title 1–200, instructions ≤ 5,000, `materials` JSONB copy (≤ 10 books), `publish_at` < `due_at`, `max_points` > 0 or null, `allow_late`, `notified_at` | ✓ (students: their classes, once published) |
| `homework_submissions` | A student's work on one homework | unique `(homework_id, student_id)`; `status` draft/submitted/returned; body ≤ 10,000; `points` ≥ 0; feedback ≤ 3,000; who marked and when; `returned_at` | ✓ (students: own rows) |
| `classroom_files` | Photos and PDFs on homework or submissions | exactly one of `homework_id`, `submission_id` (both composite FKs, cascade); type JPEG/PNG/WebP/PDF; 1 B–5 MB; SHA-256; `data bytea` | ✓ (students: files of visible homework and own work) |
| `tests` | Online tests and exams of a class (`docs/ONLINE_TESTS.md`) | subject (EN/AR); title 1–200; kind quiz/exam; status draft/published (`published_at` set exactly when published); `opens_at` < `closes_at`; time limit 1–600 min or null; attempts 1–10; shuffles; results after_submit/after_close/manual; `show_answers`; start code `^[A-Z2-9]{6}$` or null; `one_device`; `closed_early_at`; `max_extra_minutes` 0–600 (results and keys wait for it); `results_released_at`, `notified_at` | ✓ (students: published tests of their classes) |
| `test_questions` | Questions of a test | type single/multiple/true_false/short/essay; prompt 1–2,000; `options` JSONB ≤ 10; points > 0 (2 decimals); position | ✓ (students: only of tests they have started) |
| `test_question_keys` | The answer key of each question, apart from it | composite FK `(question_id, test_id, org_id)`, cascade | ✓ (students: only after the test is over for everyone, including extra time, with answers shown, results out, and they submitted) |
| `test_student_overrides` | One student's extra time and attempts on a test | PK `(test_id, student_id)`; extra minutes 0–600; extra attempts 0–10 | ✓ (students: own rows, read only) |
| `test_attempts` | A student's attempt | unique `(test_id, student_id, number)`; **one open attempt per student** (unique partial index); status in_progress/submitted (`submitted_at` set exactly when submitted); `deadline_at`; holding session; question and choice order; score, max points, needs marking, `marked_at`; `events_count` | ✓ (students: own rows) |
| `test_answers` | An answer | PK `(attempt_id, question_id)`; answer JSONB; automatic and teacher points ≥ 0; feedback ≤ 2,000 | ✓ (students: own; written only while the attempt is open) |
| `test_events` | What the test page noticed and what the teacher did | kind from a fixed list (started, left_page, paste, other_device, extra_time, time_up, …); `detail` JSONB (seconds, pasted length) | ✓ (students: own attempts) |
| `sessions` | Server-side sessions | id = SHA-256(token), 64 hex; state `active/mfa_pending`; `expires_at` | — |
| `user_tokens` | Email verification / password reset | `token_hash` unique; single use (`used_at`); expiry | — |
| `invitations` | Pending invites | `token_hash` unique; **one open invite per (org, email)**; role ≠ owner | ✓ |
| `catalog_versions` | Academic-year catalogue versions | status `draft/published/archived`; `grade_notes` JSONB | — (global) |
| `catalog_sources` | Citations per version | URL must be http(s) | — |
| `catalog_subjects` | Subject rows | unique `(version, grade, track, block, code)`; grade 1–12; track/status enums; verification columns (below) | — |
| `catalog_materials` | Selectable materials | unique `(subject, title)`; unique `(id, version_id)`; trigger keeps `version_id` = subject's; verification columns (below) | — |
| `scopes` | Content scopes (tenant data) | unique `(org_id, name)`; unique `(id, org_id, catalog_version_id)`; unique `(id, org_id)` (for students) | ✓ |
| `scope_items` | Selected materials, with the team's note and assignee | PK `(scope_id, material_id)`; composite FKs to scope (with org & version) and to material (with version); `note` 1–500 characters; `(org_id, assignee_id)` references `memberships`, so the assignee is a member of the same organization and is cleared (`ON DELETE SET NULL (assignee_id)`) when the membership ends; `status` (`todo`/`in_progress`/`done`) and `due_on` (a `date`, 2000–2100; read as `YYYY-MM-DD`, never as a time); `annotated_by`, `annotated_at`; partial index `scope_items_due_idx` on `due_on` for assigned books with a date (the reminder worker) | ✓ |
| `item_reminders` | Due-date reminders already sent, so none is repeated | PK `(scope_id, material_id, assignee_id, due_on, kind)`; `kind` `due_soon`/`overdue`; foreign keys to the selected book, the scope (with its org) and the assignee's membership, all `ON DELETE CASCADE`. A new due date or a new assignee is a new key, so it is reminded again; reopening a done book is not | ✓ |
| `assignment_digest_items` | Assignments waiting for the member's morning summary | PK `(user_id, scope_id, material_id)`; `assigned_by`, `assigned_at`; foreign keys to the selected book, the scope (with its org) and the membership, all `ON DELETE CASCADE`. The worker deletes the rows it sends. RLS: the organization, or the member themselves (read and delete only, so they can drop their own queue) | ✓ |
| `webhook_endpoints` | Customer systems told about scope changes | `url` (≤ 500), `description`, `events text[]`, `secret_enc` (AES-GCM with `DATA_ENCRYPTION_KEY`) and `secret_prefix` for display, `enabled`, `disabled_reason` (`failing`), `consecutive_failures`; unique `(id, org_id)` | ✓ |
| `webhook_deliveries` | Outbox of events per endpoint | `event_id` (the same for every endpoint and for redeliveries), `event_type`, `payload json` (kept as sent, since it is signed), `status` pending/delivered/failed, `attempts`, `next_attempt_at` (also the worker's 10-minute lease), `last_status_code`, `last_error`; FK `(endpoint_id, org_id)` → `webhook_endpoints` `ON DELETE CASCADE`; partial unique index on `(endpoint_id, coalesce_key)` while waiting for the first attempt, which merges quick changes to one scope | ✓ |
| `api_keys` | Read API keys | `key_hash` unique; revocable | ✓ |
| `plans` | Commercial plans | id pattern; prices ≥ 0; `limits`, `features` JSONB (`limits.max_students` is 0 on every plan: student accounts off) | — (global) |
| `subscriptions` | One row per org | unique `org_id`; status `trialing/active/past_due` with checks (trial → `trial_ends_at`, past_due → `grace_until`) | ✓ |
| `invoices` | Invoices | `number` unique (sequence `invoice_number_seq`); kind; status `open/paid/void` | ✓ |
| `payments` | Payment attempts | unique `(provider, provider_txn_id)` — idempotency | ✓ |
| `checkout_sessions` | Hosted-checkout attempts | unique `(provider, provider_ref)`; a callback's invoice is resolved from the signed provider reference (Paymob order id), not from the echoed merchant reference | ✓ |
| `billing_events` | Webhook receipts | unique `(provider, event_id)` — idempotency; normalized payload only | — (system only) |
| `usage_counters` | Monthly metering | PK `(org_id, metric, period)` | ✓ |
| `billing_notices` | Sent lifecycle notices (dedupe) | PK `(org_id, kind, ref)` | ✓ |
| `audit_logs` | Security & change history | bigint identity; indexes by org/time, action, actor; **app role has no UPDATE** | ✓ |
| `support_access_grants` | Customer-granted support windows | reason length; expiry; revocation | ✓ |
| `notifications` | In-app notifications | per user | — |
| `catalog_notices` | Organizations already told about an academic year's catalogue (dedupe) | PK `(org_id, kind, ref)`; ref = academic year | ✓ |
| `email_outbox` | Transactional email queue | partial index on pending | — |
| `worker_heartbeats` | Liveness of background workers | PK name | — |
| `ops_alerts` | State of each operational alert (firing / resolved, first and last seen, last notified), so only one app instance sends each message | PK `key`; counts only in `summary`/`details` | — (no tenant data) |
| `rate_limits` | Counters for route-specific rate limits, shared by app instances | PK `key` = HMAC of route and client key (no IPs or emails); UNLOGGED (counters restart after a crash) | — (no tenant data) |

Verification columns on `catalog_subjects` and `catalog_materials`: `verification_status`
(`unverified` / `verified` / `needs_review`), `verification_source`, `verification_url` (http/https),
`verification_note`, `reviewed_by` (user, `ON DELETE SET NULL`), `reviewed_at`. A CHECK keeps them
consistent: unverified rows carry no review data; verified rows need a source and date; rows needing
review need a note and date.

All timestamps are `timestamptz` (UTC). `updated_at` is maintained by the `set_updated_at()` trigger.
Primary keys are UUIDs (`gen_random_uuid()`), except `audit_logs` (bigint identity for ordering and cursor pagination).

### Indexes (selection)
- Lookups by token/key hash: `sessions(id)`, `user_tokens(token_hash)`, `invitations(token_hash)`, `api_keys(key_hash)` — unique.
- Tenant listing: `scopes(org_id, updated_at desc)`, `invoices(org_id, created_at desc)`, `invitations(org_id, created_at desc)`, `audit_logs(org_id, created_at desc)`.
- Worker scans: partial indexes `subscriptions(trial_ends_at) WHERE status='trialing'`, `subscriptions(current_period_end) WHERE status IN ('active','past_due')`, `email_outbox(send_after) WHERE status='pending'`.
- Catalogue rendering: `catalog_subjects(version_id, grade, sort_order)`, `catalog_materials(subject_id, sort_order)`.

## 3. Row-Level Security

Helper functions read transaction-local settings:
`app_current_org()`, `app_current_user()`, `app_rls_bypass()`.

```sql
CREATE POLICY scopes_isolation ON scopes
  USING (app_rls_bypass() OR org_id = app_current_org())
  WITH CHECK (app_rls_bypass() OR org_id = app_current_org());
-- memberships and students: USING also allows user_id = app_current_user()
```

Student requests (the student portal) also set `app.current_student` (`withStudentContext`,
`app_current_student()`, migration `0013`). The classroom tables then return only that student's
classes, published homework of those classes, their own submissions and the files of both, and refuse
their writes except to their own submissions and files; `students` returns only their own row. Staff
requests leave it empty and see the whole school, as before. For tests (migration `0014`) a student's
requests see published tests of their classes, questions only once they have started, answer keys only
after the test is over for everyone (including any extra time) with answers shown and results out, and only their own attempts, answers and
events; automatic marking reads the keys in the school's context after the student's transaction.

Settings are applied with `set_config(..., true)` (transaction-local), which is safe with
connection pooling. Tests prove: no rows without context; another tenant's context sees nothing;
cross-tenant `INSERT` is rejected; the app role cannot `UPDATE audit_logs` or `ALTER TABLE … DISABLE ROW LEVEL SECURITY`.

## 4. Database roles

| Role | Privileges | Used by |
| --- | --- | --- |
| Owner (`curriculum_owner`) | Owns schema objects | Migrations, seeding only (`MIGRATION_DATABASE_URL`) |
| App (`curriculum_app`) | `SELECT/INSERT/UPDATE/DELETE` on tables except no `UPDATE` on `audit_logs`; sequences; no `BYPASSRLS` | App and worker (`DATABASE_URL`) |
| Backup (`curriculum_backup`) | `pg_read_all_data` + `BYPASSRLS`, read-only | `scripts/backup.sh` |
| Superuser | Cluster administration | Restores (`scripts/restore.sh`) |

`npm run db:migrate` (or `node dist/db/migrate-cli.js up`) applies migrations and, when
`APP_DB_ROLE` is set, re-applies the app role's grants. Roles are created by
`deploy/postgres-init/01-roles.sh` (Docker) or manually on a managed database.

Why backups need their own role: `FORCE ROW LEVEL SECURITY` applies RLS to the owner too, so
`pg_dump` as the owner fails ("query would be affected by row-level security policy") — verified.

## 5. Migrations and seed data

| Command | Effect |
| --- | --- |
| `npm run db:migrate` | Apply pending migrations (owner connection) + grants |
| `npm run db:migrate:down` | Revert the latest migration (development only) |
| `npm run db:seed` | Plans + 2026/2027 catalogue + **demo users (development only; refused in production)** |
| `node dist/db/seed-cli.js --catalog-only` | Production-safe: plans (insert-only, never overwrites edited prices) + catalogue (only if that year is absent) |

Demo credentials come from `DEMO_PASSWORD` or are generated randomly and printed once; they
are never created when `NODE_ENV=production`.

## 6. Data retention

| Data | Retention | Mechanism |
| --- | --- | --- |
| Sessions | until expiry (≤ 30 d) or 7 d idle | worker cleanup hourly |
| Verification/reset tokens | 7 d after expiry/use | worker |
| Sent/failed emails | 30 d; bodies redacted immediately after delivery | worker |
| Read notifications | 180 d | worker |
| Expired unaccepted invitations | 90 d after expiry | worker |
| Rate-limit counters | until their window ends (≤ 1 h) | worker hourly |
| Resolved operational alerts | 90 d after resolution | worker |
| Due-date reminder records | 60 d after the due date | worker hourly |
| Assignments waiting for a daily summary | until the next morning's summary; 30 d at most | worker |
| Webhook deliveries (delivered or failed) | 30 d | worker hourly |
| Audit logs | `AUDIT_RETENTION_DAYS` (default 730 d); customers see their plan's window | worker |
| Billing records (invoices, payments, events) | Kept (financial records) — define the legal period with your accountant | none (manual) |
| Deleted organizations | Tenant rows removed immediately (cascade), student accounts included; the deletion audit entry is kept | API |
| Student accounts | Until the school removes the student or deletes the organization; then the account, its sessions and notifications are deleted | API (trigger `students_delete_account`) |
| Backups | `RETENTION_DAYS` (default 14 d locally) + off-site policy | `scripts/backup.sh` |

## 7. Backups

See DEPLOYMENT_GUIDE.md §Backups. Daily logical dumps (custom format) by the backup role,
optional GPG encryption, SHA-256 checksum, local retention; `scripts/verify-backup.sh` restores into
a scratch database and checks migrations, row counts, RLS flags and invariants. For point-in-time
recovery use a managed PostgreSQL service with WAL archiving.
