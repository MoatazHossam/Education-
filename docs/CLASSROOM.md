# Classes and homework

Added 2026-10-26 at the owner's request: "a complete portal for teachers and students for daily
assignments … and online tests". This document covers the first part: **classes, teachers and daily
homework**. Online tests and exams with monitoring are the next part; a gradebook follows them
(§10). Everything is in English and Arabic.

It is built into the existing system: the same sign-in, sessions, schools, roles, student accounts
(`docs/STUDENT_ACCOUNTS.md`), audit log, notifications and row-level security. There is no second
application or user database.

## 1. Who does what

| Who | Can |
| --- | --- |
| School owner and admins | Create, edit, archive and delete classes; choose each class's students; add and remove teachers (a member and a subject); everything a teacher can do, in every class and subject |
| Teacher: any member of the school (viewer, editor…) added to a class for a subject | See **My classes** (only the classes they teach); set homework for their subjects, with instructions, books from the class's curriculum and worksheet files; see who handed in; open each student's work; mark it, comment and return it, alone or several at once |
| Student (school-created account) | **Today**: what is due (overdue first), what was missed, and work returned this week. **Homework**: all homework of their classes. Open one, write an answer, attach photos or PDFs, save a draft, hand in, take it back before it is marked, see the mark and comments once returned. **My books**: the curriculum, as before. Notifications for new and returned homework |
| Members who teach nothing | No classes (the page says an admin adds them) |
| Platform administrator | Turns student accounts on for a school (§2). No access to classes, homework or marks |

A teacher of one subject sees the class's other homework but can change and mark only their own
subjects' homework (`NOT_SUBJECT_TEACHER`).

## 2. Turning it on

Classes and homework come with student accounts: the same switch (the `max_students` limit, set by a
platform administrator per school, `docs/STUDENT_ACCOUNTS.md` §2) turns on both. No plan or price
changed; pricing is still a commercial decision.

Files count against a per-school storage limit, `max_storage_mb`. It is not set on any plan; when
absent it is **1024 MB**. A platform administrator can override it per school (`limitOverrides`).

When the switch is off, staff cannot create classes or set homework (`CLASSROOM_NOT_ENABLED`, 402);
existing classes, work and marks stay readable and markable. Students cannot sign in at all
(`STUDENT_PORTAL_OFF`), as before.

## 3. Classes and teachers

