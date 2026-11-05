# Security gap analysis

Audited: `main` at `d66de3b`. Evidence labels as in [PRODUCTION_READINESS_AUDIT.md §0](PRODUCTION_READINESS_AUDIT.md):
**[V-code]** read in code, **[V-run]** run in this audit, **[DOC]** repository documents, **[ASSUMPTION]**.
This is a code review, not a penetration test; an external test is still required (S-16).

Severity: **High** = fix before launch · **Medium** = fix before onboarding schools at scale or before
student data · **Low** = hardening.

## Summary

| ID | Finding | Severity | Area |
| --- | --- | --- | --- |
| S-1 | `billing_events`, `notifications` and `email_outbox` have no Row-Level Security | Medium | Tenant isolation · **fixed by task 1.1** |
| S-2 | The RLS bypass flag is a session setting any SQL run by the app role can set | Medium | Tenant isolation · **fixed by task 1.1** |
| S-3 | 33 `withSystemContext` call sites (cross-tenant) without an enforced inventory | Medium | Tenant isolation · **fixed by task 1.1** |
| S-4 | Runtime role can `DELETE` audit rows | Low | Audit integrity · **fixed by task 1.1** |
| S-5 | Account lockout lets anyone lock a known teacher or student out for 15 minutes, repeatably | High (exam days) | Authentication · **fixed by task 1.3** |
| S-6 | No breached/common-password check; student passwords set by schools | Medium | Authentication |
| S-7 | Lockout counter is read-modify-write (non-atomic) | Low | Authentication · **fixed by task 1.3** |
| S-8 | Homework files stored in PostgreSQL without application-level encryption; disk encryption not configured | Medium | Student files |
| S-9 | Every secret is in one host file and passed to every container | High | Secrets |
| S-10 | No documented rotation for `SESSION_SECRET`, provider keys, DB passwords | Medium | Secrets |
| S-11 | AI provider: data terms, region and DPA not chosen; no output-content filter beyond schema | Medium | Third-party AI |
| S-12 | Worker has unrestricted egress (customer webhooks, AI, Paymob from the same network) | Medium | Network |
| S-13 | Flood guard is per process; no edge/CDN limit; client IP trust depends on Caddy defaults | Medium | Availability |
| S-14 | Platform admins see member names/emails of every school | Low | Privacy |
| S-15 | Dependency and image update process not defined | Medium | Supply chain |
| S-16 | No external penetration test | High | Assurance |

## 1. Tenant data isolation

**What exists [V-code].**
- Helper functions `app_current_org()`, `app_current_user()`, `app_rls_bypass()` read transaction-local settings
  (`src/db/migrations/0001_initial.ts:8-18`).
- Every tenant table gets `ENABLE` + `FORCE ROW LEVEL SECURITY` and an `org_id = app_current_org()` policy
  (`0001_initial.ts:424-453`, and the later migrations 0002, 0004, 0007, 0010–0015, 0017). Student-scoped policies
  additionally restrict to `app_current_student()` (`0013_classroom.ts:139-143`).
- Tenant context is set with `set_config(..., true)` inside a transaction, so it cannot leak across pooled
  connections (`src/db/index.ts:33-66`).
- The runtime role has no `BYPASSRLS`/superuser (`deploy/postgres-init/01-roles.sh:7-8`), and production refuses
  to start otherwise (`src/server.ts:11-17`).
- Composite foreign keys `(id, org_id)` keep child rows in their parent's tenant (e.g. `0013_classroom.ts:131-132`).
- Tests: `tests/integration/tenancy.test.ts`, `authz-coverage.test.ts` (every admin/org route protected).

**S-1 — Tables with `org_id` but no RLS [V-code].** A script over the migrations lists 50 tables; these three
hold tenant or personal data and have no policy:

| Table | Defined | Content |
| --- | --- | --- |
| `billing_events` | `0001_initial.ts:325-336` | Normalised payment events with `org_id`, amounts |
| `notifications` | `0001_initial.ts:390-400` | In-app notices per user and org (titles may name schools, invoices) |
| `email_outbox` | `0001_initial.ts:403-415` | Recipient addresses and full email bodies (no `org_id`) |

They are only queried with explicit filters today, so this is defence in depth, not a known leak.
*Fix:* add policies (`notifications`: org or own user; `billing_events` and `email_outbox`: bypass-only, since only
the worker and webhook handler use them). *Acceptance:* a test that runs an unfiltered `SELECT` on each table in
another tenant's context and gets zero rows.

