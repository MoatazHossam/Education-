# Production readiness audit — Phase 0

**Product:** Wise-EduAgent (the code and Docker images are named **Midad**, مِداد).
**Audited:** `main` at `d66de3b` (2026-11-01). No source code was changed for this audit.
**Scope:** commercial production in Egypt, Saudi Arabia, the UAE and other Arab countries, on one Linux VPS
(4 vCPU / 8 GB) with Docker Compose, PostgreSQL 16, hosted checkout (Paymob first), multi-tenant
subscriptions with AI quotas, Arabic and English.

Companion documents in this folder:

| Document | Covers |
| --- | --- |
| [SECURITY_GAP_ANALYSIS.md](SECURITY_GAP_ANALYSIS.md) | Tenant isolation, files, authentication, secrets, third-party AI exposure |
| [INFRASTRUCTURE_PLAN.md](INFRASTRUCTURE_PLAN.md) | Hosting, Compose, PostgreSQL, ClamAV, backups, rollback, sizing on 8 GB |
| [BILLING_INTEGRATION_PLAN.md](BILLING_INTEGRATION_PLAN.md) | Paymob, recurring subscriptions, webhooks, reconciliation, tax, currencies |
| [AI_COST_CONTROL_PLAN.md](AI_COST_CONTROL_PLAN.md) | AI quotas, token budgets, spend limits, provider data terms |
| [IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md) | Phased plan with dependencies, acceptance criteria and verification commands |
| [PRODUCTION_LAUNCH_CHECKLIST.md](PRODUCTION_LAUNCH_CHECKLIST.md) | Go/no-go list, business decisions, credentials, legal questions |

## 0. How to read the findings

Every finding carries one evidence label:

| Label | Meaning |
| --- | --- |
| **[V-code]** | Verified by reading the code at the cited file and line in this audit |
| **[V-run]** | Verified by running a command in this audit (results in §7) |
| **[DOC]** | Stated in the repository's own documents (mostly `docs/PROJECT_STATUS.md`, `docs/TEST_REPORT.md`); not re-run in this audit |
| **[ASSUMPTION]** | A judgement or external fact not verified from this repository; needs confirmation |

Line numbers refer to `main` at `d66de3b`.

**Important context.** The repository already has an honest status file (`docs/PROJECT_STATUS.md`, overall
classification *NOT PRODUCTION READY*) with blockers B-2 to B-10. This audit does not replace it; it checks it
against the code, adds findings it does not list, and turns the whole into a launch plan for the
multi-country target, which the existing documents only cover for Egypt.

## 1. What the product is today

**[V-code]** A multi-tenant SaaS (`package.json:5`) that began as an Egyptian curriculum "content scope" picker
(`legacy/egypt-curriculum-picker.html`) and grew into:

| Area | Implementation | Key files |
| --- | --- | --- |
| Curriculum catalogue (Egypt only: grades 1–12, tracks `moe/sec/bac/ta/intl`) | Versioned catalogue, verification marks, spreadsheet import/export | `src/catalog/*`, `src/db/migrations/0001_initial.ts:150-175` |
| Content scopes | Scopes, items, notes/assignees, due dates, reminders, digests, comparison, carry to next year, TXT/CSV/JSON export | `src/scopes/*` |
| Organizations and staff | 4 roles (owner/admin/editor/viewer), invitations, ownership transfer, data export, deletion | `src/orgs/*`, `src/auth/guards.ts:171-175` |
| Student accounts (off per school by default) | Username + password, created by the school | `src/students/*`, `docs/STUDENT_ACCOUNTS.md` |
| Classroom (same switch) | Classes, homework with file uploads, online tests with live monitoring, gradebook, retention per school | `src/classroom/*` |
| Billing | Plans, trials, invoices, proration, grace, sandbox + Paymob adapters | `src/billing/*` |
| AI | One provider (Gemini / Claude / OpenAI) chosen by configuration; one feature on `main` (test-question suggestions) | `src/ai/*`, `src/classroom/question-suggestions.ts` |
| Integrations | Read API v1 with API keys, outgoing customer webhooks with SSRF guard | `src/api-v1/*`, `src/webhooks/*` |
| Platform admin | Overview, orgs, users, plans, catalogue, audit, webhooks, AI usage, support access | `src/admin/routes.ts` |
| Operations | Alerts (email/webhook), encrypted backups with off-site copies, restore, rolling restart | `src/ops/*`, `ops/midad.sh`, `scripts/*` |

