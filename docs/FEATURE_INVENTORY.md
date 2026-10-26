# Feature inventory

Statuses: **IMPLEMENTED**, **PARTIALLY IMPLEMENTED**, **MOCKED**, **MISSING**, **DEFECTIVE**
(as defined in the project brief). "Original" is the artifact as found; "Now" is the current
codebase. Priority: P0 = required for a commercial launch, P1 = needed soon after, P2 = later.
Acceptance criteria point at the automated tests that check them where they exist.

## A. Features of the original artifact

| ID | Feature | Business purpose | Original | Now | Implementation now | Acceptance criteria (verified by) |
| --- | --- | --- | --- | --- | --- | --- |
| F-01 | Curriculum catalogue (12 grades, 5 tracks, 231 subjects, 1,038 materials) | The reference data customers pay for | IMPLEMENTED (hard-coded) | IMPLEMENTED | `catalog_*` tables, seeded from `src/catalog/legacy-dataset.ts` | Seed equals original data item-for-item (`catalog-fidelity.test.ts`); API returns 231/1,038 (`scopes.test.ts`) |
| F-02 | Track filter | Narrow to a school system | IMPLEMENTED | IMPLEMENTED | `public/js/views/picker.js` | Same six tracks; E2E picker journey |
| F-03 | Grade ruler (multi-select) | Narrow to grades | IMPLEMENTED | IMPLEMENTED | picker | E2E selects "Grade 4" |
| F-04 | Material-kind filter | Show Ministry/language/external materials | DEFECTIVE (intl items misclassified, D-01) | IMPLEMENTED | Kinds `moe/lang/ext/prog/exam` | Fidelity test asserts intl → `prog`/`exam` |
| F-05 | Search | Find subjects/books | DEFECTIVE (matched hidden kinds, D-03) | IMPLEMENTED | picker | Manual check; behaviour documented |
| F-06 | Toggle materials | Build the scope | IMPLEMENTED (client only) | IMPLEMENTED | Optimistic toggles, batched `POST …/items` every 400 ms, rollback on error | E2E: toggle → "Saved" → reload persists |
| F-07 | Selection persistence | Keep work | PARTIALLY IMPLEMENTED (localStorage, D-02, D-06) | IMPLEMENTED | `scopes`, `scope_items` with FKs and RLS | E2E persistence + crash-recovery journeys |
| F-08 | Select all shown | Bulk add | IMPLEMENTED | IMPLEMENTED | Batched in chunks of 2,000 | Manual |
| F-09 | Clear | Reset scope | DEFECTIVE (no confirmation, D-05) | IMPLEMENTED | Confirm dialog; `DELETE …/items` | `scopes.test.ts` (clear) |
| F-10 | View list | Review selection | IMPLEMENTED | IMPLEMENTED | Same grouped format | E2E checks list text |
| F-11 | Copy list | Hand selection to others | IMPLEMENTED | IMPLEMENTED | Clipboard with select-text fallback, identical format | Unit test `toText` layout |
| F-12 | Caveat notice | Legal/data disclaimer | IMPLEMENTED (static) | IMPLEMENTED | Per catalogue version, editable in drafts | Admin catalogue test |
| F-13 | Sources | Traceability | IMPLEMENTED (static) | IMPLEMENTED | `catalog_sources` per version | API test (10 sources) |
| F-14 | Dark mode | Comfort | IMPLEMENTED | IMPLEMENTED | Same tokens | Visual |
| F-15 | Responsive layout | Phone use | IMPLEMENTED | IMPLEMENTED | Original breakpoints kept | E2E: no horizontal overflow at 390 px |
| F-16 | Bilingual subject names | Arabic-speaking users | PARTIALLY IMPLEMENTED | IMPLEMENTED | Full EN/AR UI, RTL via logical CSS | E2E Arabic journey; i18n key-parity test |
| F-17 | Grade notes (Secondary 1) | Explain track choice | IMPLEMENTED | IMPLEMENTED | `catalog_versions.grade_notes` | API test |

## B. Capabilities required for a commercial SaaS

