# Screen-reader review checklist

A manual review of Curriculum Scope with screen readers, for the parts of WCAG
2.2 AA that automated checks cannot judge: whether what is announced makes
sense, in the right order, in the right language, at the right moment.

The automated checks already in place (TEST_REPORT.md §3) are the axe-core
WCAG 2.2 A/AA audit of 147 screens and dialogs (English and Arabic, light and
dark, desktop and phone) and a keyboard-only journey. They find roughly a third
to a half of WCAG problems. This checklist covers the rest for screen-reader
users. It has **not been carried out yet**.

Before it, a simulated screen reader read every audited screen and the fixes it
led to are listed in §4 (SCREEN_READER_PRECHECK.md has the details and what a
simulation cannot tell). The tester records results on the shared results page,
<https://claude.ai/artifact/LCnw1qJ35ZiuZL7AeUFj6r>. It holds the checks of §4–§8,
saves each one as it is marked, and needs Contributor access from the owner.

## 1. Who and with what

- **Tester:** someone who uses a screen reader daily. The Arabic pass needs a
  native Arabic reader who also uses a screen reader.
- **Combinations (minimum):**

  | # | Screen reader | Browser | Device | Interface languages |
  |---|---|---|---|---|
  | A | NVDA (current release) | Firefox and Chrome | Windows, desktop | English and Arabic |
  | B | VoiceOver | Safari | macOS, desktop | English and Arabic |
  | C | VoiceOver | Safari | iPhone, phone layout | English and Arabic |
  | D | TalkBack | Chrome | Android, phone layout | English and Arabic |
  | E (if a buyer asks) | JAWS | Chrome or Edge | Windows | English |

- **Voices:** an English and an Arabic voice installed for every combination,
  with automatic language switching on, so text marked `lang="ar"` is read in
  Arabic and text marked `lang="en"` in English.
- **Settings:** the screen reader's default verbosity; browser zoom at 100 %
  (one desktop round at 200 % zoom is useful as well).

## 2. Environment and test data

- A local or staging installation (README: `npm run db:migrate && npm run
  db:seed`, then `npm run dev` and `npm run dev:worker`). The seed's demo
  logins are for development only: **never use them, or this checklist, against
  production.**
- Accounts and data to prepare:
  - an owner who belongs to two organizations, one of them on a plan with API
    access (for webhooks) and student accounts switched on;
  - an editor and a viewer in the same organization;
  - a scope with selected books, some with notes, assignees, statuses and due
    dates (one due tomorrow, one overdue);
  - a second scope on another catalogue year (for compare and carry forward);
  - at least two unread notifications for the owner;
  - a webhook endpoint with a few deliveries (a failed test is enough);
  - a student account with a scope and a grade;
  - a platform administrator with two-factor sign-in.

## 3. How to record results

For each item write **Pass**, **Fail** or **N/A**, the combination letter
(A–E), and for a failure: what was announced, what was expected, and the steps.
One row per failure in the table in §9; a GitHub issue per failure is better
still.

"Announced" below means what must be conveyed (name, role, state, value), not
the exact words: each screen reader phrases it differently.

## 4. Changes made before this review: confirm them

F1–F5 were found while preparing the checklist, by reading the markup; F6–F12
by the simulated screen reader (SCREEN_READER_PRECHECK.md). All are fixed and
covered by automated checks (tests/e2e/accessibility.spec.ts), but only a
screen reader shows how they actually sound.

