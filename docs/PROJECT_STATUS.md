# Project status

**Overall classification: NOT PRODUCTION READY.**
The application is functionally complete and tested locally, but several Definition-of-Done
conditions are unverified or blocked (real payment provider, production deployment, monitoring
and alerts, legal/privacy review, catalogue data verification).

Last updated: 2026-10-25. Branch: `claude/friendly-rubin-hmemjl`.
Status values: COMPLETE · PARTIALLY COMPLETE · NOT STARTED · BLOCKED · NOT VERIFIED.

## 1. Blockers and external dependencies

| ID | Blocker | Impact | Needed from |
| --- | --- | --- | --- |
| B-1 | ~~`git push` refused with HTTP 403~~ — **resolved 2026-10-22**: access granted, branch `claude/friendly-rubin-hmemjl` pushed and `main` created from it. | — | — |
| B-2 | No Paymob keys | Adapter is contract-tested but has not been run against Paymob; real billing impossible | Business: Paymob account — test-mode keys now (for `npm run paymob:check`), live keys after Paymob's merchant verification |
| B-3 | Company registration country / tax position undecided | Provider choice, VAT on invoices, ETA e-invoicing | Founder + accountant |
| B-4 | No production host, domain, SMTP account | No deployment, TLS, real email, monitoring | Ops budget/accounts |
| B-5 | Legal review not done (PDPL licensing, privacy policy, terms, hosting location) | Cannot onboard paying customers responsibly | Legal counsel |
| B-7 | GitHub Actions jobs are rejected: "your account is locked due to a billing issue" (runs on 2026-10-22 and 2026-10-23) | No CI on GitHub; use `scripts/ci-local.sh` meanwhile | Account owner: resolve billing on the account that owns the repository |
| B-6 | Catalogue content unverified (sourced from news articles in the original). Tools to record verification now exist (Platform admin → Catalogue: one by one, per grade, or a whole spreadsheet); 0 of 231 subjects verified so far | Product value and liability | Curriculum specialist |
| B-8 | Wise EduAgent (`wise-eduagent.ai.studio`) cannot be inspected: the environment's network policy denies the host and no source export exists in the session | The Wise integration cannot go beyond documentation (`docs/wise-integration/`) | Owner: AI Studio source export, and/or allow the host in the environment's network settings with an authorized test account |
| B-9 | ~~The product stores no student records by design~~ — **owner decided 2026-10-25: student accounts created by schools.** Built and off for every school (see student accounts). Still open: the legal assessment for minors' data (SECURITY_DESIGN §7) | No school should use student accounts with real students until the assessment is done | Legal counsel (consent, controller/processor terms with schools, retention, privacy notice) |
| B-10 | No AI provider chosen | The Wise EduAgent features (assistant etc.) cannot be built | Owner: provider and model, who holds the key and pays for usage |

## 2. Deliverables

### Phase 0 — Discovery · COMPLETE
- **Implemented:** artifact source obtained and preserved; executed its data code; feature inventory; 7 defects identified.
- **Files:** `legacy/`, `docs/PRODUCT_OVERVIEW.md`, `docs/CURRENT_STATE_ASSESSMENT.md`, `docs/FEATURE_INVENTORY.md`, `docs/GAP_ANALYSIS.md`.
- **Tests:** `tests/unit/catalog-fidelity.test.ts` (3) — pass.
- **Limitations:** the artifact was only available as a rendered page; no earlier project history exists.

### Phase 1 — Foundation · COMPLETE
- **Implemented:** TypeScript/Fastify app, Zod config with production guards, PostgreSQL schema (25 tables at the time; 30 with later migrations) with RLS and composite keys, Kysely migrator, role split (owner/app/backup), seed, health/readiness.
- **Files:** `src/app.ts`, `src/config.ts`, `src/db/*`, `src/http/*`, `package.json`, `tsconfig*.json`, `eslint.config.js`.
- **Tests:** RLS proofs in `tenancy.test.ts`; config tests; health tests — pass.

### Phase 2 — Core application · COMPLETE
- **Implemented:** catalogue service/API with ETag and caching; content scopes (CRUD, batched items, duplicate, clear); TXT/CSV/JSON export; read API with API keys; picker UI faithful to the original backed by scopes; fixes for original defects D-01–D-07.
- **Files:** `src/catalog/*`, `src/scopes/*`, `src/api-v1/*`, `public/js/views/picker.js`, `public/js/views/scopes.js`.
- **Tests:** `scopes.test.ts` (10), API tests in `admin-api-ops.test.ts`, E2E 1, 6 — pass.
- **Next:** manual screen-reader review; Firefox/WebKit E2E (Roadmap P1); set alert channels and an external uptime check when the host exists (B-4).

