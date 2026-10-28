# Product audit for the showcase video

What the video is allowed to say, and why. Every capability shown or named in the two cuts was checked
against this repository before it was scripted; the full list, with its status and evidence, is in
[FEATURE_COVERAGE_MATRIX.md](FEATURE_COVERAGE_MATRIX.md).

Audit date: 2026-10-27. Repository state: branch `claude/friendly-rubin-hmemjl` at `b9b789c` (Merge PR #33)
plus the video project in this folder; no application code was changed for the video.

## 1. How the product was inspected

| Source | What it gave | Limits |
| --- | --- | --- |
| Application code (`src/`, `public/`, `migrations/`) | What exists, how it is enforced (roles on the server, row-level security, marking rules, file checks) | — |
| Project documents (`docs/PROJECT_STATUS.md`, `FEATURE_INVENTORY.md`, `TEST_REPORT.md`, `SECURITY_DESIGN.md`, `SUBSCRIPTION_MODEL.md`, `STUDENT_ACCOUNTS.md`, `CLASSROOM.md`, `ONLINE_TESTS.md`) | Status of each area, open blockers (B-2…B-10), measured figures | Figures are quoted with the conditions under which they were measured |
| Test results recorded in `docs/TEST_REPORT.md` (2026-10-27) | Which behaviour is covered by integration and end-to-end tests | The test suite was **not re-run** for this video; the report's results are cited as recorded |
| **The running application**, driven by `video-project/capture/showcase.spec.ts` | Every product screen in the video: 54 recordings, 538 frames, of the real application on a fresh database, in Arabic | Local E2E server (port 3100), not a production host. The whole journey ran to completion; a step that failed would have stopped the capture |
| `https://wise-eduagent.ai.studio/` | Nothing: the environment's network policy refuses the host (proxy 403), and no source export was supplied | See §5 |

## 2. The product in one paragraph

**Curriculum Scope (نطاق المناهج)** is a multi-tenant SaaS for the Egyptian K-12 curriculum. It began as a
single-page picker (`legacy/`) and now has two connected parts: a **curriculum workspace** (a versioned catalogue
of 12 grades, 5 tracks, 231 subjects and 1,038 materials; named content scopes; comparison across campuses
and years; notes, assignees and due dates; carry-forward to the next year; exports, a read API and webhooks),
and a **school classroom** on the same accounts (student accounts created by the school, classes, homework,
online tests with live monitoring, marking, a gradebook and a student portal). Around them: organizations,
roles, two-step verification, audit logs, subscriptions with limits, a platform console and customer-granted
support access.

## 3. Status summary

From the matrix (52 capabilities):

| Status | Count | Meaning in the video |
| --- | --- | --- |
| Available now · متاح الآن | 42 | Implemented here, covered by tests, shown from a recording of the running application |
| In development · قيد الاستكمال | 5 | Partly built or waiting on an outside step; marked on screen in amber and said in the narration |
| Future roadmap · رؤية مستقبلية | 5 | Not built; shown only as a labelled plan or concept |

**In development** (each shown with that label): Paymob payments (simulator-tested; needs merchant keys, B-2);
production hosting, real email and alert channels, external penetration test (B-4); legal review of students'
data, after which student features are switched on per school (B-5, B-9); editorial verification of the
2026/27 catalogue (tools built, 0 of 231 subjects verified, B-6); manual screen-reader review (checklist ready).

**Future roadmap**: the AI educational assistant and the Wise EduAgent integration (no AI code exists; no
provider chosen, B-10); the pilot with partner institutions; parent accounts, a question bank, grade weighting
and term reports; single sign-on and other Arab curricula; higher education.

## 4. Claims register

Every figure or strong claim in the narration or on screen, and its source.

| Claim (as said or shown) | Where | Source |
| --- | --- | --- |
| 12 grades, 5 tracks, 231 subjects, 1,038 materials | c5-catalogue, m-curriculum | `catalog-fidelity.test.ts`; `scopes.test.ts`; FEATURE_INVENTORY F-01 |
| Accessibility audit of 149 screens, 0 findings (WCAG 2.x A/AA, automated) | c4-access, c8-ready | TEST_REPORT §3, accessibility row 23 — automated; the manual screen-reader review is stated as still ahead |
| 311 unit and integration tests; 24 user journeys in 3 browser engines | c8-ready | TEST_REPORT §2 (47 files, 311 passed, 2026-10-27) and §3 (24 journeys in Chromium, Firefox and WebKit) — as recorded; not re-run for the video |
| 300 students sitting one test from one network address, no request refused | c7-deploy | TEST_REPORT §5 "One exam for a whole grade" — on the local two-instance stack; the on-screen note says so |
| Database row-level security keeps each organization's data apart, even if application code is wrong | c4-isolation, c7-isolation, m-trust | `tenancy.test.ts`; SAAS_ARCHITECTURE; SECURITY_DESIGN |
| No AI marks answers; the teacher decides | c5-marking, c6-ai-vision | `src/classroom/marking.ts` ("no AI is involved in marking") |
| Platform staff see a school's data only with time-boxed permission from the school, and every read is logged | c4-oversight, m-trust | `admin-api-ops.test.ts`; SECURITY_DESIGN (A01) |
| Files are checked for viruses before anyone opens them; photos resized and location removed | c5-homework | `file-checks.test.ts`; TEST_REPORT §4 (real ClamAV, local stack) |
| Plans: Free, Starter EGP 990 / month, Professional EGP 2,900 / month, Enterprise on request; 14-day trial | c7-plans | The application's pricing page (recorded), `SUBSCRIPTION_MODEL.md`. Shown with the note "launch price proposals — open to review" |
| Two app instances, rolling restarts, encrypted backups and a rebuilt server | c7-deploy | TEST_REPORT §4 (drills on the local production-settings stack) |

**Claims the video does not make**: no customers, users, usage figures, revenue, growth, partnerships,
certifications, awards or testimonials (none exist); no "compliant with PDPL" (the legal review is pending);
no "launched" or "live" (no production host); no AI capability today; no Wise EduAgent feature.

## 5. Wise EduAgent

The brief asked for the Wise EduAgent site to be inspected. From this environment it cannot be: the network
policy refuses `wise-eduagent.ai.studio` (proxy 403), as recorded in `docs/WISE_EDUAGENT_FUNCTIONAL_INVENTORY.md`
(status **NOT ACCESSIBLE**), and the refusal was not routed around. The only verified link is that the original
picker was built to define the content scope of "Paradise EduAgent" (`legacy/egypt-curriculum-picker.html`).

The video therefore:

- states plainly (c6-ai-status) that the AI assistant is not built yet and the integration is a planned step;
- shows the assistant as a **labelled concept** (c6-ai-vision, m-ai: dashed lines and the banner
  "تصوّر مستقبلي — ليس ميزة متاحة للبيع · Future vision — not a feature for sale"). Its rules come from this
  project, not from Wise: answers labelled as generated, no change to official records or grades, and usage
  limits within the subscription are the integration requirements recorded in
  `docs/wise-integration/04_STUDENT_EXPERIENCE_DESIGN.md`; "the teacher decides" follows the classroom's
  existing rule that no AI marks work;
- imitates no Wise screen and names no Wise feature.

To show Wise features later, the owner needs to allow the host in the environment's network settings and
provide an authorized test account, or supply the AI Studio source export; then repeat the inventory.

## 6. Demonstration data and privacy

- All people, schools and addresses are invented (مدرسة وادي النيل للغات, منى حسن, كريم, سلمى, عمر خالد, هنا,
  آدم …). Product windows carry a "DEMO DATA · بيانات تجريبية" tag.
- Recordings were made on a fresh, throw-away database created by the E2E setup; no customer or production
  data was used, and no production credentials exist in this repository.
- Blurred in the recordings: one-time student passwords, the two-step verification QR code and manual key, and
  any text naming a local address (`localhost`, `127.0.0.1`). The webhook example uses an invented host name.
- The development payment simulator page is not shown; the billing scene goes from the billing page to the
  subscribed state.

## 7. Known differences between the recordings and a customer's browser

- **Date fields** show `mm/dd/yyyy`: the native date field is drawn by the capture browser in its own locale.
  In a customer's browser it follows their system settings. The application's own dates are in Arabic.
- **Font**: the recordings use Readex Pro, the application's font, as a customer would see it.
- **Time-dependent states**: due-date reminders and the platform console's worker status come from running
  the real background worker and its reminder job during the capture, as the end-to-end tests do.