- A class has a name (unique among the school's active classes), a grade (1–12) and optionally a
  **curriculum**: one of the school's scopes. Its subjects are the grade's subjects in that scope's
  catalogue (or the newest published catalogue without a scope), each with the books the scope selected.
- Students are chosen per class (any grade; the class's grade is listed first). A student may be in
  several classes.
- A teacher row is a member and a subject (English and Arabic names, from the catalogue or typed).
  It is removed automatically when the member leaves the school.
- Archiving keeps homework and marks and stops new homework. Deleting a class deletes its homework,
  hand-ins, files and marks (the dialog says so and suggests archiving).

## 4. Homework

| Field | Notes |
| --- | --- |
| Subject | One the teacher teaches in the class (admins: any) |
| Title, instructions | Up to 200 and 5,000 characters |
| Books | Up to 10 books of that subject in the class's curriculum, copied (id, kind, title) so later catalogue edits do not change the homework |
| Students see it from | Now, or a later time: until then students do not see it (also in the database, §6) |
| Due | After the time it appears |
| Marks | The full mark (e.g. 10, up to two decimals), or none |
| Late work | Accepted and marked late (default), or refused after the due time |
| Files | Up to 5 worksheets (§5) |

A student's work goes through these states:

| State | The student | The teacher |
| --- | --- | --- |
| Not started | Sees it in **To do**; overdue after the due time | "Not handed in"; "Missing" after the due time |
| Draft | Writes and attaches files; nothing is shared yet | Still "Not handed in"; the draft's text and files stay private |
| Handed in | Sees when; can **take it back** to change it until it is marked and returned | Sees the text and files; "Late" if after the due time |
| Returned | Sees the mark and comments; nothing can change | Mark shown |

- The teacher can save a mark and comment without returning (the student does not see them yet),
  return one piece of work, or **return all marked work** at once.
- Work done on paper: the teacher can mark and return a student who handed nothing in online.
- Homework that does not accept late work closes at the due time: students can no longer hand in or
  take back, and see it under **Missed**.
- Lowering the full mark below a mark already given is refused (`POINTS_ABOVE_TOTAL`).

## 5. Files

- Photos and PDFs: JPEG, PNG, WebP, PDF. The browser sends the raw bytes; **the type is decided from
  the file's first bytes**, not from its name or the browser's claim (anything else: 415
  `FILE_TYPE_NOT_ALLOWED`). The stored name keeps the real extension ("notebook.jpg" that is a PNG
  becomes "notebook.png"); paths and control characters are removed.
- At most 5 MB per file (413 `FILE_TOO_LARGE`) and 5 files per homework or per hand-in
  (`TOO_MANY_FILES`); the school's storage limit applies (402 `STORAGE_LIMIT_REACHED`). Uploads are
  checked under the school's row lock, so two uploads cannot pass the limit together.
- Stored in PostgreSQL (`classroom_files.data`), so backups, school deletion and account deletion cover
  them. A SHA-256 of each file is kept.
- Served only after the same access checks as the homework: staff who may open the class, or the
  student it belongs to (a draft's files only to its student). Responses carry
  `Content-Security-Policy: default-src 'none'; … sandbox`, `X-Content-Type-Options: nosniff` and
  `Cache-Control: private, no-store`; images open in the browser, PDFs download.
- Not done: virus scanning, and image resizing (phone photos are kept as taken, up to 5 MB).

## 6. Data and row-level security

Migration `0013_classroom.ts`. All tables carry `org_id` and forced row-level security.

| Table | Holds |
| --- | --- |
| `classes` | name, grade, curriculum scope, archived time |
| `class_students` | class ↔ student (composite keys keep both in the same school) |
| `class_teachers` | class ↔ member, subject (English and Arabic); cascades from the membership |
| `homework` | the fields of §4, `notified_at` |
| `homework_submissions` | one per homework and student: text, state, handed-in time, late, mark, comments, who marked and when, returned time |
| `classroom_files` | name, type, size, SHA-256 and bytes; belongs to exactly one homework or one submission |

Student requests run in a new context, `withStudentContext`, which sets `app.current_student` as well
as the school. The policies then expose, **whatever the query asks for**: only the student's own
`students` row, their classes and the teachers of those classes, homework of their classes **once
published**, their own submissions, and files of those homework and submissions. Students cannot write
classes, enrolments or homework. Staff requests are unchanged (the whole school); which classes a
member may use is checked in the routes. An integration test runs unfiltered queries in a student
context to prove this.

The student data stored for a school now includes, besides name, username, grade and curriculum: class
membership, homework answers and files, marks and teachers' comments (see §9).

## 7. API

Staff (organization routes; CSRF as usual). "Teacher" means a member who teaches in the class; others
get 404 for the class and its homework.

| Method and path | Who | Purpose |
| --- | --- | --- |
| `GET /api/orgs/:orgId/classes[?archived=1]` | any member | `{ enabled, admin, grades, classes[] }`: all classes for admins, the member's own for teachers, with students, teachers and work waiting to be marked |
| `POST /api/orgs/:orgId/classes` | admin | `{ name, grade, scopeId? }` → 201 |
| `GET /api/orgs/:orgId/classes/:classId` | teacher, admin | Class, students, teachers, my subjects, the class's subjects with books, homework with counts |
| `PATCH /api/orgs/:orgId/classes/:classId` | admin | `{ name?, grade?, scopeId?, archived? }` |
| `DELETE /api/orgs/:orgId/classes/:classId` | admin | Deletes with homework, work and files |
| `PUT /api/orgs/:orgId/classes/:classId/students` | admin | `{ studentIds }` replaces the list |
| `POST /api/orgs/:orgId/classes/:classId/teachers` | admin | `{ userId, subjectEn, subjectAr }` |
| `DELETE /api/orgs/:orgId/classes/:classId/teachers/:teacherId` | admin | |
| `POST /api/orgs/:orgId/classes/:classId/homework` | subject teacher, admin | `{ subjectEn, subjectAr, title, instructions?, materialIds?, publishAt?, dueAt, maxPoints?, allowLate? }` → 201 |
| `GET /api/orgs/:orgId/homework/:homeworkId` | teacher, admin | Homework, files, `canEdit`, and the roster (one row per student: state, handed-in time, late, files, mark) |
| `PATCH`, `DELETE /api/orgs/:orgId/homework/:homeworkId` | subject teacher, admin | Edit (not the subject) or delete |
| `POST /api/orgs/:orgId/homework/:homeworkId/files` | subject teacher, admin | Raw body (photo or PDF), name in `X-File-Name` (URL-encoded) |
| `DELETE /api/orgs/:orgId/homework/:homeworkId/files/:fileId` | subject teacher, admin | |
| `GET /api/orgs/:orgId/homework/:homeworkId/submissions/:studentId` | teacher, admin | The student's work (empty while a draft), mark, comments |
| `PATCH /api/orgs/:orgId/homework/:homeworkId/submissions/:studentId` | subject teacher, admin | `{ points?, feedback?, return? }` |
| `POST /api/orgs/:orgId/homework/:homeworkId/return` | subject teacher, admin | `{ studentIds }`: returns those handed in or marked |
| `GET /api/orgs/:orgId/files/:fileId` | teacher, admin | The file (§5) |

`GET /api/orgs/:orgId` also returns `classroom { enabled, show, toMark }` for the navigation.

Students (student session; 404 for staff):

| Method and path | Purpose |
| --- | --- |
| `GET /api/student/home` | `{ school, student, classes, todo, missed, returned }` |
| `GET /api/student/homework?show=todo\|done\|all` | Homework with the student's state; a mark only once returned |
| `GET /api/student/homework/:homeworkId` | Homework, its files, the student's work (`assigned`, `draft`, `submitted`, `returned`), `closed` |
| `PUT /api/student/homework/:homeworkId/submission` | `{ body }`: saves the draft |
| `POST /api/student/homework/:homeworkId/hand-in` | `{ body? }` → `{ status, submittedAt, late }` |
| `POST /api/student/homework/:homeworkId/take-back` | Back to a draft (until returned; not after a closed due time) |
| `POST /api/student/homework/:homeworkId/files` | Raw body, as for staff; goes to the draft |
| `DELETE /api/student/homework/:homeworkId/files/:fileId` | From the draft |
| `GET /api/student/files/:fileId` | A file the student may see |
| `GET /api/student/notifications`, `POST /api/student/notifications/read` | The portal's notifications (`{ ids? }`) |

Errors: `CLASSROOM_NOT_ENABLED` (402), `CLASS_NAME_TAKEN`, `ALREADY_TEACHER` (409), `TEACHER_NOT_MEMBER`
(400), `NOT_SUBJECT_TEACHER` (403), `CLASS_ARCHIVED` (409), `DUE_BEFORE_PUBLISH`,
`INVALID_HOMEWORK_BOOKS` (400), `POINTS_ABOVE_TOTAL` (400/409), `HOMEWORK_HANDED_IN`,
`HOMEWORK_RETURNED`, `HOMEWORK_CLOSED`, `NOT_HANDED_IN`, `TOO_MANY_FILES` (409), `FILE_TOO_LARGE` (413),
`FILE_TYPE_NOT_ALLOWED` (415), `STORAGE_LIMIT_REACHED` (402). All have Arabic messages in the interface.

## 8. Notifications and audit

- Students get an in-app notification, in their language, when homework appears ("New homework: …",
  with subject and due time in Cairo time) and when work is returned (with the mark). Homework set for
  later is announced by the worker once its time comes (`runHomeworkAnnouncements`, every worker pass,
  once per homework). Students have no email address, so nothing is emailed.
- Audit log: `class.created`, `class.updated`, `class.deleted`, `class.students_changed` (counts),
  `class.teacher_added`, `class.teacher_removed`, `homework.created`, `homework.updated`,
  `homework.deleted`, `homework.marked`, `homework.returned`. Entries carry ids, titles and marks,
  never answers or comments.

## 9. Privacy

The system now stores children's school work and marks. This is personal data of minors under the
Egyptian Personal Data Protection Law (SECURITY_DESIGN §7), whose compliance grace period ends around
1 November 2026. **Get legal advice before real students' work and marks are entered**: lawful basis
and parental consent, the school as controller, retention (nothing is deleted automatically yet),
and the privacy notice. Marks are set only by teachers; nothing is marked by AI.

## 10. Not done yet

- **Online tests and exams** are built: see docs/ONLINE_TESTS.md (tests appear on the class page and
  on the student's Today and Tests pages).
- **Gradebook**: marks per class and subject, CSV export, a "My grades" page for students.
- The user guides (English and Arabic) get these pages with the gradebook.
- No email or SMS to students or parents; no parent accounts.
- No virus scanning or image resizing of uploads (§5); no retention rule for old homework.

## 11. Tests

- `tests/integration/classroom.test.ts` (7 tests): off until student accounts are on; classes,
  teachers and who sees what (admins all, teachers their own, other members none, other schools' students
  refused, a departing member stops teaching); the whole homework cycle (curriculum books only, subject
  teachers only, notifications in each student's language, private drafts, type checks from the bytes,
  file names, hand-in, the teacher's view and download headers, mark limits, return one and several,
  paper work, audit); late work, closed homework and taking work back; scheduled homework hidden until
  the worker announces it once; **row-level security in a student context with unfiltered queries**;
  file count, the storage limit and deleting a class.
- `tests/integration/authz-coverage.test.ts` and `students.test.ts` cover the new routes like every
  other: anonymous 401, another school 404, a student session refused on staff routes, staff refused on
  the portal routes.
- `tests/e2e/journeys.spec.ts`, journey 20: the school sets up a class (curriculum, students, teacher),
  sets homework with a book; the student sees it on Today with a notification, answers, attaches a photo
  (stored as PNG from its bytes) and hands in; the teacher sees "Classes (1 to mark)", opens the work with
  the photo, marks 9/10 with a comment and returns it; the student sees the mark and comment.
- `tests/e2e/accessibility.spec.ts`: 27 more screens (classes, class, homework, every dialog, the
  student's Today, homework list and homework in each state) in English, Arabic, dark and on a phone:
  0 axe findings, 0 simulated screen-reader findings.
