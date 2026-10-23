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

**10 files, 91 tests, 91 passed, 0 failed** (16.5 s). Integration tests ran against a real
PostgreSQL database with a non-superuser owner role and a separate non-BYPASSRLS app role.

| File | Tests | Result |
| --- | --- | --- |
| unit/catalog-fidelity | 3 | Pass — the seed equals the original artifact's 231 subjects / 1,038 materials item-for-item |
| unit/billing-logic | 9 | Pass |
| unit/security-primitives | 9 | Pass |
| unit/i18n | 2 | Pass |
| integration/auth | 13 | Pass |
| integration/tenancy | 15 | Pass |
| integration/scopes | 10 | Pass |
| integration/billing | 13 | Pass |
| integration/admin-api-ops | 12 | Pass |
| integration/authz-coverage | 5 | Pass — enumerated all 30+ admin routes and 30+ org routes |

Full test names (verbatim from the verbose reporter):

<details><summary>Show all 91</summary>

- tenancy › cross-tenant isolation over the API › a member of org B cannot read, modify, export or delete org A data
- tenancy › cross-tenant isolation over the API › object ids from another tenant are rejected even under the attacker’s own org (BOLA)
- tenancy › cross-tenant isolation over the API › rejects malformed org ids without leaking errors
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
- unit › exports: text export keeps the original "Copy list" layout
- unit › exports: CSV neutralises spreadsheet formulas and quotes properly
- unit › configuration: refuses unsafe production settings
- unit › catalogue fidelity: same 231 subject rows and 1,038 selectable materials
- unit › catalogue fidelity: every subject and material in order, except the documented intl kind correction
- unit › catalogue fidelity: legacy selection keys unique
- unit › effective plan (4 tests), proration (2), time helpers (3)
- unit › translations: Arabic covers every English key and placeholders match; every referenced key exists

</details>

Stability: the full suite was run at least 8 times during development; one ordering-dependent
flake (a published test catalogue leaking between files) was found and fixed in the test reset.

## 3. End-to-end — `npm run test:e2e`

**8 tests, 8 passed** (20.7 s), Chromium, real server process on port 3100.

| # | Journey | Result |
| --- | --- | --- |
| 1 | Owner registers, verifies email, signs in and builds a content scope that persists | Pass |
| 2 | Owner invites an editor, changes the role to viewer, and the viewer becomes read-only | Pass |
| 3 | Another organization cannot reach the first organization's data | Pass |
| 4 | Owner subscribes, upgrades with proration, schedules a downgrade and cancels | Pass |
| 5 | Plan limits are enforced in the UI (second organization starts on Free) | Pass |
| 6 | Service recovers after a server crash: sessions and saved selections survive a restart | Pass |
| 7 | Platform admin signs in with two-factor authentication and suspends then restores an organization | Pass |
| 8 | Arabic interface switches to right-to-left and the picker fits a phone screen (390 px, no horizontal overflow) | Pass |

Note from journey 2's first run: the test toggled a material and immediately demoted the user; the
batched save then arrived after the demotion, the server answered 403, and the UI rolled the toggle
back — correct behaviour; the test was changed to wait for "Saved".

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

## 7. Not executed

- CI workflow on GitHub-hosted runners: both attempts were refused before starting because the GitHub account is locked for billing (PROJECT_STATUS.md B-7).
- Paymob checkout/webhook against Paymob's servers (no credentials).
- Cross-browser E2E (Firefox, WebKit), automated accessibility audit, external penetration test.
- Production deployment, TLS issuance by Caddy, monitoring and alerting.