Size: about 16,400 lines of TypeScript in `src/`, a vanilla ES-module SPA in `public/`, 17 SQL migrations,
52 unit/integration test files and a Playwright suite **[V-code]**.

**Not on `main`:** branch `claude/friendly-rubin-hmemjl` carries 4 further commits (AI homework suggestions and
teaching plans, `e6d2b46..5ac2daf`) that are not merged. This audit covers `main` only.

**Wise EduAgent (the AI Studio app):** `docs/WISE_EDUAGENT_FUNCTIONAL_INVENTORY.md` records that the separate
app at `wise-eduagent.ai.studio` could not be inspected (B-8). No feature of it is assumed to exist here.

## 2. Architecture as built

```
Internet ──443──▶ Caddy 2.10 (TLS, ACME, gzip/zstd, round-robin, /readyz health)   deploy/Caddyfile
                    │
          ┌─────────┴─────────┐
        app:3000          app2:3000      Fastify 5, same image, stateless   src/server.ts, src/app.ts
          │                   │          (sessions, rate limits in PostgreSQL)
          └─────────┬─────────┘
                    │ pool 10 each (DATABASE_POOL_MAX)
                 PostgreSQL 16 ◀── worker (pool 3): outbox, webhooks, billing lifecycle,   src/worker.ts
                 (bundled or managed)      reminders, retention, file checks every 2 s
                    ▲                         │
                 migrate (one-shot:           └──3310──▶ ClamAV 1.5 (clamd INSTREAM)
                 migrations + catalogue seed)
Outbound: SMTP · Paymob API · AI provider API · customer webhooks · alert webhook · freshclam
```

Sources: `docker-compose.yml:66-143`, `docker-compose.prod.yml:24-99`, `deploy/Caddyfile:1-26` **[V-code]**.

- **One image, three roles.** `Dockerfile:1-38` builds a multi-stage, non-root (`USER node`, line 34) image;
  `migrate` runs `migrate-cli up` then the catalogue seed (`docker-compose.yml:98`); `app`/`app2` serve;
  `worker` runs `dist/worker.js`.
- **Background jobs** are a polling loop in one worker process, not a queue system (`src/worker.ts:59-91`).
  Jobs that must not run twice use row locks or insert-or-skip keys **[DOC]** (`PROJECT_STATUS.md` reminders and
  digests sections). There is no job scheduler beyond `setTimeout` loops and no dead-letter view other than
  `email_outbox.status='failed'` and `webhook_deliveries`.
- **Configuration** is validated by Zod at start-up with production guards (`src/config.ts:90-136`) **[V-code]**:
  production refuses the sandbox billing provider, non-SMTP email, non-https `APP_URL`, insecure webhook targets
  and an unset `FILE_SCAN`.
- **Files** (homework photos and PDFs, ≤ 5 MB each) are stored **inside PostgreSQL as `bytea`**
  (`src/db/migrations/0013_classroom.ts:118-133`, `src/classroom/files.ts:78-98`) **[V-code]**. There is no object
  storage. This drives database size, backup size and restore time (INFRASTRUCTURE_PLAN §4).

## 3. Capability map (the six areas asked about)

