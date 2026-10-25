# Existing SaaS assessment (for the Wise EduAgent integration)

2026-10-25, on `main` at `b298586` (PR #10 merged). Source of truth for architecture, identity, design
and data conventions in any integration.

## 1. Baseline

| Check | Result |
| --- | --- |
| Branch / working tree | `claude/friendly-rubin-hmemjl` = `origin/main` (`b298586`), clean |
| `npm test` | 25 files, 159/159 pass |
| `npm run test:e2e` | 14/14 pass on the same tree (12 journeys, accessibility audit of 46 screens with 0 findings, keyboard test); last run on `a060d70`, identical to `b298586` |
| Lint, typecheck, build, `npm audit` | Pass; 0 vulnerabilities (same tree) |
| CI on GitHub | Not running: account billing lock (PROJECT_STATUS B-7) |

## 2. Technology stack

| Layer | Technology |
| --- | --- |
| Runtime | Node.js ≥ 22, TypeScript (strict, ESM) |
| Server | Fastify 5, Zod 4 validation, pino logs, `@fastify/helmet` (strict CSP), cookies, rate limits (route limits shared in PostgreSQL) |
| Database | PostgreSQL 16 through Kysely; 29 tables; migrations `0001`–`0006`; forced Row-Level Security on tenant tables; separate owner, app (no BYPASSRLS) and backup roles |
| Front end | Vanilla ES-module SPA without a build step (`public/js`), `h()` DOM helper, shared helpers in `dom.js` (`dialog`, `tableCard`, `toast`, `downloadText`), page head and shell in `views/shell.js`; tokens in `public/app.css` (Readex Pro, IBM Plex Mono; light and dark); EN/AR dictionaries in `i18n.js` with RTL |
| Jobs | One worker process (`src/worker.ts`): email outbox, billing lifecycle, cleanup, heartbeat |
| Deployment | Docker image; compose for development; production overlay with Caddy and two app instances |
| Tests | Vitest (unit and integration on a real PostgreSQL), Playwright (journeys and an axe-core accessibility audit) |

## 3. Identity, tenancy and roles

- Accounts with email verification, Argon2id passwords, lockout, TOTP MFA and recovery codes;
  server-side sessions in PostgreSQL; CSRF origin and token checks.
- Organizations are the tenants. Membership roles are ranked `viewer < editor < admin < owner`
  (`src/auth/guards.ts`). Platform administrators are separate and must use MFA; they reach customer
  data only through a customer-granted, audited support grant.
- `inOrg(ctx, req, orgId, minRole, fn)` resolves the caller's membership server-side and runs the
  handler in an org-scoped transaction under RLS. Organization ids come from the URL but are always
  checked against the session's memberships; a route-enumeration test asserts every org route is
  protected.

## 4. Student portal assessment

As found at the start of the integration. **Since then (2026-10-25)** items 1–3 and 10 exist in a first
form: school-created student accounts, a student sign-in and a curriculum page
(`../STUDENT_ACCOUNTS.md`).

| # | Capability | Exists? | Notes |
| --- | --- | --- | --- |
| 1 | Student dashboard | **Missing** | Organization pages serve staff only |
| 2 | Student navigation and routing | **Missing** | Routes: picker, scopes, compare, carry review, members, billing, settings, audit; account; admin |
| 3 | Student data models | **Missing** | No student role or table. SECURITY_DESIGN §7: "the product is B2B and stores no student records. Keep it that way unless a new legal assessment is done." PRODUCT_OVERVIEW: "Individual students and parents are not users." |
| 4 | Courses and subjects | Partial | Catalogue of grades, tracks, subjects and books (231 subjects, 1,038 materials), versioned per academic year with verification marks. Organizations' **content scopes** select materials. No course or lesson content |
| 5 | Classes and enrolment | **Missing** | |
| 6 | Assignments and assessment data | **Missing** | No grades of any kind |
| 7 | Educational content | **Missing** | Titles and metadata only; no book text, documents or media |
| 8 | Student progress | **Missing** | |
| 9 | Existing AI features | **Missing** | No provider, prompts, conversations or embeddings |
| 10 | Permissions for students | **Missing** | Role model would need a student role (or a separate student membership) that sees only a student area |

## 5. Services an integration should reuse

| Need | Existing service |
| --- | --- |
| Sign-in, sessions, MFA | `src/auth/*` |
| Tenant-scoped data access | `inOrg`, `withOrgContext`, RLS policies (`app_rls_bypass() OR org_id = app_current_org()`) |
| Plans, features, limits | `src/billing/plans.ts` (`features` flags; `limits`), `getEntitlements`, `requireFeature` |
| Metered usage | `usage_counters` with atomic monthly increments (`consumeUsage`); metrics today: `exports`, `api_requests` |
| Rate limits | `rateLimited()` (shared across instances) |
| Audit | `recordAudit` (org and platform) |
| Email and in-app notifications | Outbox and worker; `notifications` table |
| Operational alerts | `src/ops/alerts.ts` |
| UI | `h()`, `dialog`, `tableCard`, `toast`, `pageHead`, `planLimitHint`; CSS tokens; EN/AR dictionaries |
| Accessibility checks | `tests/e2e/accessibility.spec.ts` (new pages join it) |

## 6. Conclusion

The SaaS has a strong base for a student area (identity, tenancy, entitlements, metering, design
system, EN/AR, accessibility tests) and an obvious curriculum context: the school's content scopes.
It has **no** student concept, content, assessment, progress or AI. Adding students reverses a
documented security decision and needs the owner's decision and a legal assessment
(`docs/WISE_INTEGRATION_GAP_ANALYSIS.md` §3).
