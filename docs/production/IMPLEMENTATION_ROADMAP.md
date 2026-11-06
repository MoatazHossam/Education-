# Production implementation roadmap

Built from the findings in this folder. It does not replace `docs/IMPLEMENTATION_ROADMAP.md` (the product
roadmap) or `docs/PROJECT_STATUS.md`; it is the path from `main` at `d66de3b` to a commercial launch.
Implementation waits for the owner's go-ahead for each task. Task 1.1 was approved on 2026-11-01 and is
done on the same branch as this audit.

Sizes are engineering-day estimates **[ASSUMPTION]**. IDs refer to findings: S- (security), I- (infrastructure),
B-G / P- (billing), A- / AI- (AI cost), D- / C- / L- (decisions, credentials, legal in
[PRODUCTION_LAUNCH_CHECKLIST.md](PRODUCTION_LAUNCH_CHECKLIST.md)).

## Phase overview and dependencies

```
Phase 1  Hardening, no external dependency ─────────────┐
Phase 2  Staging environment            (needs C-1 host)├──▶ Phase 6  Legal sign-off and launch
Phase 3  Payments                       (needs C-3 keys)│        (needs L-1…L-4, all phases)
Phase 4  AI cost control                (needs C-5, D-6)│
Phase 5  Multi-country                  (needs D-1…D-4) ┘
Phase 7  After launch (scale, convenience)
```

Phases 1, 3, 4 and 5 can run in parallel once their inputs exist. Phase 2 should exist before Phase 3's test-mode
run and before any load or restore drill on real hardware.

Standard checks for every code task (unchanged from today):

```bash
npm run lint && npm run typecheck && npm test        # TEST_PG_ADMIN_URL set to a local PostgreSQL 16
npm run test:e2e                                      # Playwright, Chromium
scripts/ci-local.sh                                   # full CI locally (GitHub Actions also runs on every PR)
```

## Phase 1 — Hardening that needs no outside input

