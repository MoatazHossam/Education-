# Simulated screen-reader pre-check

A simulated screen reader reads every screen the accessibility audit visits, so
problems a screen-reader user would hear are found and fixed before the manual
review in SCREEN_READER_REVIEW.md. **This is not that review.** It finds
structural problems early, so the tester's time goes on what only a person can
judge.

Last run: 2026-10-27. Every check passes. The browser recorded 149 screen
transcripts (about 65,000 spoken phrases) and the reader reports 0 findings. The
portal's screens and announcements were read for SCREEN_READER_REVIEW tasks 23–32;
three problems found there are fixed (§3, P10–P12).

## 1. What it is

- **Tool:** Guidepup's Virtual Screen Reader (`@guidepup/virtual-screen-reader`
  0.33.0, MIT licence), a development dependency only. It walks the browser's
  accessibility tree in reading order and logs the phrases a screen reader
  would speak, such as "heading, Notes and assignees, level 1" or "button,
  Gem (External reference), not pressed". It also logs what live regions
  announce, for example "polite: Saved".
- **Where it runs:** inside the end-to-end tests
  (`tests/e2e/screen-reader.ts`), in the accessibility project:
  - **Audit:** every screen and dialog the axe audit checks (149 of them,
    English and Arabic, light and dark, desktop and phone) is also read from top
    to bottom. An open dialog is read on its own, as a modal dialog keeps a
    screen reader inside it.
  - **Announcements:** one test listens while someone selects a book, opens a
    dialog, and submits a form with an error for the whole form and one with a
    field error. In the teacher and student portal, the audit also listens while
    a student hands in homework and answers a test whose saves fail, while the
    teacher's live monitor refreshes as the student works and submits, and while
    a test is marked.
- **Transcripts:** each screen's transcript is written to
  `test-results/screen-reader/` on every run (not committed). It is a useful
  preview for the human tester.
- **Browser setting:** the test browser loads the reader with CSP bypassed,
  because the app's strict CSP forbids injected scripts. The journeys still run
  under the real CSP.

## 2. What it checks

The audit test fails if any screen has:

| Check | How |
|---|---|
| A control without a name | A button, link, field, checkbox, image and so on whose phrase has a role but no name. |
| A table header without a name | An empty `columnheader` or `rowheader`. |
| A symbol read on its own | A meaningful symbol (✓, ✎, !, an emoji) read as a separate item instead of its meaning. Separators read inline (·, —, :) are not counted. |
| A skipped heading level | A heading more than one level below the one before (h1 followed by h3). |
| Text in the other language without `lang` | Read from the page itself, since the simulator has no voices: Arabic text in the English interface, or English words in the Arabic one, with no `lang` saying so. A real screen reader would read it with the wrong voice (WCAG 3.1.2). |

The announcements test asserts:
- selecting a book announces the book with its kind and then "Saved";
- opening a dialog announces "dialog, New scope" and puts focus in its first field;
- a form-level error is announced once;
- a field error moves focus to the field, which is read with its error, and no
  other message is announced.

In the portal (added 2026-10-27, with SCREEN_READER_REVIEW tasks 23–32):
- handing in homework announces "Handed in." and reads the page again from its heading;
- in a test, saving says nothing while it works; when saves fail, "Some answers are
  not saved yet. The page keeps trying." is said once for two failed answers, and
  nothing about time is said with 30 minutes left;
