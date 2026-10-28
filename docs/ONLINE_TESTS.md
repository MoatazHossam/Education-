# Online tests and exams

Teachers write quizzes and exams for a class, publish them for a time window, watch the students work
live, act on one student (more time, a retake, submit for them, allow another device), mark what the
computer cannot, and release results. Students take them in the student portal (the same sign-in as
homework; no second account), with a clock the server keeps.

Built on classes (docs/CLASSROOM.md): a test belongs to one class and one of the class's curriculum
subjects. Code: `src/classroom/marking.ts` (rules), `tests-service.ts` (shared queries, the worker pass),
`tests-routes.ts` (staff), `tests-student-routes.ts` (students), migration `0014_online_tests.ts`;
pages `public/js/views/tests.js` and `student-tests.js`. Everything is in English and Arabic.

## 1. Who does what

| | School admin | Subject teacher of the class | Other teacher of the class | Student of the class |
|---|---|---|---|---|
| See the class's tests, the live monitor, results | ✓ | ✓ | ✓ (read only) | — |
| Write, publish, change, delete a test | ✓ | ✓ (their subject) | — | — |
| More time, retake, submit for a student, allow a device, close early, new start code | ✓ | ✓ | — | — |
| Mark answers, release results | ✓ | ✓ | — | — |
| See the start code | ✓ | ✓ | — | — (given in the room) |
| Take a published test, see their own results when allowed | — | — | — | ✓ |

"Subject teacher" is as for homework: a member added to the class as a teacher of that subject. Answer
keys go to staff who can change the test only; read-only staff get the questions without keys.

## 2. Turning it on

Tests come with classes: the plan's student accounts switch turns them on (`assertClassroomEnabled`),
with no other setting and no price change. There is no separate limit; a test can hold 100 questions.

## 3. A test

| Setting | Values | Notes |
|---|---|---|
| Kind | Quiz or Exam | A label for students and teachers; the rules below decide behaviour. |
| Opens, closes | Date and time | Closes after it opens. A new test opens now by default. |
| Time limit | none, or 1–600 minutes | Each attempt ends at the earlier of start + limit and the closing time, plus any extra time. |
| Attempts | 1–10 | Each student; the teacher can give one more at a time (up to 10 extra). |
| Shuffle questions / choices | on or off | A different order for each attempt, fixed when it starts. |
| Results | as soon as each student submits / when the test closes / when I release them | What the student sees: the score, and answers if shown. "When the test closes" also waits for any extra time given, so nobody sees right answers while a classmate is still working. |
| Show answers | on or off | The correct answers appear with the results, only after the test is over for everyone. |
| Start code | on or off | Six characters (no 0/O/1/I) that the teacher reads out in the room; can be replaced at any time. |
| One device | on or off | The attempt continues only in the browser session that started it, until the teacher allows another. |

A test is a draft until published. Publishing needs at least one question and a closing time still ahead;
it notifies the class's students in their own language. Back to draft is allowed until a student starts.

Once any student has started, the questions, their order, and the timing rules (kind, opening time, time
limit, attempts, shuffles, start code, one device) are fixed, so all attempts are equal (`TEST_STARTED`).
The title, instructions, results settings and the closing time can still change. A new closing time
also moves the end of attempts in progress ("ten more minutes for everyone"), and a later one reopens a
test that was closed early.

## 4. Questions and marking

| Type | Answer | Automatic mark |
|---|---|---|
| One correct choice | one of 2–10 choices | full points or 0 |
| Several correct choices | any of 2–10 choices | (right − wrong) ÷ number correct × points, never below 0 |
| True or false | true / false | full points or 0 |
| Short answer | typed text, up to 500 characters | full points if it matches any accepted answer, else 0 |
| Written answer | typed text, up to 10 000 characters | none: the teacher marks it (a marking guide can be kept with it) |

Short answers are compared after normalising both sides, so spelling variants a teacher would accept
count: case, spaces and edge punctuation; Arabic diacritics and tatweel; أ إ آ ٱ → ا, ى → ي, ة → ه; and
Arabic-Indic digits. Points are up to 2 decimals.

