# Implementation roadmap

Effort is in engineer-days for one experienced full-stack engineer **[estimates]**.
Phases 0–5 below were executed in this repository; their status is in PROJECT_STATUS.md.

## Completed phases (this delivery)

| Phase | Scope | Outcome |
| --- | --- | --- |
| 0 Discovery | Obtain the artifact source, execute and inventory it, find defects | `legacy/`, discovery docs, 7 defects documented and fixed |
| 1 Foundation | TypeScript/Fastify service, config validation, PostgreSQL schema with RLS, migrations, seed, health, tests | Done |
| 2 Core application | Catalogue API, content scopes, exports, read API | Done |
| 3 SaaS capabilities | Auth (verification, MFA, lockout, sessions, CSRF), orgs, roles, invitations, tenancy, limits | Done |
| 4 Commercial operations | Plans, subscription lifecycle, provider abstraction, webhooks, invoices, emails, platform admin, support access, audit | Done (Paymob unverified) |
| 5 Hardening | Security review fixes, route-enumeration authz test, Docker, compose, CI workflow, backups, performance probe | Done locally (CI not run on GitHub) |

## Phase 6 — Commercial release (next)

| # | Work item | Effort | Depends on | Owner |
| --- | --- | --- | --- | --- |
| 6.1 | Run CI on GitHub-hosted runners once the account billing lock is cleared, fix anything CI-specific (all steps already pass via `scripts/ci-local.sh`) | 0.5 | Account billing (PROJECT_STATUS blocker B-7) | Account owner, then Engineering |
| 6.2 | Decide legal entity/country, VAT registration and payment provider | — | Business | Founder + accountant |
| 6.3 | Paymob test-mode keys → `npm run paymob:check`; staging run of subscribe/fail/replay/refund; fix adapter if the live payload differs from the simulator | 1–2 | test keys: none; live: 6.2 | Engineering |
| 6.4 | VAT on invoices (rate, totals, tax id) and ETA e-invoicing if Egyptian entity | 3–8 | 6.2 | Engineering + accountant |
| 6.5 | **Editorial verification of the 2026/27 catalogue** against Ministry decrees and publishers' current editions, recorded as verification marks in Platform admin → Catalogue (tool built) | 10–20 (curriculum specialist) | — | Content |
| 6.6 | Legal: privacy policy, terms, DPA template, PDPL licensing/registration, hosting location decision | external | 6.2 | Legal counsel |
| 6.7 | Production host, managed PostgreSQL, DNS, SMTP (SPF/DKIM/DMARC), Caddy TLS | 1–2 | 6.2, 6.6 | Ops |
| 6.8 | Monitoring: set `ALERT_EMAILS`/`ALERT_WEBHOOK_URL` and send a test alert (alerts are built in); external uptime check on `/readyz`; log shipping; backup job + weekly verify | 0.5–1 | 6.7 | Ops |
| 6.9 | External penetration test; fix findings | 3–5 + vendor | 6.7 | Security |
| 6.10 | Pilot: 3–5 design partners (ed-tech/publishers), onboarding sessions, feedback loop | 2–4 weeks elapsed | 6.5, 6.7 | Product |
| 6.11 | Release checklist (DEPLOYMENT_GUIDE §7), operational readiness review | 0.5 | all above | Team |

## Phase 7 — First 6 months after launch (prioritised)

| Priority | Item | Effort | Why |
| --- | --- | --- | --- |
| P1 | ~~"Carry scope to next academic year": map selections from version N to N+1 by natural key, show what changed~~ — done (PROJECT_STATUS: carry a scope to the next academic year) | — | Yearly renewal moment for every customer |
| P1 | ~~Catalogue change notifications (subjects/editions changed since your scope was made)~~ — done (PROJECT_STATUS: catalogue change notifications) | — | Core value: freshness |
| P1 | ~~Verification badges and source per subject/material~~ — done (PROJECT_STATUS: catalogue verification marks) | — | Trust |
| P1 | ~~Shared rate-limit store and second app instance~~ — done (PROJECT_STATUS: shared rate limits; two app instances behind Caddy) | — | Availability |
| P1 | ~~Automated accessibility audit (axe)~~ — done (PROJECT_STATUS: accessibility audit); still open: manual screen-reader review (checklist ready: SCREEN_READER_REVIEW.md). Firefox/WebKit E2E done (PROJECT_STATUS: journeys in Firefox and WebKit) | 1–2 | NFR-7/8 |
| P2 | ~~Bulk catalogue import/export (CSV) for editors~~ — done (PROJECT_STATUS: catalogue spreadsheet export and import) | — | Editorial efficiency |
| P2 | ~~Scope comparison~~ and ~~per-item notes and assignees~~ — done (PROJECT_STATUS: scope comparison; notes and assignees) | — | Team workflow |
| P2 | ~~Webhooks to customer systems on scope change~~ — done (PROJECT_STATUS: webhooks to customer systems) | — | Integrations |
| P2 | Card-on-file automatic renewals (Paymob subscriptions module) | 3–5 | Reduce involuntary churn |
| P2 | SSO (Google Workspace / Microsoft) for school groups | 3–5 | Enterprise |
| P3 | Other curricula (KSA, UAE, Jordan) as catalogue packs | per country: content-heavy | Market size (COMMERCIAL_FEASIBILITY.md) |
| P3 | ~~`DATA_ENCRYPTION_KEY` rotation tooling~~ — done (PROJECT_STATUS: encryption key rotation) | — | Key management |
