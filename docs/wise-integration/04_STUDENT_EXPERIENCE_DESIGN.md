# Student experience design

2026-10-25. Covers what is **built** (the student portal foundation, on the owner's decision of
school-created accounts) and what is **not designed yet** because Wise EduAgent could not be inspected.
Feature reference: `docs/STUDENT_ACCOUNTS.md`.

## 1. Principles

- One application: students use the same sign-in, sessions, design system, EN/AR layouts and
  accessibility checks as school staff. No separate Wise account, no second sign-in.
- The school is in charge: it creates the accounts, chooses each student's grade and curriculum,
  issues passwords and removes students. Students cannot sign up.
- Minimum data about minors: display name, username, grade, curriculum. Nothing that would need a
  guardian's contact details.
- Nothing invented: the portal shows only data the platform has (the school's scopes and the
  catalogue). No AI answers, practice or progress until the Wise features are known and an AI
  provider is chosen.

## 2. Journeys (built)

| Who | Journey | Screens |
| --- | --- | --- |
| Platform administrator | Turns student accounts on for a school and sets how many | Platform admin → organization → Student accounts (override) |
| School owner or admin | Adds a student, or imports a roster; hands out the school code, username and one-time password (on screen or as a CSV download); assigns grade and curriculum; issues a new password; removes a student | Organization → **Students** (shown in the navigation once accounts are on); add, edit, password and import dialogs |
| Student | Opens the sign-in link from the school (or "Student? Sign in with your school account" on the sign-in page), enters school code, username and password | `/student-login` |
| Student | Sees **My curriculum**: their grade (English and Arabic names), the curriculum's name and academic year, a legend of book kinds, and the subjects grouped as in the picker, each with only the books the school selected | `/student` |
| Student | Switches English/Arabic (remembered), changes password, signs out | Header of `/student` |

Empty and error states: no curriculum assigned yet; no books chosen for the grade; the school's
student accounts turned off; the school suspended. Each says to ask the school.

## 3. Navigation and layout

- Students get their own header (product name, school name, language, change password, sign out) and
  no staff navigation, organization switcher or notifications. Any staff address sends them to
  `/student`; staff opening `/student` are sent to their start page.
- The curriculum reuses the picker's grade heading, block and subject layout and book colours, read-only
  (no checkboxes). Phone layout stacks the subject name above its books.

## 4. Not designed yet (waits on Wise and an AI provider)

The Wise EduAgent features (an assistant, study plans, practice, progress or others) are not known:
the application could not be inspected (`../WISE_EDUAGENT_FUNCTIONAL_INVENTORY.md`). When they are, they
will be added to this portal, with the curriculum above as their context. Documents `05`–`12` will be
written with that design. Requirements already fixed by the integration brief: AI answers labelled as
generated, no change to official records or grades, per-school and per-student usage limits through
the existing plans, no second billing system.