Marking is plain rules in `marking.ts`; **no AI marks or changes marks** (AI only suggests questions, §14). An attempt's score is the sum
of the teacher's mark where there is one, else the computer's. It "needs marking" while any answered
written question has no teacher mark. Teachers can override any automatic mark (or remove the override)
and leave a comment per answer. A student's best marked attempt is their result.

## 5. Taking a test (students)

- **Today** and **Tests** list open and upcoming tests. The test page shows the window, time limit,
  attempts left, the results setting, and a start button (with a code field if needed).
- Starting creates the attempt and fixes its question and choice order; only then can the student's
  requests read the questions (row-level security, §7).
- Answers save as the student types (after a pause) and when they leave a field. The page shows "Saved"
  and the time.
- **An answer that does not reach the server is saved again.** If a save fails because the connection
  dropped, the server is busy (429) or unavailable (5xx), the page keeps the latest answer for that
  question and tries again after 5 seconds, then less often up to every 30 seconds, until it is saved.
  The bar says "Not saved yet (n): trying again", and a screen reader hears it once. Submitting first
  tries those answers again; if some are still not saved, the page says how many and asks before
  submitting without them. When the time is up or the attempt was submitted or moved to another
  device, the page stops trying and says so.
- **The server keeps the time.** The clock on the page follows the server's (a heartbeat every
  20 seconds also brings extra time the teacher gives). Saves up to 15 seconds after the deadline are
  accepted for network delays; after that, any request submits the attempt (`TIME_UP`) and the worker
  submits attempts nobody comes back to. A screen reader hears the time left at 5 minutes and 1 minute, once each
  as the time left crosses them (not when the test is opened with less time left), and again after more time is given;
  the timer itself is read only when the student goes to it.
- Submit asks for confirmation and says how many questions are unanswered.
- The page tells the student what their teacher can see (§9) before and during the test.
- Results appear by the test's setting. When answers are shown and the test is over, the review shows each
  answer, the points, the teacher's comment, and the correct answer.

## 6. The teacher's pages

- **Class page → Tests:** the class's tests with their state; "New test" (subject teachers and admins).
- **Test → Questions:** settings, the start code, questions (add, change, delete, reorder until the
  first student starts), publish / back to draft, delete.
- **Live monitor** (updates every 5 seconds): one row per student with their state (not started,
  working and online or not, submitted), time left, answers given, what was noticed, best score and
  attempts. Actions per student: more time (1–120 minutes at a time, also past the closing time), submit now, allow another device,
  another attempt; "Events" lists everything recorded for the attempt. For the whole test: close now
  (submits and marks all open attempts) and a new start code.
- **Results:** every student's attempts with scores and those that need marking; release results (when
  set to "when I release them"). An attempt opens with each answer, the computer's mark, a mark field and
  a comment.

## 7. Data and row-level security

Migration `0014_online_tests.ts`:

| Table | Holds |
|---|---|
| `tests` | settings, state (draft/published), publish and notification times, start code, early close, the most extra time given, results release |
| `test_questions` | type, prompt, choices (`[{id: 'a'..'j', text}]`), points, position |
| `test_question_keys` | the answer key, apart from the question so it can be hidden by its own policy |
| `test_student_overrides` | one student's extra minutes (≤ 600) and extra attempts (≤ 10) |
| `test_attempts` | number, state, start, deadline, extra minutes, the session that holds it, question and choice order, score, needs marking, last seen, events count |
| `test_answers` | the answer (JSON), save time, automatic and teacher points, comment |
| `test_events` | started, resumed, left the page / returned (seconds), paste (length only), offline / online, another device, device allowed, extra time, submitted, time up, submitted by the teacher, closed |

Migration `0015_classroom_retention.ts` adds `tests.work_removed_at`, `tests.monitoring_removed_at` and
`tests.retention_hold`: the school's retention periods (docs/CLASSROOM.md §11) can delete a test's
monitoring events, then its answers (each becomes JSON `null`; marks, comments and scores stay), then the
test with everything in it.

All tables have forced row-level security on `org_id` like the rest of the schema. A student's requests
run with `app.current_student` set (`withStudentContext`), and then:

