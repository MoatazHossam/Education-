# Current state assessment

Two states are documented: the **original artifact** as found on 2026-10-22 (Phase 0 discovery)
and the **SaaS codebase** as of the latest commit on branch `claude/friendly-rubin-hmemjl`.
Statuses use the definitions from the project brief. Everything marked verified was checked by
running code or tests in this repository, not by reading alone.

## 1. Original artifact (baseline)

### How it was inspected

1. Read the published artifact with the Claude Artifact reader (the URL is a rendered page; no
   export/download of a project existed). The raw HTML was saved and the platform wrapper line removed.
2. Searched the workspace and the connected repository (`MoatazHossam/Education-`) — it was empty
   (no commits), so the artifact was the only source.
3. Executed the data-building section of its script in Node (`vm`) to count and validate the data —
   now an automated test: `tests/unit/catalog-fidelity.test.ts`.
4. Loaded nothing from third parties: the artifact's only external dependencies were Google Fonts and
   outbound links.

### Technical profile

| Aspect | Finding |
| --- | --- |
| Frontend | One HTML file, inline CSS (design tokens, dark mode via `prefers-color-scheme`), ~200 lines vanilla JS (IIFE) |
| Backend | None |
| Data | Hard-coded arrays built at load time: 231 subject rows, 1,038 materials, 28 blocks, 5 tracks, 10 source links |
| Persistence | `localStorage['ecp-sel']` — array of string keys `grade|track|block|sid|title` |
| Auth / tenancy / billing | None |
| Tests / CI / deployment | None |
| Security | Data escaped with a small `esc()` before `innerHTML`; no user input reaches the DOM except the search box (used for filtering only). No secrets. |
| Accessibility | `aria-pressed` toggle buttons, labelled search, `aria-live` toast, focus-visible styles. No skip link; Arabic text not marked with `lang`. |
| Performance | Renders all 1,038 buttons on each filter change; acceptable at this size. |

### Defects found in the original

| ID | Defect | Evidence | Resolution |
| --- | --- | --- | --- |
| D-01 | International programme components (383 materials) were tagged "Ministry material" and programme assessments (96) "Language-school variant". The source code even carries the author's unresolved comment *"programme material shown in Ministry blue slot? use ext style for publisher"*. Filtering by "Ministry" therefore showed Cambridge/IB subjects. | Executed counts; `legacy/` line 297 | Fixed: new kinds `prog` and `exam`; test asserts the mapping |
| D-02 | Saved selections were keyed by display text. Any wording change in the data silently dropped saved items, while the counter still counted the orphaned keys. | Code review (`keyOf`, `listText`) | Fixed: materials have stable UUIDs; items reference them with foreign keys |
| D-03 | Search matched materials hidden by the "Show" filter, so rows appeared with no visible match. | Code review (`render`) | Fixed in the port |
| D-04 | `.subj:first-of-type{border-top:0}` never matched (the block header is the first `div`), so every first subject row had a double rule. | CSS review | Fixed (`.bhead + .subj`) |
| D-05 | "Clear" deleted every selection, including ones hidden by filters, without confirmation. | Code review | Fixed: confirmation dialog stating the count |
| D-06 | Selections were per-browser only: no sharing, lost on clearing site data, invisible to colleagues. | Design | Replaced by server-side scopes |
| D-07 | UI chrome English-only; Arabic names present but no RTL layout. | Review | English/Arabic UI with RTL |

### Data quality caveat (not a code defect)

The catalogue cites news sites (Parlmany, Masrawy, Fil Gamaa, …) and the Ministry digital library.
Its own notice says decrees and editions must be confirmed. **No item in the catalogue has been
independently verified in this project.** Platform admins can now correct it through draft
versions (see the admin catalogue editor), but the editorial verification itself is an open
business task (see PROJECT_STATUS.md).

## 2. SaaS codebase (current)

| Area | Status | Evidence |
| --- | --- | --- |
| Catalogue (DB, versioned, admin-editable) | COMPLETE | Seed reproduces original exactly (fidelity test); admin clone/edit/publish test |
| Content scopes (CRUD, items, duplicate, exports) | COMPLETE | `tests/integration/scopes.test.ts`, E2E journey 1 |
| Auth (verify, login, lockout, reset, sessions, CSRF, TOTP MFA) | COMPLETE | `auth.test.ts`, `authz-coverage.test.ts` |
| Organizations, roles, invitations, ownership transfer | COMPLETE | `tenancy.test.ts`, E2E journey 2 |
| Multi-tenancy with PostgreSQL Row-Level Security | COMPLETE | DB-level RLS tests, route-enumeration authorization test, E2E journey 3 |
| Plans, limits, usage metering | COMPLETE | `scopes.test.ts`, `billing.test.ts`, E2E journey 5 |
| Billing lifecycle (sandbox provider) | COMPLETE | `billing.test.ts`, E2E journey 4 |
| Paymob payment adapter | NOT VERIFIED | Unit-tested HMAC only; no Paymob credentials available |
| Platform admin, support access, audit log | COMPLETE | `admin-api-ops.test.ts`, E2E journey 7 |
| Front end (EN/AR, RTL, responsive) | COMPLETE | E2E journeys 1–8, visual QA screenshots |
| Docker / compose / backups | COMPLETE (locally verified) | Built image, full stack healthy, backup→restore→verify run |
| CI pipeline | NOT VERIFIED | Workflow written; not executed on GitHub (push to the repository was refused — see PROJECT_STATUS.md) |
| Production deployment, monitoring/alerting | NOT STARTED / BLOCKED | Requires hosting account, domain, SMTP, provider credentials |

Detailed per-deliverable status, test results and blockers: [PROJECT_STATUS.md](PROJECT_STATUS.md)
and [TEST_REPORT.md](TEST_REPORT.md).