### Notes and assignees on selected books · COMPLETE
- **Implemented:** a short note (up to 500 characters) on any selected book of a scope, and the organization member responsible for it, e.g. "waiting for the 2027 edition", assigned to whoever follows it up.
  - A **Notes and assignees** page per scope (from the picker's scope bar and a new column in the scopes list). It shows counts (selected, with a note, assigned, assigned to you) and filters: assigned to me, with a note, assigned, not assigned, by grade, and by text. Editors edit a book's note and assignee in a dialog, or tick several books and assign them at once. Viewers read.
  - A new assignee other than yourself gets an in-app notification in their language, once per change. It links to the page filtered to their books.
  - In the picker, annotated books carry a mark (read out as "has a note" or "assigned to …"). Deselecting one asks first, because its note goes with it.
  - The assignee must be a member of the organization: the database references memberships, so removing a member clears their assignments and keeps the notes.
  - Notes and assignees are kept when a scope is duplicated and follow their books when it is carried to another year. The carry review says how many follow and how many are on books that cannot be carried.
  - CSV exports gain `note` and `assignee` columns at the end, so existing column positions do not move. JSON exports and the read API carry the same fields; the TXT export keeps the original layout.
  - Audited as `scope.item_annotated` and `scope.items_assigned`, with which fields changed but never the note's text. Read-only scopes (over the plan limit) cannot be annotated.
- **Files:** `src/db/migrations/0008_item_notes.ts`, `src/scopes/{notes,routes,export}.ts`, `src/api-v1/routes.ts`, `public/js/views/{items,picker,scopes,carry}.js`, `public/js/main.js`, `public/js/i18n.js`, `public/app.css`.
- **Tests:** `scope-notes.test.ts` (14) and a new unit test for the CSV columns. E2E journey 14: an editor joins, the owner writes a note and assigns two books at once, the editor is notified and opens a list of exactly their books, the scopes list counts them, and the picker asks before dropping an annotated book. The accessibility audit adds 6 screens (the page, its dialog, Arabic, dark, phone) with 0 findings. All pass.
- **Limitations:** see the follow-ups below.

### Notes follow-ups: status, due dates, assignment emails, My assignments · COMPLETE
- **Implemented:**
  - **Status and due date per book:** To do, In progress or Done, and an optional due date. They are set in the note dialog or for several books at once: the bulk bar now changes the assignee, status and/or due date, and fields left on "Keep as it is" are not sent. A book past its due date that is not done shows as **overdue**, in words, not only by colour. The notes page gains a Progress column, an Overdue count, and filters for not done, overdue and done.
  - **The assignee updates the status:** the member a book is assigned to can change its status even as a viewer, and nothing else (checked by the API).
  - **My assignments** (`/org/:orgId/assignments`): every book assigned to you across the organization's scopes, overdue first, then by due date. Each row links to its scope and has a status select. The navigation shows "My assignments (n)" with the number not done yet.
  - **Assignment email:** a new assignee also gets an email listing the books (up to 10, then "and N more"), in their language, with a link and an opt-out. "Email me when books are assigned to me" is in the account settings and on by default, like catalogue emails. People assigning themselves get nothing.
  - Status and due date are kept on duplicate and on carry-forward. Exports gain `status` and `due_on` at the end of the CSV, and `status` and `dueOn` in JSON and the read API.
  - Due dates are calendar days: stored as `date` and returned as `YYYY-MM-DD`, never as a time. "Overdue" uses Cairo's date on the server and the browser's date on screen.
- **Files:** `src/db/migrations/0009_item_tracking.ts`, `src/db/index.ts`, `src/scopes/{notes,routes,export}.ts`, `src/orgs/routes.ts`, `src/auth/routes.ts`, `src/notifications/email.ts`, `public/js/views/{items,assignments,account,shell,picker}.js`, `public/js/main.js`, `public/js/i18n.js`, `public/app.css`.
- **Tests:** `scope-notes.test.ts` now has 21 tests (7 new):
  - status and due date validation;
  - the assignee-viewer rule;
  - bulk status and due date;
  - emails in Arabic, the opt-out, and none for self-assignment;
  - a shortened list for 13 books;
  - My assignments ordering, filters and counts;
  - status and due date in duplicates, carry-forward and exports.

  The CSV unit test was updated. E2E journey 15 (it reuses journey 14's school, since sign-ups are limited to 10 an hour per address): the owner makes Hana a viewer and assigns two books with a status and past due date in one go, then moves one date later. Overdue counts and filters follow. Hana's email lists the books; she opens My assignments (3) from the navigation, marks the overdue book done, filters to done, and turns the emails off. The accessibility audit adds 5 screens (the notes page with an overdue book, and My assignments in English, Arabic, dark and on a phone) with 0 findings. All pass.
- **Limitations:**
  - ~~No reminder before a due date~~: added, see due-date reminders below.
  - ~~Assignment emails are sent once per assignment~~: members can now choose one summary a day, see below.
  - ~~My assignments covers one organization at a time~~: see My assignments in all organizations below.

### Due-date reminders · COMPLETE
- **Implemented:** the worker reminds the member a book is assigned to when its due date comes near and when it has passed.
  - **When:** a book is **due soon** from 2 days before its due date to the day itself, and **overdue** for the 7 days after it. Each book is reminded once as due soon and once as overdue, for that assignee and that due date. A new due date or a new assignee is reminded again; marking a book done and reopening it is not. Done books, and books overdue for more than a week, are never reminded.
  - **How:** one in-app notice, and one email if allowed, per member and organization, listing the books (overdue first, then due soon, each with its scope and "due today", "due tomorrow" or the date; up to 20 per list, then "and N more"), in the member's language, with a link to My assignments and to the account settings.
  - **Email choice:** "Email me a reminder when my books are due soon or overdue" in the account settings, on by default and separate from the assignment emails. The email also needs a verified address. The in-app notice is always created.
  - **Timing:** the worker checks every 15 minutes and sends only between 08:00 and 21:00 Cairo time, so a worker that was down catches up the same day. Suspended accounts and organizations get nothing until they are active again.
  - **Safe to repeat:** each reminded book is recorded in `item_reminders` (migration 0010) in the same transaction as the notice and the email, with insert-or-skip on its key, so several workers or passes never send one twice. Records go with the book, the scope and the member, and are deleted 60 days after the due date. The table has forced row-level security like other tenant tables.
  - **On screen:** books due soon carry a "due soon" mark next to the due date (notes page and My assignments), and My assignments counts them.
- **Files:** `src/db/migrations/0010_due_reminders.ts`, `src/scopes/{reminders,notes}.ts`, `src/worker.ts`, `src/jobs/tasks.ts`, `src/notifications/email.ts`, `src/auth/routes.ts`, `public/js/views/{items,assignments,account}.js`, `public/js/i18n.js`.
- **Tests:** `due-reminders.test.ts` (10) and `unit/reminders.test.ts` (3):
  - one email listing both kinds, and the next day only what changed;
  - each member's language;
  - what is left out;
  - the sending hours;
  - re-reminding after a new date or assignee;
  - the email choice and unverified addresses;
  - suspended accounts and organizations;
  - three passes at once sending each reminder once;
  - long lists;
  - record removal and retention;
  - other organizations;
  - the due-soon count.

  E2E journey 16: the owner gives Hana a book due tomorrow, and the notes page marks it due soon. One pass of the reminder job against the E2E database sends one reminder, and a second pass none. Hana's email arrives although she turned assignment emails off. She sees the count and the notice, and turns reminder emails off. The accessibility audit's notes page and My assignments screens now include a due-soon book, with 0 findings. Migration 0010 was applied, reverted and applied again on a scratch database. All pass.
- **Limitations:**
  - The reminder window (2 days before, 7 days after) and the sending hours are fixed for every school.
  - Reminders go to the assignee only, not to whoever set the due date.

### Daily summary of assignment emails · COMPLETE
- **Implemented:** members choose how emails about books assigned to them arrive, in the account settings: **right away** (one email per assignment, the default, so nothing changes for anyone who does not choose), **one summary each morning**, or **none** (in-app notifications only).
  - **The summary:** one email per member, across all their organizations. It lists the books assigned since the previous summary, grouped by organization, then by scope and who assigned them (up to 10 per group, then "and N more"), with a link to My assignments in each organization. It is in the member's language.
  - **Once a day:** the worker sends it from 08:00 Cairo time to members with something assigned before that morning's 08:00. Anything assigned later waits for the next morning. A worker that was down catches up the same day, until 21:00.
  - **Still current:** books unassigned or removed from the scope since, and suspended organizations, are left out. If nothing is left, no email goes. Members whose address is not verified, or who switched the summary off, get nothing, and what was waiting is dropped.
  - **Not delayed:** the in-app notification still arrives at once.
  - **Switching:** switching back to emails right away, or to none, drops what was waiting.
  - **Storage:** waiting assignments are kept in `assignment_digest_items` (migration 0011), with forced row-level security. The organization sees its rows; a member can read and delete their own. Rows go with the book, the scope and the membership. The worker takes them with `DELETE … RETURNING` in the same transaction as the email, so two workers never send a summary twice. Anything older than 30 days is cleaned up.
- **Files:** `src/db/migrations/0011_assignment_digest.ts`, `src/scopes/{digest,notes,reminders}.ts`, `src/worker.ts`, `src/jobs/tasks.ts`, `src/notifications/email.ts`, `src/auth/routes.ts`, `public/js/views/account.js`, `public/js/i18n.js`.
- **Tests:** `assignment-digest.test.ts` (9):
  - no email per assignment, only the in-app notice;
  - one summary the next morning, then none;
  - at most one a day (later assignments wait for the next morning);
  - one email across two organizations, grouped by scope and assigner;
  - unassigned and removed books, and suspended organizations, left out;
  - switching back or off drops the queue, and the choice is validated;
  - unverified addresses;
  - Arabic and long lists;
  - three concurrent passes sending one summary;
  - row-level security for other organizations and other members;
  - cleanup.

  E2E journey 17: Hana chooses the morning summary. The owner selects a fourth book and assigns it to her, and no email goes. One pass of the summary job against the E2E database the next morning sends one summary listing the book, and a second pass none. Journeys 15 and 16 now use the new choice instead of the checkbox. The accessibility audit covers the account page with it (0 findings). Migration 0011 was applied, reverted and applied again on a scratch database.
- **Fixed a test flake:** the reminder tests checked that a book's title was *not* in an email. The catalogue repeats titles (1,038 materials, 113 titles), so two randomly picked books could share one. Those tests now pick books with distinct titles. The failure was reproduced with a repeated title and the fix confirmed on the same data.
- **Limitations:**
  - The summary time (08:00 Cairo) is the same for everyone.
  - Due-date reminders stay separate emails.
  - ~~My assignments still covers one organization at a time~~: see below.

### My assignments in all organizations · COMPLETE
- **Implemented:** a member of several organizations sees all the books assigned to them on one page, `/assignments` (API `GET /api/assignments`).
  - **One list:** overdue first, then by due date. Each row shows its organization and scope, with links to that organization's My assignments and to the scope's notes page.
  - **Counts:** totals for not done, overdue and due soon, plus "not done yet" per organization.
  - **Filters:** not done, done or all.
  - **Status updates:** the member changes a book's status here, through that organization's own route and rules.
  - **How to get there:** each organization's My assignments shows "See your books in all your organizations (n)" when the member has more than one.
  - **No new cross-tenant read:** each organization is read in its own tenant context through `inOrg`, the same checks as its own page. A suspended organization, or one that requires two-factor sign-in for the member's role when this session has none, is not read. The page names it as not shown. Students are refused like every staff route.
  - No database change.
- **Files:** `src/scopes/routes.ts`, `public/js/views/assignments.js`, `public/js/main.js`, `public/js/i18n.js`. The route is added to the reviewed allow-list in `authz-coverage.test.ts`.
- **Tests:** `all-assignments.test.ts` (4):
  - two organizations merged in one order, with counts and the done/all filters; another member's books and organizations never appear;
  - a viewer updating a status through the book's own organization;
  - suspended and two-factor organizations listed as unavailable and not read;
  - one organization giving the same books as its own page; signed-out callers 401, students 403.

  The student suite also checks the new route refuses a student. E2E journey 18: Hana creates her own organization, picks a book and gives herself a due date. From Notes Academy's My assignments she opens the page for both organizations: 5 books, 2 due soon, the earliest due first. She marks her own organization's book done there and finds it under Done. The accessibility audit adds this page in English, Arabic, dark and on a phone (73 screens, 0 findings).
- **Limitations:**
  - The page fetches each organization in turn, so it slows with many memberships (each is a few small queries).
  - The navigation count in each organization still counts that organization only.

### Student accounts and student portal · COMPLETE (off for every school; legal assessment pending before real use)
- **Implemented:** schools create accounts for their students; students sign in with the school code, a username and a password, and see the books of their grade in the scope the school assigned (`docs/STUDENT_ACCOUNTS.md`). It is the first part of the student portal planned with the Wise EduAgent integration, and it contains no AI or Wise features.
  - One sign-in system: students are `users` rows with `kind = 'student'` and no email, in the same sessions, lockout, rate limits and audit as staff. They have no membership, so every staff route refuses them (`STAFF_ONLY`); database triggers and a check constraint hold that rule. Student sessions last at most 12 hours.
  - Owners and admins: add a student, import a roster CSV (preview, all or nothing, Arabic headers and Excel files handled, up to 300 per file), set name, grade and curriculum, issue a new password (shown once, also as a download), remove. Editors and viewers have no access.
  - The student portal: My curriculum in English and Arabic, password change, sign-out. Staff pages send a student back to the portal.
  - Off by default: new plan limit `max_students` = 0 on every plan (prices unchanged); a platform administrator enables it per school with a limit override, which, like other overrides, applies only on a paid or trial plan. Platform administrators see only the number of student accounts; the platform user list excludes students.
  - Deleting a student, or the school, deletes the accounts with their sessions.
- **Files:** `src/db/migrations/0007_students.ts`, `src/students/*`, `src/auth/{guards,routes,sessions}.ts`, `src/billing/{plans,entitlements}.ts`, `src/admin/routes.ts`, `public/js/views/{student,students,auth,admin,shell}.js`, `public/js/main.js`, `public/js/i18n.js`, `public/app.css`. Staff-only code paths now use a `StaffUser` type (email always present).
- **Tests:** `students.test.ts` (25), which includes calling every route of the application with a student session. E2E journey 13 runs the whole flow through the UI: a platform admin enables accounts, the owner adds a student and imports one, the student signs in and sees exactly the scope's books, staff pages are closed to the student, Arabic works, and a reset signs the student out. The accessibility audit adds 12 screens (the Students page and dialogs; student sign-in; the portal in English, Arabic, dark and on a phone) with 0 findings. All pass, and the existing suites pass unchanged.
- **Limitations:**
  - Not for real students until the legal assessment (B-9).
  - No price yet for student accounts.
  - Import error messages are in English.
  - No classes, assignments, progress or AI: Wise EduAgent could not be inspected (B-8) and no AI provider is chosen (B-10).

### Scope comparison · COMPLETE
- **Implemented:** any two scopes of an organization side by side (Scopes → Compare scopes; any member, every plan). On the same catalogue version books are compared by id. Across catalogue years, for example last year's plan against this year's, they are matched by subject and title with the carry-forward rules. Those rules now live in a shared module, `src/scopes/match.ts`, and carry-forward behaviour is unchanged. A book renamed only in capitals or spacing counts as the same book and shows both titles; books and subjects missing from the other year's catalogue are marked. The page shows:
  - counts only in the first, only in the second, and in both;
  - a table per grade with an included/not-included mark for each scope (the words are read out by screen readers);
  - "Show only differences" (the default), "Swap", and a choice of either scope.

  "Download comparison (CSV)" gives one row per book with a yes/no column per scope and a note. It needs CSV export on the plan, and is counted and audited (`scope.comparison_exported`) like other exports.
- **Files:** `src/scopes/compare.ts`, `src/scopes/match.ts`, `src/scopes/carry.ts`, `src/scopes/routes.ts`, `public/js/views/compare.js`, `public/js/views/scopes.js`, `public/app.css`, `public/js/i18n.js`.
- **Tests:** `unit/scope-compare.test.ts` (2), `scope-compare.test.ts` (3), and E2E journey 12, which builds two scopes, compares them, filters, swaps and downloads the CSV. The accessibility audit now includes the comparison across two catalogue years, in five states: differences only, everything shown, Arabic, dark and phone; 0 findings. All pass; the carry-forward tests still pass on the shared matcher.
- **Limitations:** two scopes at a time; books are matched by title, so a book retitled beyond capitals and spacing shows as one removed and one added; per-item notes and assignees are not built yet.

### Operational alerts · COMPLETE (verified locally; real channels not yet configured)
- **Implemented:** every app instance runs a set of checks once a minute (`ALERT_CHECK_INTERVAL_MS`):
  - the background worker has stopped reporting;
  - emails are failing to send, or waiting more than 15 minutes;
  - 10 or more server errors in 5 minutes on an instance;
  - payment provider notifications failed in the last hour;
  - database migrations are pending;
  - the database is unreachable.

  A problem produces one message when it starts, a reminder every 6 hours while it lasts, and one message when it has been clear for 5 minutes. The `ops_alerts` table (migration 0006) makes sure only one instance sends each message; the database outage alert is kept in memory, because it cannot be stored. Alerts go straight to SMTP (`ALERT_EMAILS`) and/or a webhook (`ALERT_WEBHOOK_URL`: Slack, Discord, Mattermost or any JSON endpoint), not through the email outbox, so they arrive when the worker is down. They are also written to the logs. Messages carry counts and a "what to check" hint, never customer names, emails or error text. Platform admin → Overview shows current and recently resolved alerts, where alerts are sent, and a "Send test alert" button (audited as `admin.alert_test`, 5 per hour). The worker's container health check now uses the same "worker stopped" threshold. Resolved alerts are deleted after 90 days.
- **Files:** `src/ops/alerts.ts`, `src/db/migrations/0006_ops_alerts.ts`, `src/server.ts`, `src/app.ts`, `src/admin/routes.ts`, `src/config.ts`, `public/js/views/admin.js`, `docker-compose.yml`, `.env*.example`.
- **Tests:** `integration/alerts.test.ts` (6) and `unit/alerts.test.ts` (2), all pass. They cover:
  - one alert across two instances, the reminder and the resolution;
  - every check, with no customer data in any message;
  - the database outage alert;
  - channel failures;
  - the 5xx counter;
  - the admin API and its audit entries.

  Two mutation checks fail as they should: when every instance notifies, and when alerts resolve without the clear period. E2E journey 7 sends a test alert from the admin console. During the E2E run, the monitor in the real server process raised "worker stopped", correctly, since no worker runs there. On the production-settings Docker stack with two app instances, stopping the worker produced one alert email over SMTP (Mailpit) after 120 s, and restarting it one "Resolved" email 5 minutes later (TEST_REPORT §4).
- **Limitations:**
  - Not yet delivered through a real email provider or chat webhook: SMTP was tested with Mailpit, the webhook with a local receiver.
  - Nothing inside the host can report that the whole host or both app instances are down: an external uptime check on `/readyz` is still needed (DEPLOYMENT_GUIDE §6).
  - Alert texts are in English.
  - With two instances, a database outage produces one message per instance.

### Two app instances behind Caddy · COMPLETE (verified locally)
- **Implemented:** production runs two app instances (`app`, `app2`) of the same image behind Caddy. Caddy balances requests round robin, checks each instance's `/readyz` every 2 s (database reachable, schema current, not draining) and routes around an instance it cannot reach. A request whose connection failed is tried on the other instance; one that failed after it was sent is retried only if it is a GET, so no write is applied twice. On SIGTERM an instance reports "draining" for 5 s (`SHUTDOWN_DRAIN_MS`), so Caddy stops sending it requests, then finishes the requests in flight and exits; a second signal exits at once. `scripts/rolling-restart.sh [--build]` restarts or upgrades `app`, then `app2`, then the worker, waiting for each instance to be ready. Sessions, rate limits and the catalogue cache already work across instances (see shared rate limits).
- **Files:** `docker-compose.prod.yml`, `deploy/Caddyfile`, `src/server.ts`, `src/http/health.ts`, `src/config.ts`, `scripts/rolling-restart.sh`.
- **Tests:** `shutdown.test.ts` (the real server process: draining on SIGTERM, still serving during the drain, clean exit; fails without the draining flag). The production-settings stack was run locally with Docker (HTTPS through Caddy, two app instances, worker, PostgreSQL, Mailpit for SMTP) and loaded with paced reads and writes (TEST_REPORT §4):
  - 0 failed requests out of 1,280 across three rolling restarts;
  - 0 failed out of 600 with `scripts/rolling-restart.sh` itself;
  - 2 writes failed (502) with the drain switched off;
  - killing an instance's process caused 1 failed write (in flight at the moment of the crash) in 646 requests, and Docker restarted the instance within a second.
- **Limitations:** both instances run on one host, so this protects against an instance crashing or restarting, not against losing the host or the database. A write in flight on an instance that crashes can fail (the picker rolls the change back and the user retries). Not yet run on the production host (B-4).

### Shared rate limits · COMPLETE
- **Implemented:** every route with its own limit now counts in PostgreSQL, so the limit holds across several app instances and across restarts. That covers registration, email verification, login, two-factor codes and setup, password reset and change, account export and deletion, invitations, organization creation and deletion, checkout and the v1 API quota. The counters use fixed windows timed by the database clock, with one atomic upsert per limited request. They are stored HMAC-keyed, so no IP addresses or emails are stored, in an UNLOGGED table (migration 0005); the worker deletes expired counters hourly. The global limit of 600 API requests a minute per address stays in each process's memory as a flood guard. It costs no database work per request, so a flood does not reach the shared database; with N instances one address can make up to N × 600 requests a minute.
- **Why not Redis:** PostgreSQL is already run, backed up and monitored. Redis would be one more service to host and secure, for a load far below what one upsert per login can handle (TEST_REPORT §5). The store sits behind the plugin's store interface, so Redis can replace it later.
- **Files:** `src/http/rate-limit-store.ts`, `src/db/migrations/0005_rate_limits.ts`, `src/app.ts`, `src/jobs/tasks.ts`.
- **Tests:** `rate-limit-store.test.ts` (6), `unit/rate-limit-memory.test.ts` (2) — pass. With the route limits moved back to per-process memory, the two-instance and hashing tests fail.
- **Cost:** about 0.9 ms per limited request (one database round trip); other API requests are unchanged (TEST_REPORT §5).
- **Limitations:** counters restart from zero after a database crash or failover (UNLOGGED).

### Accessibility audit · COMPLETE
- **Implemented:** an automated WCAG 2.2 A/AA check (axe-core 4.13 in Playwright) of 46 screens and dialogs: the signed-out pages, every organization page, the picker in four states, the scope comparison in five, the new-scope, notifications and verification dialogs, and every platform-admin page, in English and Arabic, light and dark, desktop and a 390 px phone. It runs in the E2E suite after the journeys, so pages carry real data, and any finding fails it. The first run reported 26 findings, all fixed:
  - colour contrast (13): the amber used for the trial banner, notices, "needs review" statuses and warnings measured 4.17:1 on its pale background; it is now 5.50:1 (light theme; dark already passed);
  - target size (8): source links in the picker and the verification badges were under 24 px tall;
  - unnamed meters (3): billing usage meters now have a name and a "used / limit" value;
  - keyboard access to a scrolling table (1): every table card is now a labelled region that takes focus, so it can be scrolled with the keyboard;
  - invalid ARIA (1): the admin webhook filter links used `aria-pressed`; they now mark the current filter with `aria-current`.
  A keyboard-only test found two more problems, also fixed: closing a dialog with Escape lost focus instead of returning it to the button that opened it, and following the skip link was handled by the router as a navigation and redrew the page; it now moves focus to the page heading.
- **Files:** `tests/e2e/accessibility.spec.ts`, `tests/e2e/helpers.ts` (shared with the journeys), `playwright.config.ts`, `public/js/{dom,main}.js`, `public/app.css`, `public/js/views/{account,admin,billing,members,scopes,settings}.js`.
- **Tests:** the E2E accessibility audit and keyboard test — pass. Against the front end before the fixes, the audit reports the 26 findings and the keyboard test fails.
- **Limitations:** automated rules cover only part of WCAG; no manual review with a screen reader (NVDA, VoiceOver, TalkBack) yet; Chromium only.

### Catalogue spreadsheet export and import · COMPLETE
- **Implemented:** platform admins download any catalogue version as a CSV (UTF-8 with BOM, one row per subject and per material with ids, content and verification columns; subject columns repeat on material rows for filtering) and upload the edited file. Uploads show a preview first: every change by row, every error, and notes; nothing is written until the admin applies it, and applying re-checks the file inside the transaction and writes all of it or none of it. Verification marks can change on drafts and published versions; content corrections and new materials in existing subjects only on drafts; subjects are added and entries deleted only in the editor. A corrected entry loses its mark unless the same row updates the mark. Newly flagged entries notify customers as in the editor; imports are audited (`admin.catalog_imported`). Excel quirks handled: semicolon-separated files, CRLF, trailing blank rows, formula guard round trip; non-UTF-8 files are rejected with instructions.
- **Files:** `src/lib/csv.ts`, `src/catalog/sheet.ts`, `src/admin/routes.ts`, `public/js/views/admin.js`.
- **Tests:** `unit/csv.test.ts` (3), `unit/catalog-sheet.test.ts` (6), `catalog-sheet.test.ts` (5), E2E 11 (download, edit three marks, upload, preview, apply) — pass.
- **Limitations:** CSV only (no .xlsx); no new subjects or deletions by spreadsheet; up to 20,000 rows and 8 MB per file.

### Catalogue change notifications · COMPLETE
- **Implemented:** when a platform admin publishes a catalogue for a later academic year, or archives the version an organization's scopes use, the owners, admins and editors of each active organization with scopes behind the newest published catalogue get an in-app notification and an email in their own language. The link goes to the carry-forward review (one scope) or the scopes list (several). Each organization hears about a given academic year once (`catalog_notices`), so corrections and archiving don't repeat it. When admins newly flag entries "needs review" (or change the note), organizations that selected those entries (directly or through the subject) are told which items and why; re-saving the same flag, verified marks and unselected entries notify no one. Users can turn the emails off in their account (`users.catalog_emails`); in-app notifications stay. Following a link in the notifications dialog now closes it.
- **Files:** `src/db/migrations/0004_catalog_notifications.ts`, `src/catalog/notify.ts`, `src/admin/routes.ts`, `src/notifications/email.ts`, `src/auth/routes.ts`, `public/js/views/{account,shell}.js`, `public/js/dom.js`.
- **Tests:** `catalog-notifications.test.ts` (4); E2E 10 now follows the notification to the review page — pass.
- **Limitations:** the fan-out runs inside the admin's publish/flag request (fine for hundreds of organizations; move it to the worker before thousands); viewers are not notified because they cannot act.

### Carry a scope to the next academic year · COMPLETE
- **Implemented:** a scope's selection is matched to another published catalogue version by natural key. Subjects match on grade, track, block and code, falling back to grade, track and code when that is unambiguous on both sides; materials match on title, then on title ignoring case and spacing. The preview lists carried items (and loose renames), items with no counterpart (with the subject's new books offered as replacements), changes to subjects the scope covers, and new books. Apply either copies into a new scope (counts toward the plan's scope limit) or moves the scope in place (works at the Free plan's single scope; read-only scopes can't be moved). Chosen replacements are added and unticked items left out; audited as `scope.carried_forward`. Entry points: a banner in the picker and a button in the scopes list whenever a newer published catalogue exists.
- **Files:** `src/scopes/carry.ts`, `src/scopes/routes.ts`, `public/js/views/carry.js`, `public/js/views/{scopes,picker}.js`.
- **Tests:** `unit/carry-forward.test.ts` (4), `scope-carry-forward.test.ts` (4), E2E 10 (admin publishes 2027/2028 with a book dropped; the owner reviews and carries the scope) — pass.
- **Limitations:** matching is by title, so a book retitled beyond case and spacing appears as "missing" with its new edition offered as a replacement, not matched automatically; no notification is sent when a new catalogue is published (only the in-app banner).

### Phase 3 — SaaS capabilities · COMPLETE
- **Implemented:** registration + verification, login with lockout and rate limits, sessions (rotation, idle/absolute expiry, revocation), CSRF (origin + HMAC token), TOTP MFA with encrypted secrets, replay protection and recovery codes (mandatory for platform admins, optional org policy), password reset/change, organizations, 4 roles, invitations, ownership transfer, member removal, org deletion, personal-data export, account deletion, plan limits.
- **Files:** `src/auth/*`, `src/orgs/*`, `src/billing/entitlements.ts`, `public/js/views/{auth,members,settings,account}.js`.
- **Tests:** `auth.test.ts` (13), `tenancy.test.ts` (15), `authz-coverage.test.ts` (5), E2E 1–3, 5, 7 — pass.
- **Limitations:** no WebAuthn/SSO. (Rate-limit counters are now shared by app instances: see shared rate limits.)

### Phase 4 — Commercial operations · PARTIALLY COMPLETE
| Deliverable | Status | Notes |
| --- | --- | --- |
| Plans, entitlements, metering | COMPLETE | |
| Subscription lifecycle (trial, subscribe, prorated upgrade, scheduled downgrade, cancel/resume, renewal invoices, past-due grace, move to Free) | COMPLETE | Tested with sandbox provider and time-travelled worker runs |
| Webhook security (signatures, replay, idempotency, amount check) | COMPLETE | |
| Sandbox provider (dev/test) | COMPLETE | Refused in production |
| Paymob adapter | PARTIALLY COMPLETE | Contract-tested end to end against a simulator of Paymob's documented API (`paymob-contract.test.ts`, 11 tests); HMAC matches the reference vector of an independent implementation (Odoo `payment_paymob`). **Not yet run against Paymob's servers** — `npm run paymob:check` with test-mode keys (B-2) |
| Callbacks bound to the signed Paymob order (`checkout_sessions`, migration 0002) | COMPLETE | Found while cross-checking: `merchant_order_id` is not covered by Paymob's HMAC, so it no longer decides which invoice is paid |
| Invoices, payment history, billing emails, in-app notifications | COMPLETE | VAT not applied (B-3) |
| Platform admin (overview, orgs, users, plans, catalogue editor, audit, webhook log, health) | COMPLETE | |
| Customer-granted support access with audit | COMPLETE | |
| Audit log (org + platform) | COMPLETE | |
- **Files:** `src/billing/*`, `src/admin/*`, `src/audit/*`, `src/notifications/*`, `src/jobs/*`, `src/worker.ts`, `public/js/views/{billing,admin}.js`.
- **Tests:** `billing.test.ts` (13), `paymob-contract.test.ts` (11), `admin-api-ops.test.ts` (12), unit billing/security tests, E2E 4, 7 — pass.

### Catalogue verification marks · COMPLETE
- **Implemented:** per-subject and per-material marks (verified / needs review / not verified) with source, link, public note and review date; set by platform admins singly, per subject with its materials, or per grade; allowed on published versions (marks are annotations; content stays frozen); content edits in a draft clear the edited entry's mark; same-year draft copies keep marks, a new academic year starts unverified; every change audited. Customers see badges, details and coverage in the picker, and the marks in CSV/JSON exports and the v1 API. The reviewer's identity is not exposed.
- **Files:** `src/db/migrations/0003_catalog_verification.ts`, `src/admin/routes.ts`, `src/catalog/service.ts`, `src/scopes/export.ts`, `public/js/verify.js`, `public/js/views/{picker,admin}.js`.
- **Tests:** `catalog-verification.test.ts` (6), unit CSV test, E2E 8 (admin marks a subject; customer sees badge, source link, Arabic label) — pass.
- **Limitations:** the marks are only as good as the review behind them (B-6); marks can also be imported from a spreadsheet (see below).

### Front end and localization · COMPLETE
- Vanilla ES-module SPA (strict CSP), original visual identity, English/Arabic with RTL, responsive.
- **Tests:** E2E 1–11, `i18n.test.ts`; visual QA screenshots reviewed (layout bugs fixed).
- **Limitations:** Arabic copy not reviewed by a professional translator; Chromium-only E2E; accessibility checked automatically and by keyboard, not yet with a screen reader.

### Phase 5 — Production hardening · PARTIALLY COMPLETE
| Deliverable | Status | Evidence |
| --- | --- | --- |
| Security review + fixes (open redirect, MFA brute force, session hygiene) | COMPLETE | `authz-coverage.test.ts` |
| Dockerfile, compose (dev + prod overlay: Caddy and two app instances) | COMPLETE (local) | Image built; production-settings stack healthy; rolling restarts under load without failed requests (TEST_REPORT §4) |
| Backup / restore / verify scripts | COMPLETE (local) | Executed; see TEST_REPORT §4 |
| CI workflow | PARTIALLY COMPLETE | GitHub Actions runs on `main` are refused (B-7). All workflow steps pass when run with `scripts/ci-local.sh` on a clean clone of `main` (2026-10-23) |
| Performance | PARTIALLY COMPLETE | Sandbox smoke results; no production-sized load test |
| Monitoring & alerting | PARTIALLY COMPLETE | In-app alerts by email and webhook (operational alerts section); still needed: alert channels set to real addresses, an external uptime check on `/readyz` (B-4) |
| Disaster-recovery drill on production infrastructure | NOT STARTED | Needs B-4 |
| External penetration test | NOT STARTED | Recommended before launch |

### Phase 6 — Commercial release · NOT STARTED
Blocked by B-2…B-6. Plan: docs/IMPLEMENTATION_ROADMAP.md.

### Documentation · COMPLETE
All 16 documents in `docs/` plus `README.md`, written against the code as committed.

## 3. Definition of Done checklist

| Condition | State |
| --- | --- |
| Core workflows function correctly | ✓ (232 unit/integration + 20 E2E passing: 18 journeys, 2 accessibility) |
| No mock responses in production flows | ✓ (sandbox provider is dev/test only and refused in production) |
| Database persistence works | ✓ |
| Multi-tenant isolation tested | ✓ |
| Authentication secure | ✓ in tests; ✗ no external pen test |
| Backend authorization enforced | ✓ (route-enumeration test) |
| Subscriptions and billing tested in an appropriate environment | ✗ sandbox provider and a Paymob simulator only; not yet in Paymob test mode (B-2) |
| Plan limits enforced | ✓ |
| Admin interfaces operate correctly | ✓ |
| Automated tests pass | ✓ clean-checkout run of every CI step (`scripts/ci-local.sh`); ✗ not yet on GitHub-hosted runners (B-7) |
| Critical security issues resolved | ✓ none known; ✗ not externally assessed |
| Monitoring and alerts configured | ✓ built in and tested locally; ✗ real channels and external uptime check not configured (B-4) |
| Backup and recovery tested | ✓ locally; ✗ not on production infrastructure |
| Deployment reproducible | ✓ locally (Docker/compose) |
| Documentation accurate | ✓ |
| Operational support and release procedures defined | ✓ documented (DEPLOYMENT_GUIDE §4–7); rolling restart exercised on a local production-settings stack; ✗ not on the production host |

## 4. Next development priorities

1. Clear the GitHub billing lock (B-7) and confirm CI on GitHub-hosted runners, then get Paymob test-mode keys and run `npm run paymob:check` followed by the staging checklist (DEPLOYMENT_GUIDE §3.5); decide the tax position (B-3).
2. Catalogue verification (B-6): a curriculum specialist reviews entries against decrees and publishers and records marks in Platform admin → Catalogue.
3. Production host + monitoring + backup job (B-4), then a restore drill.
4. Legal review (B-5), pilot with 3–5 design partners.

**Resume point (2026-10-25).** After PR #10 (scope comparison, merged at `b298586`) work switched to the
Wise EduAgent student-portal integration (`docs/wise-integration/`). Wise itself could not be inspected
(B-8); on the owner's decision, student accounts created by schools were built as the portal's
foundation (above). Waiting on the owner: access to Wise (B-8) and an AI provider (B-10); legal
assessment before real student use (B-9). Per-item notes and assignees (Roadmap P2) are done (above).
