# Product requirements

Each requirement lists its verification. "Test" names refer to files under `tests/`.
Assumptions that can be revised later are marked **(assumption)**.

## 1. Functional requirements

### Catalogue
| ID | Requirement | Verification |
| --- | --- | --- |
| FR-C1 | The system provides the Egyptian K-12 curriculum catalogue for 2026/2027 exactly as defined in the original picker (231 subjects, 1,038 materials), correcting only the international-programme kind classification. | `unit/catalog-fidelity` |
| FR-C2 | Catalogues are versioned per academic year; published versions are immutable; only platform admins create drafts (by cloning), edit, publish and archive. | `integration/admin-api-ops` |
| FR-C3 | Customers can browse only published/archived versions; drafts are invisible to them. | `integration/admin-api-ops` |
| FR-C4 | Each version carries its notice, grade notes and source links. | `integration/scopes` |
| FR-C5 | Platform admins can mark subjects and materials as verified (with the source checked) or as needing review (with a public note), on drafts and published versions but not archived ones; customers see the marks, review date and coverage, but not the reviewer; editing an entry's content clears its mark; a copy for the same academic year keeps marks, a new year starts unverified. | `integration/catalog-verification`, E2E journey 8 |
| FR-C6 | When a later academic year's catalogue is published (or a version a customer uses is archived), owners, admins and editors of organizations with scopes on an older catalogue are notified in the app and by email, in their language, once per academic year, with a link to carry the scope forward. Newly flagged "needs review" entries notify the organizations that selected them. Users can turn these emails off. | `integration/catalog-notifications`, E2E journey 10 |
| FR-C7 | Platform admins can download a catalogue version as a CSV spreadsheet and upload an edited copy. The upload is previewed (changes and errors by row) before anything is saved and is applied all or nothing. Verification columns can change on drafts and published versions; content corrections and new materials in existing subjects only on drafts. | `unit/catalog-sheet`, `integration/catalog-sheet`, E2E journey 11 |

### Picker and scopes
| ID | Requirement | Verification |
| --- | --- | --- |
| FR-P1 | The picker offers the original filters (track, grades, kinds, search), grade ruler, legend, selection tray, "Select all shown", "Clear" (with confirmation), "View list" and "Copy list". | E2E journey 1 |
| FR-P2 | Selections are saved to a named **content scope** owned by an organization and visible to all its members. | `integration/scopes`, E2E journeys 1–2 |
| FR-P3 | An organization can have several scopes; each targets one published catalogue version; names are unique per organization. | `integration/scopes` |
| FR-P4 | Scopes can be renamed, described, duplicated (with items) and deleted. | `integration/scopes` |
| FR-P5 | Scopes export as TXT (original "Copy list" layout), CSV (UTF-8 BOM, formula-injection safe) and JSON. | `integration/scopes`, `unit/security-primitives` |
| FR-P6 | Materials that do not belong to the scope's catalogue version are rejected. | `integration/scopes` |
| FR-P7 | A scope can be carried to another published catalogue version (usually the next academic year): the system matches the selection by natural key, shows what carries over, what has no counterpart (with the subject's new books as replacements), what changed in the covered subjects and what is new; editors then copy it into a new scope (within the plan's scope limit) or move it in place. Viewers can see the preview. The picker and the scopes list offer it when a newer catalogue exists. | `unit/carry-forward`, `integration/scope-carry-forward`, E2E journey 10 |

### Accounts and organizations
| ID | Requirement | Verification |
| --- | --- | --- |
| FR-A1 | Sign-up creates a user and an organization owned by that user; the email must be verified before sign-in. | `integration/auth` |
| FR-A2 | Sign-in with email + password; optional TOTP second factor with single-use recovery codes; platform admins must use TOTP. | `integration/auth`, `integration/admin-api-ops` |
| FR-A3 | Password reset by single-use email link; password change requires the current password; both sign out other sessions. | `integration/auth` |
| FR-A4 | Users can list and revoke their sessions. | `integration/auth` |
| FR-A5 | Users can export their personal data and delete their account (unless they own an organization). | `integration/tenancy` |
| FR-O1 | Roles: owner (one per org), admin, editor, viewer, with the permission matrix in SAAS_ARCHITECTURE.md §Authorization. | `integration/tenancy`, `integration/authz-coverage` |
| FR-O2 | Admins invite by email with a role; invitations expire after 7 days, can be resent or revoked; pending invitations count as seats. | `integration/tenancy`, `integration/scopes` |
| FR-O3 | Ownership transfer requires the owner's password; the previous owner becomes admin. | `integration/tenancy` |
| FR-O4 | Owners can require MFA for owners/admins (paid plans), grant time-limited support access, and delete the organization (password + exact name). | `integration/admin-api-ops`, `integration/tenancy` |
| FR-O5 | Admins can read the organization audit log within the plan's retention window. | `integration/admin-api-ops` |
| FR-O6 | Admins can create/revoke read-only API keys (Professional+); keys are shown once. | `integration/admin-api-ops` |