**S-2 — Bypass is a settable GUC [V-code].** `withSystemContext` sets `app.rls_bypass = 'on'`
(`src/db/index.ts:74-79`), and the policy honours it (`0001_initial.ts:16-18`). Any statement the runtime role
executes can set the same value. With Kysely's parameterised queries there is no known injection path, but an
SQL injection anywhere would defeat RLS completely. *Fix options:* (a) a separate `midad_system` login role with
`BYPASSRLS` used only by the worker and webhook handler, so the web role cannot bypass at all; or (b) keep the
flag but make it unforgeable, e.g. a `SECURITY DEFINER` function that checks `current_user` before setting it.
(a) is simpler to reason about. *Acceptance:* as the web role, `SELECT set_config('app.rls_bypass','on',true);
SELECT count(*) FROM scopes;` returns only the current tenant's rows.

**S-3 — Cross-tenant code paths [V-code].** `withSystemContext` is called 33 times in 20 files at `d66de3b`
(`git grep -c "withSystemContext(" -- 'src/*.ts'`; 53 matching lines including imports). The comment says each must be a reviewed exception (`src/db/index.ts:69-73`),
but nothing enforces it. *Fix:* an allow-list test that fails when a new call site appears outside the listed
files/functions. Combine with S-2(a).

**S-4 — Audit tampering [V-code].** The runtime role loses `UPDATE` on `audit_logs` but keeps `DELETE`
(`src/db/migrator.ts:68-69`), needed by retention cleanup. *Fix:* run retention as the system role only, revoke
`DELETE` from the web role. Low priority.

### Resolution of S-1 to S-4 (task 1.1)

Implemented on the audit's branch after the owner's go-ahead:
- Migration `0019_system_role`: `app_rls_bypass()` is always `false`; RLS on `notifications` (recipient's
  organization or recipient), `email_outbox` (insert by anyone, everything else system-only) and
  `billing_events` (system-only).
- A separate system role (`midad_system`, `BYPASSRLS`, not superuser) on its own pool
  (`SYSTEM_DATABASE_URL`); `withSystemContext` runs there and nowhere else (`src/db/index.ts`). The app
  role can no longer bypass a policy by any setting. Server and worker refuse to start in production
  when the roles are wrong (`databaseRoleProblems`).
- The app role loses `DELETE` on `audit_logs`; only the system role's retention cleanup deletes.
- `tests/unit/system-context-allowlist.test.ts` lists every call site with its reason.
- New tests in `tests/integration/tenancy.test.ts`: the old setting opens nothing; the three tables are
  not readable across schools; the role check.
- Found while doing it: the worker's email sender read the outbox with the app role and no context; it now
  runs in the system context (`src/jobs/tasks.ts`).
- Consequence for hosting: a managed PostgreSQL must allow one `BYPASSRLS` role (it already needed one
  for backups) **[ASSUMPTION — check per provider]**.

## 2. Authentication

**What exists [V-code].** Argon2id m=19 MiB, t=2, p=1 (`src/auth/password.ts:3-4`); timing-equalised unknown-user
path (`password.ts:18-24`); sessions stored as SHA-256 of a 32-byte token (`src/auth/sessions.ts:35-40`); `__Host-`
cookie, `HttpOnly`, `SameSite=Lax`, `Secure` with https (`sessions.ts:15-18, 82-90`); idle 7 days, absolute 30 days,
12 h for platform admins and students (`sessions.ts:7-12`); TOTP with replay protection and hashed recovery codes
(`src/auth/mfa.ts:24-46`); per-email and per-address rate limits on login, reset, MFA (`src/auth/routes.ts:112-620`);
CSRF via origin check plus HMAC token (`src/app.ts:149-163`).

**S-5 — Lockout denial of service [V-code].** Five wrong passwords lock the account for 15 minutes
(`src/auth/routes.ts:28-29, 214-222`; students `274-281`). Student usernames are chosen by schools and are often
guessable. A classmate or outsider can lock a whole class before an online test, repeatedly. The per-email login
limit (10 per 15 min, `routes.ts:200`) does not prevent it.
*Fix:* lock per (account, client address) or use progressive delays instead of a hard lock; never hard-lock
student accounts during a running test window; let teachers unlock (reset exists, `src/students/routes.ts:126`).
*Acceptance:* integration test — 20 failed logins from address A do not stop a correct login from address B.
**Fixed 2026-11-05 (task 1.3) [V-run].** Failures are counted per account and client
(`src/auth/login-protection.ts`, migration `0020_login_protection`): a browser that has fully signed in to the
account before is recognised by a device cookie and has its own count; any other client is counted by its address.
Five failures lock out only that client, for 15 minutes. Failures from clients the account does not know are also
capped for the account (20 in an hour lock out every unknown client for an hour; trusted browsers still sign in), so
that many addresses cannot guess without limit; for a student whose class has a test open or opening within the hour
that account-wide lock is not applied. The sign-in rate limits count per account and client too, so someone on the same school network cannot use up the
allowance of a student's own browser. A school admin can **Unlock** a student without a new password
(`POST /api/orgs/:orgId/students/:userId/unlock`); an unlock also gives the locked-out clients their sign-in
attempts back. Verified by `tests/integration/auth.test.ts` (20 failures from A,
correct sign-in from B; a known browser on a locked-out address; the account-wide cap and the admin unlock; second
factor) and `students.test.ts` (classmate on the school network; unlock; a test about to open).
*Remaining:* on one shared network, a browser the account never signed in from is locked out together with the
attacker's; the teacher unlocks the student in one click, which also gives that address its attempts back.