- tests: only **published** tests of the student's own classes;
- questions: only of tests the student has **started**;
- keys: only after the test is **over for everyone** (closed early, or closed and the most extra time
  anyone was given has run out: `tests.max_extra_minutes`), when the teacher **shows answers**, the
  results are **out**, and the student has **submitted**; a student can never write any of these;
- attempts, answers, events, overrides: only the student's own; answers can be written only while the
  attempt is in progress.

Automatic marking needs the keys, so it runs in the school's context after the student's transaction
(`withOrgContext`); if that fails, the worker marks the attempt on its next pass.

At most one attempt per student is in progress (a unique partial index), and at most 300 events are kept
per attempt.

## 8. API

Staff (session + CSRF, role at least viewer, then the class rules in §1):

| Method and path | What |
|---|---|
| `POST /api/orgs/:orgId/classes/:classId/tests` | new test (draft) |
| `GET /api/orgs/:orgId/tests/:testId` | the test, its questions (keys for those who can change it), start code |
| `PATCH /api/orgs/:orgId/tests/:testId` | change settings (§3 for what is fixed after a start) |
| `DELETE /api/orgs/:orgId/tests/:testId` | delete with its attempts |
| `POST /api/orgs/:orgId/tests/:testId/questions` | add a question |
| `POST /api/orgs/:orgId/tests/:testId/suggest-questions` | questions suggested by AI (§14); saves nothing; 30 an hour |
| `PATCH`, `DELETE /api/orgs/:orgId/tests/:testId/questions/:questionId` | change or delete one |
| `PUT /api/orgs/:orgId/tests/:testId/questions/order` | reorder (`{ids}`, every question once) |
| `POST /api/orgs/:orgId/tests/:testId/publish`, `/unpublish` | publish (notifies students) or back to draft |
| `GET /api/orgs/:orgId/tests/:testId/monitor` | the live monitor rows and server time |
| `GET /api/orgs/:orgId/tests/:testId/attempts/:attemptId/events` | an attempt's events |
| `POST /api/orgs/:orgId/tests/:testId/students/:studentId/extra-time` | `{minutes}` 1–120 |
| `POST /api/orgs/:orgId/tests/:testId/students/:studentId/extra-attempt` | one more attempt |
| `POST /api/orgs/:orgId/tests/:testId/attempts/:attemptId/submit` | submit for the student |
| `POST /api/orgs/:orgId/tests/:testId/attempts/:attemptId/allow-device` | let the attempt continue elsewhere |
| `POST /api/orgs/:orgId/tests/:testId/close` | end now; submits and marks open attempts |
| `POST /api/orgs/:orgId/tests/:testId/new-code` | a new start code |
| `GET /api/orgs/:orgId/tests/:testId/results` | attempts of every student |
| `GET /api/orgs/:orgId/tests/:testId/attempts/:attemptId` | one attempt with answers, keys and marks |
| `PATCH /api/orgs/:orgId/tests/:testId/attempts/:attemptId/answers/:questionId` | `{points, feedback}`; `null` points removes the teacher's mark |
| `POST /api/orgs/:orgId/tests/:testId/release` | release results (manual setting) |

Students (student session + CSRF):

| Method and path | What |
|---|---|
| `GET /api/student/tests` | the student's tests with attempts used, allowed, in progress, best visible score |
| `GET /api/student/tests/:testId` | one test and the student's attempts |
| `POST /api/student/tests/:testId/start` | `{code?}`; starts or resumes; 60 per 15 minutes |
| `GET /api/student/attempts/:attemptId` | the attempt: questions in its order, saved answers, deadline, server time |
| `PUT /api/student/attempts/:attemptId/answers/:questionId` | `{answer}`; `null` clears it; 3,000 an hour |
| `POST /api/student/attempts/:attemptId/heartbeat` | keeps the monitor current; returns the deadline; 1,200 an hour |
| `POST /api/student/attempts/:attemptId/events` | `{kind: left_page, returned, paste, offline, online; seconds?; length?}`; 1,200 an hour |
| `POST /api/student/attempts/:attemptId/submit` | submit |
| `GET /api/student/attempts/:attemptId/result` | the review, when results are visible |

