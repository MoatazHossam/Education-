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
- **Public API (`/api/v1`):** `Authorization: Bearer cs_live_…` (created in Organization settings
  → API keys; Professional plan and above). Read-only.

### Errors
```json
{ "error": { "code": "PLAN_LIMIT_REACHED", "message": "Your Free plan allows 1 content scope", "details": { "limit": "max_scopes", "max": 1, "used": 1 } } }
```
| Status | Typical codes |
| --- | --- |
| 400 | `VALIDATION_ERROR` (details: `[{path, message}]`), `BAD_REQUEST`, `INVALID_MATERIALS`, `ASSIGNEE_NOT_MEMBER`, `TOKEN_INVALID`, `INVALID_PASSWORD`, `CONFIRMATION_MISMATCH`, `IMPORT_INVALID` |
| 401 | `UNAUTHORIZED`, `INVALID_CREDENTIALS`, `MFA_REQUIRED`, `MFA_INVALID` |
| 402 | `PLAN_LIMIT_REACHED`, `FEATURE_NOT_IN_PLAN`, `STUDENTS_NOT_ENABLED` |
| 403 | `FORBIDDEN`, `CSRF_TOKEN_INVALID`, `CSRF_ORIGIN_MISMATCH`, `EMAIL_NOT_VERIFIED`, `ACCOUNT_SUSPENDED`, `ORG_SUSPENDED`, `MFA_REQUIRED_BY_ORG`, `MFA_ENROLLMENT_REQUIRED`, `SUPPORT_ACCESS_REQUIRED`, `STAFF_ONLY`, `STUDENT_PORTAL_OFF` |
| 404 | `NOT_FOUND` — also returned for resources of other organizations |
| 409 | `CONFLICT`, `SCOPE_NAME_TAKEN`, `ALREADY_MEMBER`, `PAYMENT_REQUIRED`, `USE_SCHEDULED_CHANGE`, `ALREADY_ON_PLAN`, `OWNS_ORGANIZATIONS`, `USERNAME_TAKEN` |
| 429 | `RATE_LIMITED` |
| 500 | `INTERNAL_ERROR` (with `requestId`) |

### Rate limits
Global 600 requests/min/IP (when `RATE_LIMIT_ENABLED`); login 10/15 min per IP+email; student
sign-in 10/15 min per IP+school+username; student creation and password resets 120/h; roster
imports 30/h; register
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
| PATCH | `/profile` | `{name?, locale?, catalogEmails?: boolean}` (catalogue update emails; in-app notifications are always created) |
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
| GET / PATCH / DELETE | `/:orgId` | viewer / admin / owner | details + plan + usage · `{name?, locale?, requireMfaForAdmins?}` · `{password, confirmName}` |
| GET | `/:orgId/members` | viewer | |
| PATCH / DELETE | `/:orgId/members/:userId` | admin | `{role}` · remove (members may remove themselves) |
| POST | `/:orgId/transfer-ownership` | owner | `{userId, password}` |
| GET / POST | `/:orgId/invitations` | admin | `{email, role}` (admin role needs owner) |
| POST / DELETE | `/:orgId/invitations/:id/resend` · `/:orgId/invitations/:id` | admin | |
| GET | `/:orgId/audit-logs?action=&before=&limit=` | admin | cursor pagination by `before` |
| GET / POST / DELETE | `/:orgId/support-access[/:id]` | owner | `{reason, hours 1–72}` |
| GET / POST / DELETE | `/:orgId/api-keys[/:id]` | admin | POST returns the key once |
| GET | `/:orgId/students` | admin | `{enabled, limit, used, schoolCode, grades, students[]}` |
| POST | `/:orgId/students` | admin | `{username, name, grade, scopeId?}` → `201 {student, password}` (password shown once); 402 `STUDENTS_NOT_ENABLED` / `PLAN_LIMIT_REACHED` |
| POST | `/:orgId/students/import` | admin | `{csv, apply}`: preview `{rows, errors, limit, used}`; apply (all or nothing) → `{created[] with passwords, schoolCode}` |
| PATCH / DELETE | `/:orgId/students/:userId` | admin | `{name?, grade?, scopeId? (null clears)}` · delete the account |
| POST | `/:orgId/students/:userId/reset-password` | admin | → `{password}`; ends the student's sessions and lifts a lockout |

### Student portal (`/api/student`) — student session only; 404 for staff
| Method | Path | Notes |
| --- | --- | --- |
| GET | `/curriculum` | `{school {name}, scope {id, name, academicYear} \| null, grade {grade, nameEn, nameAr}, subjects[{id, track, block, nameEn, nameAr, status, materials[{id, kind, title}]}]}`: the student's grade, only the books selected in the assigned scope |
| PATCH | `/profile` | `{locale}` |
| POST | `/password` | `{currentPassword, newPassword}`; ends the student's other sessions |

