# API documentation

Base URL: `APP_URL` (e.g. `https://app.example.com`). All bodies are JSON (`Content-Type:
application/json`); other content types are rejected with `415`.

## 1. Conventions

### Authentication
- **Web app (session):** `POST /api/auth/login` sets an `HttpOnly` cookie (`sid`, or `__Host-sid`
  over HTTPS). `GET /api/auth/me` returns `csrfToken`; send it as `X-CSRF-Token` on every
  `POST/PATCH/PUT/DELETE`. Requests with a foreign `Origin` are rejected.
- **Student accounts** (created by a school, `docs/STUDENT_ACCOUNTS.md`) sign in with
  `POST /api/auth/student-login` and get the same kind of session. They may call only the student
  portal routes, `GET /api/auth/me` and `POST /api/auth/logout`; every other route answers
  403 `STAFF_ONLY`.
- **Public API (`/api/v1`):** `Authorization: Bearer midad_live_…` (created in Organization settings
  → API keys; Professional plan and above). Read-only.

### Errors
```json
{ "error": { "code": "PLAN_LIMIT_REACHED", "message": "Your Free plan allows 1 content scope", "details": { "limit": "max_scopes", "max": 1, "used": 1 } } }
```
| Status | Typical codes |
| --- | --- |
| 400 | `VALIDATION_ERROR` (details: `[{path, message}]`), `BAD_REQUEST`, `INVALID_MATERIALS`, `ASSIGNEE_NOT_MEMBER`, `TOKEN_INVALID`, `INVALID_PASSWORD`, `CONFIRMATION_MISMATCH`, `IMPORT_INVALID`, `FILE_NOT_UTF8`, `CSV_INVALID` |
| 401 | `UNAUTHORIZED`, `INVALID_CREDENTIALS`, `MFA_REQUIRED`, `MFA_INVALID` |
| 402 | `PLAN_LIMIT_REACHED`, `FEATURE_NOT_IN_PLAN`, `STUDENTS_NOT_ENABLED` |
| 403 | `FORBIDDEN`, `CSRF_TOKEN_INVALID`, `CSRF_ORIGIN_MISMATCH`, `EMAIL_NOT_VERIFIED`, `ACCOUNT_SUSPENDED`, `ORG_SUSPENDED`, `MFA_REQUIRED_BY_ORG`, `MFA_ENROLLMENT_REQUIRED`, `SUPPORT_ACCESS_REQUIRED`, `STAFF_ONLY`, `STUDENT_PORTAL_OFF` |
| 404 | `NOT_FOUND` — also returned for resources of other organizations |
| 409 | `CONFLICT`, `SCOPE_NAME_TAKEN`, `ALREADY_MEMBER`, `PAYMENT_REQUIRED`, `USE_SCHEDULED_CHANGE`, `ALREADY_ON_PLAN`, `OWNS_ORGANIZATIONS`, `USERNAME_TAKEN` |
| 429 | `RATE_LIMITED` |
| 500 | `INTERNAL_ERROR` (with `requestId`) |

**Problems in an imported file.** The previews of the roster import and the catalogue sheet import list
each problem as `{line | row, code, params, message}`. `message` is English; `code` is stable and
`params` holds the values it mentions, for example
`{"line": 5, "code": "roster_username_repeats", "params": {"username": "ok.one", "line": 2}, "message": "username \"ok.one\" repeats line 2"}`.
The web interface shows Arabic from the code. Codes and English texts: `src/lib/import-problems.ts`.

