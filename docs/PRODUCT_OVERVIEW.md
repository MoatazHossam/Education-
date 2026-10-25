# Product overview

## Where this product comes from

The starting point was a single Claude Artifact, **"Egypt Curriculum Picker · دليل المناهج"**
(<https://claude.ai/artifact/6uj4zn3bV2EM7q9172QE23>). Its source was obtained on 2026-10-22 by
reading the published artifact and is preserved verbatim in [`legacy/`](../legacy/README.md).

It was one self-contained HTML file (399 lines): inline CSS, a hard-coded data set, and about 200
lines of vanilla JavaScript. Its header says it was built to define the **content scope of
"Paradise EduAgent" for academic year 2026/2027**: the user ticks the curriculum materials an
education platform should cover, then copies the list.

### What the original actually did (verified by reading and executing its code)

- Listed the Egyptian pre-university curriculum for **grades 1–12** (Primary 1 → Secondary 3) as
  **231 subject rows** with **1,038 selectable materials**. Each subject has an English and Arabic
  name, an assessment status (*counts toward total*, *pass/fail*, *activity*), an optional note,
  and materials of three kinds: Ministry material, language-school variant, external commercial
  reference (e.g. *Al-Adwaa*, *Selah El-Telmeez*, *Gem*).
- Covered five tracks: Ministry schools, Secondary 1 (shared foundation year), the new **Egyptian
  Bakaloria**, the classic **Thanaweya Amma**, and **international programmes** (Cambridge, Pearson
  Edexcel, American Diploma, IB, German, French) plus the Egyptian "identity subjects" that
  international schools must teach.
- Filters by track, grade (multi-select), material kind, and free-text search.
- Selection with "Select all shown", "Clear", "View list" and "Copy list" (grouped text output).
- Saved the selection in the browser's `localStorage` only.
- Showed a caveat notice (decrees for 2026/27, edition checks, a pending Supreme Administrative
  Court case) and ten source links (news articles and the Ministry digital library).

It had **no backend, no accounts, no sharing, no persistence beyond one browser, no export
files, and no tests**.

## What the product is now

**Curriculum Scope** (working name; change it in `public/js/i18n.js` and the email signature in
`src/notifications/email.ts`) is a multi-tenant SaaS built around that same picker:

> A curated, versioned catalogue of the Egyptian K-12 curriculum, and a shared workspace where an
> organization's team decides — and keeps a durable record of — exactly which curriculum materials
> its product, school or content programme covers.

The core interaction is unchanged: the picker page keeps the original layout, filters, grade ruler,
selection tray and "Copy list" output format. What changed is everything around it:

| Original | Now |
| --- | --- |
| One anonymous browser | Accounts, organizations, roles (owner/admin/editor/viewer), invitations |
| One selection in `localStorage` | Any number of named **content scopes** per organization, stored server-side and shared by the team |
| Copy to clipboard | Copy list plus TXT/CSV/JSON downloads and a read-only REST API for content pipelines |
| Data hard-coded in the page | Catalogue in the database, **versioned per academic year**, edited by platform admins in drafts and published |
| English UI | English and Arabic UI with right-to-left layout |
| — | Subscriptions, plan limits, invoices, payment-provider integration (Paymob adapter; sandbox for development) |
| — | Audit log, customer-controlled support access, platform administration |

## Business problem

Egyptian curriculum structure is changing fast: the 2025/26 primary/preparatory plan changes,
the new **Bakaloria** certificate (an Education Ministry official reported 99% opt-in for 2026/27,
about 832k students — [EnterpriseAM](https://enterpriseam.com/egypt/blackboards/99-of-students-opted-into-egypts-new-baccalaureate-system/)),
and new rules for identity subjects in international schools. Anyone producing or buying
curriculum-aligned content must answer "which books, editions and subjects, for which grades and
tracks, do we cover this year?" Today that answer usually lives in spreadsheets and chat threads.

The product gives a single, maintained reference catalogue plus a shared, auditable record of the
decision, exportable into content-production and AI pipelines.

## Intended users and customers (B2B)

| Segment | Use |
| --- | --- |
| Ed-tech companies and AI tutoring products (like the original "Paradise EduAgent") | Define and track which curriculum the product covers; feed the scope to content pipelines via API |
| Content producers and publishers | Plan production of books/videos/question banks per grade, track and edition |
| Tutoring centres | Decide which subjects and reference books each centre covers |
| Private/international school groups | Map identity-subject and programme coverage across schools |
| Curriculum consultants | Prepare scope proposals for clients |

It is **B2B**. Individual students and parents do not sign up. Since 2026-10-25 a school can give its
students accounts that it creates and manages (off unless a platform administrator enables it;
`docs/STUDENT_ACCOUNTS.md`); those students see their school's curriculum and nothing else.

## Competitive position (summary — see COMMERCIAL_FEASIBILITY.md)

- **Strengths:** Egypt-specific, bilingual, already covers 2026/27 reforms (Bakaloria vs Thanaweya
  Amma, identity subjects); lightweight compared with full curriculum-mapping suites; API for
  integration; low price point in EGP.
- **Limitations:** The catalogue's accuracy depends on continuous editorial work — the original
  data is sourced from news articles and has **not been verified against official decrees**. The
  product's value is mostly that curation; the software alone is easy to copy. The market of
  organizations willing to pay for scoping alone is niche; the stronger long-term play is as a
  module of a broader content-planning or curriculum-mapping product.
