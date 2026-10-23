# Gap analysis: original artifact → commercial SaaS

| # | Area | Original state | Target for commercial launch | Delivered | Remaining gap | Blocking launch? |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Data persistence | `localStorage`, per browser | Durable, shared, backed up | PostgreSQL, scopes with FK integrity, backups verified | Off-site scheduled backups on the production host | Yes (ops task) |
| 2 | Identity | None | Accounts, verification, reset, sessions, MFA | Implemented and tested | WebAuthn, SSO (Google/Microsoft) for school groups | No |
| 3 | Tenancy | None | Isolated workspaces | Shared schema + `org_id` + RLS + membership checks; tested at API and DB level | — | No |
| 4 | Authorization | None | Role-based, server-enforced | 4 roles, `inOrg()` guard, route-enumeration test | Custom roles (Enterprise) | No |
| 5 | Core workflow | Pick → copy | Pick → save → share → export → integrate | Scopes, exports, API | Moving a scope to the next academic year's catalogue; scope comparison | No |
| 6 | Catalogue maintenance | Edit source code | Admin-managed, versioned, auditable | Draft/publish/archive editor; per-entry verification marks | Bulk import/diff tools; **the editorial review of the data against official decrees** | **Yes (business)** |
| 7 | Monetization | None | Plans, limits, payments, invoices | Plans/limits/lifecycle complete with sandbox | **Real payment provider account (Paymob) and sandbox verification**; tax invoices (ETA e-invoicing) | **Yes** |
| 8 | Email | None | Transactional email | Outbox, worker, templates EN/AR; SMTP verified with Mailpit | Production SMTP provider, SPF/DKIM/DMARC | Yes (ops task) |
| 9 | Administration | None | Platform + customer admin | Implemented | Reporting exports for finance | No |
| 10 | Security | Static page | OWASP-aligned controls | See SECURITY_DESIGN.md; tests for BOLA, CSRF, brute force, webhook forgery/replay | External penetration test; secret rotation runbooks | Recommended before launch |
| 11 | Privacy / compliance | None | PDPL-aware handling | Data export, account & org deletion, retention jobs, minimal data | Legal review, privacy policy, terms, DPA template, PDPL licensing/registration check | **Yes (legal)** |
| 12 | Localization | English UI | Arabic + English, RTL | Implemented | Professional review of Arabic copy | No |
| 13 | Testing | None | Automated unit/integration/E2E | 25 unit, 86 integration, 9 E2E — all passing | Load test on production-like hardware | No |
| 14 | Deployment | Claude artifact | Reproducible, TLS, health checks | Docker image, compose (dev/prod), Caddy TLS, health/readiness | Provision host; DNS; run CI on GitHub | **Yes (ops)** |
| 15 | Observability | None | Logs, metrics, alerts | JSON logs, health endpoints, worker heartbeat, admin health page | Uptime monitor + alert routing, error tracking | **Yes** |

## Items intentionally not built

- **Microservices / Kubernetes:** one web process + one worker + PostgreSQL covers the expected
  first-year load (see SAAS_ARCHITECTURE.md §Capacity).
- **Admin impersonation:** replaced by customer-granted, time-limited, audited support access.
- **Card-on-file automatic renewal:** renewals are invoiced and paid each period (works with cards,
  wallets and offline payment). Paymob's subscription module can be added later behind the same
  provider interface.
