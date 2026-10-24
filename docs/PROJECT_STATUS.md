# Project status

**Overall classification: NOT PRODUCTION READY.**
The application is functionally complete and tested locally, but several Definition-of-Done
conditions are unverified or blocked (real payment provider, production deployment, monitoring
and alerts, legal/privacy review, catalogue data verification).

Last updated: 2026-10-24. Branch: `claude/friendly-rubin-hmemjl`.
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

## 2. Deliverables

### Phase 0 — Discovery · COMPLETE
- **Implemented:** artifact source obtained and preserved; executed its data code; feature inventory; 7 defects identified.
- **Files:** `legacy/`, `docs/PRODUCT_OVERVIEW.md`, `docs/CURRENT_STATE_ASSESSMENT.md`, `docs/FEATURE_INVENTORY.md`, `docs/GAP_ANALYSIS.md`.
- **Tests:** `tests/unit/catalog-fidelity.test.ts` (3) — pass.
- **Limitations:** the artifact was only available as a rendered page; no earlier project history exists.

### Phase 1 — Foundation · COMPLETE
- **Implemented:** TypeScript/Fastify app, Zod config with production guards, PostgreSQL schema (25 tables) with RLS and composite keys, Kysely migrator, role split (owner/app/backup), seed, health/readiness.
- **Files:** `src/app.ts`, `src/config.ts`, `src/db/*`, `src/http/*`, `package.json`, `tsconfig*.json`, `eslint.config.js`.
- **Tests:** RLS proofs in `tenancy.test.ts`; config tests; health tests — pass.

### Phase 2 — Core application · COMPLETE
- **Implemented:** catalogue service/API with ETag and caching; content scopes (CRUD, batched items, duplicate, clear); TXT/CSV/JSON export; read API with API keys; picker UI faithful to the original backed by scopes; fixes for original defects D-01–D-07.
- **Files:** `src/catalog/*`, `src/scopes/*`, `src/api-v1/*`, `public/js/views/picker.js`, `public/js/views/scopes.js`.
- **Tests:** `scopes.test.ts` (10), API tests in `admin-api-ops.test.ts`, E2E 1, 6 — pass.
- **Next:** shared rate-limit store and a second app instance; manual screen-reader review (Roadmap P1).

### Accessibility audit · COMPLETE
- **Implemented:** an automated WCAG 2.2 A/AA check (axe-core 4.13 in Playwright) of 41 screens and dialogs: the signed-out pages, every organization page, the picker in four states, the new-scope, notifications and verification dialogs, and every platform-admin page, in English and Arabic, light and dark, desktop and a 390 px phone. It runs in the E2E suite after the journeys, so pages carry real data, and any finding fails it. The first run reported 26 findings, all fixed:
  - colour contrast (13): the amber used for the trial banner, notices, "needs review" statuses and warnings measured 4.17:1 on its pale background; it is now 5.50:1 (light theme; dark already passed);
  - target size (8): source links in the picker and the verification badges were under 24 px tall;
  - unnamed meters (3): billing usage meters now have a name and a "used / limit" value;
  - keyboard access to a scrolling table (1): every table card is now a labelled region that takes focus, so it can be scrolled with the keyboard;
  - invalid ARIA (1): the admin webhook filter links used `aria-pressed`; they now mark the current filter with `aria-current`.
  A keyboard-only test found two more problems, also fixed: closing a dialog with Escape lost focus instead of returning it to the button that opened it, and following the skip link was handled by the router as a navigation and redrew the page; it now moves focus to the page heading.
- **Files:** `tests/e2e/accessibility.spec.ts`, `tests/e2e/helpers.ts` (shared with the journeys), `playwright.config.ts`, `public/js/{dom,main}.js`, `public/app.css`, `public/js/views/{account,admin,billing,members,scopes,settings}.js`.
- **Tests:** E2E 12 (audit of 41 screens) and 13 (keyboard) — pass. Against the front end before the fixes, 12 reports the 26 findings and 13 fails.
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
- **Limitations:** rate-limit counters are in-memory (single instance); no WebAuthn/SSO.

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
| Dockerfile, compose (dev + prod overlay with Caddy) | COMPLETE (local) | Image built; stack healthy on latest code |
| Backup / restore / verify scripts | COMPLETE (local) | Executed; see TEST_REPORT §4 |
| CI workflow | PARTIALLY COMPLETE | GitHub Actions runs on `main` are refused (B-7). All workflow steps pass when run with `scripts/ci-local.sh` on a clean clone of `main` (2026-10-23) |
| Performance | PARTIALLY COMPLETE | Sandbox smoke results; no production-sized load test |
| Monitoring & alerting | **NOT STARTED** | Needs B-4 (health endpoints and admin health page exist) |
| Disaster-recovery drill on production infrastructure | NOT STARTED | Needs B-4 |
| External penetration test | NOT STARTED | Recommended before launch |

### Phase 6 — Commercial release · NOT STARTED
Blocked by B-2…B-6. Plan: docs/IMPLEMENTATION_ROADMAP.md.

### Documentation · COMPLETE
All 16 documents in `docs/` plus `README.md`, written against the code as committed.

## 3. Definition of Done checklist

| Condition | State |
| --- | --- |
| Core workflows function correctly | ✓ (137 unit/integration + 13 E2E passing: 11 journeys, 2 accessibility) |
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
| Monitoring and alerts configured | ✗ (B-4) |
| Backup and recovery tested | ✓ locally; ✗ not on production infrastructure |
| Deployment reproducible | ✓ locally (Docker/compose) |
| Documentation accurate | ✓ |
| Operational support and release procedures defined | ✓ documented (DEPLOYMENT_GUIDE §5–7); ✗ not exercised |

## 4. Next development priorities

1. Clear the GitHub billing lock (B-7) and confirm CI on GitHub-hosted runners, then get Paymob test-mode keys and run `npm run paymob:check` followed by the staging checklist (DEPLOYMENT_GUIDE §3.5); decide the tax position (B-3).
2. Catalogue verification (B-6): a curriculum specialist reviews entries against decrees and publishers and records marks in Platform admin → Catalogue.
3. Production host + monitoring + backup job (B-4), then a restore drill.
4. Legal review (B-5), pilot with 3–5 design partners.