**S-6 — Password quality [V-code].** No check against breached or common passwords. *Fix:* a local list of the
most common passwords (no external call, avoids sending hashes abroad), minimum length 10 for staff.

**S-7 — Non-atomic counter [V-code].** `failed_login_count + 1` is computed in the application and written back
(`routes.ts:215-219`); parallel attempts undercount. *Fix:* `SET failed_login_count = failed_login_count + 1
RETURNING`. Low. **Fixed 2026-11-05 (task 1.3):** each failure is one `INSERT … ON CONFLICT DO UPDATE` on
`login_failures`; a test sends 8 wrong passwords at once and finds every checked one counted.

Not present (acceptable for launch, track for enterprise): WebAuthn/passkeys, SSO (SAML/OIDC), session listing
for users beyond revocation **[DOC]** `SECURITY_DESIGN.md §6`.

## 3. Uploaded student files

**What exists [V-code].** Type decided from magic bytes, four types only (`src/classroom/files.ts:13-26`); 5 MB
cap, 5 files per item (`files.ts:13-14, 50`); file names stripped of paths/control characters (`files.ts:29-44`);
files cannot be opened until the worker has scanned them with ClamAV and re-encoded photos (dropping EXIF/GPS),
with a 100-megapixel guard (`src/classroom/file-checks.ts`, `files.ts:120-133`); downloads carry
`Content-Security-Policy: default-src 'none'; sandbox`, `nosniff`, `no-store`, PDFs as attachments
(`files.ts:139-149`); per-school storage quota under a row lock (`files.ts:68-76`, default 1 GB,
`src/billing/entitlements.ts:9`).

**S-8 — Files at rest [V-code].** Files are `bytea` in `classroom_files.data` (`0013_classroom.ts:127`), so they
are protected by RLS and included in encrypted backups, but stored in clear on the database volume.
*Fix (launch):* full-disk or volume encryption on the VPS (provider option or LUKS) and on any managed database.
*Later:* move files to S3-compatible object storage with server-side encryption and short-lived signed URLs
(INFRASTRUCTURE_PLAN §4). Application-level encryption of each file is possible but costs CPU and complicates
scanning; not recommended first.

Residual (documented): one antivirus engine; PDFs are scanned, not rewritten **[DOC]** `SECURITY_DESIGN.md §6.5`.

## 4. Secrets

**S-9 — One file, every container [V-code].** `SESSION_SECRET`, `DATA_ENCRYPTION_KEY`, Paymob keys, the AI key,
SMTP credentials and DB passwords all come from `.env.production` and the shared `x-app-env` block
(`docker-compose.yml:15-64`), so `migrate`, `app`, `app2` and `worker` each receive all of them. A compromise of
any container yields every secret.
*Fix (launch, small):* file mode 600 owned by root, the host user not in a group that can read it; split
`x-app-env` so `migrate` gets only DB URLs and the web instances do not get the backup role; keep a copy of the
file and the backup passphrase in a password manager (already advised, `docs/DEPLOYMENT_GUIDE.md §5`).
*Later:* Docker secrets (files under `/run/secrets`) or a managed secret store, read by `loadConfig`.

**S-10 — Rotation [V-code].** `npm run keys:rotate` re-encrypts with a new `DATA_ENCRYPTION_KEY`
(`src/cli/rotate-data-key.ts`). Rotating `SESSION_SECRET` logs everyone out and invalidates CSRF tokens (it is the
HMAC key, `src/auth/sessions.ts:20-22`); Paymob/AI/SMTP keys are plain environment values. *Fix:* a written
rotation runbook for each secret with its user impact, and a yearly rotation on the launch checklist.

## 5. Third-party AI data exposure