| # | Task | Findings | Size | Acceptance criteria | Verification |
| --- | --- | --- | --- | --- | --- |
| 1.1 | **Done (PR #39).** **Tenant isolation hardening**: RLS on `billing_events`, `notifications`, `email_outbox`; separate `midad_system` DB role with `BYPASSRLS` for worker/webhook/admin aggregates; the web role can no longer bypass; allow-list test for `withSystemContext` call sites | S-1, S-2, S-3, S-4 | 3 d | As the web role, `set_config('app.rls_bypass','on',true)` exposes nothing; unfiltered selects on the three tables from another tenant return 0 rows; all 371 existing tests pass | `npm run test:integration -- tenancy authz-coverage`; SQL in SECURITY_GAP_ANALYSIS §9 |
| 1.2 | **Done (2026-11-05).** **Rollback fix**: `migrate` succeeds when the database is ahead of the image; runbook updated; rollback drill script | I-3 | 1 d | Release N+1 with a new migration, roll back to N via `ops/start.sh` and via `rolling-restart.sh`: both instances `/readyz` 200 | New integration test on the migrator; drill on Docker |
| 1.3 | **Done (2026-11-05).** **Lockout that cannot be weaponised**: per account+address lock or progressive delay; no hard lock of students during an open test window; atomic counter | S-5, S-7 | 2 d | 20 failures from address A do not block a correct login from B; existing lockout tests adapted | `npm run test:integration -- auth students` |
| 1.4 | **Done (2026-11-05).** **Container limits and PostgreSQL tuning** in `docker-compose.prod.yml`; `ConcurrentDatabaseReload no` for ClamAV; Node heap caps | I-1, I-2, I-7 | 1 d | `docker compose config` shows limits; stack healthy; local load test unchanged (no 5xx) | `docker stats`; `scripts/load-exam.mjs` locally |
| 1.5 | **Done (2026-11-05).** **Secrets split**: per-service env blocks (migrate gets DB only; web gets no backup creds); env file permissions checked by `ops/midad.sh`; rotation runbook | S-9, S-10 | 1 d | Each container's `env` lists only what it needs | `docker compose exec app env \| sort` review |
| 1.6 | **Done (2026-11-05).** **AI worst-case latency**: timeout 60 s, provider retries 1, configurable | A-4 | 0.5 d | Simulator with a hanging provider returns 503 within ~4 min | `npm run test:integration -- ai ai-providers-contract` |
| 1.7 | **Done (2026-11-06).** **Webhook endpoint limit** and request size cap | B-G7 | 0.5 d | 429 above the limit; Paymob contract tests pass | `npm run test:integration -- billing paymob-contract` |
| 1.8 | **Done (2026-11-06).** **Common-password check** for staff and student passwords (local list) | S-6 | 0.5 d | "password123" refused with a clear EN/AR message | `npm run test:integration -- auth students` |
| 1.9 | **Done (2026-11-06).** **Dependency hygiene**: Renovate/Dependabot config, base images pinned by digest | S-15 | 0.5 d | Bot opens PRs; images resolve by digest | Repo settings; `docker compose config` |

Phase 1 total ≈ 10 days. Exit: all tasks merged, full suite and E2E green, `scripts/ci-local.sh` green.

## Phase 2 — Staging environment (needs host C-1, domain C-2, SMTP C-4)

| # | Task | Size | Acceptance criteria | Verification |
| --- | --- | --- | --- | --- |
| 2.1 | Provision staging VPS per INFRASTRUCTURE_PLAN §8 (encrypted disk, firewall incl. egress rules S-12, SSH hardening) | 1 d | Only 22 (restricted), 80, 443 reachable; container cannot reach `169.254.169.254` | `nmap` from outside; `docker run --rm curlimages/curl -m3 http://169.254.169.254` fails |
| 2.2 | Registry-based releases: CI (or `ci-local.sh`) builds and pushes `ghcr.io/...:<sha>`; deploy by digest; keep 5 | 1 d | Deploy and rollback use registry images, not host builds | `docker image inspect` digest matches registry |
| 2.3 | Deploy with `ops/start.sh --env prod` settings; real SMTP; alerts to a real channel | 1 d | `/readyz` 200; sign-up → verify email → login works; test alert received | Manual + `curl` |
| 2.4 | Monitoring: external uptime on `/readyz`, host metrics, log shipping, backup alerts | 1 d | Stopping `app` and `app2` pages within 3 min | Drill |
| 2.5 | Backups: daily encrypted to off-site bucket, weekly verify; PITR decision (WAL-G/pgBackRest or managed) | 1–2 d | Restore drill on a fresh VM meets RTO 4 h; measured RPO documented | `ops/backup.sh`, `ops/restore.sh --only-verify`, rebuild per DEPLOYMENT_GUIDE §8.8 |
| 2.6 | Load test on staging hardware with ClamAV on: 300 students, 5 teachers, plus a burst of 100 hand-ins with photos | 1 d | No 5xx, p95 ≤ 300 ms for answers, memory within limits, no OOM kills | `node scripts/load-exam.mjs`; `docker stats`; `dmesg \| grep -i oom` |
| 2.7 | Rollback drill (after 1.2) and rolling restart under load | 0.5 d | Zero failed requests during rolling restart; rollback < 10 min | `scripts/rolling-restart.sh` during load |

## Phase 3 — Payments (needs Paymob test keys C-3; live keys for launch)

Tasks P-1 to P-7 in [BILLING_INTEGRATION_PLAN.md §4](BILLING_INTEGRATION_PLAN.md). Order: P-1 test-mode run →
P-3 reconciliation → P-4 refunds/voids → P-5 saved card renewals (after Paymob confirms the API) → P-6 currencies
(after D-3) → P-7 tax (after D-1 and the accountant). Launch can proceed with P-1, P-3, P-4 and pay-by-link
renewals (already built) if P-5 is not ready. Size ≈ 8–12 days excluding tax e-invoicing.

Done without keys: P-2 (route limit in task 1.7; **Reprocess** for a failed notification) and P-4 in code (refunds,
voids and mismatched payments open a review for an operator, with an alert). P-3 waits for Paymob's inquiry API to
be confirmed (P-1).

## Phase 4 — AI cost control (needs AI key C-5 and budget decision D-6)

Tasks AI-1 to AI-7 in [AI_COST_CONTROL_PLAN.md §6](AI_COST_CONTROL_PLAN.md). Minimum before any school gets an AI
allowance: AI-1 (provider console cap), AI-2 (done in 1.6), AI-3 (platform cap). Size ≈ 5 days.

Done without outside input: AI-2 (task 1.6), AI-4 (token budget per school), AI-5 (daily cap per member,
`AI_USER_DAILY_LIMIT`), AI-6 (cost report) and, in code, AI-3 (prices and the platform budget,
`AI_MONTHLY_BUDGET_USD`) and AI-7 (AI limits on every plan). Still needed: AI-1 (the provider console), the
budget and allowances (D-6), and the model's prices from the provider's price page.

## Phase 5 — Multi-country readiness (needs decisions D-1 to D-4)

| # | Task | Size | Acceptance criteria |
| --- | --- | --- | --- |
| 5.1 | **Done.** `organizations.country` and `time_zone`; replace the 6 hard-coded `Africa/Cairo` uses with the org's zone; quota periods per org zone (**not done, by choice**: monthly allowances stay per UTC month for every school, so Egyptian schools' month boundaries do not move) | 2 d | A Riyadh school's reminders and "overdue" follow Asia/Riyadh; Egyptian behaviour unchanged |
| 5.2 | Per-currency plan prices and checkout (P-6) | 3 d | SAR/AED/EGP prices per plan; invoices in the org's currency |
| 5.3 | Curriculum catalogues beyond Egypt: data model allows other countries' grade/track systems | 3–5 d + content | A KSA catalogue version can be published without affecting Egypt's |
| 5.4 | Arabic copy reviewed by a native editor (regional variants if needed); Hijri date display if required | content | Reviewer sign-off |

