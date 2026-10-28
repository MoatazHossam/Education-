# Security design and threat analysis

This document describes controls that exist in the code and how they are tested. It does **not**
claim compliance with any standard or law; see §7 for what still needs external review.

## 1. Assets and actors

| Asset | Why it matters |
| --- | --- |
| Customers' content scopes and plans | Commercially sensitive (product roadmap) |
| Account credentials, sessions, TOTP secrets, API keys | Account takeover |
| Billing state and invoices | Revenue, fraud |
| Curated catalogue | The product's core value |
| Personal data (names, emails, IPs in audit logs) | Privacy obligations |
| Student accounts created by schools (name, username, grade, assigned scope; usually minors) | Children's data: highest privacy expectations (`docs/STUDENT_ACCOUNTS.md`) |

Actors: anonymous internet users, authenticated users of another tenant, malicious or careless
members within a tenant (viewer → editor escalation), students trying to reach staff features or
other students' data, compromised API keys, forged payment
webhooks, platform administrators (insider risk), and attackers with a copy of a database backup.

## 2. Threats and controls

| Threat (OWASP Top 10 2021) | Control | Where | Test |
| --- | --- | --- | --- |
| Cross-tenant data access / BOLA (A01) | Membership check per request (`inOrg`); 404 for non-members; RLS on every tenant table with fail-closed default; composite FKs | `src/auth/guards.ts`, migration | `tenancy.test.ts`, `authz-coverage.test.ts` (enumerates every route), E2E journey 3 |
| Privilege escalation within an org (A01) | Role ranks; admins cannot grant admin/owner; single-owner index; ownership transfer needs password; a viewer may change only the status of a book assigned to them (no other field, no other book) | `src/orgs/routes.ts` | `tenancy.test.ts` |
| Student accounts reaching staff features (A01) | Students are `users.kind = 'student'` with no email and no membership. `requireUser` (used by every staff route and by `inOrg`) refuses them with 403 `STAFF_ONLY`; the portal's own routes use `requireStudentSession` and take the school from the student's record, never from the request. Database triggers forbid a membership for a student and any change of `users.kind`; a check constraint forbids a student with an email, platform-admin flag or MFA | `src/auth/guards.ts`, `src/students/routes.ts`, migration `0007` | `students.test.ts` (enumerates every route with a student session), `authz-coverage.test.ts` |
| Students reaching other students' work, or teachers reaching classes they do not teach (A01) | Classroom routes check class access server side: admins every class, other members only classes they teach (404 otherwise), and only their own subjects for changes and marks. Student requests run with `app.current_student` set, and row-level security limits classes, homework (published only), submissions and files to that student whatever the query; drafts are never shown to staff | `src/classroom/*.ts`, `src/students/context.ts`, migration `0013` | `classroom.test.ts` (unfiltered queries in a student context), `authz-coverage.test.ts`, `students.test.ts` |
| Students seeing other students' marks; marks leaving the school unnoticed (A01, A09) | My grades runs in the student's row-level security context, so it reads only the student's own work and attempts; homework marks show once returned and test scores once the results setting allows. The gradebook opens only for teachers of the class and admins; its CSV is formula-guarded and each download is audited | `src/classroom/gradebook*.ts` | `gradebook.test.ts` |
| Malicious uploads (A04, A05) | Only JPEG, PNG, WebP and PDF, decided from the file's first bytes; 5 MB per file, 5 per item, a per-school storage limit checked under a row lock; names stripped of paths and control characters. Files are served after the same access checks, with `Content-Security-Policy: … sandbox`, `nosniff` and `no-store`; PDFs download instead of opening in the app's origin. Nobody opens a file until the worker has checked it: a ClamAV scan of the bytes as uploaded (`FILE_SCAN=clamav`; production must set it or explicitly `off`), and photos decoded in the worker (never in the web process), limited to 100 megapixels before decoding, turned upright, at most 2,000 px and encoded again, which drops their EXIF (location) and anything hidden after the image data. A file with a virus or a photo that cannot be read loses its bytes; uploader, owners and admins are told and it is audited. An alert fires when files wait more than 10 minutes (scanner down) | `src/classroom/files.ts`, `src/classroom/file-checks.ts` | `classroom.test.ts`, `file-checks.test.ts` (unit and integration), checked with the real ClamAV (TEST_REPORT §4) |
| Students seeing test questions early, answer keys, or other students' attempts; working past the time (A01, A04) | Row-level security in a student context: published tests of their classes only, questions only after starting, keys only after the test is over for everyone (closed and any extra time run out) with answers shown and results out (keys are in their own table), and results "when the test closes" wait for that too; own attempts, answers and events only, and answers writable only while the attempt is open. The server keeps the time: answers after the deadline (+15 s for the network) are refused and the attempt submitted; the worker submits the rest. Start codes and one-device attempts are checked server side; staff routes return keys only to those who can change the test. Monitoring records only what a browser exposes (leaving the page, pasted length, connection, another session), and the student is told | `src/classroom/tests-*.ts`, `marking.ts`, migration `0014` | `online-tests.test.ts` (unfiltered queries for another student), `test-marking.test.ts`, `authz-coverage.test.ts` |
| Cross-school access to students (A01) | Staff routes for students are org routes (`inOrg`, admins and owner only); `students` has forced RLS; a student's scope must belong to the same school (composite foreign key) | `src/students/routes.ts`, migration `0007` | `students.test.ts`, `tenancy.test.ts` (RLS on every `org_id` table) |
| Admin surface discovery (A01) | `/api/admin/*` returns 404 to non-admins; admin requires MFA-verified session | `requirePlatformAdmin` | `authz-coverage.test.ts`, `admin-api-ops.test.ts` |
| Insider access to customer data (A01) | No impersonation; customer-granted, time-boxed support access; every read audited in the customer's log | `src/admin/routes.ts` | `admin-api-ops.test.ts` |
| Weak password storage (A02) | Argon2id (m=19 MiB, t=2, p=1); timing-equalised checks for unknown accounts | `src/auth/password.ts` | unit |
| Secrets at rest (A02) | TOTP secrets and webhook signing secrets AES-256-GCM with `DATA_ENCRYPTION_KEY`; each value names its key by a short fingerprint, so the key can be rotated without downtime (`DATA_ENCRYPTION_KEYS_PREVIOUS` and the re-encryption tool, DEPLOYMENT_GUIDE §4); sessions, tokens, API keys, invitations stored as SHA-256 hashes; recovery codes hashed | `src/lib/crypto.ts` | `auth.test.ts`, unit |
| Injection (A03) | Parameterised queries via Kysely; identifiers never interpolated (`sql.id` for role grants); LIKE patterns escaped | throughout | `tenancy.test.ts` (malformed ids) |
| XSS (A03) | DOM built with text nodes only (no `innerHTML` in the SPA); CSP `script-src 'self'`, no inline scripts/styles; QR rendered as `img` data URL | `public/js/dom.js`, `src/app.ts` | header test; code search |
| CSV/formula injection (A03) | Leading `= + - @ \t \r` prefixed with `'` on export (scopes, catalogue sheet) and removed again on import; catalogue imports are platform-admin only (MFA), size-limited (8 MB, 20,000 rows), validated row by row, previewed, applied all or nothing and audited | `src/lib/csv.ts`, `src/catalog/sheet.ts` | `unit/csv`, `unit/catalog-sheet`, `integration/catalog-sheet` |
| CSRF (A01/A05) | JSON-only bodies; `Origin` and `Sec-Fetch-Site` checks; per-session HMAC token header; `SameSite=Lax`, `HttpOnly`, `__Host-` cookie in production | `src/app.ts`, `src/auth/sessions.ts` | `auth.test.ts` |
| Open redirect | `next` accepted only as same-origin path (`//` and `/\` rejected) | `public/js/views/auth.js` | regex check (manual) |
| Credential stuffing / brute force (A07) | Per-account lockout (5 failures, 15 min) for passwords **and** TOTP, student accounts included (a staff password reset lifts it); student sign-in limited per address, school and username; per-IP+email rate limits counted in PostgreSQL, so they hold across app instances and restarts (counters HMAC-keyed: no IPs or emails stored); generic errors | `src/auth/routes.ts`, `src/http/rate-limit-store.ts` | `auth.test.ts`, `authz-coverage.test.ts`, `rate-limit-store.test.ts` |
| Account enumeration (A07) | Same response for existing/new emails on register, forgot, resend; equalised login timing; student sign-in gives one answer for an unknown school, an unknown username and a wrong password | `src/auth/routes.ts` | `auth.test.ts` |
| Session hijacking / fixation (A07) | 256-bit random tokens; rotation on login and MFA; idle (7 d) and absolute expiry (30 d; 12 h for platform admins and for students, who often share school computers); revoke on password change/reset, suspension; list/revoke sessions | `src/auth/sessions.ts` | `auth.test.ts` |
| MFA bypass / replay | Pending-MFA sessions cannot call the API; TOTP step replay blocked; single-use recovery codes | `src/auth/mfa.ts` | `auth.test.ts` |
| Forged / replayed payment webhooks (A08) | Provider signature (sandbox: HMAC-SHA256 with timestamp tolerance; Paymob: HMAC-SHA512 documented field order, invoice resolved from the signed order id); idempotent event and transaction tables; amount/currency must match the invoice | `src/billing/*` | `billing.test.ts`, `paymob-contract.test.ts`, unit |
| Student passwords | Generated server-side (12 characters from a 31-letter alphabet without look-alikes, about 59 bits), shown once to the staff member who created or reset them, stored only as Argon2id hashes, never logged or audited; a reset ends the student's sessions | `src/students/service.ts` | `students.test.ts` |
| Plan-limit bypass (A04) | Limits enforced in the transaction with an org row lock; atomic conditional upsert for monthly counters | `src/billing/entitlements.ts` | `scopes.test.ts` (concurrent invites), `admin-api-ops.test.ts` |
| Security misconfiguration (A05) | Zod-validated config; production refuses sandbox billing, non-SMTP email, non-HTTPS URL, superuser/BYPASSRLS DB role; Helmet headers (HSTS in prod, nosniff, frame-ancestors none, no-referrer) | `src/config.ts`, `src/server.ts` | unit, Docker smoke |
| Vulnerable dependencies (A06) | `npm audit` clean at commit time (vulnerable `@fastify/static`, `nodemailer` and `vitest` versions were upgraded); CI audit step | `package.json`, CI | `npm audit` |
| Logging & monitoring failures (A09) | Audit log of auth events, membership/role/billing/admin/support actions; JSON logs with secrets redacted (cookie, authorization, CSRF header); operational alerts by email/webhook for a stopped worker, failing email, server-error bursts, failing payment notifications, pending migrations and database outages. Alerts carry counts only (no customer data, so they can go to a third-party chat tool), and the webhook URL is never logged | `src/audit/audit.ts`, `src/ops/alerts.ts` | multiple, `alerts.test.ts` |
| SSRF (A10) | No user-supplied URLs are fetched; provider base URL from config only | — | — |
| Data leakage in errors | Uniform error envelope; 500s return a request id only | `src/app.ts` | `admin-api-ops.test.ts` |
| Abuse / DoS | 1 MB body limit; batch sizes capped (2,000 items); pagination limits; rate limits; a per-process flood guard that does no database work before it counts: 600 API requests/min per address, or 6,000 for requests carrying a session cookie (a school's students share one address), which are then held to 600/min per verified account, or per address when the cookie is not a valid session | various | `rate-limit-store.test.ts`, `school-network-limits.test.ts` |
| Backup theft | Backups optionally GPG-encrypted; `umask 077`; backup role read-only | `scripts/backup.sh` | manual |
| Server-side request forgery through customer webhooks (A10) | Webhook URLs must be `https://`, without credentials, to a public host. Every address the host resolves to must be public (private, loopback, link-local, CGNAT, documentation, multicast, NAT64 and 6to4 ranges refused; IPv4-mapped addresses checked as IPv4). The check runs in the socket's own DNS lookup, so the connection goes to the checked address (no DNS-rebinding window). Redirects are not followed, the response body is not read, and each request has a 5-second limit. Only admins can register URLs, on plans with API access, up to 5. `WEBHOOK_ALLOW_INSECURE_TARGETS` (development and tests) is refused in production | `src/webhooks/net.ts` | `unit/webhook-net`, `integration/webhooks` |
| Forged webhooks received by customers | Each request is signed: HMAC-SHA256 with a per-endpoint secret over `<timestamp>.<body>`, with the timestamp in the header so receivers can reject replays. Secrets are shown once, stored AES-GCM encrypted (they must be read back to sign), and can be replaced. Payloads carry ids, names of scopes and counts, never a note's text or a member's name; receivers read those with an API key | `src/webhooks/service.ts` | `integration/webhooks` |

## 3. Secrets management

| Secret | Purpose | Rotation impact |
| --- | --- | --- |
| `SESSION_SECRET` | CSRF token HMAC | Rotating invalidates CSRF tokens; the SPA refetches automatically |
| `DATA_ENCRYPTION_KEY` | Encrypts TOTP secrets and customer webhook signing secrets | No downtime: the old key moves to `DATA_ENCRYPTION_KEYS_PREVIOUS`, `rotate-data-key` re-encrypts every value, then the old key is removed (DEPLOYMENT_GUIDE §4, "Rotating `DATA_ENCRYPTION_KEY`"). Keep the old key with backups made before the rotation |
| Database passwords (owner/app/backup) | DB access | Standard role password rotation |
| `PAYMOB_*`, `SANDBOX_WEBHOOK_SECRET` | Provider API and webhook verification | Rotate in provider dashboard + env |
| `AI_API_KEY` | The AI provider's API (docs/AI_LAYER.md) | Create a new key in the provider's console, set it, restart, then delete the old key; check with `npm run ai:check` |
| SMTP credentials | Email | Provider dashboard |

Secrets come only from the environment (or Docker env files kept out of git — `.gitignore`
excludes `.env*` except the examples). Nothing secret is committed; demo credentials are generated
at seed time for development only.

## 4. Email and token handling

Verification, reset and invitation links carry 256-bit random tokens; only hashes are stored.
The outbox keeps the rendered body (with the link) until delivery, then redacts it.
Pages that receive tokens send `Referrer-Policy: no-referrer`.
Catalogue update emails (new academic year, entries under review) are product notices rather than
security or billing messages, so each user can turn them off in their account (`users.catalog_emails`);
every such email links to that setting. They go only to owners, admins and editors of active
organizations, and name only the recipient's own organization's scopes and selected items.

## 5. Audit events (selection)

`auth.login`, `auth.login_failed`, `auth.account_locked`, `auth.mfa_enabled/disabled/failed`,
`auth.password_changed/reset`, `auth.sessions_revoked`, `user.registered/email_verified/deleted/data_exported`,
`org.created/updated/deleted/ownership_transferred`, `member.role_changed/removed/left`,
`invitation.created/resent/revoked/accepted`, `scope.created/updated/deleted/items_updated/cleared/exported/duplicated/item_annotated/items_assigned/items_tracked`
(which fields changed and the assignee, never the note's text),
`api_key.created/revoked`, `admin.data_key_rotated` (counts and the key id, never key material), `webhook.created/updated/deleted/secret_rotated/tested/redelivered/disabled/deliveries_exported` (URLs, events and row counts, never secrets), `billing.*`, `support_access.granted/revoked/used`, `admin.*`,
`ai.request` (feature, provider, model that answered, outcome and tokens; never the text) and `admin.ai_tested`,
`student.created/imported/updated/password_reset/removed/password_changed`, and student sign-ins
(`auth.student_login`, `auth.student_login_failed`, `auth.student_locked`), which go to the school's
own audit log with the username, never a password.
The application role cannot modify audit rows (no `UPDATE` grant); retention deletes old rows.

## 6. Residual risks and recommendations

1. **External penetration test** before onboarding paying customers.
2. The global flood guard is per process: with N app instances (two in production) one address can make up to N × 600 anonymous requests a minute, or N × 6,000 with a session cookie, each account N × 600. A cookie that is not a valid session costs one indexed session lookup before it is counted for its address. Route-specific limits (login, two-factor codes, resets, the API quota, and per student what students do in the portal) are shared. Put a provider- or CDN-level limit in front for volumetric attacks.
3. `DATA_ENCRYPTION_KEY` can be rotated (DEPLOYMENT_GUIDE §4), but it still lives in the host's environment file next to the application. A secrets manager or KMS would keep it off the host.
4. No WebAuthn/passkeys yet; TOTP only.
5. Homework files (`docs/CLASSROOM.md` §5) are scanned by one engine, ClamAV, whose signatures are only as fresh as its last update (freshclam, which needs outbound access to database.clamav.net or a mirror); it finds known malware, not every new threat. PDFs are scanned but kept as uploaded (not rewritten), and still download rather than open in the app. Photos are decoded by libvips (sharp) in the worker; keep the image updated with `npm audit` and new releases. Files uploaded before 2026-10-27 are scanned in the background once a scanner runs, and stay open meanwhile.
6. Platform admins can see member names/emails of customer orgs (needed for support); document in the privacy policy.
7. The Paymob adapter's webhook verification is contract-tested against a simulator and matches an independent implementation's HMAC vector, but has not been exercised against Paymob's servers.
8. Student accounts are a new category of personal data (minors). Their use with real students is
   subject to the legal assessment in §7.
9. Customer webhooks are the application's only outbound requests to addresses chosen by customers. The address checks are in the application; in production, also run the worker with an egress firewall that blocks private ranges and the cloud metadata address, as a second layer.
10. **AI provider (docs/AI_LAYER.md).** When `AI_PROVIDER` is set, what a school's staff send through an AI feature
   (curriculum material and their own instructions) leaves for the provider. Students never reach it (refused in
   `runAiTask` whatever the route), features must not put students' data in prompts (reviewed per feature), and
   no school uses it until a platform administrator gives it an allowance. Neither the request nor the reply is
   stored; the log keeps who, which feature, the outcome and tokens. Replies are untrusted text: features show them
   to the teacher for review and check structured replies against a schema before use. Before enabling a provider,
   choose a paid tier whose terms exclude training on requests, and name the provider and its region in the privacy
   notice and in the agreement with schools (§7).

## 7. Privacy and regulatory notes (not legal advice)

- **Egypt Personal Data Protection Law No. 151 of 2020**: its Executive Regulations (Ministerial
  Decree No. 816 of 2025) were issued in November 2025 with a one-year grace period ending around
  31 October–1 November 2026 ([Clyde & Co](https://www.clydeco.com/en/insights/2026/01/egypt-regulatory-update-on-data-privacy),
  [CMS](https://cms.law/en/are/legal-updates/egypt-s-pdpl-executive-regulations-issued-one-year-compliance-countdown-begins)).
  Sources report licensing requirements for controllers/processors and for cross-border transfers.
  **Action:** obtain legal advice on licensing/registration, the lawful basis for processing,
  hosting location (cross-border transfer if hosted outside Egypt), breach notification, and the
  privacy notice. The product already supports access (export), erasure (account/org deletion),
  data minimisation (no card data; for students only name, username, grade and curriculum, plus their
  classes, homework work and marks once the school uses classes) and retention.
- **Payments:** card data never touches the application (hosted checkout), keeping PCI DSS scope
  to SAQ-A-type obligations — confirm with the chosen provider.
- **VAT:** 14% VAT applies to digital services supplied in Egypt; non-resident sellers use the
  Simplified Vendor Registration System (vendor guides, e.g. [Kintsugi](https://trykintsugi.com/sales-tax-guides/middle-east/egypt)).
  Invoices currently show net amounts; tax handling must be designed with an accountant (and the
  ETA e-invoicing system if the company is Egyptian).
- **Children's data:** until 2026-10-25 the product stored no student records. On that date the owner
  decided to add **student accounts created by schools** (`docs/STUDENT_ACCOUNTS.md`). They are off
  for every school until a platform administrator turns them on, and they hold the minimum: a
  display name, a username chosen by the school, a grade and the scope that is the student's
  curriculum; no email, birth date, contact details or grades/marks. The school (the customer) decides
  which students get an account and is expected to be the controller; the platform processes the data
  on its behalf. **Before any school uses this with real students, obtain legal advice** on: the PDPL
  rules for children's data (consent of a parent or guardian, and who collects it), the
  controller/processor agreement with schools, retention after a student leaves, and the privacy
  notice shown to students and parents. Platform administrators see only the number of student
  accounts per school, never the students.
- **Classes, homework and marks (2026-10-26):** at the owner's request schools can now keep classes,
  homework students hand in (text, photos, PDFs) and the marks and comments teachers give
  (`docs/CLASSROOM.md`). This is more sensitive than the account data above: school work and marks of
  minors. It is under the same switch as student accounts, and the same legal advice is needed **before
  real students' work and marks are entered**, including how long work and marks are kept (the school
  sets it, see the retention bullet below). Marks are given only by teachers; no AI marks or changes them.
- **Online tests and exams (2026-10-26):** answers, scores and monitoring events (when the test page
  was left and for how long, the length of pasted text, connection losses, another device) of minors
  (`docs/ONLINE_TESTS.md` §9). No camera, microphone, screen or keystroke capture. The student is told
  what is recorded on the test page. Automatic marks follow fixed rules; no AI marks. Same switch and
  the same legal advice before real students take tests, including whether the school needs consent
  for the monitoring signals and how long they are kept (they are deleted with the test, class or
  student, and by the school's retention periods below).
- **Retention of classroom data (2026-10-27):** each school's owners and admins set how long to keep
  test monitoring records, students' work, and homework and tests with their marks, in days from the due
  time or the test's end (`docs/CLASSROOM.md` §11). Nothing is deleted until a period is set; every
  deletion is announced to owners and admins at least 14 days ahead, checked again against the current
  periods and holds when its date comes, and audited by the system without student work in the entry.
  The worker deletes in each school's own tenant transaction, so row-level security limits it to that
  school. The periods themselves are the school's decision with its legal adviser: the product makes
  them possible, it does not choose them. Backups keep deleted data until they are pruned.