| Capability | State | Evidence |
| --- | --- | --- |
| **Tenant isolation** | **Strong.** PostgreSQL Row-Level Security, `ENABLE` + `FORCE`, on every tenant table except three (see SECURITY_GAP_ANALYSIS §1); tenant context set per transaction with `set_config(..., true)`; runtime role without `BYPASSRLS`, refused in production if it has it; route-enumeration test | `src/db/index.ts:33-79`, `src/db/migrations/0001_initial.ts:8-18,424-453`, `src/server.ts:11-17`, `tests/integration/tenancy.test.ts`, `tests/integration/authz-coverage.test.ts` **[V-code]** |
| **RBAC** | **Implemented.** Org roles viewer < editor < admin < owner; membership checked server-side per request in `inOrg`; non-members get 404; platform admins need TOTP and an MFA-verified session; student accounts confined to the portal | `src/auth/guards.ts:171-264` **[V-code]** |
| **Authentication** | **Implemented.** Argon2id (OWASP minimum), sessions as SHA-256 of a 256-bit token in `__Host-` cookie, idle 7 d / absolute 30 d (12 h for admins and students), TOTP with replay protection and recovery codes, lockout, CSRF origin + HMAC token | `src/auth/password.ts:1-24`, `src/auth/sessions.ts:7-94`, `src/auth/mfa.ts:24-37`, `src/app.ts:149-163` **[V-code]** |
| **Billing** | **Partially implemented.** Full subscription lifecycle and invoice model; Paymob adapter for **one-off hosted checkout per invoice** (no card-on-file recurring), idempotent signed webhooks; never run against Paymob's servers; no reconciliation job; no VAT; one currency per deployment | `src/billing/*`, `src/config.ts:38-46` **[V-code]**, B-2/B-3 **[DOC]** |
| **AI usage tracking** | **Implemented for request counts.** Monthly per-school allowance consumed atomically before each call, released on provider failure; per-request log of tokens, model and outcome without the text; no token- or money-based budget, no platform-wide spend cap | `src/ai/service.ts:66-160`, `src/db/migrations/0017_ai_requests.ts` **[V-code]** |
| **Background jobs** | **Implemented** as one polling worker with a heartbeat, health check and "worker stopped" alert | `src/worker.ts`, `src/jobs/tasks.ts`, `src/cli/worker-health.ts`, `docker-compose.yml:118-133` **[V-code]** |

## 4. Production readiness by area

Rating: **Ready** (can launch as is, after configuration) · **Nearly** (small, known work) · **Gap** (work
needed before launch) · **Blocked** (needs an external decision or credential).

| # | Area | Rating | Summary |
| --- | --- | --- | --- |
| 1 | Application security baseline | Ready | CSP without inline script, HSTS, `no-referrer`, frame-ancestors none (`src/app.ts:66-86`); JSON-only bodies (`src/app.ts:64`); error handler hides internals (`src/app.ts:165-179`) |
| 2 | Tenant isolation | Nearly | RLS everywhere that matters; three tables without RLS and a session-settable bypass flag (SECURITY_GAP_ANALYSIS S-1, S-2) |
| 3 | Authentication | Nearly | Solid; lockout can be abused to lock out a known teacher or student before an exam (S-5); no breached-password check |
| 4 | Uploaded student files | Nearly | Magic-byte typing, 5 MB cap, ClamAV + image re-encoding before access, sandboxed CSP on download (`src/classroom/files.ts:13-149`); stored in the database, unencrypted at the application layer |
| 5 | Secrets | Gap | All secrets in one `.env.production` on the host and passed to every container (`docker-compose.yml:15-64`); no secrets manager; rotation tool exists only for `DATA_ENCRYPTION_KEY` |
| 6 | Third-party AI exposure | Nearly | Staff-only, no student data by design, no prompt/reply storage; provider terms, region and DPA undecided (B-10) |
| 7 | Docker Compose deployment | Nearly | Healthy design (two instances, drain, readiness, log caps); no container memory limits, no PostgreSQL tuning, images built on the production host |
| 8 | Database migrations | Nearly | Forward-only in practice; documented expand/contract rule; ~~rollback through `ops/start.sh` breaks after a release that added a migration~~ fixed 2026-11-05: an older release's `migrate` accepts a database a newer release migrated, shown by `scripts/rollback-drill.sh` on Docker (INFRASTRUCTURE_PLAN §6, I-3); still to run on staging (E-2) |
| 9 | Health checks and monitoring | Nearly | `/healthz`, `/readyz` (DB + schema + draining), worker heartbeat, ClamAV check, 8 built-in alerts; external uptime check and log shipping not set up |
| 10 | Backups and restore | Nearly | Encrypted backups with off-site copies and restore drill **[DOC]**; not run on production hardware; no point-in-time recovery with the bundled database |
| 11 | Billing / payments | Blocked | No Paymob credentials (B-2), tax position (B-3); recurring renewals are manual pay-by-link; no reconciliation |
| 12 | AI cost control | Gap | Count-based quotas only; no global spend cap; worst-case request latency very high (AI_COST_CONTROL_PLAN §2) |
| 13 | Performance on 8 GB | Nearly | Load-tested 300 students on one exam locally **[DOC]**; memory budget is tight with ClamAV; files in PostgreSQL grow the database |
| 14 | Multi-country readiness (KSA, UAE, others) | Gap | Catalogue is Egypt-only; Cairo time zone hard-coded in 6 files; single billing currency; no organization country or time zone |
| 15 | Legal and compliance | Blocked | No privacy policy, terms or DPA; student data features must stay off until counsel advises (B-5, B-9) |
| 16 | CI | Ready | Was blocked by an account billing lock (B-7); on 2026-11-01 all five checks ran green on GitHub for PR #39 |

