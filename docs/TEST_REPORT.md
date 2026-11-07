# Test report

Only results that were actually executed are reported here.

## Environment

| Item | Value |
| --- | --- |
| Date | 2026-10-22 (final full run started 11:06 UTC) |
| Machine | Cloud development container, Ubuntu 24.04, 4 vCPU, 15 GB RAM |
| Runtime | Node.js 22.22.0; PostgreSQL 16.15 (local cluster); Docker 29.9.1 / Compose 5.6.0 |
| Browsers | Playwright 1.56.1: Chromium 141 (build 1194), Firefox 142.0.1 (build 1495), WebKit 26.0 (build 2215). Firefox and WebKit were copied from Playwright's official image `mcr.microsoft.com/playwright:v1.56.1-noble`, as the download site is blocked here, with their system libraries from Ubuntu's archive |
| Commit | latest on branch `claude/friendly-rubin-hmemjl` (see `git log`) |

## 1. Static checks

| Check | Command | Result |
| --- | --- | --- |
| Lint | `npm run lint` (ESLint 9 + typescript-eslint) | **Pass** (0 problems) |
| Type check | `npm run typecheck` (server + E2E configs) | **Pass** |
| Dependency audit | `npm audit` | **0 vulnerabilities** (after upgrading `@fastify/static` 8→10, `nodemailer` 7→10, `vitest` 3→5, which had advisories on first install) |

## 2. Unit and integration tests — `npm test`

**63 files, 468 tests, 468 passed, 0 failed** (2026-11-06, with the image and action pins, task 1.9). Integration tests ran against a real
PostgreSQL database with a non-superuser owner role and a separate non-BYPASSRLS app role.

