# Test report

Only results that were actually executed are reported here.

## Environment

| Item | Value |
| --- | --- |
| Date | 2026-10-22 (final full run started 11:06 UTC) |
| Machine | Cloud development container, Ubuntu 24.04, 4 vCPU, 15 GB RAM |
| Runtime | Node.js 22.22.0; PostgreSQL 16.15 (local cluster); Docker 29.9.1 / Compose 5.6.0 |
| Browser | Chromium 1194 via Playwright 1.56.1 |
| Commit | latest on branch `claude/friendly-rubin-hmemjl` (see `git log`) |

## 1. Static checks

| Check | Command | Result |
| --- | --- | --- |
| Lint | `npm run lint` (ESLint 9 + typescript-eslint) | **Pass** (0 problems) |
| Type check | `npm run typecheck` (server + E2E configs) | **Pass** |
| Dependency audit | `npm audit` | **0 vulnerabilities** (after upgrading `@fastify/static` 8→10, `nodemailer` 7→10, `vitest` 3→5, which had advisories on first install) |

## 2. Unit and integration tests — `npm test`

**35 files, 257 tests, 257 passed, 0 failed** (2026-10-25, after the webhook delivery history download and the screen-reader fixes). Integration tests ran against a real
PostgreSQL database with a non-superuser owner role and a separate non-BYPASSRLS app role.