## 5. Critical launch blockers

Ordered by how early they block. "External" means it needs the owner, a provider or counsel, not code.

| ID | Blocker | Type | Detail |
| --- | --- | --- | --- |
| L-1 | Legal basis for operating in each country, privacy notice, terms, DPA with schools, minors' data | External | `SECURITY_DESIGN.md §7` **[DOC]**; PRODUCTION_LAUNCH_CHECKLIST §4 lists the questions per country |
| L-2 | Company entity, tax registration and invoicing rules per country (EG 14 % VAT, KSA 15 %, UAE 5 % **[ASSUMPTION — confirm with an accountant]**) | External | Invoices show net amounts only **[DOC]** `SECURITY_DESIGN.md §7` |
| L-3 | Paymob merchant account(s) and keys per country, and a test-mode run | External + code | `src/cli/paymob-check.ts`; B-2 |
| L-4 | Production host, region, domain, SMTP with SPF/DKIM/DMARC, alert channels | External | B-4 |
| L-5 | ~~CI not running on GitHub~~ Resolved 2026-11-01 | — | B-7 cleared; all five checks green on PR #39 |
| L-6 | ~~Rollback path through `ops/start.sh` fails after a migration (I-3)~~ Resolved 2026-11-05 | — | Task 1.2; drill passed on Docker by both rollback paths; staging run is E-2 |
| L-7 | No platform-wide AI spend cap; billing currency and quotas are per deployment, not per country | Code | AI_COST_CONTROL_PLAN, BILLING_INTEGRATION_PLAN |
| L-8 | Catalogue content unverified (0 of 231 subjects) | External | B-6 **[DOC]** |

Student accounts and the classroom are off for every school until a platform administrator turns them on
(`src/billing/plans.ts:19-20`, `src/billing/entitlements.ts:46-47`) **[V-code]**. A launch of the staff-only product
(catalogue, scopes, billing) can therefore precede the student portal, which is gated on L-1.

## 6. What is already production-ready (verified in code)

- RLS-based tenant isolation with a least-privilege runtime role and a start-up refusal of RLS-bypassing roles.
- Server-side RBAC through one guard (`inOrg`), 404 for non-members, MFA enforcement for platform admins.
- Argon2id passwords, hashed session tokens, `__Host-` cookies, CSRF defence, TOTP with replay protection.
- Signed, idempotent payment webhooks with amount/currency checks and binding to the signed Paymob order
  (`src/billing/routes.ts:161-201`, `src/billing/service.ts:225-301`).
- Upload pipeline: content sniffing, size caps, virus scan and image re-encoding before anyone can open a file.
- SSRF-safe outgoing webhooks (checked DNS lookup bound to the socket, `src/webhooks/net.ts:1-110`).
- Production configuration guards, structured JSON logs with header redaction (`src/app.ts:50-58`).
- Two stateless app instances behind Caddy with graceful drain and readiness checks.
- Encrypted backups with off-site copies and tested restore scripts **[DOC]** (`docs/TEST_REPORT.md §4`).
- English/Arabic UI with RTL (`public/js/i18n.js:827`); automated accessibility audit **[DOC]**.

