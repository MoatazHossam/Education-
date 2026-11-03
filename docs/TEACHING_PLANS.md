# Teaching plans

Added 2026-10-29 at the owner's request: lesson preparation and spreading the curriculum over the weeks
of a term, with AI help, for every school, whether or not it uses student accounts. A **teaching plan**
belongs to a curriculum scope (the school's selection of books for an academic year), a grade and a
subject. There are two kinds:

- **Lesson plan**: one lesson. The topic, its length, the books, objectives, materials, a warm-up, the
  activities with their minutes, questions to ask, assessment, homework, support and extension, notes.
- **Pacing plan**: a subject's curriculum spread over the weeks of a term. The first day of the term, the
  periods of the subject a week, the books, and one row per week (units and lessons, objectives, notes).
  Each week's dates are counted from the first day: week *n* starts 7 × (*n* − 1) days after it, and the page
  shows it as five school days.

A member writes a plan by hand, or starts from a **draft written by AI** (§4), reviews it and saves it.
Nothing written by AI is saved until the member saves the plan; the plan then records that it started
from an AI draft.

## 1. Who does what

| Who | Can |
| --- | --- |
| Any member of the school (viewer and above) | Read and print every plan of the school's scopes; write new plans; ask for AI drafts when the school has AI requests |
| The plan's author | Change and delete the plan |
| The school's owner and admins | Change and delete any plan |
| Students | Nothing: plans are for staff. Student sessions are refused on these routes, as on every staff route |
| Platform administrator | Gives schools AI requests (AI_LAYER §5); no access to plans |

Plans can be written for the grades and subjects that have books selected in the scope; the page says so and
links to the picker when there are none. Teachers usually reach them from their class: the class page links
to the plans of its curriculum scope, filtered to its grade.

## 2. Data

Table `teaching_plans` (migration `0018_teaching_plans`):

| Column | |
| --- | --- |
| `org_id`, `scope_id` | The school and the scope; `(scope_id, org_id)` references the scope, so a plan cannot point at another school's scope. Deleting the scope deletes its plans |
| `kind` | `lesson` or `pacing` |
| `grade`, `subject_en`, `subject_ar` | The grade (1–12) and subject, checked against the scope's selected books when the plan is written |
| `title`, `language` | 1–200 characters; `ar` or `en` (the language it is written in) |
| `content` | The plan, as JSON; at most 200,000 bytes. Checked by the application against its kind (`LessonContent`, `PacingContent` in `src/scopes/plans.ts`): unknown fields are refused, text and list lengths are limited, a pacing plan has 1–52 weeks |
| `ai_assisted` | Whether the plan started from an AI draft |
| `created_by`, `updated_by`, timestamps | Who wrote and last changed it (kept when that member leaves: set to null when the account is deleted) |

Row-level security is forced, with the same policy as every school table (`org_id = app_current_org()`), so
a query in one school's context never sees another school's plans. A scope holds at most **500 plans**
(`TOO_MANY_PLANS`). Plans are not copied when a scope is duplicated or carried forward to a new year.

## 3. API

All under a scope; every route needs a signed-in member of the school (`viewer` and above).

| Method and path | |
| --- | --- |
| `GET /api/orgs/:orgId/scopes/:scopeId/plans` | The scope (`id`, `name`, `academicYear`), its `grades` with the subjects that have selected books and their book titles, the `plans` (without content, with a `summary`: topic and minutes, or first day and weeks), `limit`, and `ai` (`{ left }`, `left: null` when unlimited, or `null` when AI drafts are not offered) |
| `POST /api/orgs/:orgId/scopes/:scopeId/plans` | `{ kind, grade, subjectEn, title, language, aiAssisted, content }` → 201 `{ plan }`. `INVALID_SUBJECT` when the grade and subject have no books in the scope |
| `GET /api/orgs/:orgId/scopes/:scopeId/plans/:planId` | `{ plan, scope }`; `plan.canEdit` says whether this member may change it |
| `PATCH /api/orgs/:orgId/scopes/:scopeId/plans/:planId` | Any of `{ title, language, content }`; the content is checked against the plan's kind. The author or an admin (`NOT_PLAN_AUTHOR` otherwise) |
| `DELETE /api/orgs/:orgId/scopes/:scopeId/plans/:planId` | 204. The author or an admin |
| `POST /api/orgs/:orgId/scopes/:scopeId/plans/suggest-lesson` | §4. `{ grade, subjectEn, topic, lessonText?, durationMinutes?, language }` → `{ draft, model }` |
| `POST /api/orgs/:orgId/scopes/:scopeId/plans/suggest-pacing` | §4. `{ grade, subjectEn, startDate, weeks, periodsPerWeek?, contents?, language }` → `{ draft, model }` |

A plan of another scope, or of another school, is 404. Validation errors name the field (`content.activities.1.title`),
and the editor shows each next to its field. The scopes list reports each scope's `planCount`.

## 4. Drafts written by AI

Offered when the school has AI requests (docs/AI_LAYER.md: off for every school until a platform administrator
gives it a monthly allowance) and the server has an AI provider. One request of the allowance per draft.

- **Lesson plan** (feature `lesson_plan`). The member gives a topic (3–300 characters), optionally the lesson text
  (up to 12,000 characters), the lesson's length (20–180 minutes, 45 by default) and the language.
- **Pacing plan** (feature `pacing_plan`). The member gives the first day of the term, the number of teaching weeks
  (1–40), the periods of the subject a week (1–15, 4 by default), optionally the units and lessons to cover (up to
  8,000 characters, for example the book's table of contents) and the language.
- **What is sent** to the provider: that, the grade and its stage (for example "preparatory 1"), the subject's names
  and the titles of the subject's books selected in the scope. Nothing about students, and no other plan. The forms
  ask members not to paste students' names or work.
- **The instructions** (`src/scopes/plan-suggestions.ts`) ask, for a lesson: observable objectives, activities in
  teaching order whose minutes add up to about the lesson's length, materials an ordinary Egyptian classroom has,
  questions to check understanding, assessment, homework, support and extension, keeping to the lesson text when one
  is given. For a term: exactly the number of weeks asked, each week sized to its periods, following the member's list
  in order and adding nothing that is not in it, or, without a list, what the curriculum usually covers with a note
  to check the order against the book; the last week kept for revision when the term has six weeks or more. Both:
  Modern Standard Arabic with correct spelling or simple English, books only by the titles given, never invented
  page numbers, dates, holidays or links.
- **The reply** must match the reply schema; a pacing reply must have exactly one entry per week asked. One more
  request is made if it does not (AI_LAYER §3). The server dates the weeks itself; the provider is never asked for
  dates.
- **Nothing is saved.** The draft opens in the plan editor with a notice to read and correct every part; it is saved
  as a plan, marked as started from an AI draft, only when the member presses **Save**. Leaving the editor discards it.
- **Errors** (`AI_BUSY`, `AI_UNAVAILABLE`, `AI_FAILED`, `AI_REFUSED`, `AI_REPLY_TOO_LONG`, `AI_INVALID_REPLY`,
  `FEATURE_NOT_IN_PLAN`, `INVALID_SUBJECT`) are shown in the dialog, in Arabic in the Arabic interface.

## 5. Pages

- **Teaching plans** (`/org/:orgId/scopes/:scopeId/plans`): the plans by grade and subject, filtered by grade and kind,
  with their author, last change and an "AI draft" mark. **New plan** asks the kind, grade and subject, then **Start
  blank** or **Draft with AI**. Linked from the scopes list (with the number of plans) and from each class page.
- **A plan** (`…/plans/:planId`): the plan as a document, with **Print** (the print style shows only the plan, without
  the menus and buttons), **Edit** and **Delete** for its author and admins.
- **The editor** (`…/plans/new`, `…/plans/:planId/edit`): every part as a labelled field; lists one item per line;
  activities and weeks as groups that can be added and removed, each week with its dates.

Headings follow the interface language; the plan's own text keeps its direction and is marked with its language where it
differs, for screen readers (WCAG 3.1.2).

## 6. Audit and privacy

`plan.created`, `plan.updated` (which fields changed) and `plan.deleted` are in the school's audit log with the scope,
kind, grade and subject; never the plan's text. AI drafts are in `ai_requests` and the audit log as `ai.request` with the
feature, who asked, the outcome and tokens, never the text. Plans hold what members write; they are kept until a member
deletes them or the scope is deleted, and they are not part of the classroom retention periods (CLASSROOM §11), which
cover students' work.

## 7. Not done yet

- No link between a pacing plan's weeks and lesson plans, and no tracking of which weeks were taught.
- No sharing between schools, no templates, no export other than printing (the browser's "Save as PDF" works).
- Dates do not know the school calendar: holidays are entered by the member as notes on a week.
- AI drafts have not run against the real Gemini API yet (AI_LAYER status).

## 8. Tests

- `tests/integration/teaching-plans.test.ts` (4): any member writes plans for the scope's subjects and everyone in the
  school reads them; missing parts saved empty; the audit without content; only the author and admins change or delete;
  checks of the grade and subject, the content against its kind (unknown fields refused), and the 500-plan limit;
  another school and another scope get 404; plans go with their scope.
- `tests/integration/plan-suggestions.test.ts` (4, against the Gemini simulator): off without AI requests; what is sent
  for a lesson and returned; nothing saved until the member saves the draft, which is then marked as started from AI; a
  pacing plan with exactly the weeks asked, asking again when the count is wrong; checks before any request.
- `tests/unit/plan-suggestions.test.ts` (9): the instructions and task for both kinds, defaults, the reply schemas
  (one entry per week), conversion to an editable plan, and refused requests.
- `tests/integration/tenancy.test.ts`: forced row-level security on `teaching_plans`, like every school table.
- E2E journey 26: from the class page, a lesson plan drafted with AI, edited (an activity removed and one added),
  saved, shown with its total minutes, printed (only the plan shows), edited again; a pacing plan written by hand with
  the title missing first, its weeks' dates; the list and the scopes list; deleting a plan.
- The accessibility audit: the plans list (empty and with plans), the new-plan and draft dialogs, the editor with an AI
  draft and with a field error, both kinds of plan; in Arabic, dark and on a phone.