| ID | Feature | Purpose | Original | Now | Implementation | Remaining work | Priority | Acceptance criteria (verified by) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| S-01 | Registration with email verification | Self-serve sign-up | MISSING | IMPLEMENTED | `src/auth/routes.ts`, outbox emails | — | P0 | `auth.test.ts`; E2E journey 1 |
| S-02 | Login, logout, sessions | Access | MISSING | IMPLEMENTED | DB sessions, hashed tokens, idle+absolute expiry, rotation | — | P0 | `auth.test.ts` |
| S-03 | Brute-force protection | Security | MISSING | IMPLEMENTED | Per-account lockout (password and TOTP), per-IP+account rate limits shared by all app instances (PostgreSQL) | Provider/CDN-level limit for volumetric attacks | P0 | `auth.test.ts`, `authz-coverage.test.ts`, `rate-limit-store.test.ts` |
| S-04 | Password reset/change | Account recovery | MISSING | IMPLEMENTED | Single-use 1 h tokens, revokes sessions | — | P0 | `auth.test.ts` |
| S-05 | TOTP MFA + recovery codes | Protect privileged users | MISSING | IMPLEMENTED | otplib, AES-GCM secret at rest, replay protection; required for platform admins; optional org policy | WebAuthn/passkeys | P0 | `auth.test.ts`; E2E journey 7 |
| S-06 | Organizations & multi-tenancy | Sell to teams | MISSING | IMPLEMENTED | Shared DB + `org_id` + Row-Level Security | — | P0 | `tenancy.test.ts`, `authz-coverage.test.ts`; E2E journey 3 |
| S-07 | Roles & permissions | Team control | MISSING | IMPLEMENTED | owner/admin/editor/viewer enforced in `inOrg()` | Custom roles | P0 | `tenancy.test.ts`; E2E journey 2 |
| S-08 | Invitations | Onboard teams | MISSING | IMPLEMENTED | Hashed single-use tokens, 7-day expiry, seat-checked | — | P0 | `tenancy.test.ts` |
| S-09 | Ownership transfer | Continuity | MISSING | IMPLEMENTED | Password-confirmed, single-owner index | — | P1 | `tenancy.test.ts` |
| S-10 | Named content scopes | Multiple plans per org | MISSING | IMPLEMENTED | CRUD, duplicate, per-version; carry to the next academic year with review of missing, changed and new items (copy or move); compare two scopes, also across catalogue years, with CSV download | Per-item notes and assignees | P0 | `scopes.test.ts`, `scope-carry-forward.test.ts`, `scope-compare.test.ts`, `catalog-notifications.test.ts`; E2E journeys 10, 12 |
| S-11 | Exports TXT/CSV/JSON | Hand-off | MISSING | IMPLEMENTED | Metered; CSV injection-safe | XLSX/PDF | P0 | `scopes.test.ts`, unit CSV test |
| S-12 | Read API with API keys | Integrations | MISSING | IMPLEMENTED | `/api/v1`, hashed keys, quota; signed webhooks on scope changes (retries, switch-off, test, redelivery, delivery history download) | — | P1 | `admin-api-ops.test.ts`, `webhooks.test.ts`; E2E journey 19 |
| S-13 | Plans & server-side limits | Monetization | MISSING | IMPLEMENTED | Seats, scopes, exports/month, API/month, features | — | P0 | `scopes.test.ts`, E2E journey 5 |
| S-14 | Subscription lifecycle | Revenue | MISSING | IMPLEMENTED | Trial, subscribe, prorated upgrade, scheduled downgrade, cancel/resume, renewal invoices, past-due grace, move to Free | Card-on-file auto-renew | P0 | `billing.test.ts`; E2E journey 4 |
| S-15 | Payment provider | Collect money | MISSING | PARTIALLY IMPLEMENTED | Provider abstraction; **sandbox** (dev/test) verified; **Paymob** adapter contract-tested, not yet run against Paymob | Paymob test-mode keys + `npm run paymob:check` | P0 | Simulator contract tests + independent HMAC vector |
| S-16 | Webhook security | Prevent fraud | MISSING | IMPLEMENTED | Signature check, timestamp tolerance, idempotent event store, amount check | — | P0 | `billing.test.ts` |
| S-17 | Invoices & payment history | Accounting | MISSING | IMPLEMENTED | Sequential numbers, payments table | Tax invoices (ETA e-invoicing) | P1 | `billing.test.ts` |
| S-18 | Email notifications | Lifecycle comms | MISSING | IMPLEMENTED | Transactional outbox + worker, retries, EN/AR templates | Deliverability setup (SPF/DKIM) | P0 | `admin-api-ops.test.ts`; compose run delivered to Mailpit |
| S-19 | In-app notifications | Awareness | MISSING | IMPLEMENTED | Notifications table + bell | — | P2 | Manual |
| S-19a | Catalogue change notifications | Renewal and data freshness | MISSING | IMPLEMENTED | New academic year / archived version → in-app + email to owners, admins, editors (localized, once per year, opt-out); newly flagged entries → organizations that selected them | Move fan-out to the worker at large scale | P1 | `catalog-notifications.test.ts`; E2E journey 10 |
| S-20 | Audit log | Trust, compliance | MISSING | IMPLEMENTED | Append-only for app role, org view with plan retention, platform search | Export | P0 | `tenancy.test.ts`, `admin-api-ops.test.ts` |
| S-21 | Platform admin console | Operate the business | MISSING | IMPLEMENTED | Overview/MRR, orgs, users, catalogue, plans, audit, webhooks, health | Impersonation intentionally absent | P0 | `admin-api-ops.test.ts`; E2E journey 7 |
| S-22 | Support access grants | Privacy-respecting support | MISSING | IMPLEMENTED | Owner grants 1–72 h, every read audited | — | P1 | `admin-api-ops.test.ts` |
| S-23 | Catalogue versioning & editing | Keep data current yearly | MISSING | IMPLEMENTED | Draft clone → edit → publish → archive; CSV spreadsheet export/import with preview | Diff view between versions; .xlsx | P0 | `admin-api-ops.test.ts`, `catalog-sheet.test.ts`; E2E journey 11 |
| S-23a | Catalogue verification marks | Trust in accuracy | MISSING | IMPLEMENTED | Verified / needs review per subject and material with source, link, note, date; admin editor with filter and per-grade marking; picker badges and coverage; in exports and API | The review work itself (B-6) | P0 | `catalog-verification.test.ts`, `catalog-sheet.test.ts`; E2E journeys 8, 11 |
| S-24 | Arabic UI + RTL | Market fit | MISSING | IMPLEMENTED | Dictionaries, `dir=rtl`, logical CSS | Professional translation review | P0 | E2E journey 9, i18n test |
| S-24a | Accessibility | Usable by keyboard, screen-reader and low-vision users; public-sector buyers ask for it | PARTIALLY IMPLEMENTED | IMPLEMENTED | Skip link; focus moves to the page heading, and each page is titled after it on navigation and back to the opener when a dialog closes; labelled, keyboard-scrollable tables; named meters; AA contrast; 24 px targets | Manual screen-reader review (checklist: `docs/SCREEN_READER_REVIEW.md`) | P1 | `tests/e2e/accessibility.spec.ts` (axe-core WCAG 2.2 A/AA and a simulated screen reader on 134 screens; keyboard journey; names, descriptions, page titles and announcements) |
| S-25 | Health/readiness, worker heartbeat | Operations | MISSING | IMPLEMENTED | `/healthz`, `/readyz`, heartbeat health | External uptime monitoring | P0 | `admin-api-ops.test.ts`; compose healthy |
| S-26 | Backups & restore | Disaster recovery | MISSING | IMPLEMENTED | Scripts + backup role; verified locally | Scheduled off-site job in production | P0 | Manual run recorded in TEST_REPORT.md |
| S-27 | Containerised deployment | Reproducibility, availability | MISSING | IMPLEMENTED | Dockerfile, compose (dev/prod), Caddy TLS, two app instances with load balancing and rolling restarts (`scripts/rolling-restart.sh`) | Real host | P0 | Local production-settings stack verified under load (TEST_REPORT §4) |
| S-28 | CI | Quality gate | MISSING | PARTIALLY IMPLEMENTED | GitHub Actions workflow | Not yet run on GitHub | P0 | — |
| S-29 | Monitoring & alerting | Detect outages | MISSING | PARTIALLY IMPLEMENTED | In-app alerts by email/webhook (worker stopped, email failing or delayed, server errors, payment webhooks, migrations, database down), deduplicated across instances, with reminders and resolutions; admin view and test button | Real channels; external uptime check on `/readyz`; log shipping | P0 | `alerts.test.ts`; E2E journey 7 |
| S-30 | Organization deletion, personal-data export, account deletion | Privacy rights (PDPL), customer trust | MISSING | IMPLEMENTED | `DELETE /api/orgs/:orgId` (password + name), `GET /api/auth/account/export`, `DELETE /api/auth/account` | Org-level bulk data export (all scopes in one archive) | P1 | `tenancy.test.ts` (data deletion and export) |
