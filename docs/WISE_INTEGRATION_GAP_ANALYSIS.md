# Wise EduAgent → Education SaaS: gap analysis

2026-10-25. Wise EduAgent could not be inspected (`docs/WISE_EDUAGENT_FUNCTIONAL_INVENTORY.md`), so
the "Wise evidence" column is **NOT ACCESSIBLE** for every row. The matrix compares the capabilities
the integration brief names against what this SaaS actually has (`docs/wise-integration/02_EXISTING_SAAS_ASSESSMENT.md`),
and records the action and its preconditions. No action below implements a Wise feature until that
feature has been observed.

## 1. Matrix

| Area | Wise evidence | Existing SaaS support | Integration action | Priority |
| --- | --- | --- | --- | --- |
| Student identity and sign-in | NOT ACCESSIBLE | Accounts, sessions, MFA, organizations and memberships with roles `viewer`/`editor`/`admin`/`owner`. **No student role. The product stores no student records by design** (SECURITY_DESIGN §7: "keep it that way unless a new legal assessment is done"). | EXTEND EXISTING: a student membership in the school's organization, same accounts and sessions. **Requires the owner's decision and a legal assessment** (minors' data under PDPL). | P0, prerequisite; blocked on decision |
| Student portal, dashboard, navigation | NOT ACCESSIBLE | None. Organization pages serve staff: picker, scopes, compare, members, billing, settings, audit. | EXTEND EXISTING: a student area in the same SPA shell, design tokens and EN/AR layouts. | P0, prerequisite |
| Courses, subjects, enrolment | NOT ACCESSIBLE | Catalogue (grades, tracks, subjects, books, verification marks) and the organization's **content scopes**. No classes, enrolments or teacher–student links. | EXTEND EXISTING: the school's content scopes become the student's curriculum context. This is the natural fit given V-2 (the SaaS was built to define Paradise EduAgent's curriculum). Classes and enrolments only if the Wise features need them. | P0 once unblocked |
| AI tutoring / educational chat | NOT ACCESSIBLE | No AI service, provider abstraction or conversation storage. | DEFER until observed; then PORT AUTHORIZED IMPLEMENTATION (prompts and flows from the owner's export) or REIMPLEMENT. | — |
| Study plans, goals, recommendations | NOT ACCESSIBLE | None. | DEFER | — |
| Practice, quizzes, feedback | NOT ACCESSIBLE | None. No official grades exist in the SaaS either. | DEFER | — |
| Learning progress | NOT ACCESSIBLE | None. | DEFER | — |
| Course material for grounded answers (retrieval) | NOT ACCESSIBLE | The catalogue holds titles and metadata, not book content. | DEFER: grounded tutoring needs licensed content (textbook PDFs or the publishers' data) and a content agreement. | — |
| AI provider layer | NOT ACCESSIBLE (V-1 suggests Gemini; unverified) | None. | REIMPLEMENT as a provider-independent adapter with a test provider refused in production (the pattern of the billing sandbox), when an AI feature is approved. | P1 when AI is approved |
| AI usage metering and limits | n/a | Monthly usage counters with atomic increments (`exports`, `api_requests`); plan limits and feature flags; shared rate limits. | EXTEND EXISTING: a new usage metric and plan feature; per-student and per-organization allowances. | P1 |
| Subscription and entitlement | n/a | Plans, entitlements, billing lifecycle, Paymob adapter. | EXTEND EXISTING: an AI/student feature or add-on. No second billing system; no automatic price changes. | P1 |
| Tenant isolation | n/a | Forced RLS on tenant tables, `inOrg` guard, route-enumeration and cross-tenant tests. | REUSE EXISTING; every new table and route gets the same tests. | P0 |
| Audit, alerts, rate limits | n/a | Audit log, operational alerts, shared rate limits. | REUSE EXISTING | — |
| Localization, RTL, accessibility | n/a | EN/AR with RTL, automated WCAG 2.2 AA audit in E2E. | REUSE EXISTING; new pages join the audit. | — |

## 2. Foundations needed whatever Wise contains

**Update 2026-10-25:** the owner chose school-created student accounts (decision 2). Foundations 1, 3
and 4 are built (`docs/STUDENT_ACCOUNTS.md`, `wise-integration/04_STUDENT_EXPERIENCE_DESIGN.md`);
students hold no membership but a separate student record, which keeps every staff route closed to
them. Foundation 2 (consent and age handling) waits for the legal assessment. The matrix in §1 is the
analysis as of the start of the integration.


These foundations are needed by any student-facing integration. They do not depend on Wise's feature
list, but they **do** depend on decisions only the owner can make (§3):

1. Student accounts inside a school's organization (invitation or school-managed creation), with a
   student role that sees only the student area.
2. Consent and age handling appropriate for minors, decided with legal advice.
3. The student area in the SPA: navigation, a home page showing the school's curriculum (content
   scopes), EN/AR, RTL, accessible.
4. Entitlement: a plan feature that turns the student area on for an organization.

## 3. Decisions needed from the owner

1. **Access to Wise EduAgent:** an AI Studio source export (preferred) and/or network access to
   `wise-eduagent.ai.studio` with an authorized account.
2. ~~**Students in Midad**~~ — **decided 2026-10-25: school-created accounts.** Built, off
   for every school until a platform administrator enables it. Still needed: the legal assessment
   (age range, parental consent, controller/processor terms) before real students use it.
3. **AI provider:** which provider and model (Gemini, if Wise uses it; or provider-independent), and
   who holds the API key and pays for usage.