- the live monitor announces its summary when it changes ("Working: 0 (online 0) ·
  Submitted: 1 · Not started: 0"); while it refreshes at least four times, focus
  moves at most once (when the student's buttons change on submitting) and stays on
  the teacher's button. Focus moves are counted from the browser's own events: the
  simulator reports a repeated focus move only once, so it could not show the
  problem;
- marking: the fields are named after their question, and saving a mark announces
  "Saved. Total: 2 / 2";
- the timer's announcements are unit tests (`tests/unit/countdown.test.ts`): 5
  and 1 minutes once each, none for a mark already behind when the test opens,
  again after more time, and only the nearer one when a tick jumps past both.

## 3. What it found, and the fixes

First run: 1,485 flags. Most were the tool's own artifacts or a harness bug, so
those were removed first:
- **1,000 flags: a harness bug.** The reader looped round one dialog; the
  harness now stops at "end of dialog".
- **Separators flagged as symbols.** Dots and dashes between words are read
  inline by real screen readers, so they are no longer flagged.

The rest were real:

| # | Problem | Where | Fix |
|---|---|---|---|
| P1 | Text in the other language was not marked, so a screen reader would read it with the wrong voice. Examples: English book titles, school, scope and member names, notes, URLs and "CSV" in the Arabic interface; the Arabic half of book titles ("Al-Adwaa (الأضواء)") and stage names in the English one. 359 places. | Every page with catalogue or user data | The element factory (`public/js/dom.js`) wraps runs of the other script in `<span lang>`. Elements that set their own `lang`, and those that cannot hold markup (options, text areas, code blocks), are left alone. The picker's plain-text list uses the same function. |
| P2 | A ✓ before "0 of 231 subjects verified" was read as "check mark". | Picker, coverage line | Hidden from screen readers. |
| P3 | The bell emoji inside the notifications button. | Every signed-in page | Hidden. The button's name already carries the count. |
| P4 | Empty notes, assignees and progress were shown as "—", which a screen reader skips or reads as "dash". The line under a note was just "name, date". | Notes and assignees, My assignments | Screen readers now hear "None"; the line reads "Last changed by …". |
| P5 | The column holding each row's buttons had a blank header. | 7 tables (deliveries, webhooks, scopes, members, students, admin users and catalogue versions) | Named "Details and actions" for screen readers. |
| P6 | Plan names jumped from level 1 to level 3. | Pricing | Level-2 headings. |
| P7 | A book's kind was read as "External refs"; the colour key was read as a list of phrases with no label. | Picker, student portal | Kinds are said in full ("External reference", "Ministry material"); the key is a group named "Colour key". |

The announcements test also found:

| # | Problem | Fix |
|---|---|---|
| P8 | After a failed submission with field errors, nothing was announced and focus stayed on the submit button. The form's general error box was also filled while hidden. | Focus moves to the first field in error, which is read with its error. The general box is filled only when it is meant to be seen. |
| P9 | An error for the whole form was announced twice (the box was shown, then filled). | The box is not displayed while empty (`.alert:empty`), so filling it is the one change that is announced. |

Reading the portal's transcripts and listening to it (2026-10-27) found:

| # | Problem | Where | Fix |
|---|---|---|---|
| P10 | A test opened with less than 5 minutes left announced "5 minutes left" at once (and "1 minutes left" under a minute); after more time the marks were not said again. In Arabic, "5 minutes" was in the singular | Taking a test | `public/js/countdown.js`: a mark is said once when crossed, never on opening, again after more time; "1 minute left."; Arabic plural "دقائق" and "دقيقة واحدة" |
| P11 | Every question's mark and comment fields had the same name | Marking a test | The names start with "Question N: " (read by screen readers, not shown) |
| P12 | The monitor rebuilt its table every 5 seconds and moved focus back to the teacher's button each time, which a screen reader reads again | Live monitor | Only changed cells are redrawn; a focused button stays; its click reads the latest row |

Each fix has a check in the tests above, so it stays fixed.

## 4. The checklist's tasks, as covered here

| Task (SCREEN_READER_REVIEW.md §6) | Covered by |
|---|---|
| 1 Sign in, 3 Forgot and reset password | Sign-in, register, forgot-password and reset pages read; form errors tested on the account page |
| 2 Two-factor sign-in | The two-factor page read (platform admin) |
| 4 Notifications | Notifications dialog read; the unread count in the button's name (test 22) |
| 5 Account | Account page read, in English and Arabic, and during two-factor setup (QR described, key as text) |
| 6 Switch organization | The top bar on every signed-in page |
| 7 Picker | The picker read on first visit, with selections, with the list open, in Arabic, dark, on a phone and as a viewer; selecting a book heard |
| 8 Scopes, 9 Carry forward, 10 Compare | Scopes list, new-scope dialog, carry-forward review and the comparison read (in several states) |
| 11 Notes and assignees, 12 My assignments | Both pages read, with notes, overdue and due-soon books, one school and all schools, and the note dialog |
| 13 Members, 14 Students | Members page; Students page, add, passwords and import dialogs |
| 15 Billing | Billing and pricing pages. **Not covered:** the sandbox checkout page |
| 16 Settings | Settings with a webhook, the secret, deliveries and edit dialogs |
| 17 Audit log | Read |
| 18 Viewer in the picker | Notes Academy's picker read as a viewer: books are "disabled" |
| 19 Editor with assigned books | My assignments read (the same page an editor uses) |
| 20 Student | Student sign-in, portal (English, Arabic, phone) and change-password dialog |
| 21 Admin console, 22 Catalogue editor | Overview, organizations, users, catalogue, plans, audit, events, the editor and its verification dialog |
| 23 Classes and homework | Classes (none, one, Arabic), a class with homework (also Arabic, dark), the set-homework, new-class, students and teacher dialogs |
| 24 Marking homework | The homework with work handed in and returned (also Arabic, dark), the mark dialog |
| 25 Writing a test | The new-test and add-question dialogs (choices, written answer), a draft test (also Arabic, dark) |
| 26 Live monitor | The monitor (also Arabic, dark) and the extra-time dialog read; its summary and focus heard while it refreshes |
| 27 Results and marking | Results (also Arabic) and the marking page read; field names and the saved total heard |
| 28 Gradebook | Read in English, Arabic and dark. **Not covered:** changing the subject (one subject in the test data) |
| 29 Keeping classroom data | The page with nothing set, items due and an item kept, the confirmation; Arabic, dark, phone |
| 30 Today and homework | Today, the homework list and a homework as new, with a photo being checked and checked, handed in, returned; Arabic, dark, phone; handing in heard |
| 31 Taking a timed test | The start page and dialog, the test (English, Arabic, phone), the submit dialog and "submitted"; saving failures heard; the timer's announcements as unit tests. **Not covered:** time running out in the browser |
| 32 Results and grades | The student's result (also phone) and grades (also Arabic, phone) |

## 5. What it cannot tell

These are left for the manual review:

- **How anything sounds.** The simulator has no voices, pronunciation or
  language switching. The `lang` marking is checked in the page, not heard.
  It cannot tell whether "PNNU GG2M" (a two-factor key) or Arabic-Indic digits
  are read sensibly.
- **Real screen-reader behaviour.** It does not model NVDA, JAWS, VoiceOver
  or TalkBack: browse and focus modes, verbosity settings, how each announces
  live regions, or phone gestures.
- **Its own quirks.** Some differences are known; they are not problems in the
  app:
  - It reads a select's value attribute (for example an organization id), not
    the selected option's text.
  - It reads a password field without a role.
  - It reads a named button's content after the name.
  - It splits inline text into separate items.
- **Judgement.** Whether the order, wording and amount of speech make sense to
  someone who uses a screen reader every day.

## 6. Running it

`npm run test:e2e` runs it, with the accessibility audit, after the journeys.
To rerun the audit alone, the journeys' data has to exist, so run the whole
suite. Read the transcripts in `test-results/screen-reader/`; `findings.json`
lists anything flagged.