### Rate limits
Global flood guard (when `RATE_LIMIT_ENABLED`, per app instance): 600 requests/min per IP; requests
carrying a session cookie 6,000/min per IP (a school's students share one address) and 600/min per
signed-in account (or per IP when the cookie is not a valid session). Login 10/15 min per IP+email;
student sign-in 10/15 min per IP+school+username. Per student, whatever address they share: starting
a test 60/15 min, saving answers 3,000/h, heartbeats and page events 1,200/h each, saving homework
600/h, handing in and uploading 120/h each, changing their password 10/15 min. Student creation and
password resets 120/h; roster imports 30/h; register
10/h/IP; password-reset and resend-verification 5/h per IP+email; MFA verify 10/15 min; invitations
30/h; checkout 20/h; public API 120/min/IP plus the plan's monthly request quota. Route limits are
counted across all app instances; the global limit is counted per app instance.

## 2. Endpoints

### Health
| Method | Path | Notes |
| --- | --- | --- |
| GET | `/healthz` | Liveness, no dependencies |
| GET | `/readyz` | 200 when DB reachable and migrations current, else 503 |

### Authentication & account (`/api/auth`)
| Method | Path | Body / notes |
| --- | --- | --- |
| POST | `/register` | `{name, email, password, organizationName, locale?}` → `201 {status:"verification_sent"}`; or `{name, email, password, inviteToken}` → `201 {status:"joined", orgId}` (signed in) |
| POST | `/verify-email` | `{token}` |
| POST | `/resend-verification` | `{email}` → `202` always |
| POST | `/login` | `{email, password}` → `{mfaRequired, user}` + cookie (staff accounts) |
| POST | `/student-login` | `{school, username, password}` → `{mfaRequired:false, user}` + cookie (student accounts; `school` is the organization slug). 403 `STUDENT_PORTAL_OFF` when the school has no student accounts on its plan |
| POST | `/mfa/verify` | `{code}` or `{recoveryCode}` (pending-MFA session) |
| POST | `/logout` · `/logout-others` | — |
| GET | `/me` | user (with `kind`: `staff` or `student`), organizations + roles, `csrfToken`, unread notifications; `{mfaPending:true}` during MFA. For a student: `organizations: []` and `student {username, grade, school {id, name, code, locale}}` |
| POST | `/password/forgot` · `/password/reset` · `/password/change` | `{email}` · `{token,password}` · `{currentPassword,newPassword}` |
| PATCH | `/profile` | `{name?, locale?, catalogEmails?: boolean, assignmentEmails?: boolean, assignmentEmailFrequency?: 'instant' \| 'daily', dueReminderEmails?: boolean}` (catalogue update emails; emails when books are assigned to you, right away or in one summary each morning; reminder emails for your books due soon or overdue; in-app notifications are always created). Turning assignment emails off or back to `instant` drops the books waiting for the next summary |
| GET / DELETE | `/sessions` · `/sessions/:id` | list / revoke own sessions |
| POST | `/mfa/setup` · `/mfa/enable` · `/mfa/disable` · `/mfa/recovery-codes` | setup returns `{secret, otpauthUrl, qrSvg}`; enable `{code}` → `{recoveryCodes}` |
| GET | `/account/export` | personal data as JSON |
| DELETE | `/account` | `{password}`; 409 `OWNS_ORGANIZATIONS` if the user owns orgs |

### Invitations (token holder)
| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/invitations/:token` | `{email, role, orgName, inviterName, expiresAt, hasAccount}` |
| POST | `/api/invitations/accept` | `{token}`; signed-in user's email must match |

### Notifications
`GET /api/notifications` · `POST /api/notifications/read` `{ids?}`

### My assignments in all organizations
`GET /api/assignments?show=open|done|all` (signed-in staff; students get `403 STAFF_ONLY`): the signed-in member's books in every organization they belong to, in one list.
- **Response:** `{items, counts: {open, overdue, dueSoon}, organizations: [{id, name, open, overdue, dueSoon}], unavailable: [{id, name, reason}]}`.
  - Each item is an item of `/api/orgs/:orgId/assignments` plus `orgId` and `orgName`.
  - Order: done last, then by due date (none last), then organization, scope, grade and title. At most 2,000 items.
- **How each organization is read:** in its own tenant context, through the same checks as its own page. A suspended organization (`ORG_SUSPENDED`), or one that requires two-factor sign-in for this member's role (`MFA_REQUIRED_BY_ORG`), is listed in `unavailable` and not read.
- **Changing a status:** use the organization's own route, `PATCH /api/orgs/:orgId/scopes/:scopeId/items/:materialId`.

### Catalogue
| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/catalog/versions` | published + archived versions |
| GET | `/api/catalog/versions/:id` | full tree; `ETag` / `If-None-Match` → 304. Each subject and material has `verification`: `null` or `{status: "verified"\|"needs_review", source, url, note, reviewedAt}`; `counts.verification` gives coverage. The reviewer is not included |

Tree shape:
```json
{
  "version": { "id": "…", "academicYear": "2026/2027", "label": "…", "status": "published", "notice": "…", "gradeNotes": { "10": "…" } },
  "grades": [{ "grade": 1, "nameEn": "Primary 1", "nameAr": "الصف الأول الابتدائي" }],
  "sources": [{ "id": "…", "title": "…", "url": "https://…" }],
  "subjects": [{ "id": "…", "grade": 1, "track": "moe", "block": "…", "code": "ar", "nameEn": "Arabic Language", "nameAr": "اللغة العربية",
                 "status": "scored", "note": "…", "materials": [{ "id": "…", "kind": "moe", "title": "Ministry textbook (Term 1 & Term 2)" }] }],
  "counts": { "subjects": 231, "materials": 1038 }
}
```
`track`: `moe | sec | bac | ta | intl`; `status`: `scored | pass | act`; `kind`: `moe | lang | ext | prog | exam`.

### Organizations (`/api/orgs`) — membership required; minimum role in brackets
| Method | Path | Role | Notes |
| --- | --- | --- | --- |
| POST | `/api/orgs` | user | `{name}` → new org (owner); trial only for a user's first org |
| GET / PATCH / DELETE | `/:orgId` | viewer / admin / owner | details + plan + usage + `myAssignments {open, overdue, dueSoon}` (not done; past due; due today or in the next 2 days, by Cairo's date) · `{name?, locale?, requireMfaForAdmins?}` · `{password, confirmName}` |
| GET | `/:orgId/members` | viewer | |
| PATCH / DELETE | `/:orgId/members/:userId` | admin | `{role}` · remove (members may remove themselves) |
| POST | `/:orgId/transfer-ownership` | owner | `{userId, password}` |
| GET / POST | `/:orgId/invitations` | admin | `{email, role}` (admin role needs owner) |
| POST / DELETE | `/:orgId/invitations/:id/resend` · `/:orgId/invitations/:id` | admin | |
| GET | `/:orgId/audit-logs?action=&before=&limit=` | admin | cursor pagination by `before` |
| GET / POST / DELETE | `/:orgId/support-access[/:id]` | owner | `{reason, hours 1–72}` |
| GET / POST / DELETE | `/:orgId/api-keys[/:id]` | admin | POST returns the key once |
| GET / POST | `/:orgId/webhooks` | admin | Endpoints told about scope changes (§5). GET → `{webhooks:[{id, url, description, events, secretPrefix, enabled, disabledReason, consecutiveFailures, createdAt, lastDelivery}], events, max}`. POST `{url, description?, events[]}` → `201 {webhook, secret}` (secret shown once); needs API access on the plan (`402 FEATURE_NOT_IN_PLAN`), at most 5 (`409 WEBHOOK_LIMIT`), `400 INVALID_WEBHOOK_URL` for a URL that is not https or not public |
| PATCH / DELETE | `/:orgId/webhooks/:id` | admin | `{url?, description?, events?, enabled?}` (switching on resets the failure count) · delete |
| POST | `/:orgId/webhooks/:id/rotate-secret` | admin | → `{webhook, secret}` (new secret shown once; requests are signed with it from then on) |
| POST | `/:orgId/webhooks/:id/test` | admin | Sends a `ping` at once → `{delivery: {id, status, statusCode, error}}`; not retried; 10 a minute |
| GET | `/:orgId/webhooks/:id/deliveries` | admin | Last 50: `{deliveries:[{id, eventId, eventType, status, attempts, statusCode, error, createdAt, deliveredAt, nextAttemptAt, payload}], total, keptDays, exportMax}` (`total` counts every kept delivery) |
| GET | `/:orgId/webhooks/:id/deliveries/export` | admin | Every kept delivery, newest first, at most 10,000, as CSV (`webhook-deliveries-<host>-<date>.csv`); see "Delivery history download" below. Audited (`webhook.deliveries_exported`); 10 per minute |
| POST | `/:orgId/webhooks/:id/deliveries/:deliveryId/redeliver` | admin | Queues the same event again (same event id) → `202`; `409 DELIVERY_PENDING` while it is still being sent |
| GET | `/:orgId/students` | admin | `{enabled, limit, used, schoolCode, grades, students[]}` |
| POST | `/:orgId/students` | admin | `{username, name, grade, scopeId?}` → `201 {student, password}` (password shown once); 402 `STUDENTS_NOT_ENABLED` / `PLAN_LIMIT_REACHED` |
| POST | `/:orgId/students/import` | admin | `{csv, apply}`: preview `{rows, errors, limit, used}`, one error per problem `{line, code, params, message}` (see "Problems in an imported file" below); apply (all or nothing) → `{created[] with passwords, schoolCode}`; `400 FILE_NOT_UTF8` / `CSV_INVALID` for a file that cannot be read |
| PATCH / DELETE | `/:orgId/students/:userId` | admin | `{name?, grade?, scopeId? (null clears)}` · delete the account |
| POST | `/:orgId/students/:userId/reset-password` | admin | → `{password}`; ends the student's sessions and lifts a lockout |

### Student portal (`/api/student`) — student session only; 404 for staff
| Method | Path | Notes |
| --- | --- | --- |
| GET | `/curriculum` | `{school {name}, scope {id, name, academicYear} \| null, grade {grade, nameEn, nameAr}, subjects[{id, track, block, nameEn, nameAr, status, materials[{id, kind, title}]}]}`: the student's grade, only the books selected in the assigned scope |
| PATCH | `/profile` | `{locale}` |
| POST | `/password` | `{currentPassword, newPassword}`; ends the student's other sessions |
| GET | `/home` | Today: `{school, student, classes, todo, missed, returned}` (docs/CLASSROOM.md) |
| GET | `/homework?show=todo\|done\|all` · `/homework/:homeworkId` | Homework of the student's classes, with their own work; a mark only once returned |
| PUT · POST · POST | `/homework/:id/submission` · `/homework/:id/hand-in` · `/homework/:id/take-back` | `{body}` draft · hand in (`late` if after the due time) · back to a draft until returned |
| POST · DELETE | `/homework/:id/files` · `/homework/:id/files/:fileId` | Raw photo or PDF body, name in `X-File-Name`; type checked from the bytes; 5 MB, 5 files. Answers `{file: {id, name, contentType, size, status: "pending"}}` |
| GET | `/files/:fileId` | A file the student may see (sandboxed; PDFs download), once the worker has checked it; otherwise 409 `FILE_CHECKING`, `FILE_INFECTED` or `FILE_UNREADABLE` |
| GET · POST | `/notifications` · `/notifications/read` | The portal's notifications (new and returned homework, new tests, released results) |
| GET | `/tests` · `/tests/:testId` | Published tests of the student's classes with attempts used and allowed; a score only when the results setting allows (docs/ONLINE_TESTS.md) |
| POST | `/tests/:testId/start` | `{code?}`: starts an attempt or resumes the open one; `WRONG_START_CODE`, `NO_ATTEMPTS_LEFT`, `TEST_NOT_OPEN`, `OTHER_DEVICE` |
| GET · PUT | `/attempts/:attemptId` · `/attempts/:attemptId/answers/:questionId` | The attempt (questions in its order, saved answers, deadline, server time; never keys) · save `{answer}` (`null` clears); `TIME_UP` after the deadline |
| POST | `/attempts/:attemptId/heartbeat` · `/events` · `/submit` | Keeps the teacher's monitor current · `{kind: left_page\|returned\|paste\|offline\|online, seconds?, length?}` · submit |
| GET | `/attempts/:attemptId/result` | The review once results are visible; correct answers only when the teacher shows them and the test is over |
| GET | `/grades` | My grades: per class and subject, the student's own homework marks (once returned) and test scores (once shown), average and missing count (docs/CLASSROOM.md §10) |

### Classes and homework (`/api/orgs/:orgId/…`) — teachers are members added to a class; others get 404
Full list and rules in docs/CLASSROOM.md §7. In short: `classes` (list: admins all, teachers their own;
create, edit, archive, delete: admin), `classes/:classId/students` (PUT the list: admin),
`classes/:classId/teachers` (admin), `classes/:classId/homework` (POST: the subject's teacher or an admin),
`homework/:homeworkId` (GET with the roster; PATCH, DELETE), `homework/:homeworkId/files`,
`homework/:homeworkId/submissions/:studentId` (GET the work; PATCH `{points?, feedback?, return?}`),
`homework/:homeworkId/return` (`{studentIds}`), `files/:fileId`.
Files in every listing carry `status` (`pending` while the worker checks them, `ready`, or `infected` /
`unreadable` once deleted) and `uploadedSize` (the size as uploaded when a photo was made smaller); a
file opens only when `ready` (docs/CLASSROOM.md §5).

### Online tests and exams (`/api/orgs/:orgId/…`) — same class rules; keys only to those who can change the test
Full list and rules in docs/ONLINE_TESTS.md §8. In short: `classes/:classId/tests` (POST: the subject's
teacher or an admin), `tests/:testId` (GET, PATCH, DELETE), `tests/:testId/questions` (POST; PATCH,
DELETE one; PUT `order`; until a student starts), `tests/:testId/publish` · `unpublish`,
`tests/:testId/monitor`, `tests/:testId/attempts/:attemptId/events`,
`tests/:testId/students/:studentId/extra-time` (`{minutes}`) · `extra-attempt`,
`tests/:testId/attempts/:attemptId/submit` · `allow-device`, `tests/:testId/close` · `new-code`,
`tests/:testId/results`, `tests/:testId/attempts/:attemptId` (GET; PATCH `answers/:questionId`
`{points?, feedback?}`), `tests/:testId/release`, and `tests/:testId/suggest-questions` (POST
`{topic, lessonText?, count?, types, difficulty?, language}`: questions suggested by AI, returned as
`{suggestions: [{type, prompt, options, points, key, explanation}], dropped, model}` and never saved; the
subject's teachers and admins until a student starts; uses one of the school's AI requests; 30 an hour;
ONLINE_TESTS.md §14). `GET tests/:testId` returns `ai: {left}` (null: no monthly cap) to those who can change
the test when the school has AI requests, else `ai: null`.

### Gradebook (`/api/orgs/:orgId/classes/:classId/gradebook`) — any teacher of the class and admins
`?subject=<English subject name>&format=json|csv`: the class's homework with marks and published tests as
columns, one row per student with each cell's status and points, average and missing count; `format=csv`
downloads it in the member's language (formula-guarded) and is audited (`class.gradebook_exported`).

### Keeping classroom data (`/api/orgs/:orgId/classroom-retention`) — owners and admins
Rules in docs/CLASSROOM.md §11. `GET`: `{periods:{monitoringDays, workDays, recordsDays}, updatedAt, updatedBy,
noticeDays, upcoming:[{noticeId, kind, id, title, classId, className, subjectEn, subjectAr, date, stage,
deleteAfter, notifiedAt}], held:[…]}`. `POST …/preview` with the periods: `{homework, tests, counts, deleteFrom}`
(what saving would announce now). `PUT` with the periods (each 1–3,650 days or `null` to keep): saves,
drops notices no longer covered, announces what is now within 14 days to owners and admins, returns the
`GET` body and `noticesSent`; work and monitoring longer than records: `400 RETENTION_ORDER`. `PUT …/hold`
`{kind: "homework"|"test", id, keep}`: keeps one item whatever the periods say, or lets them apply again
(`404` for another school's item). Audited as `classroom.retention_updated`, `classroom.retention_hold`
and, by the worker, `classroom.retention_applied`.

### Scopes
| Method | Path | Role | Notes |
| --- | --- | --- | --- |
| GET | `/api/orgs/:orgId/scopes` | viewer | `{scopes:[…, itemCount, readOnly, notes, assigned, assignedToMe], limit}` |
| POST | `/api/orgs/:orgId/scopes` | editor | `{name, description?, catalogVersionId}` |
| GET / PATCH / DELETE | `/api/orgs/:orgId/scopes/:scopeId` | viewer / editor / editor | GET returns `materialIds` and `annotations:[{materialId, note, assigneeId, assigneeName, annotatedAt, annotatedBy}]` (selected books with a note or an assignee) |
| PATCH | `/api/orgs/:orgId/scopes/:scopeId/items/:materialId` | editor (status: also the assignee, any role) | `{note?: string ≤500 \| null, assigneeId?: uuid \| null, status?: "todo"\|"in_progress"\|"done" \| null, dueOn?: "YYYY-MM-DD" (2000–2100) \| null}` (at least one; `""` clears the note) → `{annotation}`. A member who is not an editor may change only the `status` of a book assigned to them (`403` otherwise). The book must be selected (`404`); the assignee must be a member of the organization (`400 ASSIGNEE_NOT_MEMBER`); read-only scopes `402`. A new assignee other than yourself gets an in-app notification. Audited as `scope.item_annotated` (which fields changed, not the note's text) |
| POST | `/api/orgs/:orgId/scopes/:scopeId/items/assign` | editor | `{materialIds: uuid[1–2000], assigneeId?: uuid \| null, status?: … \| null, dueOn?: date \| null}` (at least one field) → `{updated}`; fields left out stay as they are, notes are never touched; every book must be selected, or nothing changes (`400 INVALID_MATERIALS`); a new assignee gets one notification and one email with the count. Audited as `scope.items_assigned` (with an assignee) or `scope.items_tracked` |
| GET | `/api/orgs/:orgId/assignments?show=open\|done\|all` | viewer | Books assigned to the signed-in member across the organization's scopes (default `open`: not done): `{items:[{scopeId, scopeName, academicYear, materialId, title, kind, grade, subjectEn, subjectAr, note, status, dueOn, overdue, readOnly, annotatedAt, annotatedBy}], canEditAll}`, overdue first, then by due date (none last). "Overdue" uses the date in Cairo |
| POST | `/api/orgs/:orgId/scopes/:scopeId/items` | editor | `{add?: uuid[≤2000], remove?: uuid[≤2000]}` → `{itemCount}` |
| DELETE | `/api/orgs/:orgId/scopes/:scopeId/items` | editor | clear |
| POST | `/api/orgs/:orgId/scopes/:scopeId/duplicate` | editor | `{name}`; the copy keeps notes and assignees |
| GET | `/api/orgs/:orgId/scopes/compare?a=<scopeId>&b=<scopeId>[&format=csv]` | viewer | Two scopes of the organization side by side: `{a, b, sameVersion, subjects:[{grade, track, block, code, nameEn, nameAr, onlyIn?, materials:[{title, kind, side: "a"\|"b"\|"both", aId, bId, titleInB?, notInOtherCatalog?}]}], summary:{onlyA, onlyB, both}}`; across catalogue versions books are matched by subject and title. `400` when `a` equals `b`; `404` for a scope of another organization. `format=csv` downloads it (needs CSV export: `402 FEATURE_NOT_IN_PLAN`; counted as an export; audited as `scope.comparison_exported`) |
| GET | `/api/orgs/:orgId/scopes/:scopeId/carry-forward?to=<versionId>` | viewer | Preview of carrying the scope to another **published** version: `{scope, from, to, suggestedName, plan:{subjects:[{source, target\|null, changes:[{field, from, to}], carried:[{fromId, toId, title, kind, renamedFrom?}], missing:[{fromId, title, kind}], added:[{id, title, kind}]}], summary}}`; `400` for the scope's own or an unpublished version. `notes:{carried, lost}`: notes and assignees that follow their books, and those on books that cannot be carried |
| POST | `/api/orgs/:orgId/scopes/:scopeId/carry-forward` | editor | `{targetVersionId, mode?: "copy"\|"move", name?, add?: uuid[], skip?: uuid[]}`. `copy` (default) → `201`, new scope in the target version (`402 PLAN_LIMIT_REACHED` at the scope limit, `409 SCOPE_NAME_TAKEN`); `move` → `200`, the scope switches version and its items are replaced (refused for read-only scopes). `add` must be materials of the target version (`400 INVALID_MATERIALS`); `skip` leaves carried items out. Notes and assignees follow carried books (`notesCarried` in the response). Audited as `scope.carried_forward` |
| GET | `/api/orgs/:orgId/scopes/:scopeId/export?format=txt\|csv\|json` | viewer | attachment; counts toward monthly exports; CSV/JSON need Starter+. CSV ends with `note`, `assignee`, `status`, `due_on` columns, JSON items carry `note`, `assignee`, `status`, `dueOn` (also in `GET /api/v1/scopes/:id`); TXT keeps the original layout |

Example:
```bash
curl -b cookies.txt -H "X-CSRF-Token: $CSRF" -H 'Content-Type: application/json' \
  -d '{"add":["2f0c…","9b1e…"]}' https://app.example.com/api/orgs/$ORG/scopes/$SCOPE/items
# → {"itemCount": 42}
```

### Billing
| Method | Path | Role | Notes |
| --- | --- | --- | --- |
| GET | `/api/billing/plans` | public | plans + provider + `salesEmail` |
| GET | `/api/orgs/:orgId/billing` | admin | subscription, limits, usage, invoices, payments |
| POST | `/api/orgs/:orgId/billing/checkout` | owner | `{planId, interval}` → `{status:"checkout", checkoutUrl, invoiceId}` or `{status:"applied"}` |
| POST | `/api/orgs/:orgId/billing/invoices/:invoiceId/checkout` | owner | pay an open invoice |
| POST | `/api/orgs/:orgId/billing/change` | owner | scheduled downgrade/interval change |
| POST | `/api/orgs/:orgId/billing/cancel` · `/resume` | owner | |
| POST | `/api/billing/webhooks/:provider` | provider | raw JSON, signature required (see §4) |
| GET / POST | `/api/billing/sandbox/checkout` · `/complete` | signed link | **development/test only** |

### Platform administration (`/api/admin`) — platform admin with MFA-verified session; 404 for everyone else
`GET /overview`, `GET /health`, `GET /orgs?q=&status=`, `GET /orgs/:orgId`, `POST /orgs/:orgId/suspend {reason}`,
`POST /orgs/:orgId/unsuspend`, `PATCH /orgs/:orgId/subscription {planId?, status?, interval?, currentPeriodEnd?, trialEndsAt?, limitOverrides?}`,
`POST /orgs/:orgId/invoices {planId, interval, amountCents, periodStart?, markPaid}`, `POST /invoices/:id/mark-paid`,
`GET /users?q=`, `POST /users/:id/suspend|unsuspend|unlock`, `GET /audit-logs?orgId=&action=&actor=&before=`,
`GET /billing-events?status=`, `GET /plans`, `PATCH /plans/:id`,
`GET|POST /catalog/versions`, `GET|PATCH|DELETE /catalog/versions/:id`, `POST /catalog/versions/:id/publish|archive|subjects`
(publish and archive return `notifiedOrgs`: organizations told that their scopes are behind the newest catalogue),
`PATCH|DELETE /catalog/subjects/:id`, `POST /catalog/subjects/:id/materials`, `PATCH|DELETE /catalog/materials/:id`,
`POST /catalog/versions/:id/verification {subjectIds?, materialIds?, status: "verified"|"needs_review"|"unverified", source?, url?, note?}`
(draft or published versions; `409 VERSION_ARCHIVED` for archived ones; `verified` needs `source`, `needs_review` needs `note`;
every id must belong to the version; changes the catalogue ETag; audited as `admin.catalog_verification_set`),
`GET /catalog/versions/:id/sheet` (CSV download: one row per subject and material with ids, content and verification columns),
`POST /catalog/versions/:id/sheet {csv, apply?: boolean}` (up to 8 MB / 20,000 rows; `apply: false` returns `{plan: {changes, errors, warnings, summary}}`
and writes nothing; each error and warning is `{row, code, params, message}`, row 0 meaning the whole file; `apply: true` writes the whole file or nothing (`400 IMPORT_INVALID` with the errors); verification columns on drafts and
published versions, content and new materials on drafts only; `409 VERSION_ARCHIVED`; audited as `admin.catalog_imported`),
`GET /support/orgs/:orgId/scopes[/:scopeId]` (requires an active customer grant; audited),
`GET /alerts` (`{channels: {emails, emailTransport, webhook}, alerts: [...]}`: firing alerts and those resolved in the last 30 days),
`POST /alerts/test` (sends a test alert to every configured channel; returns `{result: {email, webhook}}`, each `sent`, `failed` or `off`; 5/h; audited as `admin.alert_test`),
`GET /ai` (AI assistance, docs/AI_LAYER.md: `{provider: {name, model, customEndpoint} | null, settings: {timeoutMs, maxOutputTokens}, period, schools: [{orgId, name, planName, limit, used, requests, ok, failed, inputTokens, outputTokens}]}`
for schools with an allowance or with use this month; `limit` null means no cap),
`POST /ai/test` (one small request to the configured provider, outside any school's allowance; returns `{provider, result}` with
`result.ok`, `finish`, `model`, `ms`, tokens and the reply, or `errorKind`, `status` and the provider's message; `503 AI_NOT_CONFIGURED`
without a provider; 10/h; audited as `admin.ai_tested`). A school's monthly AI allowance is `ai_requests_per_month` in `limitOverrides`
of `PATCH /orgs/:orgId/subscription` (0 on every plan; null for no cap); `GET /api/orgs/:orgId` and the billing endpoint report it in
`limits` and the month's use as `usage.ai_requests`.

## 3. Public API v1 (for customer integrations)

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/api/v1/scopes` | scopes of the key's organization |
| GET | `/api/v1/scopes/:scopeId` | JSON export: `{scope, catalogVersion, exportedAt, itemCount, items:[{grade, gradeEn, gradeAr, track, block, subjectCode, subjectEn, subjectAr, subjectStatus, materialId, materialKind, materialTitle, subjectVerification, subjectVerificationSource, subjectReviewedAt, materialVerification, materialVerificationSource, materialReviewedAt}]}` (CSV exports carry the same six verification columns) |
| GET | `/api/v1/catalog/versions` · `/api/v1/catalog/versions/:id` | catalogue |

```bash
curl -H "Authorization: Bearer midad_live_…" https://app.example.com/api/v1/scopes
```
Each call counts toward `api_requests_per_month`; over the quota → `402 PLAN_LIMIT_REACHED`.
A plan without API access → `402 FEATURE_NOT_IN_PLAN`. Revoked/unknown key → `401`.

## 4. Webhooks (provider → app)

**Paymob** (`/api/billing/webhooks/paymob`): "transaction processed" callback; `?hmac=` must equal
HMAC-SHA512 (key `PAYMOB_HMAC_SECRET`) of the concatenation of `amount_cents, created_at, currency,
error_occured, has_parent_transaction, id, integration_id, is_3d_secure, is_auth, is_capture,
is_refunded, is_standalone_payment, is_voided, order.id, owner, pending, source_data.pan,
source_data.sub_type, source_data.type, success`. `merchant_order_id` (our `special_reference`,
`<invoiceId>.<suffix>`) is not covered by the HMAC, so the invoice is resolved from `order.id`, which
is recorded per checkout attempt in `checkout_sessions`; a mismatch is audited as
`billing.reference_mismatch` and callbacks for unknown orders are ignored. The callback URL is sent
as the intention's `notification_url`. Contract-tested against a simulator; **not yet run against
Paymob** (`npm run paymob:check`).

**Sandbox** (`/api/billing/webhooks/sandbox`): header `X-Sandbox-Signature: t=<unix>,v1=<hex
HMAC-SHA256(SANDBOX_WEBHOOK_SECRET, "t.body")>`, 5-minute tolerance.

Responses: `200 {received:true, status}` processed/ignored; `200 {duplicate:true}` for a repeated
event id; `400` bad signature; `500` processing error (provider retries; the event is re-processed
because failed events are retryable).

## 5. Webhooks to your systems (app → customer)

An organization whose plan includes API access (Professional and above) can register up to 5 HTTPS
endpoints (Settings → Webhooks, or the routes above). Each is told about the scope changes it
subscribed to:

| Event | When |
| --- | --- |
| `scope.created` | A scope is created, duplicated, or carried forward as a copy |
| `scope.updated` | A scope is renamed or its description changes |
| `scope.deleted` | A scope is deleted |
| `scope.items_changed` | Books are added or removed, the scope is cleared, or it is moved to another catalogue year |
| `scope.items_annotated` | A book's note, assignee, status or due date changes (one book or several at once). `data.materialIds` lists the books changed |
| `ping` | A test from Settings or `POST …/test` |

The payload carries the scope's state, not its books, and never a note's text or a member's name:
fetch them with `GET /api/v1/scopes/:scopeId` (each item has `note`, `assignee`, `status` and `dueOn`).
Endpoints subscribe to `scope.items_annotated` explicitly; endpoints created before it existed do
not receive it until it is ticked in Settings.

```http
POST /your/endpoint HTTP/1.1
Content-Type: application/json
User-Agent: Midad-Webhooks/1
X-Midad-Event: scope.items_changed
X-Midad-Delivery: 2b0c…            (this attempt's delivery id)
X-Midad-Signature: t=1793001600,v1=5f2c…

{"id":"8d1e…","type":"scope.items_changed","createdAt":"2026-10-25T12:00:00.000Z","organizationId":"…",
 "data":{"scope":{"id":"…","name":"Grade 6 books","catalogVersionId":"…","academicYear":"2026/2027","itemCount":5,"updatedAt":"…"}}}
```

`scope.deleted` carries `data.scope = {id, name}` only. `id` is the event id: a redelivery repeats it,
so use it to ignore duplicates.

**Check the signature** before trusting a request. `v1` is the hex HMAC-SHA256, keyed with the
endpoint's secret (`whsec_…`), of `"<t>.<raw body>"`. Reject old timestamps (for example more than
5 minutes):

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

function verify(rawBody, header, secret, toleranceSeconds = 300) {
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header ?? '');
  if (!m) return false;
  const [, t, v1] = m;
  if (Math.abs(Date.now() / 1000 - Number(t)) > toleranceSeconds) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest();
  return timingSafeEqual(expected, Buffer.from(v1, 'hex'));
}
```

**Delivery.**
- **When:** events are queued in the transaction that changes the scope, and the worker sends them (every `WORKER_INTERVAL_MS`, 15 s by default).
- **Merging:** several `scope.updated`, `scope.items_changed` or `scope.items_annotated` events for one scope that are still waiting for their first attempt are merged into one, with the latest state; a merged `scope.items_annotated` lists every book changed meanwhile.
- **Order:** events may arrive out of order; use `createdAt` and the current state from the API.
- **Success:** any 2xx answer within 5 seconds. Redirects are not followed, and the response body is ignored.
- **Retries:** failures are retried after 1 min, 5 min, 30 min, 2 h, 6 h and 12 h (7 attempts, about 21 hours), then the delivery is marked failed.
- **Switching off:** an endpoint that fails 25 attempts in a row is switched off. Its organization's owners and admins get a notification, and it is audited as `webhook.disabled`. Switching it back on resumes the waiting deliveries.
- **History:** finished deliveries are kept for 30 days.

**Delivery history download** (`GET /:orgId/webhooks/:id/deliveries/export`): a UTF-8 CSV
with a byte-order mark, one row per delivery, newest first, at most 10,000 rows. Columns:
`created_at_utc, delivery_id, event_id, event, status, attempts, http_status, error,
delivered_at_utc, next_attempt_at_utc, scope_id, scope_name, payload`. Times are ISO 8601 in
UTC; `next_attempt_at_utc` is filled only while a delivery is pending; `payload` is the exact
JSON body sent (a redelivery has the same `event_id`). Cells that a spreadsheet would run as a
formula get a leading apostrophe. It is a delivery log, not a content export: it needs no plan
feature and does not count against the monthly exports, so it stays available after a
downgrade. The signing secret is never included.

**Targets.**
- Only `https://` URLs without credentials.
- Every address the host resolves to must be public. Private, loopback, link-local, CGNAT, documentation, multicast, NAT64 and 6to4 ranges are refused.
- The check runs in the connection's own DNS lookup, so the request goes to the address that was checked.
- `WEBHOOK_ALLOW_INSECURE_TARGETS=true` lifts these rules for local development and tests only; the configuration refuses it in production.