### Scopes
| Method | Path | Role | Notes |
| --- | --- | --- | --- |
| GET | `/api/orgs/:orgId/scopes` | viewer | `{scopes:[…, itemCount, readOnly, notes, assigned, assignedToMe], limit}` |
| POST | `/api/orgs/:orgId/scopes` | editor | `{name, description?, catalogVersionId}` |
| GET / PATCH / DELETE | `/api/orgs/:orgId/scopes/:scopeId` | viewer / editor / editor | GET returns `materialIds` and `annotations:[{materialId, note, assigneeId, assigneeName, annotatedAt, annotatedBy}]` (selected books with a note or an assignee) |
| PATCH | `/api/orgs/:orgId/scopes/:scopeId/items/:materialId` | editor | `{note?: string ≤500 \| null, assigneeId?: uuid \| null}` (at least one; `""` clears the note) → `{annotation}`. The book must be selected (`404`); the assignee must be a member of the organization (`400 ASSIGNEE_NOT_MEMBER`); read-only scopes `402`. A new assignee other than yourself gets an in-app notification. Audited as `scope.item_annotated` (which fields changed, not the note's text) |
| POST | `/api/orgs/:orgId/scopes/:scopeId/items/assign` | editor | `{materialIds: uuid[1–2000], assigneeId: uuid \| null}` → `{updated}`; every book must be selected, or nothing changes (`400 INVALID_MATERIALS`); notes are kept; one notification with the count. Audited as `scope.items_assigned` |
| POST | `/api/orgs/:orgId/scopes/:scopeId/items` | editor | `{add?: uuid[≤2000], remove?: uuid[≤2000]}` → `{itemCount}` |
| DELETE | `/api/orgs/:orgId/scopes/:scopeId/items` | editor | clear |
| POST | `/api/orgs/:orgId/scopes/:scopeId/duplicate` | editor | `{name}`; the copy keeps notes and assignees |
| GET | `/api/orgs/:orgId/scopes/compare?a=<scopeId>&b=<scopeId>[&format=csv]` | viewer | Two scopes of the organization side by side: `{a, b, sameVersion, subjects:[{grade, track, block, code, nameEn, nameAr, onlyIn?, materials:[{title, kind, side: "a"\|"b"\|"both", aId, bId, titleInB?, notInOtherCatalog?}]}], summary:{onlyA, onlyB, both}}`; across catalogue versions books are matched by subject and title. `400` when `a` equals `b`; `404` for a scope of another organization. `format=csv` downloads it (needs CSV export: `402 FEATURE_NOT_IN_PLAN`; counted as an export; audited as `scope.comparison_exported`) |
| GET | `/api/orgs/:orgId/scopes/:scopeId/carry-forward?to=<versionId>` | viewer | Preview of carrying the scope to another **published** version: `{scope, from, to, suggestedName, plan:{subjects:[{source, target\|null, changes:[{field, from, to}], carried:[{fromId, toId, title, kind, renamedFrom?}], missing:[{fromId, title, kind}], added:[{id, title, kind}]}], summary}}`; `400` for the scope's own or an unpublished version. `notes:{carried, lost}`: notes and assignees that follow their books, and those on books that cannot be carried |
| POST | `/api/orgs/:orgId/scopes/:scopeId/carry-forward` | editor | `{targetVersionId, mode?: "copy"\|"move", name?, add?: uuid[], skip?: uuid[]}`. `copy` (default) → `201`, new scope in the target version (`402 PLAN_LIMIT_REACHED` at the scope limit, `409 SCOPE_NAME_TAKEN`); `move` → `200`, the scope switches version and its items are replaced (refused for read-only scopes). `add` must be materials of the target version (`400 INVALID_MATERIALS`); `skip` leaves carried items out. Notes and assignees follow carried books (`notesCarried` in the response). Audited as `scope.carried_forward` |
| GET | `/api/orgs/:orgId/scopes/:scopeId/export?format=txt\|csv\|json` | viewer | attachment; counts toward monthly exports; CSV/JSON need Starter+. CSV ends with `note` and `assignee` columns, JSON items carry `note` and `assignee` (also in `GET /api/v1/scopes/:id`); TXT keeps the original layout |

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
and writes nothing; `apply: true` writes the whole file or nothing (`400 IMPORT_INVALID` with the errors); verification columns on drafts and
published versions, content and new materials on drafts only; `409 VERSION_ARCHIVED`; audited as `admin.catalog_imported`),
`GET /support/orgs/:orgId/scopes[/:scopeId]` (requires an active customer grant; audited),
`GET /alerts` (`{channels: {emails, emailTransport, webhook}, alerts: [...]}`: firing alerts and those resolved in the last 30 days),
`POST /alerts/test` (sends a test alert to every configured channel; returns `{result: {email, webhook}}`, each `sent`, `failed` or `off`; 5/h; audited as `admin.alert_test`).

## 3. Public API v1 (for customer integrations)

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/api/v1/scopes` | scopes of the key's organization |
| GET | `/api/v1/scopes/:scopeId` | JSON export: `{scope, catalogVersion, exportedAt, itemCount, items:[{grade, gradeEn, gradeAr, track, block, subjectCode, subjectEn, subjectAr, subjectStatus, materialId, materialKind, materialTitle, subjectVerification, subjectVerificationSource, subjectReviewedAt, materialVerification, materialVerificationSource, materialReviewedAt}]}` (CSV exports carry the same six verification columns) |
| GET | `/api/v1/catalog/versions` · `/api/v1/catalog/versions/:id` | catalogue |

```bash
curl -H "Authorization: Bearer cs_live_…" https://app.example.com/api/v1/scopes
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