## 7. Checks run in this audit

On `main` at `d66de3b`, Node 22, PostgreSQL 16 local (no Docker daemon used):

```bash
export TEST_PG_ADMIN_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres
npm ci && npm run lint && npm run typecheck && npm test && npm audit --omit=dev --audit-level=high
```

### 7.1 Results [V-run]

| Step | Result |
| --- | --- |
| `npm run lint` | Clean |
| `npm run typecheck` | Clean |
| `npm test` (Vitest, unit + integration against PostgreSQL 16) | **52 files, 371 tests passed**, 135 s |
| `npm audit --omit=dev --audit-level=high` | Passes the gate (exit 0). Reports **3 moderate** advisories: `glob` (GHSA-3g3m-2fjr-6pw4) via `minimatch`, pulled in by `@fastify/static`; npm's only offered fix is a breaking downgrade to `@fastify/static@6`. Track for an upstream release rather than forcing |

Not run in this audit: Playwright E2E, the Docker image build, `scripts/load-exam.mjs`, the ops scripts. Their
last recorded results are in `docs/TEST_REPORT.md` **[DOC]**.

## 8. GitHub Actions (open item)

`.github/workflows/ci.yml` defines three jobs (checks, e2e in three browsers, docker smoke test). When the audit
started, runs on GitHub failed before any job started; `docs/PROJECT_STATUS.md` B-7 records the message "your
account is locked due to a billing issue" **[DOC]**. **Update 2026-11-01:** the lock is cleared. All five checks ran
green on GitHub for PR #39 **[VERIFIED]**. `scripts/ci-local.sh` remains available for local runs.

## 9. Assumptions made in this audit

1. "Wise-EduAgent" is the commercial name for this repository's product (Midad); the AI Studio app is separate.
2. The first production launch is a single VPS as described; no managed database unless chosen later.
3. Tax rates, Paymob country coverage and data-protection rules named here are from general knowledge and must
   be confirmed by the owner's accountant, Paymob and counsel.
4. Load figures from `docs/TEST_REPORT.md` were produced on a developer stack, not the target VPS.

## 10. Executive summary

**Already production-ready (verified in code, 371/371 tests passing):** Row-Level-Security tenant isolation with a
least-privilege database role; server-side RBAC and MFA for platform admins; Argon2id, hashed sessions, CSRF and
TOTP; signed, idempotent payment webhooks with amount checks; a safe upload pipeline (type sniffing, ClamAV,
photo re-encoding, sandboxed downloads); SSRF-safe customer webhooks; production config guards; two stateless app
instances behind Caddy with drain and readiness; encrypted backups with off-site copies and restore scripts;
English/Arabic UI.

**Missing:** automatic recurring card charges, payment reconciliation and refund handling; tax and multi-currency
billing; money-based AI budgets and a platform spend cap; container memory limits and PostgreSQL tuning;
per-service secrets; PITR; staging and production hosts; external monitoring; multi-country support (catalogue,
time zones, currencies are Egypt-only).

**Critical launch blockers:** legal advice per country, above all on minors' data and cross-border hosting (L-1);
company/tax position (L-2); Paymob credentials and a test-mode run (L-3); host, domain, SMTP (L-4); no
platform AI spend cap (L-7); unverified catalogue (L-8).

**Recommended hosting:** one 4 vCPU / 8 GB / 160 GB+ NVMe VPS with an encrypted disk, Ubuntu 24.04, the existing
Docker Compose production stack with container memory limits and tuned PostgreSQL (`shared_buffers` 2 GB), ClamAV
with concurrent reload off, 2 GB swap, daily encrypted backups to a bucket at another provider, external uptime
monitoring, and an identical smaller staging VPS. Region chosen after legal review. No Kubernetes.

**Recommended first implementation task:** roadmap task 1.1, tenant isolation hardening (RLS on the three
uncovered tables and a separate system role so the web role cannot bypass RLS), followed by 1.2, the rollback fix.
Both are done (1.1 in PR #39; 1.2 on 2026-11-05).
