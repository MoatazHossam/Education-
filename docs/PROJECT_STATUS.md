# Project status

**Overall classification: NOT PRODUCTION READY.**
The application is functionally complete and tested locally, but several Definition-of-Done
conditions are unverified or blocked (real payment provider, production deployment, monitoring
and alerts, legal/privacy review, catalogue data verification).

Last updated: 2026-10-27. Branch: `claude/friendly-rubin-hmemjl`.
Status values: COMPLETE · PARTIALLY COMPLETE · NOT STARTED · BLOCKED · NOT VERIFIED.

## 1. Blockers and external dependencies

| ID | Blocker | Impact | Needed from |
| --- | --- | --- | --- |
| B-1 | ~~`git push` refused with HTTP 403~~ — **resolved 2026-10-22**: access granted, branch `claude/friendly-rubin-hmemjl` pushed and `main` created from it. | — | — |
| B-2 | No Paymob keys | Adapter is contract-tested but has not been run against Paymob; real billing impossible | Business: Paymob account — test-mode keys now (for `npm run paymob:check`), live keys after Paymob's merchant verification |
| B-3 | Company registration country / tax position undecided | Provider choice, VAT on invoices, ETA e-invoicing | Founder + accountant |
| B-4 | No production host, domain, SMTP account | No deployment, TLS, real email, monitoring | Ops budget/accounts |
| B-5 | Legal review not done (PDPL licensing, privacy policy, terms, hosting location) | Cannot onboard paying customers responsibly | Legal counsel |
| B-7 | GitHub Actions jobs are rejected: "your account is locked due to a billing issue" (runs on 2026-10-22 and 2026-10-23; still the case for PR #23 on 2026-10-26) | No CI on GitHub; use `scripts/ci-local.sh` meanwhile. PRs #22 and #23 were merged on local checks only | Account owner: resolve billing on the account that owns the repository |
| B-6 | Catalogue content unverified (sourced from news articles in the original). Tools to record verification now exist (Platform admin → Catalogue: one by one, per grade, or a whole spreadsheet); 0 of 231 subjects verified so far | Product value and liability | Curriculum specialist |
| B-8 | Wise EduAgent (`wise-eduagent.ai.studio`) cannot be inspected: the environment's network policy denies the host and no source export exists in the session | The Wise integration cannot go beyond documentation (`docs/wise-integration/`) | Owner: AI Studio source export, and/or allow the host in the environment's network settings with an authorized test account |
| B-9 | ~~The product stores no student records by design~~ — **owner decided 2026-10-25: student accounts created by schools.** Built and off for every school (see student accounts), and since 2026-10-26 the teacher and student portal on the same switch (classes, homework, online tests with monitoring, gradebook). Still open: the legal assessment for minors' data (SECURITY_DESIGN §7). The PDPL Executive Regulations' grace period ends around 31 October–1 November 2026 | No school should use student accounts or the portal with real students until the assessment is done | Legal counsel (consent, controller/processor terms with schools, retention, privacy notice) |
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
- **Next:** manual screen-reader review (`docs/SCREEN_READER_REVIEW.md`); set alert channels and an external uptime check when the host exists (B-4).

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

### Webhooks to customer systems · COMPLETE
- **Implemented:** organizations on plans with API access (Professional and above, like the read API) register up to 5 HTTPS endpoints in Settings → Webhooks.
  - **Events:** each endpoint chooses which scope changes it hears about: created (also duplicates and carried copies), renamed or described, deleted, books added or removed (also clearing and moving to another catalogue year), plus a test ping.
  - **Payload:** the scope's current state (id, name, catalogue version and year, number of books, last change); receivers fetch the books with the read API.
  - **Signing:** each request is signed with HMAC-SHA256 over `<timestamp>.<body>`, with a per-endpoint secret.
    - The secret is shown once, stored encrypted, and can be replaced.
    - The API documentation has a receiver example, and I checked it against real signatures.
- **Delivery:**
  - **Queueing:** events are queued in the transaction that makes the change.
  - **Merging:** several quick changes to one scope reach the endpoint as one event with the latest state.
  - **Sending:** the worker sends them in parallel, outside database transactions. A 2xx answer within 5 seconds counts as delivered.
  - **Retries:** failures are retried after 1 min, 5 min, 30 min, 2 h, 6 h and 12 h, then marked failed.
  - **Switching off:** an endpoint failing 25 attempts in a row is switched off. Its owners and admins are notified, and it is audited. Switching it back on resumes the waiting deliveries.
  - **Admin tools:** admins send a test and see the result at once, see the last 50 deliveries with their payloads, and send any finished delivery again (same event id). History is kept 30 days.
- **Server-side request forgery protection:**
  - Only https URLs without credentials, to hosts whose every address is public. The check runs in the connection's own DNS lookup, so changing the DNS record after the check can't redirect the request.
  - Redirects are not followed, and the response body is not read.
  - A development-only setting, `WEBHOOK_ALLOW_INSECURE_TARGETS`, lifts this for local receivers; the configuration refuses it in production.
- **Files:** `src/db/migrations/0012_webhooks.ts`, `src/webhooks/{net,service,routes}.ts`, `src/scopes/routes.ts` (events), `src/worker.ts`, `src/jobs/tasks.ts`, `src/config.ts`, `src/app.ts`, `public/js/views/{webhooks,settings}.js`, `public/js/i18n.js`, `public/app.css`, `.env.example`.
- **Tests:**
  - **Unit:** `unit/webhook-net` (4): address ranges; URL rules; the connection-time lookup refusing a host that resolves to loopback; the signature format.
  - **Integration:** `integration/webhooks` (11):
    - endpoint management, roles, validation, the limit and plan gating;
    - signed delivery of every event to subscribed endpoints only;
    - merging; duplicate and carry;
    - retries with backoff and final failure;
    - switch-off with notification and audit, then switching back on;
    - redirects not followed and timeouts;
    - test, redelivery and secret rotation;
    - events stopping when the plan loses API access;
    - other organizations and retention;
    - with default settings, private and non-https URLs refused and nothing sent to a private address.
  - **E2E journey 19:** the Notes Academy owner adds an endpoint (a local receiver) and copies the secret. A test is delivered and its signature checks. Selecting a book reaches the receiver, signed, as "books added or removed" with the new count, and both deliveries show in the dialog.
  - **Accessibility:** the audit adds the secret, deliveries and edit dialogs and the settings page with an endpoint, also in Arabic, dark and on a phone (80 screens, 0 findings).
  - **Migration:** 0012 was applied, reverted and applied again on a scratch database.
- **Limitations:**
  - ~~No events for notes, assignees, statuses or due dates~~: added, see below.
  - Deliveries already queued are still sent if the plan loses API access; new events stop.
  - ~~No customer-side delivery log export~~: added, see "Webhook delivery history download" below. Still no per-endpoint IP allow-list for receivers to pin.
  - In production, an egress firewall is recommended as a second layer (SECURITY_DESIGN §6).

### Webhook events for notes and assignments · COMPLETE
- **Implemented:** a new event, `scope.items_annotated`. It is sent when a book's note, assignee, status or due date changes, whether one book is edited, several are changed at once, or the assignee (any role) updates a status.
  - **Payload:** the scope's state plus `materialIds`, the books changed. It never includes a note's text or a member's name; receivers read them with the API, where each item has its note, assignee, status and due date.
  - **Merging:** changes made while an event is still waiting are merged into one event, listing every book changed. The merge happens in the same `INSERT … ON CONFLICT` statement, so concurrent requests cannot lose a book.
  - **No change, no event:** saving without a change sends nothing.
  - **Opt-in:** endpoints subscribe to it explicitly ("Notes, assignees, statuses or due dates changed" in Settings, ticked by default for new endpoints). Existing endpoints don't receive it until it is ticked.
  - Member removal, which clears that member's assignments in the database, is not reported.
- **Files:** `src/webhooks/service.ts`, `src/scopes/routes.ts`, `public/js/i18n.js`.
- **Tests:**
  - `integration/webhooks` gains one test:
    - a note and a bulk assignment merged into one event naming the three books, without the note text or the member's name;
    - an endpoint not subscribed receives nothing;
    - a viewer assignee's status update sends a new event;
    - saving without a change sends nothing.
  - E2E journey 19 now also writes a note in the browser and checks the signed event names one book and not the note's text.
- **Limitations:** removing a member (which clears their assignments) and carrying a scope forward (which copies its notes; it is already reported as `scope.created`) send no `scope.items_annotated`.

### Encryption key rotation · COMPLETE
- **Implemented:** `DATA_ENCRYPTION_KEY`, which encrypts two-factor secrets and customer webhook signing secrets, can now be replaced without downtime (DEPLOYMENT_GUIDE §4, "Rotating `DATA_ENCRYPTION_KEY`").
  - **Values name their key:** new values record a short fingerprint of the key that encrypted them (the first 8 hex characters of its SHA-256). Values written before still read: each configured key is tried, and AES-GCM rejects a wrong one.
  - **The old key keeps working during a rotation:** `DATA_ENCRYPTION_KEYS_PREVIOUS` (comma-separated, up to 5) lists old keys that still decrypt; new values always use the current key. The configuration refuses a previous key that is the current one, or that is not 32 bytes.
  - **Re-encryption tool:** `rotate-data-key` (`npm run keys:check` / `npm run keys:rotate`; in production `node dist/cli/rotate-data-key.js [--check]`).
    - It rewrites every encrypted value with the current key, in batches.
    - It leaves alone a value that changed meanwhile (the app already wrote it with the current key), so running it twice changes nothing the second time.
    - It prints counts per column and per key, and records `admin.data_key_rotated` with counts and the key id only.
    - It exits with 1, naming them, when some values cannot be read with the configured keys.
  - The runbook covers the order of steps, the seconds of the rolling restart, and keeping the old key with backups made before the rotation.
  - Compose passes `DATA_ENCRYPTION_KEYS_PREVIOUS` through, and also `WEBHOOK_ALLOW_INSECURE_TARGETS`, which was missing for local Docker use.
  - No database change.
- **Files:** `src/lib/crypto.ts`, `src/config.ts`, `src/ops/data-keys.ts`, `src/cli/rotate-data-key.ts`, `src/auth/routes.ts`, `src/webhooks/{routes,service}.ts`, `src/db/seed-demo.ts`, `package.json`, `docker-compose.yml`, `.env.example`, `.env.docker.example`.
- **Tests:**
  - **Unit:** `unit/data-keys` (4): key ids; previous keys decrypting; old-format values; configuration rules.
  - **Integration:** `integration/data-keys` (3), with three app instances on one database (old key; new key with the old as previous; new key only):
    - two-factor sign-in and webhook signing work before re-encryption, after it, and with the new key alone;
    - old-format values are re-encrypted;
    - a second run changes nothing;
    - a value no configured key reads is reported and left as it is;
    - the command-line tool, run as a real process, checks, re-encrypts, records the audit entry without key material, and exits with 1 on an unreadable value.
- **Limitations:**
  - The key still lives in the environment file on the host; a secrets manager or KMS would keep it off the host.
  - The other secrets (`SESSION_SECRET`, database passwords, provider keys) are rotated by hand as in SECURITY_DESIGN §3.

### Webhook delivery history download · COMPLETE
- **Implemented:** in Settings → Webhooks → Deliveries, "Download history (CSV)" downloads every delivery kept for the endpoint (30 days), newest first, up to 10,000.
  - **Columns:** time, delivery and event ids, event, status, attempts, HTTP status, error, delivered and next-attempt times (UTC), the scope's id and name, and the exact JSON body sent. A redelivery shows the same event id.
  - **Rules:** owners and admins only, like the rest of the webhook settings. Formula-like cells are guarded as in the other CSV exports. The signing secret is never included. Each download is audited (`webhook.deliveries_exported`, with the row count) and limited to 10 a minute.
  - **Not a content export:** it needs no plan feature and does not count against the monthly exports, so the history stays available after a downgrade.
  - The dialog now says how many deliveries exist ("Showing the newest 50 of …"), how long they are kept, and when the download is limited to the newest 10,000.
  - The 30-day retention is now one constant shared by the cleanup job and the API.
- **Files:** `src/webhooks/{routes,service}.ts`, `src/jobs/tasks.ts`, `public/js/views/webhooks.js`, `public/js/i18n.js`, `public/app.css`.
- **Tests:**
  - `integration/webhooks` gains two tests:
    - the download (delivered, failed and pending rows, newest first, the formula guard, quoting, the exact body, no secret), editors refused, the audit entry, and the download still working after a downgrade;
    - with 10,005 deliveries, the list reports 10,005 and the download holds the newest 10,000.
  - E2E journey 19 downloads the history in the browser and checks the rows and the body against what the receiver got.
  - The accessibility audit now opens the deliveries dialog with a delivery in it (a failed test). This found the "Payload" toggle under the 24 px target size, which is fixed.
- **Limitations:** CSV only; one endpoint per file; no date filter (the 30 days kept are the whole history).

### Screen-reader review preparation · CHECKLIST READY, REVIEW NOT STARTED
- **Implemented:** `docs/SCREEN_READER_REVIEW.md`, a checklist for a manual review with NVDA, VoiceOver (macOS and iPhone) and TalkBack, in English and Arabic.
  - It covers what to set up, the test data, 15 checks on every page, 22 tasks by role (owner, editor, viewer, student, platform administrator), the Arabic interface, phones, and a results table.
  - Each item states what must be announced, using the interface's actual labels.
- **Fixed while preparing it** (found by reading the markup; axe does not check these):
  - The notifications button's unread count was not announced: its name replaced the badge. It is now "Notifications, 2 unread".
  - The whole page area was a live region, so screen readers could read a whole page out after each change. It is not a live region any more: pages are announced through the heading that takes focus, and messages through the status area.
  - Every page had the same title. Each page is now titled after its heading, followed by " · Curriculum Scope" (in Arabic, the Arabic name).
  - In the picker, a book's kind (Ministry, language-school, external reference, programme, assessment) was shown by colour only. Each book button now also says it, as the student portal already did.
  - Form hints and field errors were not linked to their fields. They are now the field's description, and a corrected field no longer carries its old error.
- **Files:** `docs/SCREEN_READER_REVIEW.md`, `public/index.html`, `public/js/{main,dom}.js`, `public/js/views/{shell,picker}.js`, `public/js/i18n.js`.
- **Tests:** a new E2E test checks, with the browser's accessibility tree, a field's description before and after an error, page titles in both languages, the picker's book names, the notifications button's name before and after reading, and that the page area is not a live region. Against the previous front end it reports 13 failures, one for each fixed problem (TEST_REPORT §3).
- **Limitations:** the review itself has not been done: it needs a person who uses a screen reader daily, and a native Arabic reader for the Arabic pass. Until then, how the app sounds is unverified.

### Screen-reader checklist for the teacher and student portal · CHECKLIST READY, REVIEW NOT STARTED

- **Asked:** "start on item 4" of the next priorities (§4.2): tasks for handing in homework, taking a timed test (what the timer and saving announce), the live monitor, marking and the gradebook, in both languages, with checks for each on the results page.
- **Implemented:**
  - **Checklist** (`docs/SCREEN_READER_REVIEW.md`): tasks 23–32 for the portal, written from what the pages actually announce: classes and homework, marking homework, writing a test, the live monitor, results and marking a test, the gradebook, keeping classroom data (teachers, owners and admins); Today and homework with files being checked, a timed test (the timer is read on demand, 5 and 1 minutes announced once, saving silent while it works and its failure said once), results and grades (students). Test data for them, including a 6-minute test to hear the timer. Tasks 24, 26–28 and 30–32 are repeated in Arabic (with the Arabic-Indic digits of the timer); a phone check for taking a test.
  - **Results page:** the shared page now holds 72 checks (32 tasks; F13–F16; AR4; P5), with the Arabic and phone ones shown only where they apply. Results recorded before stay as they were.
- **Found by the simulated screen reader on the portal, and fixed** (SCREEN_READER_PRECHECK §3, P10–P12):
  - **The timer** announced "5 minutes left" as soon as a test was opened with less time left, said "1 minutes left", did not announce again after the teacher gave more time, and used the singular for "5 minutes" in Arabic. Now each mark is said once when crossed (`public/js/countdown.js`, unit-tested), "1 minute left.", "متبقٍ ٥ دقائق." and "متبقٍ دقيقة واحدة.".
  - **Marking a test:** every question's fields had the same names; they now start with "Question N: " for screen readers.
  - **Live monitor:** the table was rebuilt every 5 seconds and focus put back on the teacher's button, which a screen reader reads again; now only changed cells are redrawn and a focused button stays.
- **Heard in the tests (simulated):** "Handed in." on handing in; saving failures said once; the monitor's summary when it changes, and the teacher's button read at most once while it refreshes; "Saved. Total: 2 / 2" on marking.
- **Left for the human tester, as checks:** how the timer and Arabic-Indic digits sound; whether the reading position holds while the monitor refreshes; where focus lands after attaching a file (the page is drawn again); whether moving through the gradebook's subject list with the arrow keys loads each subject at once (WCAG 3.2.2; the organization switcher works the same way).
- **Files:** `docs/SCREEN_READER_REVIEW.md`, `docs/SCREEN_READER_PRECHECK.md`, `public/js/countdown.js` (+ `.d.ts`), `public/js/views/{student-tests,tests}.js`, `public/js/i18n.js`, `tests/unit/countdown.test.ts`, `tests/e2e/accessibility.spec.ts`; the results page (artifact).
- **Tests:** `tests/unit/countdown.test.ts` (4); the accessibility audit's new listening checks (handing in, saving failures, the monitor, marking) and field names.

### Operations scripts for Linux and Windows · COMPLETE (drilled on the local production-settings stack; the Windows script not yet run on Windows)

- **Asked:** "is the deployment guide complete and what else can we do before making batch files to backup, restore, start and stop for everything?", then "both" (Linux and Windows) and "all options and choice during run" (every kind of backup copy, chosen while it runs).
- **Implemented:**
  - **The gaps found in the guide, first:**
    - Compose now passes every setting the app reads, so a managed database (with SSL), the pool size, the timings and the image tag can be set in the settings file.
    - Every container's log is capped at 5 × 10 MB.
    - A rebuild keeps the image it replaces as `curriculum-scope:previous`, for a rollback (`APP_IMAGE_TAG=previous`).
    - The production `migrate` job failed when the settings file set `FILE_SCAN=clamav`: fixed.
    - `ops/verify.sql` checks a database (migrations, forced row-level security, row counts of all 51 tables, invariants); `scripts/verify-backup.sh` uses it too.
    - Database passwords: hex is now advised, since base64's `/` breaks database addresses.
  - **`ops/cs.sh` (Linux) and `ops\cs.ps1` with `.bat` launchers (Windows):**
    - Commands: start, stop, status, back up, restore, test a backup, and set up the copies, plus a menu of all of them.
    - Every choice is asked and saved as the next default; `--yes` reuses the saved choices for cron and Task Scheduler.
    - The host needs only Docker: the tools run in containers.
  - **Backups:**
    - Contents: the database (homework files included) and a check of it, optionally the settings file and the TLS certificates.
    - Encrypted with a passphrase (AES-256-GCM with scrypt, by a tool in the app image, `src/lib/backup-crypt.ts`) and checksummed.
    - Copies: a folder or USB drive, an SFTP server (key or password, host key checked) and/or an S3-compatible bucket.
    - Old backups are deleted by age wherever the new one arrived.
    - One run at a time; a failure exits non-zero.
  - **Restores:**
    - A restore never overwrites: it creates a new database, checks it against the backup, then switches, keeping the previous database and settings.
    - After the switch, the encryption key is checked against every stored secret.
    - On a computer without a settings file, the backup's settings are put back, so one command rebuilds a lost server.
    - Managed databases are supported, with an admin that needs no superuser rights.
- **Tests:**
  - `tests/unit/backup-crypt.test.ts` (3).
  - The drill in TEST_REPORT §4: both scripts, every kind of copy, the failure cases, a lost server and a managed database. It found six problems, all fixed.
- **Files:** `ops/` (`cs.sh`, `cs.ps1`, the `.sh` and `.bat` launchers, `verify.sql`), `src/lib/backup-crypt.ts`, `src/cli/backup-crypt.ts`, `tests/unit/backup-crypt.test.ts`, `docker-compose.yml`, `docker-compose.prod.yml`, `.env.docker.example`, `.gitattributes`, `scripts/rolling-restart.sh`, `scripts/verify-backup.sh`, docs (DEPLOYMENT_GUIDE §3–5 and §7, new §8; TEST_REPORT §4; README).
- **Not done:**
  - The Windows script has run only under PowerShell 7 on Linux, not on Windows (Docker Desktop, Windows PowerShell 5.1, `cmd.exe`, Task Scheduler).
  - Copies went to servers in containers, not to a real cloud provider.
  - The start script's rebuild was not run here (builds need the proxy settings).
  - No scheduled job exists yet on a real host (B-4).
  - On Windows, Docker Desktop needs a signed-in user, so a server that must run unattended belongs on Linux.

### Journeys in Firefox and WebKit · COMPLETE

- **Asked:** "start on item 6" of the next priorities (§4.2): end-to-end tests in Firefox and WebKit as well as Chromium.
- **Implemented:**
  - **A run per browser:** `npm run test:e2e:firefox` and `npm run test:e2e:webkit` run the 24 journeys in Firefox 142 and in WebKit 26 (Safari's engine), each on a fresh database, since the journeys build on each other's data. `npm run test:e2e` stays Chromium, with the accessibility tests. `playwright.config.ts` builds the configuration for a browser; CI runs one end-to-end job per browser, and `scripts/ci-local.sh` runs all three.
  - **Bug found and fixed in the picker:** a book chosen or removed less than half a second before the page was reloaded or closed could be lost. In WebKit, journey 1 kept 1 of 3 books after a reload; in Firefox a change made just before a reload was lost; Chromium happened to deliver it. The picker saves in batches 0.4 s after the last change, said "Saved" after the first batch even when more were waiting, and sent what was left on leaving as an ordinary request, which the browser cancels with the page. Now every save is a keepalive request (the browser completes it after the page is gone), what is waiting is sent on `pagehide` (which Safari fires; it does not always fire `beforeunload`), and "Saved" is said only when nothing is left to send. Journey 1 now changes a selection and reloads at once: with the old picker this fails in Firefox and WebKit, with the new one it passes in all three.
  - **Two faults of Playwright's browser builds, worked around in the tests only** (`navigable()` in `tests/e2e/helpers.ts`; Chromium is left as it is):
    - Firefox sometimes loses a navigation's "load" event although the page has loaded, and the test then waits until it times out: 11 of 100 fresh pages in a probe, none of 100 when waiting for DOMContentLoaded, which its navigations now do.
    - WebKit's Linux build aborts the page on the second reload after a `history.pushState` (an internal assertion on an empty `std::optional`), which every in-app link makes; a bare page with one `pushState` does the same. Its reloads are made as a new load of the same address, which never failed.
- **Tests:** Chromium: 28 passed (24 journeys, 4 accessibility). Firefox: 24 passed. WebKit: 24 passed. Firefox and WebKit ran twice with the same result (TEST_REPORT §3).
- **Files:** `playwright.config.ts`, `playwright.firefox.config.ts`, `playwright.webkit.config.ts`, `package.json`, `.github/workflows/ci.yml`, `scripts/ci-local.sh`, `tests/e2e/helpers.ts`, `tests/e2e/journeys.spec.ts`, `public/js/api.js`, `public/js/views/picker.js`, `.gitignore`, `.dockerignore`, `eslint.config.js`, docs.
- **Not done:** the accessibility tests run in Chromium only. These are Playwright's Linux builds, not Safari on macOS or iOS, Firefox or Chrome on Windows or Android, or real phones and tablets. Whether real Safari has WebKit's reload fault is not known; the manual review can try it (open a page from the menu, then reload twice). Playwright's download site is blocked in this environment, so Firefox and WebKit were copied from Playwright's official Docker image of the same version (`mcr.microsoft.com/playwright:v1.56.1-noble`); CI downloads them as usual. CI on GitHub still waits on the billing lock (B-7).

### Arabic messages in the import previews · COMPLETE

- **Asked:** "start on item 5" of the next priorities (§4.2): translate the server validation messages in the roster import and catalogue sheet import previews.
- **Implemented:**
  - **Problem codes:** every problem the roster import and the catalogue sheet import report now carries a stable code and its parameters next to the English text (`src/lib/import-problems.ts`, 35 codes). API clients keep reading `message`. The Arabic interface shows the Arabic text for the code (`problemText` in `public/js/dom.js`); values taken from the file (a username, a scope or column name) are isolated so a Latin word cannot reorder the Arabic sentence around it.
  - **Roster import:** each problem is listed on its own, so a line with three problems is listed three times and counted as three. A file that is not UTF-8, or has a quote that is never closed, is refused with a code of its own (`FILE_NOT_UTF8`, `CSV_INVALID`) and an Arabic message; before, it was `BAD_REQUEST`, which the Arabic interface showed as the generic "something went wrong".
  - **Catalogue sheet import:** its errors and its warning carry codes too. In Arabic, the preview names a changed subject by its Arabic grade and subject names (the server's label is English), and "Row N" now reads «السطر N», as in the roster import, because «الصف» also means a grade.
- **Tests:** `tests/unit/import-problems.test.ts` (2): every code has an Arabic text with the same placeholders, and no Arabic text is left without a code. The unit and integration tests of both imports now check codes and parameters, and a new integration test covers a line with three problems and the two unreadable files. In the end-to-end tests, the accessibility audit opens the roster import in Arabic with five problems and checks each item's Arabic text, its right-to-left direction and the isolated values (one more screen, 0 findings); journey 11 uploads a sheet with two problems in the Arabic interface and checks the Arabic messages and the Arabic subject label.
- **Files:** `src/lib/import-problems.ts`, `src/students/{service,routes}.ts`, `src/catalog/sheet.ts`, `public/js/{dom,i18n}.js`, `public/js/views/{students,admin}.js`, `tests/unit/{import-problems,catalog-sheet}.test.ts`, `tests/integration/{students,catalog-sheet}.test.ts`, `tests/e2e/{accessibility,journeys}.spec.ts`, docs (`STUDENT_ACCOUNTS.md`, `API_DOCUMENTATION.md`, `USER_GUIDE.ar.md` and its import screenshots).
- **Not done:** a native speaker has not reviewed the new Arabic texts (4.1 item 6). Other server messages, such as the details of form validation errors and the operational alerts, are still English. The published copies of the Arabic user guide (web page, PDF and HTML) were rebuilt from `main` and republished the same day with the new screenshots.

### Simulated screen-reader pre-check and tester results page · COMPLETE (manual review still not started)
- **Implemented:**
  - **Simulated screen reader:** Guidepup's Virtual Screen Reader (`@guidepup/virtual-screen-reader` 0.33.0, MIT, development dependency only) reads every screen the accessibility audit checks, now 83, from top to bottom. A new test listens to what is announced after actions. The audit fails on an unnamed control or table header, a symbol read on its own, a skipped heading level, or text in the other language without `lang`. Transcripts are written to `test-results/screen-reader/` on each run. Details, coverage of the checklist's 22 tasks, and what a simulation cannot tell: `docs/SCREEN_READER_PRECHECK.md`.
  - **Results page for the tester:** a shared page holding the checklist's checks, where the tester marks Pass, Fail or Not applicable per combination and language, with notes. Each mark saves as it is made, in the page's own store, so the results can be read back and acted on. It needs Contributor access from the owner. Link in `docs/SCREEN_READER_REVIEW.md`.
- **Fixed after the pre-check:**
  - Text in the other language is marked with `lang`: English titles, names and notes in the Arabic interface, Arabic names in the English one (359 places). The element factory does it for every page.
  - The ✓ before the verification count and the bell emoji are hidden from screen readers.
  - Empty notes, assignees and progress read "None"; the line under a note reads "Last changed by …".
  - The column of row buttons is named "Details and actions" in 7 tables.
  - Pricing plans are level-2 headings.
  - Book kinds are said in full; the picker's colour key is a named group.
  - After a failed submission with field errors, focus moves to the first field in error (nothing was announced before); an error for the whole form is announced once.
- **Files:** `tests/e2e/screen-reader.ts`, `tests/e2e/accessibility.spec.ts`, `tests/e2e/helpers.ts`, `public/js/dom.js`, `public/js/verify.js`, `public/js/views/{shell,picker,student,items,assignments,billing,admin,members,scopes,students,webhooks}.js`, `public/js/i18n.js`, `public/app.css`, `package.json`, `docs/SCREEN_READER_PRECHECK.md`, `docs/SCREEN_READER_REVIEW.md`.
- **Tests:** E2E 23/23 (the audit with the simulated reader's checks on 83 screens, and the new announcements test).
- **Limitations:** a simulation has no voices, no language switching and none of a real screen reader's modes or verbosity; the manual review in `docs/SCREEN_READER_REVIEW.md` is still needed. The sandbox checkout page is not covered.

### Classes and homework (teacher and student portal, part 1 of 3) · COMPLETE (off for every school; legal assessment pending before real use)

- **Asked:** "a complete portal for teachers and students for daily assignments, monitoring and controlling exams and online tests … in English and Arabic". Built in three parts: (1) classes and daily homework, here; (2) online tests and exams with live monitoring; (3) a gradebook and the user guides.
- **Implemented** (`docs/CLASSROOM.md`):
  - **Classes:** owners and admins create classes (name, grade, a scope as curriculum), choose the students and add teachers per subject. A teacher is any member added to a class; they see only **My classes**. Archive or delete.
  - **Homework:** a subject's teacher (or an admin) sets homework with instructions, books from the class's curriculum, worksheet files, a due time, an optional later start, a full mark and whether late work is accepted. The class's students are notified in their language (scheduled homework by the worker when it appears).
  - **Students:** the portal opens on **Today** (to do, missed, returned this week), with **Homework** and **My books** (the curriculum, as before) and a notifications bell. A student writes an answer, attaches photos or PDFs, saves a draft, hands in, and can take work back until it is marked.
  - **Marking:** the roster shows who handed in, late and missing work; the teacher opens each piece with its photos, gives a mark and comments, and returns one or all marked work. Work done on paper can be marked too. Students see marks only once returned.
  - **Files:** JPEG, PNG, WebP and PDF, type decided from the bytes, 5 MB each, 5 per item, a per-school storage limit (`max_storage_mb`, 1 GB unless overridden), served sandboxed.
  - **Security:** classroom tables have forced row-level security; student requests set `app.current_student`, so a student's queries return only their classes, published homework and own work whatever they ask for. The same switch as student accounts turns it on; no plan or price changed.
  - **Arabic:** every page, dialog, status and error in both languages. Reviewing the screens fixed two display problems in Arabic: a mark "9 / 10" read as "10 / 9" (now "9 من 10") and a class "7A" shown as "A7" in mixed text (digits written against a Latin word now stay with it).
- **Not done (next parts):** online tests and exams, the gradebook, the user guides' new sections; no email or SMS to students or parents; no virus scanning of uploads (done 2026-10-27, see Safer uploads); no retention rule for old work (done 2026-10-27).
- **Before real use:** legal advice on children's work and marks under the PDPL (SECURITY_DESIGN §7).
- **Files:** `src/db/migrations/0013_classroom.ts`, `src/classroom/{service,files,routes,student-routes}.ts`, `src/students/context.ts`, `src/db/index.ts` (`withStudentContext`), `src/worker.ts`, `src/orgs/routes.ts`, `public/js/views/{classes,student,shell}.js`, `public/js/{api,dom,i18n}.js`, `public/app.css`.
- **Tests:** `tests/integration/classroom.test.ts` (7), the route coverage tests, journey 20, and 27 more screens in the accessibility audit.

### Online tests and exams with live monitoring (teacher and student portal, part 2 of 3) · COMPLETE (off for every school; legal assessment pending before real use)

- **Asked:** "monitoring and controlling exams and online tests", in English and Arabic (part 2 of the portal above).
- **Implemented** (`docs/ONLINE_TESTS.md`):
  - **Writing:** a subject's teacher (or an admin) writes a quiz or exam for a class: one or several correct choices, true/false, short answer (several accepted answers), written answer. Opening and closing times, an optional time limit, 1–10 attempts, shuffled questions or choices, a start code read out in the room, one device per attempt, when results show (on submitting, when the test closes, or when released) and whether answers are shown. Questions and timing are fixed once a student starts.
  - **Taking:** students see open and upcoming tests on **Today** and **Tests**, start (with the code), answer with saving as they go, and submit. **The server keeps the time**: late answers are refused and the attempt is submitted; the worker submits attempts nobody returns to. The page says what the teacher can see.
  - **Live monitor:** every student's state (not started, working and online, submitted), time left, answers given, and what the page noticed (left the page and for how long, pasting with its length only, offline, another device). Per student: more time, submit now, allow another device, another attempt, the event list. For the test: close now, new start code.
  - **Marking and results:** automatic marks for every type but written answers (fixed rules; Arabic spelling variants accepted in short answers; partial credit for several choices, never below 0); the teacher marks written answers, can override any mark, comments per answer, and releases results. Students see their score and, when shown, the correct answers once the test is over for everyone (a classmate's extra time included). **No AI marks.**
  - **Security:** forced row-level security: in a student's requests, questions only after starting, answer keys only after the test is over and answers are shown, only their own attempts. Read-only teachers of the class see no keys. No camera, microphone, screen or keystroke capture.
  - **Arabic:** every page, dialog, status and error message in both languages. The screen-reader check on the Arabic screens found English questions read in pieces (the final "?" on its own); text with no Arabic in it is now marked as English in one piece.
  - **Found in review and fixed before commit:** results "when the test closes" and the correct answers would have opened at the closing time while a student with extra time was still working; they now wait for that time. A new closing time did not move attempts already running; it does now. Teachers of another subject in the class could see answer keys on an attempt page; they no longer receive them.
- **Not done:** no question bank, images in questions, or parent accounts. (The gradebook and the user guides' new sections followed in part 3, below.)
- **Before real use:** legal advice on children's marks and the monitoring signals under the PDPL (SECURITY_DESIGN §7).
- **Files:** `src/db/migrations/0014_online_tests.ts`, `src/classroom/{marking,tests-service,tests-routes,tests-student-routes}.ts`, `src/classroom/{routes,student-routes}.ts`, `src/worker.ts`, `src/app.ts`, `public/js/views/{tests,student-tests,classroom-common,classes,student}.js`, `public/js/{dom,main,i18n}.js`, `public/app.css`.
- **Tests:** `tests/unit/test-marking.test.ts` (5), `tests/integration/online-tests.test.ts` (8), the route coverage tests, journey 21, and the test pages in the accessibility audit.

### Keeping classroom data (retention periods per school) · COMPLETE (off until a school sets periods; the periods are the school's legal decision)

- **Asked:** "start on item 1" of the next priorities (§4.2): each school sets how long it keeps classroom data, with a notice before deletion and the gradebook to download.
- **Implemented** (`docs/CLASSROOM.md` §11):
  - **Three periods per school**, in days from a homework's due time or a test's end: test monitoring records; students' work (homework answers and files, test answers); homework and tests with their marks. All unset ("Keep") until a school chooses: nothing is deleted before that. Work and monitoring cannot outlive their homework or test.
  - **Notice first:** when an item comes within 14 days of its period's end, owners and admins get an in-app notification and an email listing it; deletion waits at least 14 days after the notice, so a short period on old data never deletes anything at once. Saving shows how many items are already past the new periods and asks to confirm.
  - **Checked again when the date comes:** a longer period, a later due or closing time, or a hold cancels the deletion; a test with an attempt still running waits.
  - **Keep one item** (an appeal): a hold per homework or test, and "Let the periods apply" to lift it.
  - **What stays:** after work is deleted, hand-in times, marks, comments, automatic marks per answer and scores stay, and the gradebook is unchanged until the homework or test itself is deleted. Re-marking an attempt keeps the stored automatic mark of a deleted answer.
  - **Pages:** Classes → Keeping data (periods, what is due with a gradebook link and Keep, what is kept); homework and test pages say what is due or was deleted; students read that their answer was deleted because the school keeps work for a limited time, with their mark still shown. English and Arabic.
  - **Worker:** hourly, per school in its own tenant transaction (row-level security limits every deletion to that school); notices between 08:00 and 21:00 Cairo time; suspended schools skipped. Audited: `classroom.retention_updated`, `classroom.retention_hold`, and `classroom.retention_applied` by the system with titles and counts, never student work.
- **Not done:** classes, enrolments and student accounts are not deleted by the periods (schools remove those themselves); teachers are not notified (their pages show it); backups keep deleted data until pruned.
- **Before real use:** the periods themselves come from the school's legal advice (B-5, B-9).
- **Files:** `src/db/migrations/0015_classroom_retention.ts`, `src/db/{migrator,types}.ts`, `src/classroom/{retention,retention-routes}.ts`, `src/classroom/{service,routes,tests-service,tests-routes}.ts`, `src/notifications/email.ts`, `src/worker.ts`, `src/app.ts`, `public/js/views/{retention,classes,tests,student,student-tests}.js`, `public/js/{main,i18n}.js`.
- **Tests:** `tests/integration/classroom-retention.test.ts` (4), journey 23, 7 more screens in the accessibility audit, the guide scripts (one new screenshot per language).

### Exams at school scale (one online test for a whole grade on one school network) · COMPLETE (measured on the local two-instance stack; not on production hardware)

- **Asked:** "start on item 2" of the next priorities (§4.2): load-test one online test with 100–300 students and several teachers on the live monitor on the two-instance stack, then make the flood guard count per student session or raise it.
- **Found** (load test before the fix, 100 students from one address, 3 teachers, 8 minutes; TEST_REPORT §5): the limits on what students do counted **per address**, so a school shared one student's allowance. 40 of 100 students could not start the exam (starting: 60 per 15 minutes for the whole school), and after about 7 minutes heartbeats were refused (1,200 an hour for the whole school). The flood guard (600 requests a minute per address and instance) was not reached by 100 students, but would be by about 300.
- **Implemented:**
  - **Per student:** starting a test, saving answers, heartbeats, page events, homework drafts, hand-ins, uploads and the student's password change now count per account once the session is verified (`perAccount`), still in PostgreSQL and shared by both instances. One student is held to the same limits as before; a classmate at the same address is not affected.
  - **Flood guard in two steps:** before the session is looked up it counts per address, 600 a minute, or 6,000 for requests that carry a session cookie; after the lookup each account is held to 600 a minute, and a cookie that is not a valid session is counted for its address (a forged or rotated cookie gets no allowance of its own). Still in each process's memory: no database work per request.
  - **Saving on a weak connection:** an answer that fails to save (connection lost, 429, 5xx) is kept and tried again after 5 s, then up to every 30 s; the test bar says "Not saved yet (n): trying again" and a screen reader hears it once. Submitting tries those answers again first, and if some are still not saved it says how many and asks before submitting without them. Before, the page showed an error and did not try again (typed answers were sent again on submitting; a choice was saved only if the student changed it). English and Arabic.
  - **Load-test script** `scripts/load-exam.mjs`: sets up a school's class and a 20-question test through the API, signs students in from one address over the first minute, saves answers, sends heartbeats and page events as the page does, submits; teachers poll the monitor every 5 s; reports status codes and latency per kind of request and checks every acknowledged answer against the teacher's view.
- **Results after the fix** (same stack, 8 minutes each): 100 students with 3 teachers, and 300 students with 5 teachers (about 1,900 requests a minute from one address): every student started and submitted, **no request refused or failed**, every acknowledged answer stored (1,993 and 5,981). With 300 students, p95 was 28 ms for saving an answer, 25 ms for a heartbeat and 79 ms for the monitor (300 rows); the slowest request took 189 ms.
- **Not done:** not measured on production hardware or over a real school network; per-instance flood guard (an address can make up to N × 6,000 signed-in requests a minute with N instances; SECURITY_DESIGN §6 item 2).
- **Files:** `src/http/rate-limit.ts`, `src/app.ts`, `src/classroom/{tests-student-routes,student-routes}.ts`, `src/students/routes.ts`, `public/js/views/student-tests.js`, `public/js/i18n.js`, `scripts/load-exam.mjs`.
- **Tests:** `tests/integration/school-network-limits.test.ts` (2, both fail on the code before the fix), journey 24, the load test (TEST_REPORT §5).

### Safer uploads (virus scan and photo resizing of homework files) · COMPLETE (scanning verified with the real ClamAV on the local stack; not yet on the production host)

- **Asked:** "start on item 3" of the next priorities (§4.2): scan homework files for viruses in the worker before a teacher can open them, and resize large photos.
- **Implemented** (`docs/CLASSROOM.md` §5, migration 0016):
  - **Nobody opens a file before it is checked.** New uploads are *being checked*; the file routes answer 409 `FILE_CHECKING` until the worker is done. The worker checks files on its own loop every 2 seconds, oldest first, one transaction and row lock per file, so two workers never check the same file.
  - **Virus scan:** ClamAV's daemon over TCP (clamd `INSTREAM`), with the bytes as uploaded. The production compose file runs `clamav/clamav:1.5` next to the worker (signatures in a volume, updated by freshclam) and sets `FILE_SCAN=clamav`; production refuses to start without an explicit `FILE_SCAN` (`clamav` or `off`).
  - **Photos:** turned upright by their EXIF orientation, at most 2,000 pixels on the longer side (never enlarged), encoded again in the same format, which drops their metadata (a phone photo's location, time and phone model). Decoded in the worker, never in the web process; images claiming over 100 megapixels are refused before decoding. PDFs are kept as they are.
  - **A file with a virus** loses its bytes and shows "Virus found: deleted"; the uploader is told (in their language), and the school's owners and admins too; the audit log records it with the virus's name and the file's SHA-256. **A photo that cannot be read** is deleted and its uploader asked to upload it again. Blocked files take no storage.
  - **Scanner down:** files wait and are retried every pass (attempts and last error kept), the worker logs the error once, and a new operational alert, *Homework files waiting*, fires after 10 minutes.
  - **Older files** (before this change, or uploaded while scanning was off) stay open and are scanned in the background once a scanner runs.
  - **Pages:** "Being checked…" next to the file, and the list updates itself every 3 seconds without reloading the page (focus and what a student is typing stay); a toast says when a file was deleted. The upload hint says files open once checked. English and Arabic; both user guides say so.
- **Verified on Docker** (TEST_REPORT §4): the production-settings stack with the real ClamAV 1.5.4. A phone photo of 4,032 × 3,024 (106 KB, EXIF with GPS) became 2,000 × 1,500 (30 KB) without EXIF, checked 2.1 s after hand-in; the teacher got 409 before that. A PDF opened unchanged. The EICAR test file was found ("Eicar-Test-Signature"), deleted, audited and reported to the student and the owner. With ClamAV stopped, a file waited (retried every 2 s), the alert fired once its wait passed 10 minutes, and 15 s after ClamAV was started again the file opened.
- **Not done:** one antivirus engine only; PDFs are not rewritten; photos uploaded before 2026-10-27 keep their size and metadata.
- **Files:** `src/db/migrations/0016_file_checks.ts`, `src/db/{migrator,types}.ts`, `src/classroom/{file-checks,files,routes,student-routes}.ts`, `src/worker.ts`, `src/ops/alerts.ts`, `src/config.ts`, `public/js/views/{classes,student}.js`, `public/js/i18n.js`, `docker-compose.yml`, `docker-compose.prod.yml`, `.env.example`, `.env.docker.example`, `package.json` (`sharp`).
- **Tests:** `tests/unit/file-checks.test.ts` (5), `tests/integration/file-checks.test.ts` (6), `classroom.test.ts` (opening waits for the check), the configuration test, journey 20 and the accessibility audit (a photo being checked, then checked). The test PNG used by the classroom tests and journeys was corrupt (its compressed data failed its checksum); it is now a valid 1 × 1 PNG.

### Gradebook, My grades and the user guides (teacher and student portal, part 3 of 3) · COMPLETE (off for every school; legal assessment pending before real use)

- **Implemented** (`docs/CLASSROOM.md` §10):
  - **Gradebook** (class page → Gradebook): one subject at a time, a column for each homework with marks and each published test (oldest first), a row for each student. Cells show the mark, or To mark, Returned, Missing, Working, or nothing yet. A test counts the best marked attempt. The average counts marked work only; missing work is counted on its own, not as zero. Any teacher of the class and the school's admins can open it.
  - **CSV**: the same table in the member's language, formula-guarded, each download in the audit log. Not limited by plan: it is the school's own record.
  - **My grades** (student portal → Grades): the student's own marks per class and subject, homework once returned and tests once shown, with the average. Runs in the student's row-level security context.
  - **User guides**: a new chapter in English and Arabic, "Classes, homework, tests and grades", with 19 new screenshots in each language (81 per guide); the student portal and roles sections updated. Captured by the same script in both languages.
- **Fixed while doing it:** "1 points" on test pages (now "1 point", and in Arabic درجة واحدة / درجتان / ٣ درجات); a test's subtitle said "due" for its closing time; full-page screenshots of scrolled pages drew the sticky top bar mid-page.
- **Not done:** no weighting between homework and tests, term reports or grade scales; no parent accounts.
- **Files:** `src/classroom/{gradebook,gradebook-routes}.ts`, `src/app.ts`, `public/js/views/{grades,classes,student,tests,student-tests,classroom-common}.js`, `public/js/{main,i18n}.js`, `public/app.css`, `tests/e2e/user-guide.spec.ts`, `docs/USER_GUIDE.md`, `docs/USER_GUIDE.ar.md`, `docs/user-guide/images{,-ar}/`.
- **Tests:** `tests/integration/gradebook.test.ts` (3), journey 22, 6 more screens in the accessibility audit, and both guide scripts.

### Arabic user guide, and the Arabic interface fixes it led to · COMPLETE
- **Implemented:** `docs/USER_GUIDE.ar.md`, the user guide in Arabic, with 62 screenshots of the Arabic interface (`docs/user-guide/images-ar/`). The demo school and its people have Arabic names, and the guide names every button as the interface shows it.
  - **How it is made:** `npm run docs:screenshots:ar` (`playwright.guide-ar.config.ts`). The screenshot script (`tests/e2e/user-guide.spec.ts`) now runs in either language. It takes every label from the interface's own dictionaries, so the same steps drive both languages, and the English run still produces the English guide's 62 screenshots.
- **Fixed in the Arabic interface (found by the Arabic screenshots):**
  - **Reading order:** English text in the Arabic interface is now marked with its direction as well as its language. Two things were displayed out of order before:
    - a book title's closing bracket ("(Ministry textbook (Term 1 & Term 2");
    - email addresses and codes split at "@" or "_" ("nilevalley.example@salma.fathy").
  - **Address fields:** the "https://" placeholder showed as "//:https". Address and email fields now run left to right.
  - **Untranslated text:** 47 strings in the platform administrator's console were hardcoded English and are now translated: table headings, the plan form, the subscription summary, statuses, platform health, the audit filters and the catalogue editor's grade headings. The English wording is unchanged, except where raw codes now show as words: roles ("Owner", not "owner"), the billing interval ("Monthly", not "month") and billing states ("trial", not "trialing").
  - **Plan descriptions:** the four plans' descriptions are shown in Arabic while they keep their original English text. A description an administrator edits is shown as written.
  - **Emails:** the Arabic invitation named the role in English ("بدور editor"), and the Arabic assignment email said "books" for one book. Both are fixed.
  - **Audit log:** a long Arabic date no longer runs into the next column.
- **Files:** `docs/USER_GUIDE.ar.md`, `docs/user-guide/images-ar/*.png`, `docs/user-guide/images/*.png` (retaken), `tests/e2e/user-guide.spec.ts`, `playwright.guide-ar.config.ts`, `playwright.guide.config.ts`, `package.json`, `public/js/{dom,i18n}.js`, `public/js/views/{admin,billing,settings}.js`, `public/app.css`, `src/notifications/email.ts`, `tests/unit/email-templates.test.ts`, `tests/e2e/accessibility.spec.ts`.
- **Tests:**
  - A unit test for the two Arabic emails.
  - The accessibility audit now checks, in Arabic, that an email address is one left-to-right piece and that a book title keeps its closing bracket.
  - Both screenshot runs pass (62 screens each).
- **Limitations:** catalogue content (book titles, most notes, the catalogue's notice) is English in the catalogue itself, so it appears in English in the Arabic interface. Server-side validation messages and operational alert texts are still English, except the problems listed by the two import previews, which are shown in Arabic since 2026-10-27 (Arabic messages in the import previews, above). A professional translator has not reviewed the Arabic interface or guide.

### User guide with screenshots · COMPLETE
- **Implemented:** `docs/USER_GUIDE.md`, a guide to every part of the system for the people who use it, with 62 screenshots in `docs/user-guide/images/`. It covers:
  - signing up and signing in, roles, the picker, scopes and comparison;
  - notes, assignees and due dates; notifications and My assignments; members and invitations;
  - carrying a scope to a new year, billing, students and the student portal;
  - settings (API keys, webhooks, support access), the audit log, the account page, Arabic and phones;
  - the emails the system sends, with real examples, and the platform administrator's console.
- **How the screenshots are made:** `npm run docs:screenshots` (`playwright.guide.config.ts`, `tests/e2e/user-guide.spec.ts`) builds an invented demo school on a fresh test database through the interface, as its people would, and saves each screen. It is not part of `npm run test:e2e`. It fails if a step stops working or a dialog's content is wider than the dialog, so the pictures can be retaken after any interface change.
- **Fixed while taking them:**
  - **Billing:** during a trial, the plan being trialled showed "Current plan" with no **Subscribe** button, although the server accepts that checkout. It now shows both.
  - **Dialogs:** a new API key, a webhook signing secret and the example `curl` line ran past the right edge of their dialogs and were cut off. They now wrap. Webhook payloads are one column instead of two, and the deliveries dialog is wider.
  - **Styling:** the link field in the catalogue verification dialog had no styling (`input[type=url]` was missing from the shared field style).
  - **Phones:** the top bar stayed stuck while scrolling, covering about a quarter of the screen and the focused control (WCAG 2.4.11). It now scrolls away on small screens, like the picker's filters.
  - **Admin Users page:** members who joined by creating an account from an invitation showed no last sign-in, although they were signed in. That first sign-in is now recorded.
  - **Mixed-language text:** a title mixing scripts, such as "Al-Adwaa (الأضواء)", is kept in one piece, so the book buttons' spacing no longer splits it (a regression from the `lang` marking).
- **Files:** `docs/USER_GUIDE.md`, `docs/user-guide/images/*.png`, `tests/e2e/user-guide.spec.ts`, `playwright.guide.config.ts`, `package.json`, `public/app.css`, `public/js/dom.js`, `public/js/views/{billing,webhooks}.js`, `src/auth/routes.ts`.
- **Tests:** the billing journey checks the trialled plan's Subscribe button, and an integration test pays for the trialled plan end to end. An integration test checks the first sign-in from an invitation; it fails without its fix. The accessibility audit now fails if a dialog's content is wider than the dialog (it caught the API key dialog before the fix), and checks that a mixed-script title stays one piece. Unit and integration 259/259, E2E 23/23, and the guide's screenshot run (62 screens) pass.
- **Limitations:** the screenshots show the English interface on a desktop, plus a few Arabic and phone screens. The date fields show the test browser's month/day order; people see their own computer's format. The guide describes the sandbox checkout; the Paymob page is not shown until its keys exist.

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
  - Import error messages were in English until 2026-10-27; they are now shown in Arabic in the Arabic interface (Arabic messages in the import previews, above).
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
- **Limitations:** automated rules cover only part of WCAG; no manual review with a screen reader (NVDA, VoiceOver, TalkBack) yet (the checklist is ready: `docs/SCREEN_READER_REVIEW.md`); Chromium only.

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
- **Limitations:** Arabic copy not reviewed by a professional translator; end-to-end journeys in Chromium, Firefox and WebKit since 2026-10-27 (Chromium only before), the accessibility tests in Chromium only; accessibility checked automatically and by keyboard, not yet with a screen reader (checklist: `docs/SCREEN_READER_REVIEW.md`).

### Phase 5 — Production hardening · PARTIALLY COMPLETE
| Deliverable | Status | Evidence |
| --- | --- | --- |
| Security review + fixes (open redirect, MFA brute force, session hygiene) | COMPLETE | `authz-coverage.test.ts` |
| Dockerfile, compose (dev + prod overlay: Caddy and two app instances) | COMPLETE (local) | Image built; production-settings stack healthy; rolling restarts under load without failed requests (TEST_REPORT §4) |
| Operations scripts, Linux and Windows: start, stop, status, encrypted backups with copies (folder or USB drive, SFTP, S3 bucket), restore, test, scheduled runs | COMPLETE (local) | Drill with both scripts, including rebuilding a wiped server from an off-site copy (TEST_REPORT §4); the Windows script not yet run on Windows |
| CI workflow | PARTIALLY COMPLETE | GitHub Actions runs on `main` are refused (B-7). All workflow steps pass when run with `scripts/ci-local.sh` on a clean clone of `main` (2026-10-23) |
| Performance | PARTIALLY COMPLETE | Sandbox smoke results; no production-sized load test |
| Monitoring & alerting | PARTIALLY COMPLETE | In-app alerts by email and webhook (operational alerts section); still needed: alert channels set to real addresses, an external uptime check on `/readyz` (B-4) |
| Disaster-recovery drill on production infrastructure | NOT STARTED | Needs B-4 (the same drill passed on the local stack) |
| External penetration test | NOT STARTED | Recommended before launch |

### Phase 6 — Commercial release · NOT STARTED
Blocked by B-2…B-6. Plan: docs/IMPLEMENTATION_ROADMAP.md.

### Documentation · COMPLETE
All 16 documents in `docs/` plus `README.md`, written against the code as committed.

## 3. Definition of Done checklist

| Condition | State |
| --- | --- |
| Core workflows function correctly | ✓ (311 unit/integration + 28 E2E passing: 24 journeys, 4 accessibility; the 24 journeys also pass in Firefox and WebKit) |
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
| Backup and recovery tested | ✓ locally, with both scripts, including rebuilding a wiped server from an off-site copy; ✗ not on production infrastructure; ✗ the Windows script not yet on Windows |
| Deployment reproducible | ✓ locally (Docker/compose) |
| Documentation accurate | ✓ |
| Operational support and release procedures defined | ✓ documented (DEPLOYMENT_GUIDE §4–8) with scripts for Linux and Windows; rolling restart and the backup and restore drill exercised on a local production-settings stack; ✗ not on the production host |

## 4. Next development priorities

Where things stand (2026-10-27): the teacher and student portal is complete and off for every school.
It covers classes, daily homework, online tests and exams with live monitoring, the gradebook and the
students' grades. It was merged in PR #23 at `6837f1a`. Both user guides describe it, and the web
pages and offline copies (PDF and HTML, English and Arabic) were republished on 2026-10-27. Of 4.2,
items 1 to 6 are done the same day: schools set how long they keep classroom data (PR #24), one exam
for a whole grade on one school network was load-tested and its limits fixed (PR #25), homework files
are scanned for viruses and photos resized before anyone opens them (PR #26), the screen-reader
checklist covers the portal (PR #27), the problems listed by the two import previews are shown in
Arabic (PR #28), and the journeys run in Firefox and WebKit as well as Chromium, which found and fixed a
way to lose picker changes (PR #29). After that, at the owner's request, came the operations scripts for
Linux and Windows: start, stop, status, encrypted backups with copies, restores and a lost-server rebuild
(see above). The list below is done; what remains waits on the owner (4.1) or on the pilot's feedback.

### 4.1 Needed from the owner or from outside the team

These block release; development cannot do them.

| # | What | Why now | Blocker |
| --- | --- | --- | --- |
| 1 | Legal advice on students' data: accounts, homework and its files, marks, test answers and the monitoring signals. It should cover parental consent, the school as controller and the agreement with it, how long each kind of data is kept, the privacy notice, PDPL licensing and the hosting location | The PDPL Executive Regulations' grace period ends around 31 October–1 November 2026 (SECURITY_DESIGN §7). Until the advice is in, keep student accounts and the portal off for every school. The answers set the retention periods each school enters (Classes → Keeping data, built) | B-5, B-9 |
| 2 | Clear the GitHub billing lock, then let CI run on `main` on GitHub-hosted runners | PRs #22 and #23 were merged on local checks only | B-7 |
| 3 | Paymob test-mode keys, then `npm run paymob:check` and the staging checklist (DEPLOYMENT_GUIDE §3.5); decide the tax position | No real billing until then | B-2, B-3 |
| 4 | Production host, SMTP and alert channels, then the scheduled backup with an off-site copy and a restore drill there (scripts ready: DEPLOYMENT_GUIDE §8) | Nothing can be deployed | B-4 |
| 5 | Catalogue verification by a curriculum specialist (0 of 231 subjects so far) | Product value and liability | B-6 |
| 6 | Manual screen-reader review (SCREEN_READER_REVIEW.md) and a native speaker's review of the Arabic texts, the portal's pages first | Only simulated checks so far. The checklist now has 32 tasks, 23–32 for the portal (4.2 item 4, done), and the results page holds them | — |
| 7 | Decisions: whether and how student accounts and the portal are priced (free today, enabled per school by a platform administrator; no price is changed automatically); access to Wise (B-8) and an AI provider (B-10) | Needed before selling the portal, and before any AI feature | B-8, B-10 |
| 8 | Pilot with 3–5 design partners (IMPLEMENTATION_ROADMAP 6.10), with real students only after item 1 | Feedback decides the order of the later portal features in 4.2 | items 1, 4, 5 |
| 9 | If a Windows computer will run the app: on it, one backup, one test and one restore with `ops\cs.bat`, and the scheduled task (DEPLOYMENT_GUIDE §8.5) | The Windows script has only run under PowerShell 7 on Linux; there is no Windows here | — |

### 4.2 Development that can start now

In the recommended order. None of these items waits on a blocker. Sizes are estimates in days.

| # | Item | Why | Size |
| --- | --- | --- | --- |
| 1 | ~~**Retention of classroom data.**~~ **Done 2026-10-27** (Keeping classroom data, above): three periods per school, notices 14 days ahead to owners and admins, a hold per item, the gradebook linked for download, off until set | — | — |
| 2 | ~~**Exams at school scale.**~~ **Done 2026-10-27** (Exams at school scale, above): the load test found that 40 of 100 students on one address could not start; the portal's limits now count per student and the flood guard per account, and 100 and 300 students took the exam with no request refused | — | — |
| 3 | ~~**Safer uploads.**~~ **Done 2026-10-27** (Safer uploads, above): ClamAV scans every file in the worker before anyone opens it, photos are made at most 2,000 px without their metadata, and an alert fires when files wait | — | — |
| 4 | ~~**Screen-reader checklist for the portal.**~~ **Done 2026-10-27** (Screen-reader checklist for the teacher and student portal, above): tasks 23–32 in both languages and on the results page; three problems the simulated reader found are fixed | — | — |
| 5 | ~~**Arabic import messages.**~~ **Done 2026-10-27** (Arabic messages in the import previews, above): every problem in the roster and catalogue sheet previews has a code, and the Arabic interface says it in Arabic | — | — |
| 6 | ~~**E2E in Firefox and WebKit**~~ **Done 2026-10-27** (Journeys in Firefox and WebKit, above): the 24 journeys pass in all three engines; a picker change made just before leaving the page is no longer lost | — | — |

**After the pilot's feedback, not before:**
- weighting between homework and tests, term reports and grade scales;
- a question bank, and images or formulas in questions;
- parent accounts with email or SMS to parents. These depend on the legal advice, and could also be how parents give consent;
- card-on-file renewals (after B-2) and SSO for school groups (roadmap P2).

**Resume point (2026-10-27).** PR #30 (Arabic guide republished) is merged. On
`claude/friendly-rubin-hmemjl` (from `main` at `6f0bfd8`): the operations scripts for Linux and Windows.
4.2 is finished; the next development work is for the owner to choose, from the items after the pilot
or from 4.1 once its blockers clear. Waiting on the owner: legal advice before real student use (B-5,
B-9), the GitHub billing lock (B-7), Paymob keys (B-2), access to Wise (B-8) and an AI provider (B-10).