The limits on the student routes count **per student** (per account), not per address, so a whole grade
can sit a test from one school network; they are shared by every app instance. The flood guard in front
of every API request also lets many signed-in students share one address and holds each account to
600 requests a minute (docs/STUDENT_ACCOUNTS.md §9). A load test of one exam with 100 and 300 students
on one address is in docs/TEST_REPORT.md §5 (`scripts/load-exam.mjs`).

Error codes: `TEST_EMPTY`, `TEST_ALREADY_CLOSED`, `TEST_STARTED`, `TEST_NOT_OPEN`, `CLOSES_BEFORE_OPENS`,
`TOO_MANY_QUESTIONS`, `QUESTION_INVALID`, `ANSWER_INVALID`, `WRONG_START_CODE`, `NO_START_CODE`,
`NO_ATTEMPTS_LEFT`, `TOO_MANY_ATTEMPTS`, `OTHER_DEVICE`, `TIME_UP`, `ATTEMPT_SUBMITTED`,
`ATTEMPT_IN_PROGRESS`, `POINTS_ABOVE_TOTAL`, `RESULTS_AUTOMATIC`, `RESULTS_NOT_YET`, `CLASS_ARCHIVED`.
Each has an English and an Arabic message in the interface.

## 9. What the monitor sees, and what it does not

The test page reports only what a browser tells any web page, and the student is told so in the page
before and during the test:

- when the attempt starts, resumes, and is submitted, and how many questions are answered;
- when the test page is hidden (another tab, window or app) and for how many seconds;
- pasting into the test, with the **length** of the pasted text only, never the text;
- losing and regaining the connection;
- the attempt being opened in another browser session.

There is **no camera, microphone, screen recording, keystroke logging, or browser lock-down**. These
signals are hints for a teacher who is in the room or knows the class, not proof: a second device or a
book cannot be seen, and a page can be hidden for innocent reasons. The pages say this, and nothing is
decided automatically from them.

## 10. Notifications, audit, worker

- In-app notifications in each student's language: a test is published; results are released.
- Audit entries: `test.created`, `test.updated`, `test.deleted`, `test.published`, `test.unpublished`,
  `test.extra_time`, `test.extra_attempt`, `test.forced_submit`, `test.device_allowed`, `test.closed`,
  `test.marked`, `test.results_released`.
- The worker (`runTestDeadlines`, every pass) submits attempts more than 15 seconds past their deadline
  and marks submitted attempts that were not marked.

## 11. Privacy

Marks and monitoring events are personal data of children. Before a school enters real students' marks,
the school (as controller) needs legal advice on Egypt's Personal Data Protection Law; its executive
regulations' grace period ends around 1 November 2026. Platform administrators get no automatic access:
support access is as for the rest of a school's data (docs/SECURITY_DESIGN.md). Attempts, answers and
events are deleted with the test, the class, or the student, and by the school's own retention periods
(docs/CLASSROOM.md §11): monitoring events and answers can each be kept for a shorter time than marks.
Nothing is deleted until the school sets a period, and owners and admins are told at least 14 days before.

## 12. Not done yet

- The **gradebook** (docs/CLASSROOM.md §10) shows each student's best marked attempt next to their
  homework; the user guides (English and Arabic) describe these pages.
- No question bank or import, no images or formulas in questions, no partial credit on short answers.
- AI suggestions are not yet checked against the real Gemini API (no key in the development environment, §14).
- No parent accounts, email or SMS to students.

## 13. Tests

- `tests/unit/test-marking.test.ts` (5): answer normalising in Arabic and English; question and answer
  checks; automatic marks for every type, including negative marking floors; deadlines with the closing
  time and extra minutes; shuffles and start codes.
- `tests/integration/online-tests.test.ts` (8): writing and publishing (subject teachers only,
  notifications); taking with keys hidden and marking, and a teacher of another subject who sees no keys
  and cannot mark; the start code, attempts and a retake; time kept by the server and the worker; a new
  closing time moving running attempts, and results and answers waiting for a classmate's extra time;
  the monitor, one device, closing early and reopening; settings fixed after a start and manual release;
  **row-level security for another student with unfiltered queries**.