| File | Tests | Result |
| --- | --- | --- |
| unit/catalog-fidelity | 3 | Pass — the seed equals the original artifact's 231 subjects / 1,038 materials item-for-item |
| unit/billing-logic | 9 | Pass |
| unit/security-primitives | 12 | Pass — includes the CSV `note`, `assignee`, `status` and `due_on` columns (at the end, formula-guarded), and production refusing `WEBHOOK_ALLOW_INSECURE_TARGETS` |
| unit/i18n | 2 | Pass |
| unit/scope-compare | 2 | Pass — same version (only in each, in both); across versions (renamed, missing books and subjects, block renamed) |
| unit/carry-forward | 4 | Pass — natural-key matching, loose renames, removed subjects, ambiguous keys |
| unit/csv | 3 | Pass — quotes, line breaks, Arabic, formula guard round trip, Excel semicolons and CRLF |
| unit/catalog-sheet | 6 | Pass — export layout, published vs draft rules, mark clearing, errors, encoding, semicolons |
| unit/alerts | 2 | Pass — 5xx counter windows; worker-stopped threshold |
| unit/rate-limit-memory | 2 | Pass — fixed windows; memory bounded, oldest windows dropped first |
| unit/data-keys | 4 | Pass — key ids in new values; previous keys decrypt and an unconfigured key is named; old-format values read with whichever key opens them; `DATA_ENCRYPTION_KEYS_PREVIOUS` rules |
| unit/webhook-net | 4 | Pass — public-address classifier (private, loopback, link-local, CGNAT, documentation, multicast, NAT64, 6to4, IPv4-mapped); URL rules (https only, no credentials, no private or local hosts, development setting); the socket's DNS lookup refusing a host that resolves to loopback; signature format |
| unit/reminders | 3 | Pass — reminder wording in English and Arabic (today, tomorrow, dates across month and year ends, month in words in Arabic with no direction marks), overdue listed first, long lists shortened, notice titles |
| integration/auth | 13 | Pass |
| integration/tenancy | 16 | Pass |
| integration/scopes | 10 | Pass |
| integration/scope-compare | 3 | Pass — same catalogue with CSV (counted, audited); last year against this year; other organization 404, same scope 400, viewer allowed, CSV refused on Free |
| integration/scope-carry-forward | 4 | Pass — preview, copy with replacements, move at the Free limit, validation and roles |
| integration/scope-notes | 21 | Pass — status and due dates (validation, the assignee-viewer rule, bulk changes), assignment emails (language, opt-out, none for yourself, long lists shortened), My assignments (order, filters, navigation counts), status and due date in duplicates, carry-forward and exports; notes and assignees: set and read; viewers refused; unselected books, long notes, empty requests; assignee must be a member (also enforced by the database); clearing; note text kept out of the audit log; notifications in the assignee's language, once, none for yourself; bulk assignment (all or nothing, notes kept); member removal clears assignments; scopes list counts; read-only scopes; deselection; duplicate; carry-forward (copy and move; preview counts lost notes); CSV/JSON/API exports; other organizations 404 |
| integration/due-reminders | 10 | Pass — the worker's due-date reminders: one email per member and organization listing overdue and due-soon books, once (the next day only what changed); each member's language; done, unassigned and long-overdue books left out; only between 08:00 and 21:00 Cairo time; reminded again after a new due date or assignee, not after reopening; the email opt-out and unverified addresses keep the in-app notice; suspended accounts and organizations skipped until active; three concurrent passes send each reminder once; long lists shortened; records removed with the book, the member and 60 days after the due date, and invisible to other organizations; the navigation's due-soon count |
| integration/data-keys | 3 | Pass — key rotation across three app instances on one database: two-factor sign-in and webhook signing before re-encryption, after it and with the new key alone; old-format values re-encrypted; idempotent; unreadable values reported and untouched; the command-line tool run as a process (check, rotate, audit without key material, exit 1 on unreadable values) |
| integration/webhooks | 14 | Pass — customer webhooks against a local receiver: the delivery history download (delivered, failed and pending rows newest first, formula guard, quoting, the exact body sent, no secret; editors refused; audited; still available after a downgrade; capped at the newest 10,000 of 10,005); management (secret once, stored encrypted; editors refused; validation; limit of 5; plan without API access 402); signed delivery of every event to subscribed endpoints only, payload and key order; merging of quick changes; notes and assignments as one event naming every book changed, without note text or names, also for a viewer's status update, none for a save without a change; duplicate and carry; retries with backoff and final failure; switch-off after 25 failures with notification and audit, switching back on; redirects not followed and timeouts; test, redelivery (same event id), secret rotation; events stop without API access; other organizations 404 and RLS; 30-day retention; with default settings, non-https and private URLs refused and nothing sent to a private address |
| integration/all-assignments | 4 | Pass — My assignments across organizations: two organizations merged in one order with totals and per-organization counts, done/all filters, other members' books never shown; status update as a viewer through the book's organization; suspended and two-factor organizations listed as unavailable and not read; same books as the organization's own page; 401 signed out, 403 for students |
| integration/assignment-digest | 9 | Pass — the daily summary: no email per assignment for members who chose it (in-app notice kept); one summary the next morning, then none; at most one a day (assignments after the morning's sending time wait); one email across two organizations grouped by scope and assigner; unassigned/removed books and suspended organizations left out; switching back or off drops the queue, choice validated; unverified addresses; Arabic and long lists; three concurrent passes send one summary; RLS for other organizations and members; cleanup after 30 days |
| integration/catalog-sheet | 5 | Pass — export, preview writes nothing, apply with notifications and audit, all-or-nothing, drafts, access |
| integration/catalog-notifications | 4 | Pass — who is notified on publish/archive, language, email opt-out, once per year, flags |
| integration/billing | 13 | Pass |
| integration/catalog-verification | 6 | Pass — marks on published versions, validation, archived refusal, copy and reset rules, exports |
| integration/paymob-contract | 11 | Pass — the real `PaymobProvider` over HTTP against a simulator of Paymob's documented API |
| integration/admin-api-ops | 12 | Pass |
| integration/authz-coverage | 5 | Pass — enumerated all 30+ admin routes and 30+ org routes |
| integration/students | 25 | Pass — student accounts (`docs/STUDENT_ACCOUNTS.md`): off by default and per-school override; sign-in, equal errors, lockout, staff reset, password change; every application route called with a student session (only the portal answers); database triggers and constraints; roles; another school 404 and RLS; scopes of the same school only; account deletion; platform user list; roster import (preview, all or nothing, Excel/Arabic files, limit); the portal's curriculum; suspended school; generated passwords |
| integration/alerts | 6 | Pass — one alert across two instances, reminder after 6 h, one resolution after 5 min clear; every check; no customer data in messages; database outage from memory; a failing channel does not stop the other; 5xx counting; admin list and audited test alert |
| integration/shutdown | 1 | Pass — the real server process reports draining on SIGTERM, keeps serving during the drain, exits cleanly |
| integration/rate-limit-store | 6 | Pass — one login limit across two app instances and a restart; exact counts under concurrency; window expiry; HMAC keys only; the global guard stays per process; cleanup |

Full test names (verbatim from the verbose reporter):

<details><summary>Show all 257</summary>

- tenancy › cross-tenant isolation over the API › a member of org B cannot read, modify, export or delete org A data
- tenancy › cross-tenant isolation over the API › object ids from another tenant are rejected even under the attacker’s own org (BOLA)
- tenancy › cross-tenant isolation over the API › rejects malformed org ids without leaking errors
- tenancy › Row-Level Security › every table with an org_id column has forced RLS, apart from the documented exceptions
- tenancy › Row-Level Security › returns no tenant rows without a tenant context, even for an unscoped query
- tenancy › Row-Level Security › only exposes the current tenant’s rows inside a tenant context
- tenancy › Row-Level Security › blocks writing rows for another tenant (WITH CHECK)
- tenancy › Row-Level Security › the application role cannot bypass RLS or rewrite audit history
- tenancy › Row-Level Security › composite keys stop items pointing at another tenant’s scope or another catalogue version
- tenancy › roles and permissions › enforces the permission matrix server-side
- tenancy › roles and permissions › transfers ownership with password confirmation and keeps a single owner
- tenancy › roles and permissions › member removal rules: owner cannot be removed, members can leave, removed users lose access
- tenancy › invitations › existing users accept with their own account; email must match
- tenancy › invitations › revoked invitations cannot be used and duplicate members are refused
- tenancy › data deletion and export › owner deletes an organization: its data is gone, other tenants untouched, audit retained
- tenancy › data deletion and export › a user can export their data and delete their account unless they own an organization
- auth › registers an owner with an organization on a 14-day trial and requires verification before login
- auth › does not reveal whether an email is already registered
- auth › rejects weak passwords and invalid input with field details
- auth › locks the account after 5 failed attempts and uses a generic error
- auth › rate-limits repeated login attempts per client and account
- auth › logout invalidates the session
- auth › rejects state-changing requests without the session CSRF token
- auth › rejects cross-origin requests and non-JSON bodies
- auth › resets the password with a single-use token and revokes existing sessions
- auth › changing the password requires the current one and signs out other sessions
- auth › requires a TOTP code at login once enabled, and rejects replayed codes
- auth › disabling MFA requires password and a valid code
- auth › lists and revokes own sessions only
- admin-api-ops › is invisible to ordinary users and requires MFA for admins
- admin-api-ops › sees customer metadata but not scope contents without a support grant
- admin-api-ops › suspends and restores organizations and users
- admin-api-ops › assigns an enterprise plan manually with custom limits
- admin-api-ops › manages catalogue versions: clone to draft, edit, publish; published is read-only
- admin-api-ops › updates plan prices and limits with audit
- admin-api-ops › requires a plan with API access, authenticates by key, meters usage and honours revocation
- admin-api-ops › health and readiness endpoints
- admin-api-ops › sets security headers and a strict CSP
- admin-api-ops › never leaks internals in error responses
- admin-api-ops › worker delivers queued email, retries failures with backoff, and redacts bodies after sending
- admin-api-ops › cleanup applies retention and heartbeat is visible to admins
- billing › lists public plans without authentication
- billing › trial → paid Starter via hosted checkout and signed webhook
- billing › a failed payment leaves the invoice open and notifies the owner; retry succeeds
- billing › refuses non-self-serve plans and billing actions from non-owners
- billing › rejects bad signatures, stale timestamps and unknown providers
- billing › processes each event once (replay is a no-op)
- billing › does not activate a plan when the paid amount does not match the invoice
- billing › upgrades mid-period with a prorated charge and keeps the period
- billing › schedules a downgrade; the renewal invoice bills the new plan and applies it when paid
- billing › cancel keeps access until period end, then moves to Free; resume undoes it
- billing › unpaid renewal: past due with grace period, then Free
- billing › sends one trial-ending notice, then moves to Free when the trial ends
- billing › a user gets one trial; additional organizations start on Free
- scopes › serves the published 2026/2027 catalogue with ETag caching
- scopes › requires authentication
- scopes › creates a scope, toggles materials in batches, and persists across sessions
- scopes › rejects materials from another catalogue version or unknown ids
- scopes › enforces unique names per organization and draft-version restrictions
- scopes › duplicates a scope with its items
- scopes › exports text in the original list format, CSV and JSON during the trial
- scopes › Free plan: text export only, monthly export quota, one scope
- scopes › after a downgrade, scopes beyond the limit become read-only but are not deleted
- scopes › member limit counts pending invitations and is enforced under concurrency
- authz-coverage › every route is either admin-only, org-scoped, API-key-only, or explicitly allow-listed
- authz-coverage › admin routes: 401 when anonymous, 404 for ordinary users (surface not disclosed)
- authz-coverage › org routes: 401 when anonymous, 404 for members of another organization
- authz-coverage › public API routes require an API key
- authz-coverage › locks the account after repeated wrong codes and ends the pending session
- unit › passwords: hashes with argon2id and verifies
- unit › secret encryption: round-trips and detects tampering
- unit › TOTP: accepts a current code once and rejects replay of the same step
- unit › TOTP: generates unique recovery codes and normalizes input
- unit › webhook signatures: sandbox verifies signed payloads, rejects tampering and stale timestamps
- unit › webhook signatures: paymob HMAC-SHA512 over the documented field order
- unit › webhook signatures: paymob matches the signature vector of an independent implementation (Odoo)
- paymob-contract › creates an intention as documented and sends the customer to Unified Checkout
- paymob-contract › turns a Paymob API rejection into a 502 without exposing provider details; retry works
- paymob-contract › turns an unreachable Paymob API into a 502 as well
- paymob-contract › a successful payment marks the invoice paid and activates the plan; retried callbacks are deduplicated
- paymob-contract › a declined payment is recorded and the invoice stays open; a new checkout attempt can then be paid
- paymob-contract › applies a payment made on an earlier checkout attempt of the same invoice
- paymob-contract › rejects callbacks with a missing or wrong HMAC, a tampered body or an unsupported type
- paymob-contract › binds the payment to the signed Paymob order, not to the unsigned merchant_order_id
- paymob-contract › the browser redirect is signed over the same fields (what `npm run paymob:check` verifies)
- paymob-contract › ignores signed callbacks for orders this app did not create
- paymob-contract › does not apply pending, refunded or wrong-amount transactions
- unit › exports: text export keeps the original "Copy list" layout
- unit › exports: CSV neutralises spreadsheet formulas and quotes properly
- unit › exports: CSV carries verification columns, with the same formula guard on sources
- catalog-verification › marks entries of the published catalogue; customers see the mark and coverage, not the reviewer
- catalog-verification › records entries that need review with a public note, and resets marks to unverified
- catalog-verification › validates the request and the targets
- catalog-verification › is admin-only and refuses archived versions
- catalog-verification › copies marks into a draft of the same academic year only; content edits reset them, unchanged saves do not
- catalog-verification › scope exports carry the marks
- scope-compare › on one catalogue: only in each and in both; the CSV download is counted and audited
- scope-compare › compares last year's scope with this year's: books matched by subject and title, renamed and missing ones marked
- scope-compare › only within one organization; viewers can compare; the CSV needs CSV export on the plan
- unit › comparing two scopes: on one catalogue version: only in A, only in B, in both; untouched subjects are left out
- unit › comparing two scopes: across catalogue versions: matched by subject and title, with renamed and missing books and subjects marked
- unit › carry forward: carries exact and loosely matching titles, and lists missing books with new candidates
- unit › carry forward: follows a subject whose block was renamed when its code is unambiguous
- unit › carry forward: reports removed subjects, ignores unselected ones, and summarises
- unit › carry forward: does not guess when the loose subject key is ambiguous
- scope-carry-forward › previews what carries over, what is missing, what changed and what is new
- scope-carry-forward › copies into a new scope for the new year, with chosen replacements; the old scope is untouched
- scope-carry-forward › moves a scope in place, which also works at the Free plan scope limit
- scope-carry-forward › validates the target and the materials, and requires an editor to apply
- catalog-notifications › a newer catalogue notifies owners, admins and editors of organizations behind it, in their language, once per year
- catalog-notifications › organizations already on a year hear about its correction only when the version they use is archived
- catalog-notifications › entries newly flagged for review notify organizations that selected them; repeats and other marks do not
- catalog-notifications › users can turn catalogue emails off and on in their profile
- unit › CSV: round-trips quotes, delimiters, line breaks, Arabic text and guarded formulas
- unit › CSV: reads files saved by Excel: semicolons, CRLF, trailing blank lines, no BOM
- unit › CSV: rejects an unterminated quote and leaves ordinary apostrophes alone
- unit › catalogue spreadsheet: exports every subject followed by its materials, and an untouched sheet changes nothing
- unit › catalogue spreadsheet: applies marks on a published version and rejects incomplete ones
- unit › catalogue spreadsheet: allows content changes and new materials only in drafts; content changes clear marks left untouched
- unit › catalogue spreadsheet: round-trips a formula-looking title without reporting a change
- unit › catalogue spreadsheet: reports unknown ids, duplicates, moves, title clashes, bad values, encoding and missing columns
- unit › catalogue spreadsheet: reads a semicolon-separated sheet saved by Excel in some locales
- catalog-sheet › exports the whole catalogue with ids and marks
- catalog-sheet › previews then applies verification marks on the published catalogue, notifying customers of new flags
- catalog-sheet › refuses content changes on a published version as a whole: nothing is written
- catalog-sheet › applies corrections and new materials to a draft; a correction clears a mark left untouched
- catalog-sheet › is admin-only, refuses archived versions and explains encoding problems
- unit › configuration: refuses unsafe production settings
- unit › catalogue fidelity: same 231 subject rows and 1,038 selectable materials
- unit › catalogue fidelity: every subject and material in order, except the documented intl kind correction
- unit › catalogue fidelity: legacy selection keys unique
- unit › effective plan (4 tests), proration (2), time helpers (3)
- unit › translations: Arabic covers every English key and placeholders match; every referenced key exists
- rate-limit-store › two app instances enforce one login limit, and a restarted instance still enforces it
- rate-limit-store › stores keyed hashes only: no IP address or email
- rate-limit-store › the global flood guard stays per process: it limits at 600 a minute and writes nothing to the database
- rate-limit-store › counts concurrent requests from several instances exactly
- rate-limit-store › starts a new window when the old one ends; reading does not count; namespaces are separate
- rate-limit-store › the worker deletes expired counters and keeps live ones
- shutdown › reports draining on SIGTERM, keeps serving during the drain, then exits cleanly
- alerts › sends one alert per problem across instances, a reminder after 6 hours, and one resolution once it clears
- alerts › checks email delivery, server errors, payment notifications and migrations; messages carry counts, not addresses
- alerts › alerts from memory when the database is unreachable, reminds after 6 hours, and resolves when it is back
- alerts › a failing channel does not stop the other; failures are logged without the webhook URL
- alerts › counts 5xx responses, except the health endpoints
- alerts › platform admins see alerts and can send a test alert (audited); customers cannot
- unit › alert helpers: counts server errors over the last minutes and forgets older ones
- unit › alert helpers: considers the worker stopped after four intervals, at least two minutes
- unit › in-memory flood guard windows: counts within a window and starts again when it ends
- unit › in-memory flood guard windows: stays bounded, dropping the oldest windows first
- students › student accounts are off until enabled › no plan includes them; the staff page says so and creation is refused
- students › student accounts are off until enabled › a platform administrator turns them on per school with a limit override, and the limit holds
- students › student accounts are off until enabled › a school back on the Free plan loses the override: no sign-in, and open sessions stop working
- students › student sign-in › signs in with school code, username and password; /me describes the student and school
- students › student sign-in › gives the same answer for an unknown school, an unknown username and a wrong password
- students › student sign-in › cannot sign in through the staff sign-in, and a student username is per school
- students › student sign-in › locks after five wrong passwords; a staff reset lifts the lock and ends existing sessions
- students › student sign-in › a student can change their password; other sessions end
- students › a student account reaches only the student portal › every other route refuses a signed-in student, including their own school's staff routes
- students › a student account reaches only the student portal › staff accounts cannot use the student portal routes
- students › a student account reaches only the student portal › the database refuses a membership for a student and a kind change
- students › school staff manage their students › admins and the owner only; editors and viewers are refused
- students › school staff manage their students › another school cannot see, change, reset or remove them (404)
- students › school staff manage their students › assigns a scope of the same school only, and edits name and grade
- students › school staff manage their students › removing a student deletes the account and its sessions; deleting the school deletes all its students
- students › school staff manage their students › platform administrators do not see student accounts in the user list
- students › roster import › previews problems line by line and imports nothing while any remain
- students › roster import › reads Excel-style files (semicolons, BOM, Arabic headers) and returns each password once
- students › roster import › refuses a file that would pass the plan limit, as a whole
- students › roster import › rejects files without the required columns or with too many rows
- students › the student portal › shows the books of the student's grade that are in the assigned scope, and nothing else
- students › the student portal › without a scope it says so, and other students' or schools' data never appears
- students › the student portal › a student can switch the interface language
- students › the student portal › a suspended school blocks its students
- students › generated passwords › use an unambiguous alphabet and do not repeat
- scope-notes › notes and assignees on selected books › an editor sets a note and an assignee; everyone in the organization sees them
- scope-notes › notes and assignees on selected books › viewers cannot change them; books that are not selected, long notes and empty requests are refused
- scope-notes › notes and assignees on selected books › the assignee must be a member of the organization
- scope-notes › notes and assignees on selected books › clearing both note and assignee clears the item; the note text never reaches the audit log
- scope-notes › notes and assignees on selected books › a new assignee is told in their own language, once; assigning yourself sends nothing
- scope-notes › notes and assignees on selected books › assigns several books at once: one notice with the count, notes kept, unknown books refuse the whole request
- scope-notes › notes and assignees on selected books › removing a member clears their assignments and keeps the notes
- scope-notes › notes and assignees on selected books › the scopes list counts notes, assignments and what is assigned to me
- scope-notes › notes and assignees on selected books › a read-only scope (over the plan limit) cannot be annotated
- scope-notes › notes and assignees on selected books › deselecting a book drops its note with it
- scope-notes › notes travel with the scope › a duplicate keeps notes and assignees
- scope-notes › notes travel with the scope › carrying forward keeps notes on carried books and reports those on books that cannot be carried
- scope-notes › notes travel with the scope › CSV and JSON exports and the read API carry note and assignee; the text export stays the original layout
- scope-notes › notes travel with the scope › another organization cannot read or change them
- scope-notes › status, due dates, assignment emails and my assignments › an editor sets a status and a due date; bad values are refused
- scope-notes › status, due dates, assignment emails and my assignments › the member a book is assigned to can update its status, even as a viewer, and nothing else
- scope-notes › status, due dates, assignment emails and my assignments › updates status and due date of several books at once, keeping notes and assignees
- scope-notes › status, due dates, assignment emails and my assignments › emails the new assignee the list of books, in their language, unless they turned it off
- scope-notes › status, due dates, assignment emails and my assignments › a long list is shortened in the email
- scope-notes › status, due dates, assignment emails and my assignments › my assignments: across scopes, overdue first, then by due date; done ones apart; counts for the navigation
- scope-notes › status, due dates, assignment emails and my assignments › status and due date travel with duplicates and carry-forward, and appear in exports
- unit › exports › CSV ends with the item note, assignee, status and due date, formula-guarded
- due-reminders › due-date reminders › reminds the assignee once about books due soon and overdue, in one email listing both
- due-reminders › due-date reminders › writes to each member in their language, one email per member
- due-reminders › due-date reminders › leaves out done books, unassigned books and books overdue for more than a week; sends only between 8:00 and 21:00 Cairo time
- due-reminders › due-date reminders › a new due date or a new assignee is reminded again; reopening a book is not
- due-reminders › due-date reminders › turning reminder emails off keeps the in-app notice; unverified addresses get the notice only
- due-reminders › due-date reminders › suspended accounts and organizations get nothing until they are active again
- due-reminders › due-date reminders › two workers running at once send each reminder once
- due-reminders › due-date reminders › a long list is shortened in the email
- due-reminders › due-date reminders › records go with the book, the member and old due dates, and stay inside the organization
- due-reminders › due-date reminders › the navigation counts books due soon
- unit › due-date reminder wording › says today, tomorrow, or the date, across month and year ends
- unit › due-date reminder wording › lists overdue books first, each section by due date, and shortens long lists
- unit › due-date reminder wording › titles the in-app notice by what is due
- assignment-digest › daily summary of assignment emails › members who chose it get no email per assignment, only the in-app notice; the books wait for the morning summary
- assignment-digest › daily summary of assignment emails › sends at most one summary a day: what is assigned after the morning sending time waits for the next morning
- assignment-digest › daily summary of assignment emails › one email covers every organization, grouped by scope and by who assigned the books
- assignment-digest › daily summary of assignment emails › leaves out books unassigned or removed since, and suspended organizations; nothing left means no email
- assignment-digest › daily summary of assignment emails › switching back to emails right away, or off, drops what was waiting; the choice is validated
- assignment-digest › daily summary of assignment emails › an unverified address gets no summary; the waiting books are dropped
- assignment-digest › daily summary of assignment emails › writes in the member’s language and shortens long lists
- assignment-digest › daily summary of assignment emails › two workers running at once send one summary
- assignment-digest › daily summary of assignment emails › waiting rows stay inside the organization and the member; old ones are cleaned up
- all-assignments › My assignments across all organizations › lists the member’s books from every organization in one order, with counts per organization and in total
- all-assignments › My assignments across all organizations › the member updates a book’s status through its own organization, even as a viewer there
- all-assignments › My assignments across all organizations › suspended organizations, and ones asking this member for two-factor sign-in, are listed as unavailable and not read
- all-assignments › My assignments across all organizations › a member of one organization gets the same books as on its own page; signed-out callers and students are refused
- webhooks › webhook endpoints › admins add endpoints; the secret is shown once and stored encrypted; editors, viewers and plans without API access cannot
- webhooks › webhook endpoints › scope changes are queued with the change and delivered signed by the worker, to subscribed endpoints only
- webhooks › webhook endpoints › quick changes to one scope reach the endpoint as one event with the latest state
- webhooks › webhook endpoints › notes, assignees, statuses and due dates are one event per scope naming every book changed, without the notes themselves
- webhooks › webhook endpoints › carrying a scope forward and duplicating it are reported too
- webhooks › webhook endpoints › failures are retried with backoff and fail for good after the last attempt
- webhooks › webhook endpoints › an endpoint that keeps failing is switched off and the admins are told; switching it on again resumes delivery
- webhooks › webhook endpoints › redirects are not followed and slow endpoints time out
- webhooks › webhook endpoints › a test sends a ping at once; redelivery queues the same event again; a new secret signs from then on
- webhooks › webhook endpoints › the delivery history downloads as CSV with every kept delivery, newest first; only admins can; it is audited
- webhooks › webhook endpoints › the download holds the newest 10,000 deliveries
- webhooks › webhook endpoints › events stop when the plan no longer includes API access
- webhooks › webhook endpoints › another organization cannot see or change them; old deliveries are cleaned up
- webhooks › webhook targets with the default settings › only https URLs to public hosts are accepted, and nothing is sent to a private address
- unit › webhook targets › only public unicast addresses are allowed
- unit › webhook targets › URLs must be https, without credentials, to a public host
- unit › webhook targets › the socket lookup refuses a host that resolves to a private address
- unit › webhook targets › signs "<timestamp>.<body>" with HMAC-SHA256
- data-keys › rotating DATA_ENCRYPTION_KEY › old values keep working during the rotation, are re-encrypted, and then work with the new key alone
- data-keys › rotating DATA_ENCRYPTION_KEY › a value no configured key can read is reported and left as it is
- data-keys › rotating DATA_ENCRYPTION_KEY › the command-line tool checks, re-encrypts, records an audit entry, and fails on unreadable values
- unit › encryption keys › new values name their key; the key id is a short fingerprint
- unit › encryption keys › previous keys still decrypt; a key that is not configured is named in the error
- unit › encryption keys › envelopes from before key ids were recorded are read with whichever configured key opens them
- unit › encryption keys › DATA_ENCRYPTION_KEYS_PREVIOUS takes up to five other 32-byte keys

</details>

Stability: the full suite was run at least 8 times during development; one ordering-dependent
flake (a published test catalogue leaking between files) was found and fixed in the test reset.
A second flake (1 run in 4) was in the due-date reminder tests: they check that a title is *not* in
an email, and two randomly picked books can share a title (the catalogue has 113 titles for 1,038
materials). Reproduced by giving two picked books the same title; those tests now use books with
distinct titles (`distinctTitleMaterialIds`), which pass on the same data.

## 3. End-to-end — `npm run test:e2e`

**22 tests, 22 passed** (4.1 min, 2026-10-25), Chromium, real server process on port 3100: 19 journeys,
then the accessibility project (3 tests), which reuses the journeys' data.

| # | Journey | Result |
| --- | --- | --- |
| 1 | Owner registers, verifies email, signs in and builds a content scope that persists | Pass |
| 2 | Owner invites an editor, changes the role to viewer, and the viewer becomes read-only | Pass |
| 3 | Another organization cannot reach the first organization's data | Pass |
| 4 | Owner subscribes, upgrades with proration, schedules a downgrade and cancels | Pass |
| 5 | Plan limits are enforced in the UI (second organization starts on Free) | Pass |
| 6 | Service recovers after a server crash: sessions and saved selections survive a restart | Pass |
| 7 | Platform admin signs in with two-factor authentication, sends a test alert (the console reports that no channel is configured), and suspends then restores an organization | Pass |
| 8 | Platform admin verifies a subject against a decree in the catalogue editor; the customer sees the badge, its source link and the coverage line | Pass |
| 9 | Arabic interface switches to right-to-left, shows the Arabic verification label, and the picker fits a phone screen (390 px, no horizontal overflow) | Pass |
| 10 | A newer catalogue (2027/2028) is published with one of the owner's books dropped; the picker offers to carry the scope and the owner is notified; the notification opens the review page, which lists the missing book; the new scope opens on 2027/2028 with the rest carried | Pass |
| 11 | Platform admin downloads the 2027/2028 sheet, marks three books verified, uploads it, sees the preview and applies it; coverage shows 3 verified materials | Pass |
| 12 | Owner builds two scopes with one book in common, opens Compare scopes from the scopes list: 1 only in each, 1 in both; differences only by default, everything after clearing the filter; Swap; the downloaded CSV has the right yes/no columns | Pass |
| 13 | Student accounts: the Students page is closed until a platform admin sets the school's student override in the admin console; the owner adds a student (password shown once) and imports a roster (a file with a bad line is refused, the corrected one imported, the credentials CSV downloaded and checked); the student follows the link on the staff sign-in page, is refused with a wrong password, signs in, sees exactly the three books chosen for grade 7, is sent back to the portal from a staff page, switches to Arabic; a staff password reset signs the student out | Pass |
| 14 | Notes and assignees: an editor joins by invitation; the owner writes a note on a book (focus returns to its Edit button) and assigns two books to the editor at once; the editor is notified, follows the notification to the page filtered to their two books and sees the note; the scopes list shows the counts; in the picker the annotated book carries its mark, deselecting it asks first (Cancel keeps it, Remove drops it with its note) | Pass |
| 15 | Status and due dates (reuses journey 14's school, as sign-ups are limited to 10 an hour per address): the owner makes Hana a viewer and assigns her two books with status To do and a past due date in one step, then moves one date later; the Overdue count goes 2 → 1 and the Overdue filter shows one book; Hana's email lists the books; she opens My assignments (3) from the navigation, sees the overdue book first, marks it Done (the overdue mark goes), filters to Done, and turns assignment emails off in her account | Pass |
| 16 | Due-date reminders (same school): the owner assigns Hana a third book due tomorrow and the notes page marks it "due soon"; one pass of the worker's reminder job (run directly against the E2E database at 10:30 Cairo time, since the E2E run starts no worker) sends one reminder and a second pass none; Hana's email lists the book as "due tomorrow" with a link to My assignments, although she turned assignment emails off (a separate choice); she sees Due soon 1 on My assignments and the reminder in her notifications, and turns reminder emails off | Pass |
| 17 | Daily summary (same school): Hana switches assignment emails from none to one summary each morning; the owner selects a fourth book and assigns it to her (found with the Not assigned filter) and no assignment email goes; one pass of the worker's summary job for the next morning (run directly, as for journey 16) sends one summary listing the book under Notes Academy, “Grade 6 books”, assigned by E2E Owner, and a second pass none. Journeys 15 and 16 use the new three-way choice instead of the old checkbox | Pass |
| 18 | All organizations: Hana creates her own organization (Hana Study Group), selects a book and gives it to herself due tomorrow; from Notes Academy's My assignments she follows "See your books in all your organizations (2)"; the page lists 5 books (both due tomorrow first, then by date), Not done yet 5 and Due soon 2, and links each organization; she marks her own organization's book Done there, finds it under Done, and 4 remain not done | Pass |
| 19 | Webhooks: a local receiver stands in for the school's system (the E2E server allows local targets); the Notes Academy owner adds it in Settings → Webhooks without "Scope deleted", copies the secret shown once, and sees it Active with the three events; Send test → "Test delivered (200)" and the ping's signature checks with the secret; selecting one more book in Grade 6 books and one pass of the worker's webhook job (run directly) delivers `scope.items_changed` with 5 books, signed; the Deliveries dialog lists both, delivered (200), says deliveries are kept for 30 days, and "Download history (CSV)" downloads both rows newest first with the exact body the receiver got; a note written on a book is delivered as `scope.items_annotated` naming that one book, signed, without the note's text | Pass |

Note from journey 2's first run: the test toggled a material and immediately demoted the user; the
batched save then arrived after the demotion, the server answered 403, and the UI rolled the toggle
back — correct behaviour; the test was changed to wait for "Saved".

### Accessibility (`tests/e2e/accessibility.spec.ts`)

| # | Test | Result |
| --- | --- | --- |
| 20 | axe-core 4.13 with the WCAG 2.0/2.1/2.2 A and AA rule sets on 80 screens: sign in (light and dark), register, forgot password, pricing, invalid email/reset/invitation links; the picker (first visit, with selections and the newer-catalogue banner, list panel open, Arabic, dark, phone); new-scope and notifications dialogs; scopes, carry-forward review (also Arabic, dark, phone), members, billing (also Arabic, dark), settings, audit log, account (also Arabic); platform admin overview, organizations, organization detail, users, catalogue versions, plans, audit, webhooks, catalogue editor (light and dark) and its verification dialog; scope comparison across two catalogue years (differences only, everything, Arabic, dark, phone); Students page (empty and with a student), add-student, student-password and roster-import (with a problem) dialogs; student sign-in; student portal (English, Arabic, Arabic dark, dark, phone) and its change-password dialog; notes and assignees (with a note and a book chosen, with an overdue and a due-soon book, Arabic, dark, phone) and its edit dialog; My assignments (English, Arabic, dark, phone); My assignments in all organizations (English, Arabic, dark, phone); settings with a webhook endpoint (also Arabic, dark, phone) and the webhook secret, deliveries (with a failed test delivery, its history note and download button) and edit dialogs | Pass — 0 findings (the deliveries dialog with a row first showed the "Payload" toggle under the 24 px target size; fixed) |
| 21 | Keyboard only: the first Tab from the top reaches the visible skip link, which moves focus to the page heading without redrawing it; a dialog opened with Enter takes focus, Escape closes it and focus returns to the opener; Tab reaches a material, its focus outline is visible, Space selects it and the tray counts it | Pass (4.5 s) |
| 22 | What screen readers are given, read from the browser's accessibility tree (docs/SCREEN_READER_REVIEW.md §4): on the account page's password form, the new-password field's description is its hint, then its hint and error after a failed submission, then the hint alone once corrected; the page area is not a live region; page titles follow the heading on the picker, account, settings and not-found pages and switch to the Arabic name in Arabic; picker book buttons include their kind ("(Ministry)", "(External refs)"); the notifications button is "Notifications, 2 unread" with two unread, "Notifications" after opening the list, and focus returns to it | Pass |

Before the fixes (same tests, front end at the previous commit) the audit reported 26 findings:

| Rule (impact) | Count | Where | Fix |
| --- | --- | --- | --- |
| `color-contrast` (serious) | 13 | amber text (`--pass`): the trial banner on every organization page, picker notices and "needs review" statuses, admin user warning pills | `--pass` #9a6a12 → #83580c: 4.17:1 → 5.50:1 on #faf0d9, 6.24:1 on white |
| `target-size` (serious) | 8 | picker source links; verification badge `summary` in the admin editor | 24 px minimum height via padding |
| `aria-meter-name` (serious) | 3 | billing usage meters (English, Arabic, dark) | `aria-label` and `aria-valuetext` "used / limit" |
| `scrollable-region-focusable` (serious) | 1 | admin audit table | all 11 table cards are labelled, focusable regions (`tableCard`) |
| `aria-allowed-attr` (critical) | 1 | admin webhook filter links with `aria-pressed` | `aria-current="page"` |

The keyboard test failed on the old front end: following the skip link redrew the page (the router treated `#main`
as a navigation). With that fixed, it then failed because Escape removed the dialog before the browser
could return focus; the dialog helper now cleans up on `close` and focuses the opener.

Automated checks find only part of WCAG failures (no judgement of reading order, meaningful labels or
screen-reader output); a manual screen-reader review is still to be done, with the checklist in
docs/SCREEN_READER_REVIEW.md.

Test 22 against the previous front end (same test, its checks made non-stopping so every one is
reported): 13 failures, one for each fixed problem: the page area was a live region (1); every page
title was "Curriculum Scope" (6: account, picker, settings, not found, and after switching to Arabic
and back); the password field had no description, before and after the error (3); the two book
buttons had no kind in their name (2); the notifications button was "Notifications" with two unread (1).
Test 22 creates its member directly in the database, because the run already uses most of the 10
sign-ups an hour that the server allows from one address.

## 4. Operational verification (manual, executed)

| Check | Result |
| --- | --- |
| `docker build` (multi-stage, non-root) | Pass — 396 MB image |
| `docker compose up` (postgres, migrate, app, worker, mailpit) from an empty volume | Pass — all services healthy (worker via heartbeat health check); `/readyz` 200 |
| Email via SMTP | Pass — registration email delivered to Mailpit by the worker |
| Production guard: sandbox billing with `NODE_ENV=production` | Pass — container refuses to start |
| Production guard: superuser DB connection | Pass — "Database role "postgres" bypasses Row-Level Security" |
| `pg_dump` as schema owner | Fails as expected (FORCE RLS) → dedicated backup role introduced |
| `scripts/backup.sh` with the backup role | Pass — 140 KB dump + checksum |
| `scripts/verify-backup.sh` | Pass — migrations present, row counts match, RLS flags intact, invariants hold |
| Restore into a new DB and query as the app role | Pass — catalogue readable, tenant rows hidden without context |
| Backup from inside the compose stack (`docker compose exec postgres pg_dump -U curriculum_backup`) | Pass |
| Re-run after the final code changes (image rebuilt at commit `1310087`; stack from an empty volume) | Pass — app, worker, postgres, mailpit healthy; `/readyz` 200; image contains no `.env` and no build CA |

### Two app instances behind Caddy (2026-10-25)

The production compose files (`docker-compose.yml` + `docker-compose.prod.yml`) were run with production
settings: `NODE_ENV=production`, `APP_URL=https://localhost` (Caddy's local certificate authority,
trusted by the test client, TLS verification on), `BILLING_PROVIDER=disabled`, SMTP to Mailpit. The
services were PostgreSQL, migrate, `app`, `app2`, worker, Caddy and Mailpit. Two sandbox-only
adjustments: Docker Hub refused anonymous pulls (429), so the same official images were pulled
from `mirror.gcr.io` and tagged with their usual names, and the image was built with the proxy
settings (DEPLOYMENT_GUIDE §2). The test client registered through Caddy, received the
confirmation email via the worker and Mailpit, confirmed, signed in and created a scope. The load
was 4 clients sending about 8 requests a second in total, kept under the per-instance flood guard:
reads of `/api/auth/me` and the scope, and writes adding and removing a scope item, half of all
requests.

| Check | Result |
| --- | --- |
| Stack from empty volumes | All healthy; migrations 0001–0005 applied; `https://localhost/readyz` 200 through Caddy |
| Load with both instances up (20 s) | 160 requests, 0 failed; one session served by both instances, split evenly |
| 12 wrong-password logins for one account | 10 × 401 then 2 × 429; Caddy sent 6 to each instance (shared limit) |
| Rolling restart (`docker compose restart app`, then `app2`), drain 5 s, three runs | 480 + 400 + 400 requests, **0 failed**; while one restarted the other served (e.g. 2 vs 38 requests in that 5 s window); Caddy logged the 503 "draining", then "host is up" |
| Same with the drain switched off (`SHUTDOWN_DRAIN_MS=0`) | 336 requests, **2 failed**: one write (502) per restart, caught on a connection the closing instance dropped |
| `scripts/rolling-restart.sh`, after a separate `docker compose run --rm migrate` | 600 requests, **0 failed**; app, app2 and worker recreated and healthy; the script took 35 s |
| `kill -9` of an instance's process (three crashes over two runs) | 360 + 286 requests; **1 failed**: a write in flight on the crashed instance (502, correctly not retried); Docker restarted each instance within a second; the first was ready again 6 s after the kill |
| Worker during all runs | 0 failed ticks |

The `--build` path of `scripts/rolling-restart.sh` (`docker compose build`) was not run here,
because builds in this sandbox need the proxy settings; the migration step it runs was.

### Operational alerts on the same stack (2026-10-25)

Same production-settings stack, rebuilt with the alert code, with `ALERT_EMAILS=ops@example.test` and a
10 s check interval. `ALERT_EMAILS` reached both app containers through `docker-compose.yml`.

| Step | Result |
| --- | --- |
| `docker compose stop worker` at 05:17:06 | One email, after 120 s (05:19:06), over SMTP to Mailpit: "[localhost] ALERT: The background worker has not reported for 2 minutes", with the instance, the count and what to check; no customer data. Both app instances ran the checks; one sent it |
| `docker compose start worker` at 05:19:18 | One email at 05:24:16: "[localhost] Resolved: …", after the condition had been clear for 5 minutes |
| `ops_alerts` | `worker_stalled`, resolved, first seen 05:19:07, resolved 05:24:17 |

## 5. Performance smoke — `scripts/perf-smoke.mjs`

Compiled server (`node dist/server.js`), one process, local PostgreSQL, rate limiting disabled,
20 concurrent clients × 400 requests per endpoint, on the 4-vCPU sandbox (after the catalogue
caching change):

| Endpoint | p50 | p95 | p99 | Throughput | Errors |
| --- | --- | --- | --- | --- | --- |
| `GET /healthz` | 8.3 ms | 19.2 ms | 39.0 ms | 1,962 req/s | 0 |
| `GET /api/catalog/versions/:id` (1,038 materials) | 53.8 ms | 88.2 ms | 451.6 ms | 337 req/s | 0 |
| `GET /api/orgs/:id/scopes/:id` | 47.9 ms | 61.2 ms | 66.1 ms | 406 req/s | 0 |
| `POST …/items` (toggle)* | 63.2 ms | 125.1 ms | 159.5 ms | 282 req/s | 0 |
| `GET …/export?format=txt`* | 64.8 ms | 152.2 ms | 221.5 ms | 253 req/s | 0 |

\* From the run before the catalogue change (the second run measured only the first three rows).
These are sandbox figures, not capacity guarantees; the p99 tail on the catalogue endpoint under
20-way concurrency remains. Re-run on production-sized hardware before launch.

### Rate-limit store cost (2026-10-25)

Ad hoc scripts (not committed) on the same sandbox, local PostgreSQL 16, app driven in-process with
`app.inject` and a distinct client address per request, so no limit was reached:

| Measurement | p50 | p95 | p99 | Throughput |
| --- | --- | --- | --- | --- |
| Store upsert alone, 20 concurrent, 500 different clients | 2.53 ms | 6.81 ms | 9.09 ms | 6,667/s |
| Store upsert alone, 20 concurrent, one shared address (one hot row) | 1.63 ms | 3.92 ms | 6.26 ms | 10,323/s |
| Anonymous API request, one at a time: no limiter / limit counted in PostgreSQL | 0.20 / 1.12 ms | 0.46 / 1.54 ms | 0.91 / 3.15 ms | — |
| Same, 20 concurrent: no limiter / limit counted in PostgreSQL | 1.34 / 8.34 ms | 3.88 / 15.37 ms | 5.34 / 19.48 ms | — |
| Same, 20 concurrent: no limiter / global limit in process memory (as shipped) | 1.25 / 1.62 ms | 5.59 / 4.63 ms | 10.91 / 7.30 ms | — |

Counting the global limit in PostgreSQL added one round trip to every API request. At full load it
made the database write the bottleneck, and under a flood it would push the flood onto the shared
database. So the global limit stays a per-process flood guard, and only the route-specific limits
(login, two-factor codes, resets, registration, invitations, checkout, the v1 API) are counted in
PostgreSQL, where the extra ~0.9 ms is small next to the work those requests already do (a login
hashes a password with Argon2id).

## 6. CI pipeline on a clean checkout (local equivalent of GitHub Actions)

2026-10-23: `scripts/ci-local.sh` on a fresh `git clone --branch main` (commit `59265a2`), Node.js 22,
`postgres:16-alpine` service container with the workflow's credentials. Two sandbox-only adjustments:
Chromium was preinstalled (Playwright's download CDN is blocked here), and `docker build` received the
proxy settings and CA as build arguments/secret.

| Step (job) | Result |
| --- | --- |
| npm ci | Pass |
| lint (checks) | Pass |
| typecheck (checks) | Pass |
| unit + integration tests (checks) | Pass — 10 files, 91 tests |
| dependency audit, production (checks) | Pass — 0 vulnerabilities |
| Playwright journeys (e2e) | Pass — 8 tests |
| docker build (docker) | Pass |
| production configuration guard (docker) | Pass |

Running the workflow file itself with `act` reached the job's services but could not fetch the
`actions/setup-node` action through this sandbox's git proxy, so the steps were run by the script instead.

## 7. Paymob verification without Paymob credentials (2026-10-23)

| Check | Result |
| --- | --- |
| HMAC against an independent implementation: fixture and expected signature from Odoo's `payment_paymob` module (`odoo/odoo` 19.0, `tests/common.py`), redirect and webhook forms | Match |
| Request format vs Paymob's Create Intention docs and Odoo's client (`POST /v1/intention/`, `Authorization: Token <secret>`, amount in piastres, `special_reference` → callback `merchant_order_id`, `intention_order_id` → callback `order.id`) | Consistent; enforced by the simulator |
| Contract tests: real adapter over HTTP against `tests/helpers/paymob-simulator.ts` | 11/11 pass |
| Mutation check: the contract tests run against the previous billing service | 2 fail (a rewritten `merchant_order_id` paid another organization's invoice; a callback for an order this app never created was applied) — fixed by `checkout_sessions` |
| `npm run paymob:check` dry run against the simulator | Valid redirect → exit 0; tampered HMAC → exit 1; live keys refused |
| Migration `0002_checkout_sessions` down → up on the test database | Pass |
| Full suite after the change: lint, typecheck, 104 unit/integration, 8 E2E, `npm audit --omit=dev`, build | Pass, 0 vulnerabilities |

The simulator encodes Paymob's documentation; it cannot show where Paymob's live behaviour differs
from it. paymob.com was not reachable from this environment's network, so the docs were read via
search results, the official Python SDK on PyPI and Odoo's open-source module.

## 8. Not executed

- CI workflow on GitHub-hosted runners: both attempts were refused before starting because the GitHub account is locked for billing (PROJECT_STATUS.md B-7).
- Paymob checkout/webhook against Paymob's servers (no keys; §7 lists what was verified instead, and `npm run paymob:check` is the next step).
- Cross-browser E2E (Firefox, WebKit), manual screen-reader review, external penetration test.
- Two app instances on separate hosts, and loss of the host or the database (both instances ran on one Docker host).
- Production deployment, TLS issuance by Caddy, an external uptime check, and alert delivery through a real email provider or chat webhook (SMTP was tested with Mailpit, the webhook with a local receiver).