### Billing
| ID | Requirement | Verification |
| --- | --- | --- |
| FR-B1 | Plans with seat, scope, export and API limits plus feature flags; limits enforced server-side. | `integration/scopes`, `integration/admin-api-ops` |
| FR-B2 | New organizations of a first-time owner get a 14-day Professional trial **(assumption: length and plan)**; further organizations start on Free. | `integration/billing` |
| FR-B3 | Owners subscribe monthly or yearly through a hosted checkout; the plan activates only after a verified provider event. | `integration/billing`, E2E journey 4 |
| FR-B4 | Upgrades apply immediately with a prorated charge; downgrades and interval changes apply at renewal; cancellation applies at period end and can be undone before then. | `integration/billing`, E2E journey 4 |
| FR-B5 | Renewal invoices are issued `RENEWAL_NOTICE_DAYS` before period end; unpaid renewals become past-due with `GRACE_DAYS` of access, then the org moves to Free. | `integration/billing` |
| FR-B6 | Moving to a lower plan never deletes data: excess scopes become read-only (oldest stay editable); seats above the limit block new invitations only. | `integration/scopes` |
| FR-B7 | Platform admins can assign plans manually (e.g. Enterprise), set limit overrides, issue manual invoices and mark them paid. | `integration/admin-api-ops` |
| FR-B8 | Billing emails: trial ending/ended, renewal due, payment succeeded/failed, past due, subscription ended. | `integration/billing` |

### Platform administration
| ID | Requirement | Verification |
| --- | --- | --- |
| FR-X1 | Overview (MRR, revenue, orgs, users, plan mix), health (DB, migrations, worker heartbeat, outbox, failed webhooks). | `integration/admin-api-ops` |
| FR-X2 | Search organizations and users; suspend/restore both; unlock locked users. | `integration/admin-api-ops`, E2E journey 7 |
| FR-X3 | Admins cannot read customer scope contents unless the owner granted support access; each read is audited in the customer's log. | `integration/admin-api-ops` |
| FR-X4 | Audit log search across the platform; webhook event log. | `integration/admin-api-ops` |
| FR-X5 | Edit plan prices, limits and features. | `integration/admin-api-ops` |

## 2. Non-functional requirements

| ID | Requirement | Target | Status |
| --- | --- | --- | --- |
| NFR-1 Security | OWASP ASVS-aligned controls (SECURITY_DESIGN.md); no cross-tenant access | 0 failing authz tests | Met (tests) |
| NFR-2 Privacy | Minimal personal data; retention jobs; export/deletion | — | Met in code; legal review open |
| NFR-3 Availability | Single-region, single-host launch **(assumption)**; restart-safe; health endpoints; two app instances so restarts and an instance crash do not take the service down | 99.5% monthly **(assumption)** | Not yet measurable (not deployed); rolling restarts with 0 failed requests on a local production-settings stack |
| NFR-4 Latency | p95 < 300 ms for API reads and writes at 20 concurrent users on 2 vCPU **(assumption)** | Measured on 4 vCPU dev sandbox: p95 53–152 ms (TEST_REPORT.md) | Met in sandbox; re-measure on production hardware |
| NFR-5 Recoverability | RPO ≤ 24 h, RTO ≤ 4 h **(assumption)** | Daily dumps + verified restore procedure | Procedure verified locally |
| NFR-6 Localization | Full EN/AR UI, RTL, Arabic emails | — | Met |
| NFR-7 Accessibility | Keyboard operable, labelled controls, visible focus, sufficient contrast; WCAG 2.2 AA target | 0 automated WCAG 2.2 A/AA findings (axe-core) on every screen | Met for automated checks (46 screens: English/Arabic, light/dark, desktop/phone) and a keyboard-only journey (TEST_REPORT §3); no manual screen-reader review yet |
| NFR-8 Browser support | Current Chrome, Edge, Firefox, Safari; phones ≥ 360 px | — | Chromium verified by E2E; others not tested |
| NFR-9 Maintainability | TypeScript strict, lint, CI, migrations | — | Met |
| NFR-10 Portability | Containerised; any Linux host with Docker and PostgreSQL 16 | — | Met (local) |