| File | Tests | Result |
| --- | --- | --- |
| unit/catalog-fidelity | 3 | Pass — the seed equals the original artifact's 231 subjects / 1,038 materials item-for-item |
| unit/billing-logic | 9 | Pass |
| unit/security-primitives | 12 | Pass — includes the CSV `note`, `assignee`, `status` and `due_on` columns (at the end, formula-guarded), and production refusing `WEBHOOK_ALLOW_INSECURE_TARGETS` |
| unit/i18n | 2 | Pass |
| unit/passwords | 21 | Pass — new passwords (task 1.8): the pinned NCSC list cut to 10–128 characters (9,113 entries); refused when in it in any case, a common or this service's word (Arabic too, vowel marks ignored) with only digits and symbols added, or one character repeated; too short and too long first; six good passwords accepted; the problem passed on as a field `code`; English and Arabic texts for every code |
| unit/image-pins | 11 | Pass — dependency hygiene (task 1.9): every `Dockerfile` stage and every compose image but the locally built `midad:` one pinned as `name:tag@sha256:<64 hex>`; the image's Node.js major is CI's; the ops scripts name no image (comments aside) and read rclone from `ops/images.Dockerfile`, PostgreSQL from `docker-compose.yml` and Caddy from `docker-compose.prod.yml`: the bash lookup run with bash (and an unknown name refused), the PowerShell pattern applied to the same files; Dependabot covers npm, both Dockerfile directories, the compose files and the actions, every entry against `main`, without Node.js, `@types/node` or PostgreSQL majors; every CI action pinned by a 40-hex SHA with its release in a comment. Breaking a compose pin, the ops script's lookup or an action pin fails 4 of the tests |
| unit/backup-crypt | 3 | Pass — backup archive encryption (`src/lib/backup-crypt.ts`): round trip for sizes from 0 to 1.1 MB whatever the chunk boundaries; a wrong passphrase, one changed byte, a cut file, another format, a header with no data and a passphrase under 12 characters all refused; a fresh salt and IV each time |
| unit/countdown | 4 | Pass — the time left announced in a timed test (`public/js/countdown.js`): 5 and 1 minutes once each as they are crossed; nothing for a mark already behind when the test opens; again after more time; only the nearer mark when a tick jumps past both |
| unit/email-templates | 2 | Pass — the Arabic invitation names the role as the Arabic interface does; the Arabic assignment email says "a book" for one and "books" for more |
| unit/file-checks | 5 | Pass — the ClamAV daemon client against a stand-in speaking its protocol: clean and infected, 64 KB chunks, errors, hang-ups, timeouts and refused connections; photos made at most 2,000 px without EXIF (location included), turned upright, never enlarged, same format; wrong type, garbage and a header claiming 400 million pixels refused |
| unit/scope-compare | 2 | Pass — same version (only in each, in both); across versions (renamed, missing books and subjects, block renamed) |
| unit/carry-forward | 4 | Pass — natural-key matching, loose renames, removed subjects, ambiguous keys |
| unit/csv | 3 | Pass — quotes, line breaks, Arabic, formula guard round trip, Excel semicolons and CRLF |
| unit/ai-layer | 8 | Pass — AI reply schemas in the form all three providers accept (limits dropped from what is sent, every object closed, optional fields refused); JSON replies checked against the full schema, Markdown fences removed; provider error kinds; configuration (off by default, key and model required, https endpoint in production); the default timings (60 s, 1 retry) and the longest wait they allow, 260 s (task 1.6) |
| integration/ai-providers-contract | 30 | Pass — the Gemini, Anthropic and OpenAI adapters against a local simulator of each documented API (`tests/helpers/ai-simulator.ts`): instructions, task and JSON schema in the documented fields with the key in the right header; reply, tokens and model read; refusals and truncated replies reported; a refused key not retried and never echoed; 429, 5xx and 400 mapped; a temporary failure retried; timeouts; a provider that never answers retried once by default, then a timeout; the call cancelled at its deadline when a 429 asks to wait 20 s (task 1.6); Anthropic's server-side fallback requested on the models that have it |
| unit/question-suggestions | 6 | Pass — the instructions and task sent for suggested questions (grade and stage, subject, books, topic, lesson text, count, kinds, language), the reply schema every provider can be held to, each kind turned into the test's question form, and what is left out (two correct choices on a one-answer question, an index outside the choices, one choice, no true/false, no accepted answer, an empty question, a kind not asked for) |
| integration/test-question-suggestions | 6 | Pass — against the Gemini simulator: off without AI requests (and the test page says so); what is sent (topic, lesson text, grade, subject, title; no student) and returned (checked questions, two left out), nothing saved, one request counted and logged, a kept suggestion added like any question; only the subject's teachers and admins; not after a student starts; no more than the test's room; request checks; refusals and failures, with the request given back |
| unit/homework-suggestions | 4 | Pass — the instructions and task for a homework suggestion (grade and stage, subject, books, topic, lesson text, kind, minutes, language), defaults and English, the reply schema within the homework form's limits, trimming |
| integration/homework-suggestions | 5 | Pass — against the Gemini simulator: off without AI requests (and the class page says so); what is sent (topic, lesson text, grade, subject, kind, minutes; no student) and returned; nothing saved, one request counted and logged, and the teacher then sets it as any homework; only the subject's teachers and admins, a subject of the class's grade, another school 404, an archived class refused; request checks before any request; a second request on a bad reply, refusals passed on |
| unit/plan-suggestions | 9 | Pass — lesson and pacing plan drafts (`docs/TEACHING_PLANS.md` §4): the instructions and task (grade and stage, subject, books, topic, lesson text, length; the term's start, weeks, periods, contents, a revision week only in terms of 6 weeks or more), defaults, the reply schemas (exactly one entry per week), conversion to a plan the editor can save (trimmed, empty items left out), refused requests |
| integration/teaching-plans | 4 | Pass — teaching plans: any member writes plans for the scope's grades and subjects with books, everyone reads them, missing parts saved empty; the audit names plans without their content; only the author and admins change or delete; the grade and subject, the content against its kind (unknown fields refused) and the 500-plan limit checked; another school and another scope get 404; plans go with their scope |
| integration/plan-suggestions | 4 | Pass — plan drafts against the Gemini simulator: off without AI requests; a lesson plan from the topic and lesson text (what is sent, the scope's books in the draft), nothing saved until the member saves it, then marked as started from AI; a pacing plan with exactly the weeks asked, asking again once when the count is wrong (2 attempts logged); checks of the subject, the request and the school before any request |
| integration/ai | 19 | Pass — the AI layer end to end against the simulator: off for every school until a platform administrator sets an allowance, nothing sent before; off without a provider; student accounts refused; the usage log and audit entry with no text; a second attempt on an unusable reply; refusals and truncated replies; the unit given back when the provider fails; a provider that never answers: 503 `AI_UNAVAILABLE` after one call of two attempts, and a slow provider with unusable replies within the bound (task 1.6); the monthly limit held under 8 concurrent requests; an unlimited allowance; row-level security between schools; retention; the platform administration endpoints and the connection test |
| unit/catalog-sheet | 6 | Pass — export layout, published vs draft rules, mark clearing, errors (with their codes), encoding, semicolons |
| unit/import-problems | 2 | Pass — a problem in an imported file carries its code, parameters and English text; every code has an Arabic text with the same placeholders, and no Arabic text is left without a code |
| unit/alerts | 2 | Pass — 5xx counter windows; worker-stopped threshold |
| unit/rate-limit-memory | 2 | Pass — fixed windows; memory bounded, oldest windows dropped first |
| unit/data-keys | 4 | Pass — key ids in new values; previous keys decrypt and an unconfigured key is named; old-format values read with whichever key opens them; `DATA_ENCRYPTION_KEYS_PREVIOUS` rules |
| unit/webhook-net | 4 | Pass — public-address classifier (private, loopback, link-local, CGNAT, documentation, multicast, NAT64, 6to4, IPv4-mapped); URL rules (https only, no credentials, no private or local hosts, development setting); the socket's DNS lookup refusing a host that resolves to loopback; signature format |
| unit/reminders | 3 | Pass — reminder wording in English and Arabic (today, tomorrow, dates across month and year ends, month in words in Arabic with no direction marks), overdue listed first, long lists shortened, notice titles |
| unit/test-marking | 5 | Pass — online test rules (`docs/ONLINE_TESTS.md` §4): typed answers normalised as a teacher would accept them (Arabic diacritics, tatweel, alef forms, ى/ي, ة/ه, Arabic-Indic digits, case, spaces, edge punctuation); marks for every type, partial credit for several choices never below 0, written answers left to the teacher; question and answer checks; the attempt deadline (time limit or the test's end, plus extra time); shuffles and start codes |
| integration/auth | 22 | Pass — includes common passwords refused at sign-up, reset and change with `PASSWORD_TOO_COMMON`, the old password and the reset link still working (task 1.8); includes the sign-in lockout per account and client (production findings S-5, S-7): 20 failures from address A, then a correct sign-in from address B; another browser on the locked-out address is refused, a browser that signed in before is not (its own count and rate limit), a made-up device cookie gets nothing; two accounts sharing a browser have their own allowance on it (fails without the per-account key: 429); a school admin's and a platform administrator's unlock give an address whose attempts someone used up its attempts back (fails without it: 429); 20 failures from four unknown addresses lock out every unknown client but not a known browser, and the platform administrator sees and lifts the lock; 8 parallel failures all counted; wrong second-factor codes lock out that client only and end its pending session, and a browser is trusted only after the code |
| integration/tenancy | 21 | Pass |
| unit/config-roles | 3 | Pass — the web app needs `SESSION_SECRET` and the provider keys its settings name; the worker starts without `SESSION_SECRET`, payment or AI keys (a random stand-in session secret, different in every process) and still checks what it uses; migrations need only the schema owner's database |
| unit/compose-env | 5 | Pass — the environment of each production container as Compose resolves `docker-compose.yml` and `docker-compose.prod.yml`: `migrate` gets only the schema owner's address; the worker no session, payment, AI or alert keys; app and app2 the web app's secrets and not the owner's; role passwords only on `postgres`; every setting the app reads can still be set. On `main`'s compose files three of the five fail |
| unit/system-context-allowlist | 1 | Pass — every cross-tenant (system context) call site in `src/` matches the reviewed list |
| integration/migrator | 3 | Pass — migrations and rollbacks (`src/db/migrator.ts`), on a scratch database with the CLI run as its own process: a new database gets every migration in order, then nothing more; on a database a later release migrated, Kysely alone fails ("previously executed migration … is missing") while `migrateToLatest` and `migrate-cli up` succeed, readiness finds nothing pending and `migrate-cli down` refuses; an unknown migration among the release's own, or a newer database lacking one of the release's, is refused with what was found |
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
| integration/billing | 16 | Pass — including the payment callback limits (task 1.7): a signed event of exactly 64 KiB is processed and one byte more is refused with 413 before anything is recorded; 600 callbacks a minute from one address, alternating between two app instances, then 429, while a callback from another address is still processed. Both tests fail with the limits removed (200 instead of 413; 400 instead of 429, since the per-process guard saw 300 on each instance) |
| integration/catalog-verification | 6 | Pass — marks on published versions, validation, archived refusal, copy and reset rules, exports |
| integration/paymob-contract | 11 | Pass — the real `PaymobProvider` over HTTP against a simulator of Paymob's documented API; the simulator's callback (686 bytes) is well under the 64 KiB cap |
| integration/admin-api-ops | 12 | Pass |
| integration/authz-coverage | 5 | Pass — enumerated all 30+ admin routes and 30+ org routes |
| integration/students | 29 | Pass — includes a student's own new password refused when common (task 1.8); student accounts (`docs/STUDENT_ACCOUNTS.md`): off by default and per-school override; sign-in, equal errors, lockout per address (a classmate on the school network cannot lock the student out of a browser they signed in from; Unlock keeps the password; with a test opening within the hour, 20 failures from four addresses do not lock the student out, while another student without a test is locked out of unknown addresses), staff reset, password change; every application route called with a student session (only the portal answers); database triggers and constraints; roles; another school 404 and RLS; scopes of the same school only; account deletion; platform user list; roster import (preview with one entry per problem and its code, unreadable files refused with `FILE_NOT_UTF8` / `CSV_INVALID`, all or nothing, Excel/Arabic files, limit); the portal's curriculum; suspended school; generated passwords |
| integration/alerts | 6 | Pass — one alert across two instances, reminder after 6 h, one resolution after 5 min clear; every check; no customer data in messages; database outage from memory; a failing channel does not stop the other; 5xx counting; admin list and audited test alert |
| integration/shutdown | 1 | Pass — the real server process reports draining on SIGTERM, keeps serving during the drain, exits cleanly |
| integration/rate-limit-store | 6 | Pass — one login limit across two app instances and a restart; exact counts under concurrency; window expiry; HMAC keys only; the global guard stays per process; cleanup |
| integration/classroom | 7 | Pass — classes and homework (`docs/CLASSROOM.md`): off until student accounts are on; who sees which class; the whole homework cycle (curriculum books and subject teachers only, notifications in each student's language, private drafts, file type from the bytes, hand-in, files opening only once checked, download headers, mark limits, return one and several, paper work, audit); late, closed and taken-back work; scheduled homework announced once by the worker; row-level security with unfiltered queries in a student context; file count, storage limit, deleting a class |
| integration/online-tests | 8 | Pass — online tests and exams (`docs/ONLINE_TESTS.md`): drafts hidden from students (also directly in the database), publishing notifies the class in each student's language; students get questions without answer keys, answers are checked and saved, submission marks them, the teacher marks the written answer, and a teacher of another subject sees no keys and cannot mark; start code, attempts and a retake; the server keeps the time (late saves refused, the worker submits the rest); a new closing time moves running attempts, and results and answers wait for a classmate's extra time; the live monitor (left the page, pasting, another device), one device, submitting for a student, closing early and reopening; settings locked after a start and manual release; row-level security for another student with unfiltered queries |
| integration/school-network-limits | 2 | Pass — a school's students on one address (`docs/STUDENT_ACCOUNTS.md` §9): 65 students start a test and send heartbeats (the 61st start was refused when limits counted per address); one student is still held to 60 starts in 15 minutes while a classmate is not; the flood guard lets two accounts make 800 requests a minute from one address, stops each account at 600 with `RATE_LIMITED` and `retry-after`, and holds a forged session cookie, also a changing one, to its address. Both tests fail on the code before the change |
| integration/classroom-retention | 4 | Pass — keeping classroom data (`docs/CLASSROOM.md` §11): nothing deleted until a school sets periods; the preview; notices to owners and admins only (in-app and email, no student work in them) at least 14 days ahead; after the notice, work and monitoring are deleted while hand-ins, marks, comments, scores and the gradebook stay, and re-marking keeps the automatic mark; a hold, a longer period (saved, or changed behind the worker) and a later due time each cancel a deletion; no notices at night; the records stage deletes the homework with its students' notifications; another school untouched; owners and admins only, periods in order |
| integration/file-checks | 6 | Pass — homework files checked before anyone opens them (`docs/CLASSROOM.md` §5): 409 until the worker's pass; a phone photo made 2,000 × 1,500 without EXIF, its new SHA-256 and the size uploaded kept, PDFs unchanged; a virus deletes the bytes, tells the student (Arabic), owner and admin but not the teacher, is audited and takes no storage; an unreadable photo tells only its uploader; a failing scanner keeps files waiting and counted, stops at the first error, and the alert fires after 10 minutes; without a scanner photos are still prepared, and once scanning is on older files are scanned while open; two workers never check the same file |
| integration/gradebook | 3 | Pass — the gradebook (`docs/CLASSROOM.md` §10): columns for homework with a full mark and published tests, oldest first; marked, to-mark, missing and not-yet cells; averages over marked work and missing counts; 404 for a member who does not teach the class; the CSV in the member's language (English and Arabic), formula-guarded and audited; My grades showing a student only their own marks, once returned or shown |

Full test names (file › group › test, from `npx vitest list`):

<details><summary>Show all 311</summary>

- admin-api-ops › platform administration › is invisible to ordinary users and requires MFA for admins
- admin-api-ops › platform administration › sees customer metadata but not scope contents without a support grant
- admin-api-ops › platform administration › suspends and restores organizations and users
- admin-api-ops › platform administration › assigns an enterprise plan manually with custom limits
- admin-api-ops › platform administration › manages catalogue versions: clone to draft, edit, publish; published is read-only
- admin-api-ops › platform administration › updates plan prices and limits with audit
- admin-api-ops › public API (API keys) › requires a plan with API access, authenticates by key, meters usage and honours revocation
- admin-api-ops › operations › health and readiness endpoints
- admin-api-ops › operations › sets security headers and a strict CSP
- admin-api-ops › operations › never leaks internals in error responses
- admin-api-ops › operations › worker delivers queued email, retries failures with backoff, and redacts bodies after sending
- admin-api-ops › operations › cleanup applies retention and heartbeat is visible to admins
- alerts › operational alerts › sends one alert per problem across instances, a reminder after 6 hours, and one resolution once it clears
- alerts › operational alerts › checks email delivery, server errors, payment notifications and migrations; messages carry counts, not addresses
- alerts › operational alerts › alerts from memory when the database is unreachable, reminds after 6 hours, and resolves when it is back
- alerts › operational alerts › a failing channel does not stop the other; failures are logged without the webhook URL
- alerts › operational alerts › counts 5xx responses, except the health endpoints
- alerts › operational alerts › platform admins see alerts and can send a test alert (audited); customers cannot
- all-assignments › My assignments across all organizations › lists the member’s books from every organization in one order, with counts per organization and in total
- all-assignments › My assignments across all organizations › the member updates a book’s status through its own organization, even as a viewer there
- all-assignments › My assignments across all organizations › suspended organizations, and ones asking this member for two-factor sign-in, are listed as unavailable and not read
- all-assignments › My assignments across all organizations › a member of one organization gets the same books as on its own page; signed-out callers and students are refused
- assignment-digest › daily summary of assignment emails › members who chose it get no email per assignment, only the in-app notice; the books wait for the morning summary
- assignment-digest › daily summary of assignment emails › sends at most one summary a day: what is assigned after the morning sending time waits for the next morning
- assignment-digest › daily summary of assignment emails › one email covers every organization, grouped by scope and by who assigned the books
- assignment-digest › daily summary of assignment emails › leaves out books unassigned or removed since, and suspended organizations; nothing left means no email
- assignment-digest › daily summary of assignment emails › switching back to emails right away, or off, drops what was waiting; the choice is validated
- assignment-digest › daily summary of assignment emails › an unverified address gets no summary; the waiting books are dropped
- assignment-digest › daily summary of assignment emails › writes in the member’s language and shortens long lists
- assignment-digest › daily summary of assignment emails › two workers running at once send one summary
- assignment-digest › daily summary of assignment emails › waiting rows stay inside the organization and the member; old ones are cleaned up
- auth › registration and email verification › registers an owner with an organization on a 14-day trial and requires verification before login
- auth › registration and email verification › does not reveal whether an email is already registered
- auth › registration and email verification › rejects weak passwords and invalid input with field details
- auth › login protection › locks the account after 5 failed attempts and uses a generic error
- auth › login protection › rate-limits repeated login attempts per client and account
- auth › login protection › logout invalidates the session
- auth › CSRF protection › rejects state-changing requests without the session CSRF token
- auth › CSRF protection › rejects cross-origin requests and non-JSON bodies
- auth › password reset › resets the password with a single-use token and revokes existing sessions
- auth › password reset › changing the password requires the current one and signs out other sessions
- auth › two-factor authentication › requires a TOTP code at login once enabled, and rejects replayed codes
- auth › two-factor authentication › disabling MFA requires password and a valid code
- auth › sessions › lists and revokes own sessions only
- authz-coverage › authorization coverage (all registered routes) › every route is either admin-only, org-scoped, API-key-only, or explicitly allow-listed
- authz-coverage › authorization coverage (all registered routes) › admin routes: 401 when anonymous, 404 for ordinary users (surface not disclosed)
- authz-coverage › authorization coverage (all registered routes) › org routes: 401 when anonymous, 404 for members of another organization
- authz-coverage › authorization coverage (all registered routes) › public API routes require an API key
- authz-coverage › second-factor brute force › locks the account after repeated wrong codes and ends the pending session
- backup-crypt › backup archive encryption › round-trips data of any size, whatever the chunk boundaries
- backup-crypt › backup archive encryption › refuses a wrong passphrase, a changed byte, a cut file, another format and a short passphrase
- backup-crypt › backup archive encryption › uses a fresh salt and IV each time
- billing › subscribing › lists public plans without authentication
- billing › subscribing › trial → paid Starter via hosted checkout and signed webhook
- billing › subscribing › trial → paid on the plan being trialled (Professional) ends the trial
- billing › subscribing › a failed payment leaves the invoice open and notifies the owner; retry succeeds
- billing › subscribing › refuses non-self-serve plans and billing actions from non-owners
- billing › webhook security › rejects bad signatures, stale timestamps and unknown providers
- billing › webhook security › processes each event once (replay is a no-op)
- billing › webhook security › does not activate a plan when the paid amount does not match the invoice
- billing › plan changes › upgrades mid-period with a prorated charge and keeps the period
- billing › plan changes › schedules a downgrade; the renewal invoice bills the new plan and applies it when paid
- billing › plan changes › cancel keeps access until period end, then moves to Free; resume undoes it
- billing › plan changes › unpaid renewal: past due with grace period, then Free
- billing › trial lifecycle › sends one trial-ending notice, then moves to Free when the trial ends
- billing › trial lifecycle › a user gets one trial; additional organizations start on Free
- catalog-notifications › catalogue change notifications › a newer catalogue notifies owners, admins and editors of organizations behind it, in their language, once per year
- catalog-notifications › catalogue change notifications › organizations already on a year hear about its correction only when the version they use is archived
- catalog-notifications › catalogue change notifications › entries newly flagged for review notify organizations that selected them; repeats and other marks do not
- catalog-notifications › catalogue change notifications › users can turn catalogue emails off and on in their profile
- catalog-sheet › catalogue spreadsheet export and import › exports the whole catalogue with ids and marks
- catalog-sheet › catalogue spreadsheet export and import › previews then applies verification marks on the published catalogue, notifying customers of new flags
- catalog-sheet › catalogue spreadsheet export and import › refuses content changes on a published version as a whole: nothing is written
- catalog-sheet › catalogue spreadsheet export and import › applies corrections and new materials to a draft; a correction clears a mark left untouched
- catalog-sheet › catalogue spreadsheet export and import › is admin-only, refuses archived versions and explains encoding problems
- catalog-verification › catalogue verification marks › marks entries of the published catalogue; customers see the mark and coverage, not the reviewer
- catalog-verification › catalogue verification marks › records entries that need review with a public note, and resets marks to unverified
- catalog-verification › catalogue verification marks › validates the request and the targets
- catalog-verification › catalogue verification marks › is admin-only and refuses archived versions
- catalog-verification › catalogue verification marks › copies marks into a draft of the same academic year only; content edits reset them, unchanged saves do not
- catalog-verification › catalogue verification marks › scope exports carry the marks
- classroom › classes are off until student accounts are on › refuses to create a class and says so
- classroom › classes and teachers › admins manage classes; a teacher sees only the classes they teach, other members none
- classroom › homework › a teacher sets homework; students are told in their language, hand in text and a photo, and get it back marked
- classroom › homework › late work, closed homework, and taking work back
- classroom › homework › scheduled homework stays hidden until its time, then the worker tells the class once
- classroom › homework › row-level security keeps each student to their own classes and work, whatever the query
- classroom › homework › school storage limit, file count and deleting a class
- classroom-retention › classroom data retention › deletes nothing until a school sets periods; saving previews, records notices and tells owners and admins
- classroom-retention › classroom data retention › after the notice period, deletes work and monitoring but keeps marks, and the gradebook still shows them
- classroom-retention › classroom data retention › a hold, a longer period or a moved date cancels a deletion; records go with everything; other schools are untouched
- classroom-retention › classroom data retention › only owners and admins manage it, periods must be in order, and students see none of it
- data-keys › rotating DATA_ENCRYPTION_KEY › old values keep working during the rotation, are re-encrypted, and then work with the new key alone
- data-keys › rotating DATA_ENCRYPTION_KEY › a value no configured key can read is reported and left as it is
- data-keys › rotating DATA_ENCRYPTION_KEY › the command-line tool checks, re-encrypts, records an audit entry, and fails on unreadable values
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
- file-checks › checking homework files › scans every file and resizes photos before anyone can open them
- file-checks › checking homework files › deletes a file with a virus, tells the uploader, the owner and admins, and records it
- file-checks › checking homework files › a photo that cannot be read is deleted and its uploader told; nobody else is
- file-checks › checking homework files › when the scanner fails, files wait and are tried again; an alert fires after 10 minutes
- file-checks › checking homework files › without a scanner, photos are still resized; once scanning is on, older files are scanned and stay open meanwhile
- file-checks › checking homework files › two workers never check the same file
- gradebook › gradebook › shows each student’s marks for a class and subject, with what is missing and an average of what is marked
- gradebook › gradebook › downloads as CSV in the member’s language, guarded against spreadsheet formulas, and the download is audited
- gradebook › my grades › a student sees only their own marks, once returned or shown, in each class and subject
- online-tests › writing and publishing a test › checks questions, keeps drafts from students, and tells the class when it is published
- online-tests › taking a test › students get questions without answer keys, answers are checked and saved, and submission marks them
- online-tests › taking a test › a start code, the number of attempts and retakes the teacher allows
- online-tests › time › the server keeps the time: late answers are refused, the attempt is submitted, and the worker catches the rest
- online-tests › time for everyone and extra time › a new closing time moves students already working; results and answers wait for anyone with extra time
- online-tests › monitoring and control › the teacher sees who is working, leaving the page, pasting or using another device, and acts on one student
- online-tests › monitoring and control › questions and timing are locked once a student starts; results released by hand reach the students
- online-tests › monitoring and control › a student never reaches another student’s attempt, answers or events
- paymob-contract › Paymob checkout (Intention API + Unified Checkout) › creates an intention as documented and sends the customer to Unified Checkout
- paymob-contract › Paymob checkout (Intention API + Unified Checkout) › turns a Paymob API rejection into a 502 without exposing provider details; retry works
- paymob-contract › Paymob checkout (Intention API + Unified Checkout) › turns an unreachable Paymob API into a 502 as well
- paymob-contract › Paymob transaction callbacks › a successful payment marks the invoice paid and activates the plan; retried callbacks are deduplicated
- paymob-contract › Paymob transaction callbacks › a declined payment is recorded and the invoice stays open; a new checkout attempt can then be paid
- paymob-contract › Paymob transaction callbacks › applies a payment made on an earlier checkout attempt of the same invoice
- paymob-contract › Paymob transaction callbacks › rejects callbacks with a missing or wrong HMAC, a tampered body or an unsupported type
- paymob-contract › Paymob transaction callbacks › binds the payment to the signed Paymob order, not to the unsigned merchant_order_id
- paymob-contract › Paymob transaction callbacks › the browser redirect is signed over the same fields (what `npm run paymob:check` verifies)
- paymob-contract › Paymob transaction callbacks › ignores signed callbacks for orders this app did not create
- paymob-contract › Paymob transaction callbacks › does not apply pending, refunded or wrong-amount transactions
- rate-limit-store › shared rate limits (PostgreSQL) › two app instances enforce one login limit, and a restarted instance still enforces it
- rate-limit-store › shared rate limits (PostgreSQL) › stores keyed hashes only: no IP address or email
- rate-limit-store › shared rate limits (PostgreSQL) › the global flood guard stays per process: it limits at 600 a minute and writes nothing to the database
- rate-limit-store › shared rate limits (PostgreSQL) › counts concurrent requests from several instances exactly
- rate-limit-store › shared rate limits (PostgreSQL) › starts a new window when the old one ends; reading does not count; namespaces are separate
- rate-limit-store › shared rate limits (PostgreSQL) › the worker deletes expired counters and keeps live ones
- school-network-limits › one school network › each student has their own allowance on the test routes, however many share the address
- school-network-limits › one school network › the flood guard lets many accounts share an address, and stops one account or a forged cookie at 600 a minute
- scope-carry-forward › carrying a scope to the next academic year › previews what carries over, what is missing, what changed and what is new
- scope-carry-forward › carrying a scope to the next academic year › copies into a new scope for the new year, with chosen replacements; the old scope is untouched
- scope-carry-forward › carrying a scope to the next academic year › moves a scope in place, which also works at the Free plan scope limit
- scope-carry-forward › carrying a scope to the next academic year › validates the target and the materials, and requires an editor to apply
- scope-compare › comparing scopes › on one catalogue: only in each and in both; the CSV download is counted and audited
- scope-compare › comparing scopes › compares last year's scope with this year's: books matched by subject and title, renamed and missing ones marked
- scope-compare › comparing scopes › only within one organization; viewers can compare; the CSV needs CSV export on the plan
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
- scopes › catalogue API › serves the published 2026/2027 catalogue with ETag caching
- scopes › catalogue API › requires authentication
- scopes › content scopes (persisted selections) › creates a scope, toggles materials in batches, and persists across sessions
- scopes › content scopes (persisted selections) › rejects materials from another catalogue version or unknown ids
- scopes › content scopes (persisted selections) › enforces unique names per organization and draft-version restrictions
- scopes › content scopes (persisted selections) › duplicates a scope with its items
- scopes › exports and plan gating › exports text in the original list format, CSV and JSON during the trial
- scopes › exports and plan gating › Free plan: text export only, monthly export quota, one scope
- scopes › exports and plan gating › after a downgrade, scopes beyond the limit become read-only but are not deleted
- scopes › exports and plan gating › member limit counts pending invitations and is enforced under concurrency
- shutdown › graceful shutdown › reports draining on SIGTERM, keeps serving during the drain, then exits cleanly
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
- students › roster import › lists each problem of a line on its own, and names unreadable files with their own codes
- students › the student portal › shows the books of the student's grade that are in the assigned scope, and nothing else
- students › the student portal › without a scope it says so, and other students' or schools' data never appears
- students › the student portal › a student can switch the interface language
- students › the student portal › a suspended school blocks its students
- students › generated passwords › use an unambiguous alphabet and do not repeat
- tenancy › cross-tenant isolation over the API › a member of org B cannot read, modify, export or delete org A data
- tenancy › cross-tenant isolation over the API › object ids from another tenant are rejected even under the attacker’s own org (BOLA)
- tenancy › cross-tenant isolation over the API › rejects malformed org ids without leaking errors
- tenancy › Row-Level Security (database layer) › every table with an org_id column has forced RLS, apart from the documented exceptions
- tenancy › Row-Level Security (database layer) › returns no tenant rows without a tenant context, even for an unscoped query
- tenancy › Row-Level Security (database layer) › only exposes the current tenant’s rows inside a tenant context
- tenancy › Row-Level Security (database layer) › blocks writing rows for another tenant (WITH CHECK)
- tenancy › Row-Level Security (database layer) › the application role cannot bypass RLS or rewrite audit history
- tenancy › Row-Level Security (database layer) › composite keys stop items pointing at another tenant’s scope or another catalogue version
- tenancy › roles and permissions › enforces the permission matrix server-side
- tenancy › roles and permissions › transfers ownership with password confirmation and keeps a single owner
- tenancy › roles and permissions › member removal rules: owner cannot be removed, members can leave, removed users lose access
- tenancy › invitations › existing users accept with their own account; email must match
- tenancy › invitations › an account created from an invitation is signed in, which counts as its first sign-in
- tenancy › invitations › revoked invitations cannot be used and duplicate members are refused
- tenancy › data deletion and export › owner deletes an organization: its data is gone, other tenants untouched, audit retained
- tenancy › data deletion and export › a user can export their data and delete their account unless they own an organization
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
- alerts › alert helpers › counts server errors over the last minutes and forgets older ones
- alerts › alert helpers › considers the worker stopped after four intervals, at least two minutes
- billing-logic › effective plan › free when no subscription or free plan
- billing-logic › effective plan › trial grants the plan until it ends, even if the worker has not run
- billing-logic › effective plan › active period, then grace, then free
- billing-logic › effective plan › open-ended manual subscriptions stay active
- billing-logic › proration › charges the price difference for the remaining fraction, rounded up
- billing-logic › proration › never charges for a cheaper plan
- billing-logic › time helpers › clamps month ends
- billing-logic › time helpers › formats usage periods in UTC
- billing-logic › time helpers › formats EGP amounts
- carry-forward › carry forward: matching a scope to another catalogue version › carries exact and loosely matching titles, and lists missing books with new candidates
- carry-forward › carry forward: matching a scope to another catalogue version › follows a subject whose block was renamed when its code is unambiguous
- carry-forward › carry forward: matching a scope to another catalogue version › reports removed subjects, ignores unselected ones, and summarises
- carry-forward › carry forward: matching a scope to another catalogue version › does not guess when the loose subject key is ambiguous
- catalog-fidelity › legacy catalogue fidelity › has the same 231 subject rows and 1,038 selectable materials
- catalog-fidelity › legacy catalogue fidelity › matches every subject and material in order, except the documented intl kind correction
- catalog-fidelity › legacy catalogue fidelity › keeps the legacy selection keys unique (grade|track|block|sid|title)
- catalog-sheet › catalogue spreadsheet › exports every subject followed by its materials, and an untouched sheet changes nothing
- catalog-sheet › catalogue spreadsheet › applies marks on a published version and rejects incomplete ones
- catalog-sheet › catalogue spreadsheet › allows content changes and new materials only in drafts; content changes clear marks left untouched
- catalog-sheet › catalogue spreadsheet › round-trips a formula-looking title without reporting a change
- catalog-sheet › catalogue spreadsheet › reports unknown ids, duplicates, moves, title clashes, bad values, encoding and missing columns
- catalog-sheet › catalogue spreadsheet › reads a semicolon-separated sheet saved by Excel in some locales
- csv › CSV for spreadsheet round trips › round-trips quotes, delimiters, line breaks, Arabic text and guarded formulas
- csv › CSV for spreadsheet round trips › reads files saved by Excel: semicolons, CRLF, trailing blank lines, no BOM
- csv › CSV for spreadsheet round trips › rejects an unterminated quote and leaves ordinary apostrophes alone
- data-keys › encryption keys › new values name their key; the key id is a short fingerprint
- data-keys › encryption keys › previous keys still decrypt; a key that is not configured is named in the error
- data-keys › encryption keys › envelopes from before key ids were recorded are read with whichever configured key opens them
- data-keys › encryption keys › DATA_ENCRYPTION_KEYS_PREVIOUS takes up to five other 32-byte keys
- countdown › the time left announced in a timed test › says 5 minutes and 1 minute once each, when the time left crosses them
- countdown › the time left announced in a timed test › does not say a mark already behind when the page opens
- countdown › the time left announced in a timed test › says the marks again after the teacher gives more time
- countdown › the time left announced in a timed test › says only the nearer mark when a tick jumps past both
- import-problems › problems in an imported file › fills the English text from the parameters
- import-problems › problems in an imported file › has an Arabic text for every code, with the same placeholders, and none left over
- email-templates › Arabic emails › name the invited role as the Arabic interface does
- email-templates › Arabic emails › say \"a book\" for one assigned book and \"books\" for more
- file-checks › ClamAV daemon client (clamd INSTREAM over TCP) › reports clean files and viruses, sending the file in 64 KB chunks
- file-checks › ClamAV daemon client (clamd INSTREAM over TCP) › throws when clamd reports an error, hangs up, does not answer in time, or cannot be reached
- file-checks › photos › makes a large phone photo at most 2000 px and drops its EXIF, location included
- file-checks › photos › turns a photo upright from its EXIF orientation
- file-checks › photos › keeps the format, never enlarges, and refuses what is not a readable image of its type
- i18n › UI translations › Arabic covers every English key and placeholders match
- i18n › UI translations › every statically referenced key exists
- rate-limit-memory › in-memory flood guard windows › counts within a window and starts again when it ends
- rate-limit-memory › in-memory flood guard windows › stays bounded, dropping the oldest windows first
- reminders › due-date reminder wording › says today, tomorrow, or the date, across month and year ends
- reminders › due-date reminder wording › lists overdue books first, each section by due date, and shortens long lists
- reminders › due-date reminder wording › titles the in-app notice by what is due
- scope-compare › comparing two scopes › on one catalogue version: only in A, only in B, in both; untouched subjects are left out
- scope-compare › comparing two scopes › across catalogue versions: matched by subject and title, with renamed and missing books and subjects marked
- security-primitives › passwords › hashes with argon2id and verifies
- security-primitives › secret encryption › round-trips and detects tampering
- security-primitives › TOTP › accepts a current code once and rejects replay of the same step
- security-primitives › TOTP › generates unique recovery codes and normalizes input
- security-primitives › webhook signatures › sandbox: verifies signed payloads, rejects tampering and stale timestamps
- security-primitives › webhook signatures › paymob: HMAC-SHA512 over the documented field order
- security-primitives › webhook signatures › paymob: matches the signature vector of an independent implementation (Odoo)
- security-primitives › exports › text export keeps the original \"Copy list\" layout
- security-primitives › exports › CSV neutralises spreadsheet formulas and quotes properly
- security-primitives › exports › CSV carries verification columns, with the same formula guard on sources
- security-primitives › exports › CSV ends with the item note, assignee, status and due date, formula-guarded
- security-primitives › configuration › refuses unsafe production settings
- test-marking › online test marking › normalises typed answers the way a teacher would accept them, in Arabic and English
- test-marking › online test marking › marks each question type; multiple choice gives partial credit, never below zero
- test-marking › online test marking › checks questions and answers before they are saved
- test-marking › online test marking › ends an attempt at the time limit or the test’s end, whichever comes first, plus extra time
- test-marking › online test marking › shuffles without losing items and makes readable start codes
- webhook-net › webhook targets › only public unicast addresses are allowed
- webhook-net › webhook targets › URLs must be https, without credentials, to a public host
- webhook-net › webhook targets › the socket lookup refuses a host that resolves to a private address
- webhook-net › webhook targets › signs \"<timestamp>.<body>\" with HMAC-SHA256

</details>

Stability: the full suite was run at least 8 times during development; one ordering-dependent
flake (a published test catalogue leaking between files) was found and fixed in the test reset.
A second flake (1 run in 4) was in the due-date reminder tests: they check that a title is *not* in
an email, and two randomly picked books can share a title (the catalogue has 113 titles for 1,038
materials). Reproduced by giving two picked books the same title; those tests now use books with
distinct titles (`distinctTitleMaterialIds`), which pass on the same data.

## 3. End-to-end — `npm run test:e2e`

**Chromium: 30 tests, 30 passed.** The latest run took 7.6 min, on 2026-10-29 with homework suggestions and teaching plans. It used a real server process on port 3100: 26 journeys, then the accessibility project (4 tests), which reuses the journeys' data.
- **2026-11-06, common-password check (task 1.8), Chromium, locally:** the full run passed 29 of 30 (7.0 min), the every-screen audit included; the 30th was the new test, fixed as described below, after which it and the other changed test passed twice (with the 26 journeys they depend on, 28 of 28 each time). The screen-reader test now changes a password to `password123` in English and `Password2026!` in Arabic and hears the message in each language. It also holds the language preference's save for 3 s and checks that the page's `lang` and its text change together at once: with the old language button (save first, then redraw) it fails, as it should. That race was found by PR #45's CI: the every-screen audit read the student portal straight after "English" was clicked and found Arabic text under `lang="en"` while the save was on its way. Both language buttons now redraw first, and the audit waits for the English text. The first version of the new test removed its request hold while two saves were still held, which Playwright resolves itself ("Route is already handled"); it now waits for both saves to come back 200 instead, and passed twice.
- **2026-11-05, sign-in lockout per account and client (task 1.3): Chromium 30 tests, 30 passed (8.1 min).** The student journey now has a student locked out by wrong passwords: the school sees "locked", presses **Unlock**, and the student signs in with the same password. The first run of it found that the extra attempts used up that student's sign-in allowance, which a later journey needed: an unlock now also gives the locked-out clients their attempts back (integration test added).
- **Journey 26 (2026-10-29, teaching plans):** a lesson plan drafted with AI, edited, printed; a pacing plan written by hand; the list, the scopes list and deleting a plan. The accessibility project audits 19 more screens (the every-screen audit took 5.3 min).
- **Found on the way (2026-10-29), all fixed before the passing run:**
  - **In the app:** in the Arabic interface, the plan editor's fields holding English text (an AI draft) had no language mark, so a screen reader would read them with the Arabic voice. Each field is now marked with the language of what it holds.
  - **In the tests:** the journey expected "27 Sep 2026", and newer English date formatting writes "27 Sept 2026". The audit also took a page's address too early, because Playwright matched the heading "Pacing plan" inside "New pacing plan" (names match as case-insensitive parts unless asked to be exact). It then opened `/plans/new/edit`, which correctly answered 404, and waited for a heading until the 8-minute limit. Both checks are now exact, and the limit was not raised.
- **Journey 25 (2026-10-28, questions suggested by AI):** the platform gives a school AI requests; a teacher asks for questions, keeps two and edits one. The accessibility project audits both suggestion dialogs.
- **The AI layer:** the platform administrator's journey also tests the AI provider (in E2E, a simulator in a process of its own), gives a school an allowance, and the school sees it on its billing page.
- **Two failures on the way, neither a fault in the app** (2026-10-29):
  - **The homework journey** read a handed-in photo's size as soon as it was visible. Under load (a film render on the same machine), the picture arrived 60–76 ms later, so the read returned 0. The journey now waits for the picture to load.
  - **The every-screen accessibility audit** hit its 8-minute limit with no violations under the same load. On an idle machine it took 4.9 min; its usual time is 3–5.5 min, and the limit was not raised.

**Firefox: 25 journeys, 25 passed** (3.1 min) with `npm run test:e2e:firefox`, and **WebKit: 25 journeys, 25 passed** (3.8 min) with `npm run test:e2e:webkit`. Both ran on 2026-10-29 on the merged code (`main` at `be4f7bb`), each on a fresh database. Journey 25 and the AI additions are included. The first cross-browser runs, on 2026-10-27, had 24 journeys: Firefox 3.1 and 2.9 min, WebKit 3.9 and 3.6 min (see "Cross-browser runs" below). Journey 24's first run
stopped in its own setup: it left the question editor's third choice empty, which the editor refuses;
the test now fills it.
The audit test's time budget went from 5 to 8 minutes on 2026-10-27: with 147 screens it takes about
5.5 minutes (the first run with the new screens stopped at the 5-minute limit, with no finding).

| # | Journey | Result |
| --- | --- | --- |
| 1 | Owner registers, verifies email, signs in and builds a content scope that persists; a book removed just before a reload stays removed (sent as the page goes) | Pass |
| 2 | Owner invites an editor, changes the role to viewer, and the viewer becomes read-only | Pass |
| 3 | Another organization cannot reach the first organization's data | Pass |
| 4 | Owner subscribes, upgrades with proration, schedules a downgrade and cancels | Pass |
| 5 | Plan limits are enforced in the UI (second organization starts on Free) | Pass |
| 6 | Service recovers after a server crash: sessions and saved selections survive a restart | Pass |
| 7 | Platform admin signs in with two-factor authentication, sends a test alert (the console reports that no channel is configured), and suspends then restores an organization | Pass |
| 8 | Platform admin verifies a subject against a decree in the catalogue editor; the customer sees the badge, its source link and the coverage line | Pass |
| 9 | Arabic interface switches to right-to-left, shows the Arabic verification label, and the picker fits a phone screen (390 px, no horizontal overflow) | Pass |
| 10 | A newer catalogue (2027/2028) is published with one of the owner's books dropped; the picker offers to carry the scope and the owner is notified; the notification opens the review page, which lists the missing book; the new scope opens on 2027/2028 with the rest carried | Pass |
| 11 | Platform admin downloads the 2027/2028 sheet, marks three books verified, uploads it, sees the preview and applies it; coverage shows 3 verified materials. Then, in the Arabic interface, a sheet with a corrected subject name (refused on a published version) and a book marked for review without a note: the preview lists both problems in Arabic («السطر N: …», the column name kept in place) and names the subject by its Arabic grade and subject names; Cancel applies nothing | Pass |
| 12 | Owner builds two scopes with one book in common, opens Compare scopes from the scopes list: 1 only in each, 1 in both; differences only by default, everything after clearing the filter; Swap; the downloaded CSV has the right yes/no columns | Pass |
| 13 | Student accounts: the Students page is closed until a platform admin sets the school's student override in the admin console; the owner adds a student (password shown once) and imports a roster (a file with a bad line is refused, the corrected one imported, the credentials CSV downloaded and checked); the student follows the link on the staff sign-in page, is refused with a wrong password, signs in, sees exactly the three books chosen for grade 7, is sent back to the portal from a staff page, switches to Arabic; a staff password reset signs the student out | Pass |
| 14 | Notes and assignees: an editor joins by invitation; the owner writes a note on a book (focus returns to its Edit button) and assigns two books to the editor at once; the editor is notified, follows the notification to the page filtered to their two books and sees the note; the scopes list shows the counts; in the picker the annotated book carries its mark, deselecting it asks first (Cancel keeps it, Remove drops it with its note) | Pass |
| 15 | Status and due dates (reuses journey 14's school, as sign-ups are limited to 10 an hour per address): the owner makes Hana a viewer and assigns her two books with status To do and a past due date in one step, then moves one date later; the Overdue count goes 2 → 1 and the Overdue filter shows one book; Hana's email lists the books; she opens My assignments (3) from the navigation, sees the overdue book first, marks it Done (the overdue mark goes), filters to Done, and turns assignment emails off in her account | Pass |
| 16 | Due-date reminders (same school): the owner assigns Hana a third book due tomorrow and the notes page marks it "due soon"; one pass of the worker's reminder job (run directly against the E2E database at 10:30 Cairo time, since the E2E run starts no worker) sends one reminder and a second pass none; Hana's email lists the book as "due tomorrow" with a link to My assignments, although she turned assignment emails off (a separate choice); she sees Due soon 1 on My assignments and the reminder in her notifications, and turns reminder emails off | Pass |
| 17 | Daily summary (same school): Hana switches assignment emails from none to one summary each morning; the owner selects a fourth book and assigns it to her (found with the Not assigned filter) and no assignment email goes; one pass of the worker's summary job for the next morning (run directly, as for journey 16) sends one summary listing the book under Notes Academy, “Grade 6 books”, assigned by E2E Owner, and a second pass none. Journeys 15 and 16 use the new three-way choice instead of the old checkbox | Pass |
| 18 | All organizations: Hana creates her own organization (Hana Study Group), selects a book and gives it to herself due tomorrow; from Notes Academy's My assignments she follows "See your books in all your organizations (2)"; the page lists 5 books (both due tomorrow first, then by date), Not done yet 5 and Due soon 2, and links each organization; she marks her own organization's book Done there, finds it under Done, and 4 remain not done | Pass |
| 19 | Webhooks: a local receiver stands in for the school's system (the E2E server allows local targets); the Notes Academy owner adds it in Settings → Webhooks without "Scope deleted", copies the secret shown once, and sees it Active with the three events; Send test → "Test delivered (200)" and the ping's signature checks with the secret; selecting one more book in Grade 6 books and one pass of the worker's webhook job (run directly) delivers `scope.items_changed` with 5 books, signed; the Deliveries dialog lists both, delivered (200), says deliveries are kept for 30 days, and "Download history (CSV)" downloads both rows newest first with the exact body the receiver got; a note written on a book is delivered as `scope.items_annotated` naming that one book, signed, without the note's text | Pass |
| 20 | Classes and homework (journey 13's school): the owner creates class 7A with the "Prep 1 books" curriculum, chooses Laila and Omar, adds themselves as teacher of a subject and sets homework with one of the curriculum's books and 10 marks; Laila sees it on Today with a notification, writes an answer, attaches a photo named .jpg (kept as notebook.png from its bytes; "Being checked…" until one pass of the worker's file checks, run directly, after which the list shows the file by itself and her answer stays) and hands in; the owner sees "Classes (1 to mark)", 1 of 2 handed in, opens the work with the photo, gives 9/10 with a comment and returns it; Laila sees her mark and the comment, can no longer change the work, and Today lists it under "Returned this week". Journey 13 now also checks that the portal opens on Today and the curriculum is under My books | Pass |
| 21 | Online test (journey 20's class 7A): the owner writes "Chapter 1 quiz" with a 20-minute limit and a start code, adds three questions (one correct choice, a short answer accepting "Aswan" or "أسوان", a written answer; 6 points) and publishes it; Laila starts from Today ("Tests open now"), first with a wrong code (refused), then the right one in lower case; the clock shows the time left; she answers (the short answer in Arabic), leaves the page once and pastes once, and the page shows "Saved"; on the live monitor she is "Working", "3 of 3 answered", "Left the page 1×", "Pasted 1×", Omar "Not started"; the owner gives her 10 minutes more; she submits and is told the results come later; the owner closes the test, opens Results ("To mark"), sees 2 / 2 and 1 / 1 marked automatically, marks the written answer 2.5 of 3 with a comment ("Saved. Total: 5.5 / 6"); Laila's past tests show 5.5 / 6 and her review shows the comment | Pass |
| 22 | Gradebook (journeys 20 and 21's class 7A): the owner opens **Gradebook** from the class page; the subject is preselected; Laila's row shows 9 (homework) and 5.5 (test) and an average of 90.6%, Omar's shows the test as Missing; **Download CSV** saves `gradebook-7A-….csv` whose header starts with "Student" and whose Laila row ends with 90.6 and 0 missing. Laila signs in, opens **Grades** and sees her subject in 7A with "Average: 90.6%", the homework 9 / 10 and the test 5.5 / 6 | Pass |
| 23 | Keeping classroom data (journeys 20–22's class 7A, its homework and test moved 40 days back): the owner opens **Keeping data** from Classes (nothing due), sets 30 days for students' work; saving asks first ("homework: 1, tests: 1"); both are listed as due and the owner's email lists the homework; **Keep** moves the test to the kept list. One worker pass 15 days later deletes the homework's work: the homework page says so, the teacher's view of Laila's work says the answer and files were deleted and the mark is still 9; Laila's grades still show 9 / 10 and her homework page says why her work is gone | Pass |
| 24 | Saving on a weak connection (journey 20's class 7A): the owner writes and publishes "Weak Wi-Fi quiz" with one choice question; Laila starts it. Her first save is answered 503 by the test (the network stands in for a busy server): the bar says "Not saved yet (1): trying again", and the page saves it by itself 5 s later ("Saved"). With every save failing she changes her answer; the bar says so again, and **Submit** first shows "Some answers are not saved" ("Answers not saved yet: 1."), which she cancels. Once saves go through, the page saves the answer by itself, she submits, and the database holds her latest answer | Pass |
| 25 | AI suggestions (journey 20's class 7A; the E2E server's AI provider is the simulator): a platform administrator gives Delta Prep School 20 AI requests a month; on a new test the owner asks for questions (a missing topic is said first), keeps two of three and edits one; 19 requests are left. In the new-homework form, **Suggest with AI** with a topic, the kind Writing and 20 minutes shows the suggested homework with its time and notes; **Use this suggestion** fills the title (focused) and instructions; cancelling sets nothing | Pass |
| 26 | Teaching plans (same class and scope): from the class page, **Teaching plans** opens the scope's plans filtered to grade 7; **New plan** → **Draft with AI** (18 requests left; a missing topic is said first) opens the lesson plan draft in the editor with its notice; the owner renames it, removes an activity and adds one (focus moves to it), saves; the plan shows its objectives, activities, a total of 40 minutes against a 45-minute lesson and "Started from a draft written by AI"; in print only the plan shows; an edit adds a note. A pacing plan written by hand: saving without a title focuses the title with its error; week 2 shows 4–8 Oct 2026; the plan lists both weeks and its last day. The list marks the AI draft and shows "2 weeks from 27 Sept 2026"; the scopes list shows "Plans: 2"; deleting the pacing plan leaves the lesson plan | Pass |

### Cross-browser runs (Firefox and WebKit), 2026-10-27

The first runs in Firefox and WebKit found one fault in the app and two in Playwright's browser builds.

| Found | Cause | What changed | Checked |
| --- | --- | --- | --- |
| WebKit: journey 1 kept 1 of 3 chosen books after a reload | The picker saved in batches 0.4 s after the last change, said "Saved" after the first batch while more were waiting, and sent what was left on leaving as an ordinary request, which the browser cancels with the page | Saves are keepalive requests; what is waiting is sent on `pagehide`; "Saved" only when nothing is left (`public/js/views/picker.js`, `public/js/api.js`). Journey 1 now removes a book and reloads at once | With the previous picker the new step fails in Firefox and WebKit (the removal is lost) and passes in Chromium; with the new one it passes in all three |
| Firefox: a journey now and then waited 90 s for a page that had loaded (journeys 17, 20, 4 on different runs) | Playwright's Firefox loses the navigation's "load" event: 11 of 100 fresh pages in a probe against the E2E server (Chromium and WebKit: 0 of 80) | In Firefox the journeys' navigations wait for DOMContentLoaded (`navigable()` in `tests/e2e/helpers.ts`) | 0 of 100 in the same probe; two full runs pass. Waiting for the new page's blank document first was not enough (7 of 100) |
| WebKit: "Page crashed" on a reload | Playwright's WebKit Linux build aborts the page (assertion `_M_is_engaged()` on an empty `std::optional`) on the second reload after a `history.pushState`; a bare page with one `pushState` does the same, without one it does not | In WebKit the journeys' reloads are a new load of the same address (same helper) | No crash in two full runs. Real Safari is a different build and was not available to test |

Neither browser fault involves the app's code; both work-arounds are in the test helpers only, and
Chromium runs as before.

Note from journey 2's first run: the test toggled a material and immediately demoted the user; the
batched save then arrived after the demotion, the server answered 403, and the UI rolled the toggle
back — correct behaviour; the test was changed to wait for "Saved".

### Accessibility (`tests/e2e/accessibility.spec.ts`)

| # | Test | Result |
| --- | --- | --- |
| 23 | axe-core 4.13 with the WCAG 2.0/2.1/2.2 A and AA rule sets on 170 screens, each also read from top to bottom by a simulated screen reader (SCREEN_READER_PRECHECK.md: no unnamed control or table header, no symbol read on its own, no skipped heading level, no unmarked other-language text) and checked that no open dialog's content is wider than the dialog. The 170 screens: sign in (light and dark), register, forgot password, pricing, invalid email/reset/invitation links; the picker (first visit, with selections and the newer-catalogue banner, list panel open, Arabic, dark, phone); new-scope and notifications dialogs; scopes, carry-forward review (also Arabic, dark, phone), members, billing (also Arabic, dark), settings, audit log, account (also Arabic); platform admin overview, organizations, organization detail, users, catalogue versions, plans, audit, webhooks, catalogue editor (light and dark) and its verification dialog; scope comparison across two catalogue years (differences only, everything, Arabic, dark, phone); Students page (empty and with a student), add-student, student-password and roster-import (with a problem) dialogs, and the roster import in Arabic with five problems (each item's Arabic text, right-to-left direction and the username and scope name kept in place are checked); student sign-in; student portal (English, Arabic, Arabic dark, dark, phone) and its change-password dialog; notes and assignees (with a note and a book chosen, with an overdue and a due-soon book, Arabic, dark, phone) and its edit dialog; My assignments (English, Arabic, dark, phone); My assignments in all organizations (English, Arabic, dark, phone); settings with a webhook endpoint (also Arabic, dark, phone) and the webhook secret, deliveries (with a failed test delivery, its history note and download button) and edit dialogs; the account page during two-factor setup; the picker as a viewer (read-only); the platform admin's two-factor sign-in page; classes (none yet, with a class, Arabic), the new-class, choose-students, add-teacher and set-homework dialogs, a class with homework (also Arabic, dark), a homework with work handed in and returned (also Arabic, dark) and the mark dialog; the student's Today (no class, homework due, Arabic, phone), homework list (also phone) and homework as new, a draft with a photo being checked and once checked, handed in, returned with a mark, Arabic, dark and phone; online tests: the new-test and add-question dialogs (choices, written answer), a draft test with questions (also Arabic, dark), the student's Today with a test open, the tests list, the start page and start dialog, taking a test (also Arabic, phone), the live monitor (also Arabic, dark) and its extra-time dialog, the submit dialog, submitted, the results (also Arabic), marking an attempt, and the student's result (also phone); the gradebook (also Arabic, dark) and the student's grades (also Arabic, phone); keeping classroom data (nothing set, the confirmation dialog, items due, an item kept; also Arabic, dark, phone); questions and homework suggested by AI (both request and both review dialogs); teaching plans (none yet, with two plans, Arabic, dark, phone), the new-plan and draft dialogs, the lesson plan editor with an AI draft (also Arabic), the pacing plan editor with a field error (also phone), a lesson plan (also Arabic, dark, phone) and a pacing plan (also Arabic). In the teacher and student portal the same test also listens (2026-10-27): handing in homework is heard as "polite: Handed in." and the page's heading; a test's failed saves as "Some answers are not saved yet. The page keeps trying." once for two answers, with nothing about saving or time otherwise; the live monitor's summary when it changes, and focus moving at most once while the board refreshes at least four times (counted from the browser's focus events; with the whole table redrawn on each refresh, as before, focus moved 4 times and this check failed); marking a test: each question's fields named "Question N: …" and "polite: Saved. Total: 2 / 2". | Pass — 0 findings (the Arabic test screens first showed an English question's final "?" read on its own, and "null" read where an empty part of the page was drawn; fixed) (the deliveries dialog with a row first showed the "Payload" toggle under the 24 px target size; fixed). Also checks that in Arabic an email address and a mixed English title (with brackets and "&") are each one left-to-right run with `lang="en"`, so they are not shown reversed |
| 24 | Keyboard only: the first Tab from the top reaches the visible skip link, which moves focus to the page heading without redrawing it; a dialog opened with Enter takes focus, Escape closes it and focus returns to the opener; Tab reaches a material, its focus outline is visible, Space selects it and the tray counts it | Pass (4.5 s) |
| 25 | What screen readers are given, read from the browser's accessibility tree (docs/SCREEN_READER_REVIEW.md §4): on the account page's password form, the new-password field's description is its hint, then its hint and error after a failed submission, then the hint alone once corrected; the page area is not a live region; page titles follow the heading on the picker, account, settings and not-found pages and switch to the Arabic name in Arabic; picker book buttons include their kind ("(Ministry material)", "(External reference)"); after a failed submission focus is on the first field in error; the notifications button is "Notifications, 2 unread" with two unread, "Notifications" after opening the list, and focus returns to it | Pass |
| 26 | A simulated screen reader listens while the member acts: selecting a book is heard as the book with its kind and then "polite: Saved"; opening the new-scope dialog announces "dialog, New scope" and focus lands on its Name field; a wrong current password is announced once; a too-short new password moves focus to that field, which is read with its error, and no other message is announced | Pass |

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

Simulated screen-reader pre-check (SCREEN_READER_PRECHECK.md), 2026-10-25: the first run flagged
1,485 items; after removing a harness bug (1,000 items, a dialog read in a loop) and separators the
tool reads on their own (·, —, :), the real findings were text in the other language without `lang`
(359 places), a check mark and an emoji read as symbols, blank action column headers in 7 tables,
empty cells read as a dash, a skipped heading level on the pricing page, and (from the listening test, the last row) field
errors not announced and a form error announced twice. All are fixed; the last run reports 0.

The "what screen readers are given" test against the previous front end (its checks made non-stopping so every one is
reported): 13 failures, one for each fixed problem: the page area was a live region (1); every page
title was the app's name alone (6: account, picker, settings, not found, and after switching to Arabic
and back); the password field had no description, before and after the error (3); the two book
buttons had no kind in their name (2); the notifications button was "Notifications" with two unread (1).
That test creates its member directly in the database, because the run already uses most of the 10
sign-ups an hour that the server allows from one address.

### User guide screenshots — `npm run docs:screenshots`

**1 test, 1 passed** (1.8 min, 2026-10-27). It is a separate configuration, not part of `npm run test:e2e`. It builds the demo school of `docs/USER_GUIDE.md` on a fresh test database through the interface and saves 82 screens (19 of them for classes, homework, tests and the gradebook, added with the gradebook, and 1 for keeping classroom data). Only the new screenshot was committed on 2026-10-27; the others keep the 2026-10-26 capture. It fails if a step stops working, or if a dialog's content is wider than the dialog. Before the fix, that check failed on the "API key created" dialog.

The same test in the Arabic interface, `npm run docs:screenshots:ar`: **1 test, 1 passed** (1.8 min, 2026-10-27),
82 screens for `docs/USER_GUIDE.ar.md` (again only the new keeping-data screenshot committed), with Arabic demo data and every label read from the interface's own Arabic
dictionary (a missing key stops the run). Reviewing these screens found the untranslated admin console text, plan
descriptions, reversed email addresses and brackets, left-aligned web addresses and the audit date overflow listed
in PROJECT_STATUS.md; the English run was repeated after those fixes (1 passed, 62 screens at the time). Reviewing the new classroom screens found "1 points", a test subtitle saying "due" for its closing time, the gradebook's names and titles in the header style, and full-page shots drawing the top bar mid-page; all fixed before these runs.

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
| Backup from inside the compose stack (`docker compose exec postgres pg_dump -U midad_backup`) | Pass |
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

### Homework file checks with the real ClamAV (2026-10-27)

The same production-settings stack (§4 above), rebuilt with this change (image 468 MB, `sharp` 0.35.5 with
libvips 8.18.7 loading as the unprivileged user), now with the `clamav` service from
`docker-compose.prod.yml` (ClamAV 1.5.4, signatures of 25–26 October in the image; about 1 GB of memory
once loaded). Migration 0016 applied to the existing database. The app instances and the worker ran with
`FILE_SCAN=clamav`; the migrate job with `off`. A script drove the stack through Caddy as the school's
owner (as the teacher) and a new student; the database was read with `psql` in the container.

| Step | Result |
| --- | --- |
| Worker start, ClamAV still loading | Logged `fileScan: "clamav"` and "the virus scanner (clamd) does not answer yet; homework files wait until it does" |
| The student uploads a phone photo (4,032 × 3,024, 106,515 bytes, EXIF with the phone's make and GPS) and a PDF, and hands in | Both `pending`; the teacher opening the photo at once: **409 `FILE_CHECKING`** |
| The worker's check | Both `ready` **2.1 s** after the hand-in, `scanned_at` set (scanned by ClamAV) |
| The teacher opens them | Photo: 200, **2,000 × 1,500, 29,552 bytes, no EXIF**, the make no longer in the bytes; `original_size_bytes` 106,515. PDF: 200, the same bytes as uploaded |
| A file holding the EICAR test string added to the student's work directly in the database (an upload cannot carry it: it must start with a photo's or a PDF's bytes, and ClamAV reports EICAR only at the start of a file) | **`infected`, virus `Eicar-Test-Signature`**, bytes deleted; audit `classroom.file_infected` by the system with the virus's name; the student's notification "A file you uploaded was deleted"; the owner's "A virus was found in a homework file … uploaded by Scan Student … The device it came from may be infected." |
| `docker compose stop clamav`, then the student uploads a PDF | Stays `pending`; retried every 2 s (`check_attempts` 4 after 8 s, error `getaddrinfo ENOTFOUND clamav`); the worker logged the error once |
| The waiting file backdated 11 minutes | Within a minute one instance raised **`file_checks_stalled`**: "1 homework file has waited more than 10 minutes to be checked" (`ops_alerts`, the app's log) |
| `docker compose start clamav` | The file `ready` and scanned **15 s** later (signatures already in the volume) |
| Five minutes with nothing waiting | The alert **resolved** (10:35:19, one "resolved" message from one instance) |

### Operations scripts: backups, copies, restores and a lost server (2026-10-27)

The production-settings stack again (two app instances, worker, ClamAV, Caddy with its local certificate
authority, PostgreSQL), started with `ops/start.sh --env prod --yes`. Data was made through the API: a
school owner (confirmed in SQL, as no mailbox exists here) with two-factor sign-in on, a webhook (its
signing secret stored encrypted), 20 students who sat an online test with `scripts/load-exam.mjs` (436
requests, 0 failed, 208 saved answers all matching the teacher's view), and homework with a photo checked
by ClamAV. Copy targets ran in containers on one Docker network (`BACKUP_DOCKER_NETWORK`): an SFTP server
(`atmoz/sftp`, one user with an SSH key, one with the password `Sec ret"&!x 2026`), an S3-compatible
server (`rclone serve s3`: MinIO's image was not available here, and no real cloud provider was used),
and a folder standing in for a USB drive. Interactive runs were driven through a pseudo-terminal.

**Linux script (`ops/midad.sh`)**

| Check | Result |
| --- | --- |
| Interactive backup: settings file and certificates included, encrypted, copies to the folder, SFTP and the bucket | Pass in 6.5 s: archive 304 KB (dump 284 KB, 51 tables, 16 migrations); the four files have the same checksum; none of `PGDMP`, `SESSION_SECRET`, `DATA_ENCRYPTION_KEY`, `manifest` or the photo's name appears in the archive; the passphrase appears in no file |
| `--yes` with no terminal, passphrase from the passphrase file | Pass: the saved choices reused, all three copies made |
| SFTP server stopped | The backup kept here and in the folder; "copies failed: server", exit 1; no lock or unfinished files left |
| Old backups (files dated 40 and 7 days back, and a file not named `midad-backup-*`, in all four places) | The 40-day-old backups deleted in the backup folder, the folder copy, on SFTP and in the bucket; the others kept |
| Test of one backup fetched from each of the four places (`--only-verify`) | Pass ×4: 16 migrations, row-level security forced on 34 tables, all 51 tables' row counts equal to the backup's check; the scratch database dropped |
| One byte changed in the folder copy | Refused by the checksum; with the checksum file removed, refused by the decryption ("Wrong passphrase, or the file is damaged"); exit 1 |
| Wrong passphrase | Refused, exit 1 |
| Restore from the bucket after renaming the school and deleting the webhook, switch | New database `midad_r<time>`, checks passed, app back within a minute; the name and the webhook back, the photo's bytes identical (MD5), 20 test attempts, key check passed; the owner signed in through Caddy with password and TOTP |
| **Lost server:** `docker compose down -v` (database, certificates, virus signatures gone), settings file, local backups and copy settings removed; restore from SFTP | Pass in about 90 s: the SFTP connection set up during the restore, the settings file put back from the backup, the database restored and checked, the certificates restored (HTTPS still validated by the old certificate authority), all services healthy, two-factor sign-in worked |
| Managed database: a separate PostgreSQL 16 with the three roles and an admin that is neither superuser nor `BYPASSRLS` (only `CREATEDB` and membership of the owner role); restore and switch | New database owned by the owner role; `DATABASE_URL`, `MIGRATION_DATABASE_URL` and `BACKUP_DATABASE_URL` rewritten; checks as the backup role passed; two-factor sign-in worked; backup and test from it passed, also with `DB_NAME` left out |
| SFTP server replaced (new host key) | Copy refused ("knownhosts: key mismatch"), exit 1 |
| A lock held by a running process; a lock and a decrypted file left by a killed run | Refused ("another backup or restore is running (process …)"); taken over with a warning, the leftovers deleted |
| Stop, "remove the containers" | Containers removed; the four volumes kept |

**Windows script (`ops\midad.ps1`), run with PowerShell 7.4.2 on Linux**

| Check | Result |
| --- | --- |
| Start (`--yes`), status, menu | Pass |
| Interactive backup, passphrase typed twice, copies to all three | Pass |
| Backups made by one script, tested by the other (bucket and SFTP) | Pass both ways |
| Interactive restore from the backup folder, certificates restored over the existing ones, switch | Pass: data back, photo identical, key check passed, two-factor sign-in worked; the replaced certificates saved first |
| Lost server, rebuilt from the bucket (bucket connection set up during the restore) | Pass, as with the Linux script, including the note that the old database is empty |
| Password SFTP set up through the menu (the password above) | Connected; stored obscured; unattended backups from both scripts reached it |
| Passphrase file made through the menu | Mode 600; unattended backup used it |
| Damaged copy, wrong passphrase, no terminal without `--yes`, `--yes` without `--env`, SFTP stopped | Same refusals, messages and exit codes as the Linux script |
| Managed database: backup, test, restore without switching | Pass |
| Unattended full restore with switch (`--yes`), both scripts, after all fixes | Pass |
| Windows PowerShell 5.1 | Not run (no Windows here). A parser scan finds no PowerShell 7-only syntax, and the file is ASCII only |

Problems the drill found, all fixed in the same change: the `migrate` job failed in production when the
settings file set `FILE_SCAN=clamav` (`CLAMAV_HOST` was not passed to it); SFTP copies failed with a
`known_hosts` holding only the server's ed25519 key (the copy tool asked for ECDSA first; it now asks for
a key type the file lists); on a server without a settings file the restore asked about the settings file
a second time; the certificate volume made by the restore drew a Compose warning (Compose now makes it);
closing the window during a restore left the lock and decrypted files behind (now taken over and deleted);
a saved SSH key could not be swapped for a password (answer `none`).

### Rollback after a release that added a migration (2026-11-05) — `scripts/rollback-drill.sh`

Production finding I-3 (`docs/production/INFRASTRUCTURE_PLAN.md` §6), roadmap task 1.2. The script runs its own
Compose project (`midad-drill`) with throwaway settings and secrets on the production files
(`docker-compose.yml` + `docker-compose.prod.yml`: two app instances, worker, ClamAV, Caddy, PostgreSQL).
Release N is built from the checkout; release N+1 is N plus migration `9000_rollback_drill` (a new table and a new
column on `organizations`, an expanding change). Images were built with the proxy settings
(`DOCKER_BUILD_ARGS`); everything is removed afterwards.

| Step | On `main` before the fix | With the fix |
| --- | --- | --- |
| N+1 with `ops/start.sh`: migration applied, `/readyz` 200 on `app` and `app2` | Pass | Pass |
| Back to N with `ops/start.sh` (`APP_IMAGE_TAG`) | **Fail**: N's `migrate` stopped with `corrupted migrations: previously executed migration 9000_rollback_drill is missing`; `app` and `app2` did not start | Pass: `migrate` printed "Database is ahead of this release (rollback): 9000_rollback_drill stay applied; this release's migrations are all applied"; both instances `/readyz` 200 on `midad:drill-n`; the migration stays recorded |
| Forward to N+1 with `ops/start.sh` | not reached | Pass |
| Back to N with `scripts/rolling-restart.sh` | not reached | Pass: both instances `/readyz` 200 on `midad:drill-n` |

With the fix the whole drill took 1 min 30 s (images already built). No drill containers or images were left.

### Container memory limits and PostgreSQL settings (2026-11-05) — task 1.4

Production findings I-1, I-2 and I-7 (`docs/production/INFRASTRUCTURE_PLAN.md` §3, §5). The production-settings stack
(`docker-compose.yml` + `docker-compose.prod.yml`: Caddy with its local certificate authority, `app` and `app2`,
worker, ClamAV with real signatures, PostgreSQL 16), built from this branch and started with
`ops/start.sh --env prod` under its own project name with throwaway settings and secrets, on a 4-vCPU, 15 GB
sandbox (cgroup v1, so limits are enforced). Everything was removed afterwards.

| Check | Result |
| --- | --- |
| `docker compose config` | Limits app, app2, migrate 768 MiB; worker 1 GiB; clamav 2 GiB; postgres 3 GiB with 1 GiB `/dev/shm`; caddy 256 MiB; `NODE_OPTIONS=--max-old-space-size=512` for app, app2, worker, migrate; the postgres `command:` with every setting |
| Running containers | The same limits in `docker inspect`; `SHOW` gives shared_buffers 1GB, effective_cache_size 2GB, work_mem 16MB, maintenance_work_mem 256MB, max_connections 80, idle_in_transaction_session_timeout 2min; V8 heap limit 524 MiB in app, app2 and worker; `ConcurrentDatabaseReload no` in clamd.conf; all healthy |
| ClamAV signature reload (two standalone containers, no limit, same signatures, `clamdscan --reload`, resident memory sampled every 0.2 s) | Default `ConcurrentDatabaseReload yes`: 944 MiB steady, **1,886 MiB peak**, 22 s. With `no`: 944 MiB steady, **956 MiB peak**, 17 s (scans wait meanwhile) |
| Exam load test, 300 students and 5 teachers for 8 minutes (`scripts/load-exam.mjs`, as in §5) | **16,539 requests, all 2xx** (no 429, no 5xx); 300 of 300 signed in, started and submitted; 5,983 acknowledged answers, none missing or different. p95: sign-in 114 ms, start 42 ms, save 27 ms, heartbeat 25 ms, monitor 67 ms, submit 76 ms |
| Memory under that load (`docker stats` every 15 s, 31 samples) | Peaks: app 114 MiB and app2 95 MiB of 768; worker 77 MiB of 1,024; clamav 962 MiB of 2,048; postgres 157 MiB of 3,072 (small database); caddy 29 MiB of 256. No container killed or restarted; no statement of 500 ms or more in the database log |
| A container over its limit (`docker exec` of a process in `worker` that kept allocating 64 MiB buffers) | Stopped by the kernel at about 960 MiB (exit 137, `oom_kill 1` in the worker's memory cgroup). The worker kept running (heartbeat healthy); PostgreSQL the same process, not restarted; app, app2 and ClamAV untouched; `/readyz` through Caddy 200 |

Compared with the same test on 2026-10-27 (§5): the same result (every request 2xx). Sign-in was slower at the
tail: p99 788 ms against 131 ms, the slowest 895 ms. Other latencies were the same within a few milliseconds. The
cause was not isolated: sign-in now also does the lockout's lookups (task 1.3), one instance reached 204 % CPU during
the first minute's Argon2 hashing, and the load generator and `docker stats` ran on the same 4 vCPUs. The memory
limits were far from reached. Repeat on staging hardware.

### Settings per container (2026-11-05) — task 1.5

Production finding S-9. The production-settings stack built from this branch and started with
`ops/start.sh --env prod` under its own project name, with throwaway settings that set every provider key
(`BILLING_PROVIDER=paymob` with its four keys, `AI_PROVIDER=gemini` with a key and model, an alert webhook address).
The names of the secret settings in each container's environment (`docker inspect`, and `env` inside the running
app and worker; names only, never values):

| Container | Secret settings present |
| --- | --- |
| `migrate` | `MIGRATION_DATABASE_URL` |
| `app`, `app2` | `AI_API_KEY`, `ALERT_WEBHOOK_URL`, `DATABASE_URL`, `DATA_ENCRYPTION_KEY`, `DATA_ENCRYPTION_KEYS_PREVIOUS`, `PAYMOB_HMAC_SECRET`, `PAYMOB_PUBLIC_KEY`, `PAYMOB_SECRET_KEY`, `SANDBOX_WEBHOOK_SECRET`, `SESSION_SECRET`, `SMTP_URL`, `SYSTEM_DATABASE_URL` |
| `worker` | `DATABASE_URL`, `DATA_ENCRYPTION_KEY`, `DATA_ENCRYPTION_KEYS_PREVIOUS`, `SMTP_URL`, `SYSTEM_DATABASE_URL` |
| `postgres` | `DB_APP_PASSWORD`, `DB_BACKUP_PASSWORD`, `DB_OWNER_PASSWORD`, `DB_SYSTEM_PASSWORD`, `POSTGRES_PASSWORD` |
| `caddy`, `clamav` | none |

`migrate` applied every migration and seeded the catalogue (exit 0); app, app2 and the worker were healthy, the worker
having started without `SESSION_SECRET` or the Paymob and AI keys the settings file asked for. Everything was removed
afterwards.

### AI request time with a provider that never answers (2026-11-05) — task 1.6

Production finding A-4. A one-off test (not kept in the suite, as it takes two minutes) ran `runAiTask` for three
schools at once, one per adapter, with the **default** settings (`AI_TIMEOUT_MS` 60000, `AI_MAX_RETRIES` 1) against
the provider simulator scripted never to answer:

| Adapter | Result | Time | Requests to the provider |
| --- | --- | --- | --- |
| Gemini | 503 `AI_UNAVAILABLE` | 121.6 s | 2 |
| Anthropic | 503 `AI_UNAVAILABLE` | 120.4 s | 2 |
| OpenAI | 503 `AI_UNAVAILABLE` | 120.4 s | 2 |

With the settings before this task (120 s, 2 retries) the same case makes three attempts, about 6 minutes (computed, not run). The longest
possible wait with the defaults is 260 s (`aiWorstCaseMs`): it needs a first reply of the wrong shape, asked for once
more (docs/AI_LAYER.md §2). Measured before the change, with the SDKs the app uses: a `retry-after` of 4 s was waited
for by the Anthropic and OpenAI SDKs (up to 60 s is honoured) and not by Gemini's, so each provider call now has a
deadline; the contract tests show a 20 s `retry-after` cut at that deadline on all three.

### Images pinned by digest (2026-11-06) — task 1.9

Production finding S-15. On Docker 29.9 in this container:

| Check | Result |
| --- | --- |
| Every pinned reference pulled by its digest (`docker pull name:tag@sha256:…`) | All 6 resolve: Node.js 22 base, PostgreSQL 16, Mailpit, ClamAV, Caddy, rclone. Docker Hub refused three anonymous pulls with 429 (its rate limit), so the daemon used Google's Docker Hub mirror; a digest names the content, so a mirror cannot serve anything else |
| `docker build` (with this container's proxy settings, §2 of the deployment guide) | Built `FROM docker.io/library/node:22-bookworm-slim@sha256:5ec23b7c…` for all three stages; Node.js v22.23.4 inside; CI's smoke test (the image refuses the sandbox billing provider in production) passes |
| `docker compose … config --images` | Development: `postgres` and `mailpit` with `@sha256:`, three `midad:local`. Production (both files): `postgres`, `clamav`, `caddy` with `@sha256:`, four `midad:local`; `config -q` valid |
| The ops scripts' images, resolved by `ops/midad.sh`'s lookup and run | `rclone version` v1.71.2 and `rclone obscure`; `pg_dump` 16.15; busybox `tar` 1.37.0 in the Caddy image; `ops/midad.sh --help` starts from the repository and from another directory |
| `.github/dependabot.yml` against the public Dependabot schema (SchemaStore `dependabot-2.0.json`, with Ajv) | Valid |
| Action SHAs (`git ls-remote` on each action's repository) | `actions/checkout` v4.4.0 `11d5960a…`, `actions/setup-node` v4.4.0 `49933ea5…`, `actions/upload-artifact` v4.6.2 `ea165f8d…` |
| Dependabot on GitHub, after the push | GitHub's check of `.github/dependabot.yml` passed; 10 update jobs succeeded and opened 12 pull requests (#47 to #58) within three minutes: one group of 10 npm minor and patch updates, npm majors one by one, Mailpit 1.33, rclone 1.75 in `/ops`, and the actions' v7 releases. None in this first run for the Node.js, PostgreSQL, ClamAV or Caddy pins. They targeted the repository's default branch (`claude/friendly-rubin-hmemjl`), so every entry now sets `target-branch: main` |

Not run: `ops/midad.ps1`'s lookup with PowerShell (the unit test applies its pattern to the same files instead).

### Dependabot's first updates (2026-11-06)

Dependabot's weekly npm group (10 minor and patch updates) and the three actions' v7 releases, in one pull request.

| Check | Result |
| --- | --- |
| The npm group as Dependabot proposed it | Typecheck failed: Kysely 0.29 (a 0.x "minor") moved `Migrator`, `Migration` and `MigrationProvider` to `kysely/migration`. Fixed in `src/db/migrator.ts`; Kysely now gets its own pull requests (`exclude-patterns` in `.github/dependabot.yml`) |
| With the fix, on the new versions | `npm run lint`, `npm run typecheck`, `npm run build` pass; `npm test` 63 files, 468 tests pass (migrations run on the new Kysely in every integration file); `npm audit --omit=dev --audit-level=high` passes (3 moderate, as before) |
| Actions v7 (`checkout` 7.0.1, `setup-node` 7.1.0, `upload-artifact` 7.0.2) | Dependabot's pins compared with each action's release tag (`git ls-remote`): same commits. Release notes read: nothing this workflow uses changed (fork checkouts under `pull_request_target`, `NODE_AUTH_TOKEN`, an optional unzipped upload); they run on Node.js 24, which ends the runner's "Node.js 20 is deprecated" warning. Each one's own pull request passed all five CI jobs before they were combined |
| End-to-end, first CI run | Chromium's accessibility test failed: `@axe-core/playwright` 4.14 brings axe-core 4.14, whose rule `label-content-name-mismatch` (WCAG 2.5.3, label in name) found 7 controls whose name did not contain their visible text: the picker's grade buttons ("P1 G1" named "Grade 1"), the homework button showing "Mark" named "Open the work of …", "Save mark" named "Save the mark for question 2", "Send test", "Send again", "Submit now" on the live monitor, and the catalogue editor's "verify" links. Each name now holds its visible text (EN and AR); the tests and SCREEN_READER_REVIEW.md use the new names |
| End-to-end, here | Playwright 1.64.1's browsers cannot be downloaded in this container, so the same tests ran with the new axe on Playwright 1.56.1 (whose browsers are here): journeys and accessibility, 30 passed. With only the grade buttons put back, the accessibility test fails with the same 7 picker findings as CI |

### Clear messages when the server or the database update fails (2026-11-06)

The owner's local installation predated migration 0019: `migrate` stopped with a raw `role "midad_system" does
not exist`, the app never started, the sign-in page said only "Failed to fetch" (the browser's English, in the
Arabic interface), and the Windows `ops\status.bat` could not find `.env.docker` when double-clicked.

| Check | Result |
| --- | --- |
| A database without the system role (Docker: a fresh development installation, then `DROP ROLE midad_system`), `ops/midad.sh start` | `migrate` stops before changing anything: "The database has no role "midad_system" (the system role, SYSTEM_DB_ROLE) … docs/DEPLOYMENT_GUIDE.md section 3.3 …" (plain ASCII, so Windows PowerShell shows it intact), "Nothing was changed in the database." Start shows these lines under compose's own "service "migrate" didn't complete successfully", then the path of the full log, and exits 1. Before the fix, start stopped at compose's line alone |
| `ops/midad.sh status` on the same installation | The same lines, once (only the last run of the `migrate` container is read; its log keeps every earlier run) |
| The settings file without `DB_SYSTEM_PASSWORD` | Start refuses: "set these in .env.docker first: DB_SYSTEM_PASSWORD" with a note naming the guide section; status warns with the same note |
| The repair in the deployment guide, Linux commands exactly as written there | Role created, password added to the settings file; start runs `migrate` ("Granted runtime privileges to the system role midad_system"), app ready, `/readyz` 200 |
| The sign-in page in Arabic with the app container stopped (Chromium, real connection refused) | "تعذّر الاتصال بالخادم. تحقّق من اتصالك بالإنترنت، ثم حاول مرة أخرى بعد قليل." instead of "Failed to fetch" |
| `tests/integration/migrator.test.ts` (new test) | `migrate-cli up` as its own process on a new database with a missing system role, then a missing app role: exit 1, the role named, the guide section named, no stack trace, no table created; with the role present, the same command migrates and grants. Fails without the role check |
| `tests/unit/api-client.test.ts` (new) | Chrome's, Firefox's and Safari's network errors become `NETWORK_ERROR` (status 0, still retried by an online test's answer saves), from API calls and downloads; a cancelled request stays a cancellation; 502/503/504 without the app's JSON become `SERVER_UNAVAILABLE` while the app's own 5xx codes stay; no page calls `fetch` itself; both messages exist in English and Arabic. Fails without the change |
| `tests/unit/ops-status.test.ts` (new) | The Linux script's functions run against a stand-in for `docker compose`: the missing-setting note, start's refusal, status showing the `migrate:` lines of the last run (and the first error line of any other failure), nothing when the update succeeded; the Windows script has the same steps, setting names and markers. Fails with the log lines left out |
| `tests/e2e/journeys.spec.ts` (new journey) | The Arabic sign-in page with the request refused, then answered 502 by a proxy, then refused in English, shows each message; the next attempt signs in |

| Whole suite | `npm run lint`, `npm run typecheck`, `npm run build` pass; `npm test` 65 files, 480 tests pass |
| End-to-end, here (Playwright 1.56.1, whose browsers are in this container) | Chromium: journeys and accessibility, 31 passed. Firefox and WebKit journeys: 27 passed each on the second run. On the first run each stopped at one navigation in an older journey that never finished (Firefox: opening the student sign-in page; WebKit: a reload left on "Loading…"), the faults of these browser builds that `tests/e2e/helpers.ts` works around; `main` passed once in both, and the same Firefox reload had failed once in CI on `main`'s code (PR #51) |

Not run here: `ops/midad.ps1` (no PowerShell in this container). Its new lines mirror the Linux ones and the unit
test checks they are there; the owner ran the Windows repair commands in the guide on their own installation.

### Dependabot's major versions (2026-11-06)

| Change | Check | Result |
| --- | --- | --- |
| Remove `@types/nodemailer` | `tsc --traceResolution`: `nodemailer` resolves to `node_modules/nodemailer/dist/esm/nodemailer.d.ts` (10.3.1's own types); without the package: lint, typecheck, build, unit tests | Pass |
| ESLint 10, `@eslint/js` 10 | `npm run lint` before the fix: 5 `no-useless-assignment` errors (initial values always overwritten); after: lint, typecheck, build, `npm test` 65 files, 480 tests | Pass |
| otplib 13 | New `tests/unit/totp.test.ts`: RFC 6238 appendix B values (T = 59 s → 287082; T = 1111111109 → 081804), drift ±1 step accepted and ±2 refused, replays refused, 160-bit base32 secrets, `otpauth://totp/Midad:…` link with `issuer=Midad`. The same test passes unchanged on otplib 12.0.1 and 13.5.0. `npm test` 66 files, 484 tests | Pass |
| TypeScript 7.0.2 | `tsc --noEmit` on the code: no errors. `eslint`: exits 2, "typescript-eslint does not support TS 7.0" | Held on 5.9.3 |
| `@anthropic-ai/sdk` 1.6.0 (after the owner confirmed no gateway reads `X-Api-Key`) | `tests/integration/ai-providers-contract.test.ts` now checks the request the SDK sends: `anthropic-version: 2026-10-21`, the key as `Authorization: Bearer`, no `x-api-key`; the provider simulator accepts either header, as the API does. AI tests (`ai.test.ts`, `ai-providers-contract.test.ts`, `unit/ai-layer.test.ts`, 62 tests); lint, typecheck, build; `npm test` 71 files, 517 tests; E2E in Chromium (Playwright 1.56.1), journeys and accessibility, 31 tests | Pass |

### AI limits per member and per school (2026-11-06)

| Check | Result |
| --- | --- |
| `tests/integration/ai-limits.test.ts` (new, 10 tests) against the provider simulator | The 51st request of a member's day gets 429 `AI_DAILY_LIMIT` and does not reach the provider; another member goes on; a failed request gives the day's unit back; 8 concurrent requests on a daily cap of 3 let exactly 3 through; the worker removes counts older than a week; tokens are counted without a budget; 8 concurrent slow requests on a budget of 3 estimates let exactly 3 reach the provider; a spent budget refuses before the provider and shows no AI left; a second attempt reserves another estimate and stops when there is none; the admin override (refused below 0 and above 1,000,000,000) and the AI card; AI limits on plans | Pass |
| The same file with the daily check removed, then with the token reservation removed | 4 tests fail each time | The tests catch both |
| `tests/unit/ai-layer.test.ts`, `tests/unit/billing-logic.test.ts` (new tests) | The token estimate, the UTC day key, the daily cap setting (default 50, 0 allowed, bounds); every plan carries both AI limits and an override replaces them | Pass |
| `tests/integration/ai.test.ts` | The admin endpoint's new fields (`userDailyLimit`, `tokenLimit`, `tokensUsed`) | Pass |
| Whole suite | `npm run lint`, `npm run typecheck`, `npm run build`; `npm test` 67 files, 498 tests; E2E in Chromium (Playwright 1.56.1), journeys and accessibility, 31 tests, the platform admin journey now setting a token budget and seeing "0 of 200,000" on the AI card | Pass |

### What AI costs and the platform budget (2026-11-06)

| Check | Result |
| --- | --- |
| `tests/integration/ai-costs.test.ts` (new, 6 tests) against the provider simulator, with test prices (not any provider's) | Prices set by a platform administrator and audited with the previous ones; each request priced when logged (400 in × 1.25 + 70 out × 10 = 1,200 millionths of a dollar); a new price applies from then on; the answering model's price, else the configured model's, else no cost (counted as unpriced); a reply without counts priced at its estimate; a failed call at 0; price validation (negative, 7 decimals, over 100,000, missing, unknown provider, bad model id refused; 99,999.123456 and 0.075 accepted) and access (404 for non-admins); the cost report per school and per feature; with a budget of US$4 and US$1.60 a request: no price refused before the provider with the `ai_price_missing` alert, `ai_budget_high` at US$3.20, a request still allowed under the budget, `ai_budget_reached` at US$4.80, then both schools refused (the provider not called), last month's spending not counted | Pass |
| The same file with the budget check removed, then with request pricing removed | 2 and 4 tests fail | The tests catch both |
| `tests/unit/ai-layer.test.ts` | The budget setting (0 by default, decimals, negative refused); dollars and millionths converted exactly | Pass |
| `tests/unit/system-context-allowlist.test.ts` | The new cross-school reads recorded with their reasons (the platform's spending, sums only; the admin cost report and prices) | Pass |
| Whole suite | `npm run lint`, `npm run typecheck`, `npm run build`; `npm test` 68 files, 506 tests; E2E in Chromium (Playwright 1.56.1) journeys and accessibility, 31 tests, the platform admin journey now entering the model's prices (a negative one refused next to the field). The first two runs found two faults in the new card, both fixed: the price form was not shown (the form helper's element was not used), and the remove button's spoken name did not contain its visible text (axe `label-content-name-mismatch`) | Pass |

### Payment tools without Paymob keys (2026-11-06)

| Check | Result |
| --- | --- |
| `tests/integration/billing-reprocess.test.ts` (new, 3 tests) | A failed notification, stored as the webhook route stores it (the normalized event from a signed sandbox callback), is reprocessed by a platform administrator: invoice paid, plan active, event processed, audited; a second request gets 409 `EVENT_NOT_FAILED`; the provider's retry is a duplicate; one payment. A reprocess that fails in the database leaves the event failed with the new error and audits the attempt. 404 for non-admins and unknown events, 400 for a bad id, 409 for an ignored event | Pass |
| The same file with the "failed only" check removed | 2 tests fail | The tests catch it |
| `tests/integration/billing-reviews.test.ts` (new, 3 tests) | A refund of a received payment opens one review linked to it (a replay opens none), the invoice stays paid and the plan active, audited as `billing.payment_reversed`, invisible to another school (row-level security); a void, a short payment and a second payment on a paid invoice each open one; listing, resolving with a note (audited), 409 `REVIEW_RESOLVED` the second time, 400 without a note, 404 for non-admins; the `billing_review_needed` alert fires while one is open and clears once resolved | Pass |
| `tests/integration/paymob-contract.test.ts` (updated) | A refunded and a voided Paymob transaction (simulator, the assumed shape: the original transaction with `is_refunded` / `is_voided`) open reviews resolved to the invoice through the signed order id; pending and wrong-amount ones are not applied | Pass |
| E2E, platform admin journey | A signed sandbox "voided" notification on a paid invoice shows under "Payments to review (1)"; resolved with a note through the dialog; the list empties | Pass |
| Whole suite | `npm run lint`, `npm run typecheck`, `npm run build`; `npm test` 70 files, 512 tests; E2E in Chromium (Playwright 1.56.1), journeys and accessibility, 31 tests | Pass |

Not done: P-3 (reconciliation). Paymob's documentation hosts (`developers.paymob.com`, `docs.paymob.com`) are not reachable from this environment, so its transaction inquiry API could not be confirmed.

### Each school's time zone (2026-11-06)

| Check | Result |
| --- | --- |
| `tests/integration/org-time-zone.test.ts` (new, 5 tests) | Cairo by default; owners set the zone and country (Asia/Riyadh, SA), kept and audited; an unknown zone is refused with the error on `timeZone`; bad country codes refused, null clears; editors refused (403). Overdue: with two schools 25 hours apart (Pacific/Kiritimati and Pacific/Niue), a book due on Niue's today is overdue in the first school only. Reminders: at 04:30 UTC no school is in its hours (skipped); at 05:30 UTC (08:30 Riyadh, 07:30 Cairo) only the Riyadh school is reminded; at 06:30 UTC Cairo's is, and Riyadh's is not sent twice. The daily summary goes out at 08:30 Riyadh, not before. A retention date at 21:30 UTC reads 11 Nov in Riyadh and 10 Nov in Cairo | Pass |
| The same file with "today" fixed to Cairo, then with the sending hours fixed to Cairo | 1 and 2 tests fail | The tests catch both |
| Existing reminder, summary, retention, notes and all-schools tests (48) | Unchanged for Cairo schools. One case first failed: a summary pass with only a suspended school was skipped as outside hours, so it no longer dropped that school's waiting books. Fixed: the hours check counts suspended schools | Pass |
| E2E, webhooks journey | The settings page shows Africa/Cairo; Asia/Riyadh and Saudi Arabia are saved and shown after a reload, then set back | Pass |
| Whole suite | `npm run lint`, `npm run typecheck`, `npm run build`; `npm test` 71 files, 517 tests, of which the reviewed list of cross-school reads failed until the new hours check was recorded in it; after that the unit tests (31 files, 166) pass; E2E in Chromium (Playwright 1.56.1), journeys and accessibility, 31 tests | Pass |

### Secrets in files (2026-11-06)

| Check | Result |
| --- | --- |
| `tests/unit/config-files.test.ts` (new, 7 tests) | Settings read from `<NAME>_FILE`, line ending ignored (LF and CRLF); used when Compose passes the setting itself as empty; both given is refused and the message does not contain the secret; an unreadable file names the setting, the path and the reason (ENOENT, EISDIR; EACCES checked when not run as root, as in CI); an empty file means not set, and a missing required setting says it can come from a file; the worker and migrations read files too; exactly the 13 secret settings have a file form | Pass |
| The same file with the line-ending trim removed, then with the "not both" rule removed | 2 and 1 tests fail | The tests catch both |
| `tests/unit/compose-env.test.ts` (3 new tests) | `docker-compose.secrets.yml` gives the session secret to app and app2 only and the data key to them and the worker, each `_FILE` names a setting the app reads from a file in a container that gets that setting; the base file keeps the required check; `secrets/` is in `.gitignore` and `.dockerignore` | Pass |
| `docker compose config` (Compose 5.6) with throwaway settings | No secret and no file: stops with "set DATA_ENCRYPTION_KEY, or DATA_ENCRYPTION_KEY_FILE with docker-compose.secrets.yml". Values in the settings file (as before), production and development stacks: valid. The add-on without the `_FILE` paths: stops with "set SESSION_SECRET_FILE to the file that holds the session secret". The add-on with them: valid; app and app2 get both secrets at `/run/secrets/…`, the worker the data key only, migrate neither | As expected |
| Production stack on Docker 29.9 (image built from this branch), the add-on, throwaway settings and secret files owned by uid 1000, mode 400 | migrate exit 0; app and app2 ready; worker running. In `docker inspect` and in each process's environment (`/proc/1/environ`): `SESSION_SECRET` and `DATA_ENCRYPTION_KEY` empty, the `_FILE` paths set, and neither secret's value anywhere (0 matches in app, app2, worker). The secret file owned by root, mode 600: the app stops with "SESSION_SECRET_FILE: cannot read /run/secrets/session_secret (EACCES)". The value in both places: "set SESSION_SECRET or SESSION_SECRET_FILE, not both". Everything removed afterwards | Pass |
| Compose file secrets, one container (alpine, uid 1000) | Owner and mode are those of the host file (uid, gid and mode in the secret's definition are ignored outside Swarm). A file replaced while running is seen after `docker compose restart`; written in place, at once | Recorded in DEPLOYMENT_GUIDE §3.7 |
| Whole suite | `npm run lint`, `npm run typecheck`, `npm run build`; `npm test` 72 files, 527 tests; E2E in Chromium (Playwright 1.56.1), journeys and accessibility, 31 tests | Pass |
| Not run | The ops scripts with the add-on (they do not use it) | — |

### Passkeys (2026-11-06)

| Check | Result |
| --- | --- |
| `tests/integration/passkeys.test.ts` (new, 10 tests), against a software authenticator built from the WebAuthn Level 3 specification (`tests/helpers/soft-authenticator.ts`: P-256 keys, CBOR attestation object with "none", authenticator data with flags and counter, DER signature over authenticator data and the client data hash) | Added with the password (wrong one refused), email and audit; sign-in on another browser with no email or password gives an active, two-step verified session; last use recorded; account export lists it. Refused: the same registration answer twice, another account answering a challenge, the same device twice (excluded), another origin or relying party, no user verification, a made-up challenge; at sign-in a replayed answer, another origin or relying party, no user verification, a bad signature, a counter that went back, a user handle of another account (7 failures audited), then a good sign-in still works; an expired challenge; a registration challenge used to sign in; the worker removes expired challenges. Rename and remove by the owner only (another account gets 404); a removed passkey gives `PASSKEY_UNKNOWN`. At most 10 (`PASSKEY_LIMIT`). A suspended account is refused; a school's two-step rule refuses a password-only session and accepts a passkey one; a platform admin's passkey session opens the admin pages. Signed-out visitors (401) and students (403 `STAFF_ONLY`) cannot add or list them | Pass |
| The same file with: user verification not required at sign-in; challenges reusable; the user handle not checked; a passkey session not two-step verified | 1, 3, 1 and 3 tests fail | The tests catch all four |
| E2E, new journey (Chromium virtual authenticator, DevTools WebAuthn domain) | Account page: wrong password refused, passkey added and listed ("Not used yet"), one credential on the authenticator; signed out, "Use a passkey" signs in without email or password; last use shown; removed with confirmation; the device's passkey then gives "This passkey is not registered with Midad…". Skipped in Firefox and WebKit, which have no virtual authenticator in Playwright; the server side runs in every CI job | Pass |
| Accessibility suite | The account page with the Passkeys section and the sign-in page with the passkey button, English and Arabic, light and dark, desktop and phone | Pass |
| Route reviews (`authz-coverage.test.ts`, `students.test.ts`) | The seven passkey routes are listed: the two sign-in routes as public, the rest as the account's own; a signed-in student gets 403 `STAFF_ONLY` from each of those | Pass |
| Whole suite | `npm run lint`, `npm run typecheck`, `npm run build`; `npm test` 73 files, 537 tests; E2E in Chromium (Playwright 1.56.1), journeys and accessibility, 32 tests; journeys in Firefox and WebKit, 27 tests each (the passkey journey skipped) | Pass |

### CI time limits (2026-11-07)

| Check | Result |
| --- | --- |
| `.github/workflows/ci.yml` | Every job has a limit (checks and image 30 minutes, end-to-end 45); installing the browser has 10. Before, a job had GitHub's default of six hours: the WebKit install hung twice (PRs #72 and #74) for over 20 minutes before any test ran, and was cancelled and re-run by hand | Changed |
| `tests/unit/ci-workflow.test.ts` (new, 2 tests) | Every job has a limit of at most an hour; the browser install step has one of at most 10 minutes. Removing the install step's limit, then the first job's, fails 1 test each time | Pass |

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

### One exam for a whole grade on one school network (2026-10-27) — `scripts/load-exam.mjs`

The production-settings stack of §4 (Caddy with its local certificate, `app` and `app2`, worker,
PostgreSQL 16, Mailpit; `NODE_ENV=production`, rate limits on), rebuilt from this branch, on the same
4-vCPU sandbox as the load generator. The script signs in as the school's owner, creates a class of
new students (roster import) and a 20-question exam (16 single-choice, 4 short answers, shuffled),
publishes it, then for 8 minutes: every student signs in and starts within the first minute, saves an
answer about every 20 s, sends a heartbeat every 20 s as the test page does, reports leaving the page
now and then (5% of saves) and submits at the end; 3 teachers (separate sessions) refresh the live
monitor every 5 s. Every request leaves from one machine, so the server sees one client address, as
for a school behind one NAT. At the end every answer the server acknowledged is compared with the
teacher's view of the attempt.

**Before the fix** (`main` at the start of this work), 100 students:

| Request | n | 2xx | 429 | p50 | p95 | p99 |
| --- | --- | --- | --- | --- | --- | --- |
| Student sign-in | 100 | 100 | 0 | 38 ms | 104 ms | 140 ms |
| Start the test | 100 | **60** | **40** | 17 ms | 26 ms | 30 ms |
| Save an answer | 1,360 | 1,360 | 0 | 20 ms | 27 ms | 36 ms |
| Heartbeat | 1,411 | 1,200 | **211** | 16 ms | 23 ms | 29 ms |
| Live monitor (3 teachers) | 306 | 306 | 0 | 26 ms | 47 ms | 59 ms |
| Submit | 60 | 60 | 0 | 51 ms | 98 ms | 230 ms |

3,763 requests in 521 s (7.2 a second). **40 of 100 students could not start**: starting was limited
to 60 in 15 minutes per address, so for the whole school. The 60 who started lost their heartbeats
after about 6.7 minutes (1,200 an hour per address, at 3 a minute each), so the monitor would have
shown them offline. Answers acknowledged: 1,199, all stored as acknowledged. The flood guard
(600 a minute per address and instance) was not reached: about 430 requests a minute on average,
shared by two instances.

**After the fix** (this branch), same stack, same script:

| Request | 100 students, 3 teachers: n | 2xx | 429 | p50 | p95 | p99 |
| --- | --- | --- | --- | --- | --- | --- |
| Student sign-in | 100 | 100 | 0 | 46 ms | 110 ms | 234 ms |
| Start the test | 100 | 100 | 0 | 25 ms | 51 ms | 80 ms |
| Save an answer | 2,178 | 2,178 | 0 | 20 ms | 29 ms | 34 ms |
| Heartbeat | 2,302 | 2,302 | 0 | 17 ms | 25 ms | 31 ms |
| Page event | 122 | 122 | 0 | 16 ms | 22 ms | 24 ms |
| Live monitor | 306 | 306 | 0 | 30 ms | 47 ms | 55 ms |
| Submit | 100 | 100 | 0 | 56 ms | 69 ms | 73 ms |

5,612 requests in 527 s (10.6 a second), none refused and none failed. Every student started and
submitted; 1,993 acknowledged answers, all stored as acknowledged.

| Request | 300 students, 5 teachers: n | 2xx | 429 | p50 | p95 | p99 |
| --- | --- | --- | --- | --- | --- | --- |
| Student sign-in | 300 | 300 | 0 | 37 ms | 85 ms | 131 ms |
| Start the test | 300 | 300 | 0 | 22 ms | 33 ms | 43 ms |
| Save an answer | 6,604 | 6,604 | 0 | 19 ms | 28 ms | 40 ms |
| Heartbeat | 6,900 | 6,900 | 0 | 16 ms | 25 ms | 40 ms |
| Page event | 308 | 308 | 0 | 15 ms | 23 ms | 36 ms |
| Live monitor (300 rows) | 505 | 505 | 0 | 52 ms | 79 ms | 103 ms |
| Submit | 300 | 300 | 0 | 60 ms | 83 ms | 98 ms |

16,423 requests in 524 s (31.3 a second, about 1,900 a minute from one address, so about 940 a
minute on each instance: past the old guard's 600). None refused and none failed; every student
started and submitted; 5,981 acknowledged answers, all stored as acknowledged. The slowest request
took 189 ms. One `docker stats` snapshot two minutes in showed each app instance at about 7% of a CPU
and PostgreSQL at about 19%. Lint and typecheck ran at low priority during the run's last minutes. These are
sandbox figures on one machine, not a capacity guarantee; repeat on staging hardware (DEPLOYMENT_GUIDE §7).

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
- The AI adapters and the suggested questions against the real Gemini API (no key in this environment; the simulator follows the documented APIs, and `npm run ai:check` with a real key is the next step). The quality of real suggestions in Arabic and English is therefore not yet judged; a teacher's review of a sample is needed.
- Branded browsers and devices (Safari on macOS and iOS, Firefox and Chrome on Windows and Android, phones and tablets); the accessibility tests in Firefox and WebKit; manual screen-reader review; external penetration test.
- Two app instances on separate hosts, and loss of the host or the database (both instances ran on one Docker host).
- The rollback drill (`scripts/rollback-drill.sh`) on a staging host (launch checklist E-2); it ran on Docker in this container only.
- Production deployment, TLS issuance by Caddy, an external uptime check, and alert delivery through a real email provider or chat webhook (SMTP was tested with Mailpit, the webhook with a local receiver).
- `ops/midad.ps1`'s image lookup with PowerShell (task 1.9; covered by the unit test's copy of its pattern), and Dependabot security updates (they need switching on in the repository's settings).
- The Windows operations scripts on Windows (Docker Desktop, Windows PowerShell 5.1, `cmd.exe`, Task Scheduler), backup copies to a real cloud bucket (Amazon S3, Backblaze B2, Cloudflare R2), and the `start` script's image rebuild (builds here need the proxy settings).