- `tests/integration/authz-coverage.test.ts` covers every new route (anonymous 401, other school 404,
  students refused on staff routes and staff on student routes).
- `tests/e2e/journeys.spec.ts`, journey 21: a teacher writes a test with a start code and three questions
  and publishes it; the student starts from Today (a wrong code first), answers, leaves the page and
  pastes; the monitor shows it; extra time; the student submits; the teacher closes, opens the results,
  marks the written answer, and the student sees 5.5 / 6 and the comment.
- `tests/integration/school-network-limits.test.ts` (2): 65 students of one school start and send
  heartbeats from one address (the 61st was refused before), one student is still held to the start
  limit while a classmate is not; the flood guard counts per account and holds a forged cookie to its
  address.
- `tests/e2e/journeys.spec.ts`, journey 24: saves fail (503) while a student answers; the page says the
  answer is not saved and is trying again, submitting warns how many are waiting, and once the network
  is back the latest answer is the one stored.
- `scripts/load-exam.mjs`: the load test of one exam (TEST_REPORT §5).
- `tests/e2e/accessibility.spec.ts`: every test page and dialog for teachers and students in English,
  Arabic, dark and on a phone: 0 axe findings, 0 simulated screen-reader findings.

## 14. Questions suggested by AI

When the school has AI requests (docs/AI_LAYER.md: off for every school until a platform administrator gives it a
monthly allowance) and the server has an AI provider, the test page offers **Suggest questions with AI** to those
who can change the test (the subject's teachers and the school's admins), until a student starts.

- **The teacher gives** a topic (3–300 characters), optionally the lesson text (up to 12,000 characters), how many
  questions (1–10, and no more than the test has room for), the kinds, the difficulty and the language (Arabic or
  English).
- **What is sent** to the provider: that, the test's title and kind, the class's grade, the subject's names, and the
  titles of the subject's books in the class's curriculum scope. Nothing about the students: no names, answers,
  marks or work. The page asks teachers not to paste students' names or work.
- **The instructions** (`src/classroom/question-suggestions.ts`) ask for questions that keep to the lesson text when
  one is given, suit the grade, check one idea each and have one defensible answer, in Modern Standard Arabic with
  correct spelling or in simple English, with set rules per kind (3–4 choices with exactly one correct, plausible
  wrong choices, no "all of the above"; clear true-or-false statements; every accepted form of a short answer; a
  marking guide for written answers) and a short reason for the teacher.
- **The reply** is checked twice: against the reply schema (one more request if it does not match, AI_LAYER §3), then
  each question against the same rules as a question typed by hand (`questionProblem`). Questions that break them,
  or of kinds that were not asked for, are left out and counted (`dropped`).
- **Nothing is saved.** The page lists the suggestions with their answers and reasons; the teacher unticks the ones
  they do not want and **Add selected** adds the others through the normal question route, in order. They are then
  ordinary questions (no mark that AI wrote them). The reason is not kept.
- **Counting and errors:** one request of the school's monthly allowance per suggestion request, given back if the
  provider fails without answering; the page shows how many are left. Errors (`AI_BUSY`, `AI_UNAVAILABLE`,
  `AI_FAILED`, `AI_REFUSED`, `AI_REPLY_TOO_LONG`, `AI_INVALID_REPLY`, `FEATURE_NOT_IN_PLAN`, `TEST_STARTED`,
  `TOO_MANY_QUESTIONS`) are shown in the dialog, in Arabic in the Arabic interface.
- **Log:** each request is in `ai_requests` and the audit log as `ai.request` with feature `test_questions`, who asked,
  the outcome and tokens, never the text.

Tests: `tests/unit/question-suggestions.test.ts` (6: the instructions and task, the reply schema, each kind's
conversion, what is left out), `tests/integration/test-question-suggestions.test.ts` (6, against the Gemini simulator:
off without AI requests, what is sent and returned, nothing saved, only the subject's teachers and admins, not after a
start, the test's room for questions, request checks, errors and the request given back), E2E journey 25 (the
platform gives the school AI requests; the teacher asks, keeps two, edits one) and the accessibility audit of both
dialogs.