| # | Was | Now | Check |
|---|---|---|---|
| F1 | The notifications button was named "Notifications"; the unread count shown on it was not announced. | Named "Notifications, 2 unread" while there are unread ones. | The count is announced; after opening the list the button is "Notifications" again. |
| F2 | The whole page area was a live region, so a page change or a filter change could have the whole page read out. | Not a live region. Pages are announced by moving focus to the heading; messages use the status area. | Moving to another page reads its heading, not the whole page; changing a picker filter announces only the filter's new state. |
| F3 | Every page had the same title, "Curriculum Scope". | The title is the page heading followed by " · Curriculum Scope" (in Arabic, " · نطاق المناهج"). | The title is announced on each page; the browser tab and history show it. |
| F4 | In the picker the kind of a book (Ministry, language-school, external reference, programme, assessment) was shown by colour only. | Each book button also says its kind, as the student portal already did. | A book is announced as its title followed by its kind, e.g. "… (Ministry material), toggle button, not pressed". |
| F5 | Form hints and field errors were not linked to their fields; a field with an error was only "invalid". | Hints and errors are the field's description. | On an invalid field the error is read with the field; a corrected field no longer reads the old error. |
| F6 | Text in the other language was not marked: English titles, names and notes in the Arabic interface, Arabic names in the English one. | Marked with `lang`, so the screen reader can switch voice. | With automatic language switching on, such text is read in its own language, a whole phrase at a time. |
| F7 | Empty notes, assignees and progress showed only "—"; the line under a note was just a name and a date. | Read as "None"; the line reads "Last changed by …". | Empty cells say "None"; the note's line is understandable on its own. |
| F8 | After a failed submission with field errors, nothing was announced. | Focus moves to the first field in error. | The field and its error are read at once. |
| F9 | An error for the whole form could be announced twice. | Announced once. | One announcement per error. |
| F10 | The ✓ before the verification count and the bell were read as symbols. | Hidden from screen readers. | Neither is read. |
| F11 | The column holding a row's buttons had a blank header in 7 tables. | Named "Details and actions". | Moving into that column announces its name. |
| F12 | The picker's colour key had no name; kinds were read as "External refs"; pricing plans jumped from heading level 1 to 3. | A group named "Colour key"; kinds in full; plans are level-2 headings. | As described. |

## 5. Every page (each combination)

| # | Check | Expected |
|---|---|---|
| G1 | Page language | The page is read in the interface language (`<html lang>` is `en` or `ar`, with `dir="rtl"` in Arabic). Arabic subject and grade names in the English interface are read in Arabic, and the English names in the Arabic interface in English. |
| G2 | Page title | See F3. |
| G3 | Landmarks | Signed in: a banner (top bar), "Main navigation", and main. The picker also has the regions "Filters" and "Selection". Sign-in pages have a main landmark. |
| G4 | Headings | One level-1 heading per page (the page name); level 2 for sections, picker grades and dialog titles. The headings list gives a usable outline of the page. |
| G5 | Skip link | The first Tab from the top of a page is "Skip to content"; following it moves to the page heading without reloading. |
| G6 | Focus after a page change | Focus is on the new page's heading and it is announced (F2, F3). Browser Back does the same. |
| G7 | Current page in the navigation | The current item is announced as the current page. The "My assignments" item includes the number of open books when there are some. |
| G8 | Messages | "Saved" and other confirmations are announced once, politely, without moving focus. Errors are announced at once. A confirmation disappears after 3 seconds and an error after 6: check the whole message is heard first. |
| G9 | Dialogs | On opening, the dialog's title is announced and focus is inside it; the reading cursor cannot leave it; Escape closes it; focus returns to the control that opened it. |
| G10 | Forms | Each field is announced with its label, type, required state and hint (F5). After a failed submission the error is announced, and for field errors each field reads its own error (F5). Checkboxes announce their state. |
| G11 | Tables | Moving across cells announces the column header. A table that scrolls sideways is in a region named after its content, reachable with Tab. |
| G12 | Toggle buttons | Picker filters (track, grade, kind) and book buttons announce "pressed" or "not pressed", and the change when activated. Grade buttons are named "Grade 1" … "Grade 12". |
| G13 | Symbols | Symbols shown on screen (✓, ✎, !, the bell) are not read as symbols; their meaning is read as words instead ("Verified", "Under review", "has a note", "assigned to …", "due soon"). |
| G14 | Language switch | The switch button is read in the language it switches to ("العربية" in an Arabic voice, "English" in an English one). After switching, the page is in the other language and direction, and focus is on the page heading. |
| G15 | Dates and numbers | Dates are read sensibly in both languages (the Arabic interface uses Arabic-Indic digits and month names). |

## 6. Tasks, by role

Do each task with the screen reader alone, without looking at the screen.

### Everyone

1. **Sign in**, with a wrong password first: the error is announced, then the
   correct sign-in succeeds and the first page heading is announced.
2. **Two-factor sign-in** (platform admin): the code field and its error, and
   "Use a recovery code instead".
3. **Forgot password** and **reset password** (link from the email): fields,
   errors, and the final confirmation.
4. **Notifications**: the count on the button (F1), the list in the dialog
   (title, text, date and "Open" link for each), closing it.
5. **Account**: change the name and language; the email settings (catalogue
   updates, assignment emails and their frequency, due-date reminders); "Active
   sessions" and "Sign out all other sessions"; **two-factor setup** (the QR
   code is described as "QR code for your authenticator app", and the key is
   readable as text in groups of four: note whether groups such as "PNNU" are
   spelled out or pronounced as words); recovery codes; "Download my data
   (JSON)".