5.3 is the largest product question: the catalogue model is Egyptian (`track IN ('moe','sec','bac','ta','intl')`,
`0001_initial.ts:154`). Selling scopes in KSA/UAE needs local curriculum data and a curriculum specialist (like B-6).

## Phase 6 — Legal sign-off and launch

| # | Task | Depends on | Acceptance |
| --- | --- | --- | --- |
| 6.1 | Privacy notice, terms, DPA with schools, sub-processor list (hosting, email, Paymob, AI) in EN/AR | L-1…L-4 | Counsel approval |
| 6.2 | External penetration test; fix High findings | Phases 1–2 | Report with no open High |
| 6.3 | Production VPS (same as staging), live keys, DNS, backups, monitoring | All above | PRODUCTION_LAUNCH_CHECKLIST all ✓ |
| 6.4 | Pilot with 3–5 schools, student features off unless counsel approved | 6.1 | Pilot feedback recorded |

## Phase 7 — After launch

Object storage for homework files (I-6); managed PostgreSQL with PITR; passkeys/WebAuthn and SSO; Docker secrets
or a secret manager; per-school AI routing to a regional endpoint; card-on-file for wallets where supported.

## Recommended first implementation task

**Task 1.1 — tenant isolation hardening.** It needs no external input, protects the property every customer and
regulator will ask about first (one school cannot see another's data, including minors' work), and the change is
contained to migrations, `src/db/index.ts`, the worker/webhook entry points and tests. It should land before any
real school data exists, because changing roles afterwards needs a data-free window. Task 1.2 (rollback fix) is the
best second task, and must be done before the first production upgrade. *Both are done:* 1.1 in PR #39, 1.2 on
2026-11-05 (INFRASTRUCTURE_PLAN §6, I-3).