**What exists [V-code].** One provider for the server (`src/config.ts:83-88`); only staff can call it, students are
refused in the service itself (`src/ai/service.ts:69-70`); prompts are bounded to 60,000 characters
(`service.ts:26, 72`); neither prompt nor reply is stored, only metadata (`0017_ai_requests.ts:13-28`); replies are
schema-checked and reviewed by a teacher before they become questions (`src/classroom/question-suggestions.ts`);
`AI_API_BASE` must be https in production (`config.ts:107-109`).

**S-11 — Gaps.**
1. **Provider terms not chosen.** Which tier (paid, no training on inputs), which region of processing, and
   whether a DPA is signed are open (B-10 **[DOC]**). For Saudi and Emirati customers, cross-border transfer of
   school content to a US/EU provider is a legal question (PRODUCTION_LAUNCH_CHECKLIST §4).
2. **No per-school opt-out at the data-terms level.** Schools are enabled by an allowance; the privacy notice
   must name the provider and region before any school is enabled.
3. **Teacher-entered text may contain student names** (e.g. pasted lesson notes). Policy forbids sending student
   data, but there is no detection. *Fix:* UI warning on the AI dialog; optional simple redaction of names from
   the school's own roster before sending (feasible because the roster is local).
4. **Prompt injection** from pasted material can only change suggestions the teacher then reviews; no tool use
   or data access is given to the model. Acceptable.

## 6. Network and availability

**S-12 — Egress [V-code].** The worker sends customer webhooks (SSRF-checked in application, `src/webhooks/net.ts`)
from the same container network that can reach PostgreSQL and ClamAV. `SECURITY_DESIGN.md §6.9` already advises an
egress firewall. *Fix:* host firewall (nftables/ufw) denying the container networks access to private ranges and
`169.254.169.254` except the compose network; allow outbound 443 and SMTP only.

**S-13 — Flood control [V-code].** The global limiter is in each process's memory (`src/app.ts:88-104`,
`src/http/rate-limit.ts:286-291`): two instances double the allowance. Route-specific limits are shared in
PostgreSQL. `TRUST_PROXY=true` (`docker-compose.prod.yml:18`) trusts whatever Caddy forwards; Caddy 2.10 sets the
client address itself unless `trusted_proxies` is configured **[ASSUMPTION — Caddy ≥ 2.5 default; confirm on the
host]**. If a CDN is put in front later, Caddy's `trusted_proxies` must list the CDN ranges or every client will
appear as the CDN, collapsing per-address limits. *Fix:* a provider/CDN rate limit for volumetric traffic; a test
on staging that a spoofed `X-Forwarded-For` does not change `req.ip`.

## 7. Platform operators and privacy

**S-14 [V-code/DOC].** Platform admins see member names and emails (needed for support); access to a school's data
otherwise requires a customer-granted, expiring, audited support grant (`src/admin/routes.ts:206, 809-812`).
Admins see only counts of students **[DOC]**. *Fix:* state this in the privacy notice; require MFA (already
enforced) and keep the number of platform admins minimal.

## 8. Supply chain and assurance

**S-15.** Dependencies are mostly caret ranges (`package.json:38-58`) with a lockfile; AI SDKs are pinned. CI runs
`npm audit --omit=dev --audit-level=high` (`.github/workflows/ci.yml:40-41`) and CI runs on GitHub again since 2026-11-01 (B-7 cleared).
Base images are tags, not digests (`Dockerfile:3`, `docker-compose*.yml`). *Fix:* Dependabot or Renovate for npm,
Docker and Actions; pin images by digest in production; monthly patch window; rebuild for base-image CVEs.

**S-16.** An external penetration test focused on tenant isolation, the student portal, uploads and billing
webhooks, before the first paying school **[DOC]** `SECURITY_DESIGN.md §6.1`.

## 9. Verification commands

```bash
# RLS coverage: every table with org_id should have FORCE RLS (run as the schema owner)
psql "$MIGRATION_DATABASE_URL" -c "
SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
  AND EXISTS (SELECT 1 FROM information_schema.columns k WHERE k.table_name = c.relname AND k.column_name = 'org_id')
ORDER BY 2, 1;"

# Runtime role must not bypass RLS
psql "$DATABASE_URL" -c "SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user;"

# Cross-tenant call sites (track the count; it should only change deliberately)
npm run test:unit -- system-context-allowlist   # after task 1.1: the reviewed list of call sites

# Security and tenancy tests
npm run test:integration -- tenancy authz-coverage auth

# Headers on production
curl -sI https://$DOMAIN/ | grep -iE "strict-transport|content-security|x-content-type|referrer"
```