6. **Switch organization** with the selector in the top bar, and create a new
   organization.

### Owner and admin

7. **Picker** (the main screen):
   - choose a scope in "Scope";
   - narrow by track, grade and kind (G12) and search ("Search");
   - select and deselect books: name, kind (F4), verification ("Verified" or
     "Under review"), note marks, and pressed state; "Saved" is announced;
   - the selected count in "Selection", then "View list", "Copy list" and
     "Download…";
   - each grade is a section headed by its name; a subject's verification
     badge ("Verified", "Under review" or "2 of 3 verified") opens and closes
     its source and date.
8. **Scopes**: create one (dialog), rename, duplicate, delete (the confirmation
   says what is deleted), and open "Notes and assignees", "Compare" and
   "Carry forward".
9. **Carry forward review**: the summary of what will be carried and what has
   no match, the copy / move choice, and the result.
10. **Compare**: choose two scopes; each row reads "Included" or "Not included"
    for each scope (not the ✓ or — symbols); "Show only differences"; "Download
    comparison (CSV)".
11. **Notes and assignees**: the filters ("Show"), choosing books ("Choose …",
    "Choose every book shown in …"), the bulk bar, and the note dialog ("Edit
    the note on …": Note, Assigned to, Status, Due date). Overdue and due-soon
    books are announced as such.
12. **My assignments** (one school and all schools): each book's status
    selector is named "Status of …"; the change is confirmed.
13. **Members**: invite (dialog), change a role, remove someone (confirmation),
    transfer ownership.
14. **Students**: "Add student", "Import CSV…" (file field, preview, result),
    the one-time passwords dialog and "Download passwords (CSV)", "New password
    for …".
15. **Billing**: the plan cards (name, price, what is included), choosing a
    plan in the sandbox checkout (test mode only), cancelling.
16. **Settings**: "Require two-factor authentication for owners and admins",
    API keys (the key is shown once in a
    dialog and can be read and copied), and **webhooks**:
    - add an endpoint (URL with its hint, description, event checkboxes);
    - the signing secret dialog (secret readable in one piece);
    - "Send a test to …": the result is announced;
    - "Deliveries to …": the table (time, event, result, attempts), "Payload"
      opens and closes, "Send again …" is named after the event and time, and
      "Download history (CSV)" downloads;
    - edit, "New secret" (confirmation), delete (confirmation).
17. **Audit log**: the filters and the table.

### Editor and viewer

18. A viewer in the picker: book buttons are announced as unavailable (dimmed);
    activating one announces "Read-only: viewers cannot change selections.".
19. An editor with assigned books: "My assignments" and changing a status.

### Student

20. **Student sign-in** (school code, username, password), the curriculum (grade
    heading, subjects, each book with its kind), changing the password, signing
    out.

### Platform administrator

21. Overview (with alerts), organizations (suspend and restore with their
    confirmations), users, plans, audit, and events.
22. **Catalogue editor**: grades as expandable sections, editing a subject,
    "Verification…" dialog, bulk verification from a spreadsheet (upload,
    preview, apply).

## 7. Arabic interface

Repeat §5 and tasks 1, 4, 7, 11, 12, 16 and 20 in Arabic. In addition:

- Labels, buttons and messages are read in Arabic with the Arabic voice, and
  English book titles and URLs in English.
- Reading order follows right-to-left layout; nothing is read out of order
  because of mixed-direction text (URLs, codes and numbers inside Arabic
  sentences).
- Plural forms and gender agreement sound natural (the Arabic copy has not been
  reviewed by a professional translator yet; note anything odd).

## 8. Phone (combinations C and D)

- Swipe order follows the visual order; nothing important is skipped.
- The picker's selection tray at the bottom does not cover content that is read
  next.
- Dialogs open and close with the screen reader's gestures (two-finger scrub on
  VoiceOver, back gesture on TalkBack) and focus returns to the opener.
- Tables that scroll sideways can be explored.

## 9. Results

Results are recorded on the results page linked at the top, which also
copies all failures as text for issues. Summarize them here when the review
is done:

| Date | Tester | Combination | Item | Result | What was announced / expected | Issue |
|---|---|---|---|---|---|---|
| | | | | | | |

When the review is done: link the results here, update TEST_REPORT.md §3,
PRODUCT_REQUIREMENTS.md (NFR-7), FEATURE_INVENTORY.md (S-24a) and
GAP_ANALYSIS.md (row 16), and fix the failures it finds.
