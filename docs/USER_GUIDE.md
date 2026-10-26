# Curriculum Scope: user guide

Curriculum Scope lets a school, publisher or ed-tech team choose which books
and programmes of the Egyptian curriculum (Primary 1 to Secondary 3) its
platform covers. The team keeps those choices together in named lists called
**content scopes**. It adds notes, assigns books to colleagues with due dates,
and carries each list forward when a new academic year's catalogue is
published. A school can also give its students accounts, so each student sees
the books chosen for their grade.

This guide walks through every part of the system, screen by screen, in the
order a school meets them. It also covers the platform administrator's
console. The whole interface works in English and Arabic (see
[section 15](#15-arabic-and-phones)).

> **About the screenshots.** They were taken from a demo school on a test
> server. The people, school, emails and addresses are invented. Payments use
> the test-mode checkout (no real money). A few details differ from a live
> server, and the captions point them out. To retake every screenshot after a
> change to the interface, run `npm run docs:screenshots`; see
> [About this guide](#about-this-guide).

## Contents

1. [Plans and creating an account](#1-plans-and-creating-an-account)
2. [Signing in](#2-signing-in)
3. [Roles: who can do what](#3-roles-who-can-do-what)
4. [The picker: choosing books](#4-the-picker-choosing-books)
5. [Scopes: list, duplicate, compare](#5-scopes-list-duplicate-compare)
6. [Notes, assignees, statuses and due dates](#6-notes-assignees-statuses-and-due-dates)
7. [Notifications and My assignments](#7-notifications-and-my-assignments)
8. [Members and invitations](#8-members-and-invitations)
9. [A new academic year: carrying a scope forward](#9-a-new-academic-year-carrying-a-scope-forward)
10. [Billing](#10-billing)
11. [Students and the student portal](#11-students-and-the-student-portal)
12. [Organization settings: API keys, webhooks, support access](#12-organization-settings-api-keys-webhooks-support-access)
13. [Audit log](#13-audit-log)
14. [Your account](#14-your-account)
15. [Arabic and phones](#15-arabic-and-phones)
16. [Emails the system sends](#16-emails-the-system-sends)
17. [Platform administration](#17-platform-administration)
18. [Limits and things to know](#18-limits-and-things-to-know)

---

## 1. Plans and creating an account

### Pricing

The **Pricing** page (`/pricing`) is open to everyone. Every plan has the same
curriculum catalogue; plans differ in team size, number of scopes, exports and
integrations. Switch between **Monthly** and **Yearly** prices at the top.

![The pricing page with the Free, Starter, Professional and Enterprise plans](user-guide/images/pricing.png)

| Plan | Price | Seats | Scopes | Exports a month | Also |
|---|---|---|---|---|---|
| Free | free | 2 | 1 | 5 | Text export, 7-day audit log |
| Starter | EGP 990 a month | 5 | 10 | 100 | CSV and JSON export, 30-day audit log, two-factor rule for admins |
| Professional | EGP 2,900 a month | 25 | 100 | 1,000 | Read API (50,000 requests a month) and webhooks, 365-day audit log |
| Enterprise | contact sales | no limit | no limit | no limit | Priority support, 730-day audit log, invoicing |

Prices are in Egyptian pounds; any tax is shown on the invoice. A platform
administrator can change prices (section 17); changes apply to new invoices
only.

### Creating an account

Click **Start free trial** (or **Create an account** on the sign-in page).
Enter your name, email, a password of at least 10 characters, and your
organization's name: your company, school or team.

![The sign-up form, filled in for Mona Hassan of Nile Valley Language School](user-guide/images/register.png)

A new organization gets **14 days of the Professional plan** with no card.
After **Create account**, the system emails a confirmation link (it expires in
48 hours):

![“Check your email for a confirmation link”](user-guide/images/register-check-email.png)

Opening the link confirms the address:

![“Your email is confirmed. You can sign in now.”](user-guide/images/email-confirmed.png)

People invited by a colleague do not use this form; they accept the
invitation instead (section 8).

## 2. Signing in

Sign in with your email and password at `/login`.

![The sign-in page](user-guide/images/sign-in.png)

- **Forgot password?** emails a link to choose a new password. The link works
  once and expires in an hour. Changing the password signs out your other
  sessions.

  ![Reset your password: enter your email](user-guide/images/forgot-password.png)

  ![Choose a new password](user-guide/images/reset-password.png)

- **Two-factor authentication.** If you turned it on (section 14), or your
  organization requires it for owners and admins, the next page asks for the
  6-digit code from your authenticator app. If you lost your phone, use one
  of your recovery codes instead.

  ![Two-factor verification: enter the 6-digit code](user-guide/images/two-factor-sign-in.png)

- **Students** have their own sign-in page, linked at the bottom
  (section 11).

After several wrong passwords the account is locked for a while; a platform
administrator can unlock it (section 17).

## 3. Roles: who can do what

Everyone in an organization has one role. The **Members** page lists them.

| Role | Can |
|---|---|
| **Owner** | Everything, including billing, transferring ownership, support access and deleting the organization. One per organization. |
| **Admin** | Manage editors and viewers, invitations, students, settings, API keys and webhooks; read the audit log and billing. |
| **Editor** | Create, edit, duplicate, carry forward and delete scopes; choose books; write notes and assign books. |
| **Viewer** | Read and export scopes, notes and assignments. Cannot change anything. |

The menu shows only what your role can use. Owners and admins see
**Students** (when the student portal is on), **Billing**, **Settings** and
**Audit log**; editors and viewers see **Picker**, **Scopes**,
**My assignments** and **Members**.

## 4. The picker: choosing books

The picker is the main screen, opened by **Picker** in the menu. It shows the
whole catalogue for the scope's academic year, grade by grade. A tick on a book
adds it to the scope you have selected, for everyone in your organization.

### Your first scope

A new organization has no scopes yet, so the picker starts with a prompt:

![The picker on a first visit, with “Create your first content scope”](user-guide/images/picker-first-visit.png)

The yellow trial bar under the menu counts the trial's remaining days; its
**Choose a plan** link opens Billing.

**Create your first scope** (or **New scope** later) asks for a name, an
optional description and the catalogue year:

![The New scope dialog](user-guide/images/new-scope-dialog.png)

### Filters

![The picker's filters: scope, track, grade, kinds of books, search and the colour key](user-guide/images/picker-filters.png)

- **Scope**: the list you are editing. **New scope** creates another;
  **Notes and assignees** opens the notes page for this scope (section 6).
- **Track**: Ministry (Arabic and language schools), Secondary 1, Bakaloria,
  Thanaweya Amma, International, or all.
- **Grade**: P1–P6, Prep 1–3, Sec 1–3. Click several to show several grades;
  click a pressed grade again to hide it.
- **Show**: which kinds of books are listed: Ministry, Language-school,
  External references, Programme, Assessments.
- **Search** finds a subject, book or programme by name.
- The **colour key** explains the colours: a subject's status (counts toward
  the total, pass/fail only, activity) and each kind of book.

### Choosing books

Each subject shows its English and Arabic names, its status, and its books.
Click a book to add it; click again to remove it. The bar at the bottom shows
**Saved** after each change and counts the selected items.

![Grade 1 in the picker, with chosen books and an open verification badge](user-guide/images/picker-books.png)

- **✓ Verified.** A green tick means a platform administrator checked the
  entry against an official source (a ministerial decree, a publisher's
  page). Open the subject's **Verified** badge to see the source and the date
  it was checked. Above the filters, a line says how many subjects are
  verified so far. Entries without a tick come from the sources listed at the
  end of the page; check them before contracting content.
- **✎** on a book means it has a note, an assignee, a status or a due date
  (section 6). Removing such a book asks for confirmation, because its note
  and assignment are removed with it.
- **Select all shown** adds every book currently listed (after filters);
  **Clear** empties the scope after confirmation.

### Your list, copied or downloaded

**View list** shows the selection as plain text, grouped by grade and
subject. **Copy list** copies that text. **Download…** saves the scope as
**TXT**, **CSV** or **JSON**. CSV and JSON need the Starter plan or above, and
every download counts toward the plan's monthly exports. CSV and JSON include
each book's verification, note, assignee, status and due date.

![The selection shown as a list under the bottom bar](user-guide/images/picker-tray.png)

### Viewers

Viewers see the same picker, but books cannot be clicked. The scope bar says
**Read-only: viewers cannot change selections**, and so does a message when a
viewer tries.

![The picker as Salma, a viewer: books are greyed and a read-only message is shown](user-guide/images/picker-viewer.png)

A scope above the plan's scope limit (after moving to a smaller plan) is also
read-only, with its own message.

## 5. Scopes: list, duplicate, compare

**Scopes** in the menu lists the organization's scopes and how many the plan
allows.

![Content scopes: two scopes with their year, number of items, notes and buttons](user-guide/images/scopes.png)

For each scope:

- The **name** opens it in the picker.
- **Notes and assignees** (the "2 with notes · 3 assigned" link) opens its
  notes page; "1 for you" counts the books assigned to you.
- **Edit** renames it or changes its description.
- **Duplicate** copies it, with its books, notes and assignments, under a new
  name (here "Primary 1–3 core books — Campus B", a second campus that swaps a
  few books). The copy opens in the picker.
- **Delete** removes it for everyone, after confirmation.
- When a newer catalogue exists, **Carry to 2027/2028…** appears
  (section 9).

### Comparing two scopes

**Compare scopes** shows which books each of two scopes includes, grade by
grade. The cards count the books only in the first, only in the second, and
in both. **Show only differences** hides books both scopes share. **Swap**
exchanges the two. **Download comparison (CSV)** saves it (Starter plan and
above; counts as an export).

![Compare scopes: one book only in the first scope, two only in Campus B, 11 in both](user-guide/images/compare.png)

Scopes from different years can be compared. Books are then matched by
subject and title, and a book missing from one year's catalogue is marked.

## 6. Notes, assignees, statuses and due dates

Every selected book can carry a short note and be assigned to one member, with
a status (To do, In progress, Done) and an optional due date. Open the page
from **Notes and assignees** in the picker's scope bar or on the Scopes
page.

![Notes and assignees: counts, filters, the bulk bar and the books of Primary 1](user-guide/images/notes-page.png)

- The cards at the top count the selected books, those with a note, those
  assigned, those assigned to you, and those overdue.
- **Show** filters the list: all, assigned to me, with a note, assigned, not
  assigned, not done yet, overdue, done. **Grade** and **Search** narrow it
  further (search covers book, subject, note and person).
- **Progress** shows the status, the due date, and **due soon** (today or in
  the next two days) or **overdue** (after the due date, until the book is
  Done).
- Under each note: who changed it last, and when.

### Editing one book

**Edit** on a row opens the note and assignee dialog:

![The note and assignee dialog for “Ministry textbook (Term 1 & Term 2)”](user-guide/images/note-dialog.png)

The note can be up to 500 characters, and everyone in the organization can
read it. **Assigned to** lists the organization's members. The due date is
optional; the date field follows your computer's regional format.

### Changing several books at once

Tick books in the list (or the box in a grade's header to tick every book
shown in that grade). Then choose in the **Change several books** bar what to
set: assignee, status and/or due date. **Keep as it is** leaves a field
unchanged. Click **Apply to the chosen books**.

![The Change several books bar, with two books chosen](user-guide/images/notes-bulk.png)

Assigning books notifies the assignee (section 7). Viewers can read this page
but not change it.

## 7. Notifications and My assignments

### Notifications

The bell in the top bar shows how many notifications are unread. It opens the
list; **Open** goes to the page concerned. Notifications arrive when books
are assigned to you, when books you follow are due soon or overdue, when a new
catalogue year is published for your scopes, and after a payment.

![Karim's notifications: Mona Hassan assigned you 1 book](user-guide/images/notifications.png)

### My assignments (this organization)

**My assignments** in the menu (with a count of open books) lists the books
assigned to you in this organization's scopes: overdue first, then by due
date. Change a book's **Status** right in the list. **Show** switches between
Not done yet, Done and All.

![Karim's My assignments: one overdue book and one due soon](user-guide/images/my-assignments.png)

### My assignments in all my organizations

If you belong to several organizations, the link at the top of My assignments
opens one list across all of them, with a line counting the open books in
each. Organizations that are suspended, or that require two-factor
authentication you have not set up, are left out with a note.

![My assignments in all my organizations: three books across two organizations](user-guide/images/my-assignments-all.png)

### Several organizations

The organization menu in the top bar switches between your organizations;
**New organization…** creates another. Your account page lists them all.

![The top bar with the organization menu, bell, language, account and sign-out buttons](user-guide/images/organization-switcher.png)

## 8. Members and invitations

**Members** lists who belongs to the organization: their role, whether they
use two-factor authentication, and when they joined.

![Members: Mona (owner) and Karim (editor); Salma's invitation is pending](user-guide/images/members.png)

- **Invite someone**: enter an email and a role, then **Send invitation**. Seats
  count members plus pending invitations; the line above the form shows how
  many of the plan's seats are used.
- **Pending invitations** can be resent or revoked. An invitation expires
  after 7 days.
- Owners and admins change a member's **Role** in the list (admins manage
  editors and viewers) or **Remove** them. A member can **Leave**.
- **Make owner** (owner only) transfers ownership after you enter your
  password. You become an admin and lose billing control.

### Accepting an invitation

The invitation email links to a page that names who invited you, to which
organization, and with which role. Someone new enters their name and a
password and clicks **Create account and join**. The email is already
confirmed, because the invitation proved it. Someone with an account signs in
and accepts.

![Karim's invitation: “Mona Hassan invited you to Nile Valley Language School as Editor”](user-guide/images/invitation.png)

## 9. A new academic year: carrying a scope forward

When the platform publishes the next year's catalogue (section 17), each
scope still on the old year shows a banner in the picker. Editors also get a
notification and an email.

![The picker header: “A newer catalogue (2027/2028) has been published. Carry this scope forward”](user-guide/images/carry-banner.png)

![Notifications: the 2027/2028 catalogue is published, for each organization's scopes](user-guide/images/notifications-catalogue.png)

**Carry this scope forward** (or **Carry to 2027/2028…** on the Scopes page)
opens a review of what changed before anything is saved:

![Carrying “Primary 1–3 core books — Campus B” to 2027/2028: 12 of 13 items carry over; one is not in the new catalogue](user-guide/images/carry-review.png)

- **Summary**: how many selected books carry over as they are, how many need a
  decision, and how many notes and assignments go with their books.
- **Not in the new catalogue**: books with no counterpart next year. Tick a
  replacement when one is offered ("New in 2027/2028 — add instead").
- **Changes to subjects you cover** and **New in subjects you cover** list
  renamed books, changed subjects and new titles.
- **Carried over**: open it and untick anything to leave out.
- **How to carry it**: create a new scope for the new year and keep the old
  one (choose its name), or move this scope to the new year, replacing its
  selection. If the plan has no room for another scope, only moving is
  offered.
- **Carry forward** saves it and opens the result in the picker.

## 10. Billing

**Billing** (owners and admins; only the owner changes the plan) shows the
current plan, this month's usage, the plans, and invoices.

![Billing during the trial: Professional trial, usage meters and the plans](user-guide/images/billing.png)

- **Current plan**: the plan, its state (trial, active, past due, free) and
  what happens next, such as the date a trial ends or the plan renews.
- **Usage this month**: seats, scopes, exports and API requests against the
  plan's limits.
- **Plans**: choose monthly or yearly, then:
  - **Subscribe** during a trial or on the Free plan. This includes the plan
    you are trialling.
  - **Upgrade now** for a higher plan on the same interval. You pay a
    prorated invoice for the rest of the period.
  - **Switch at renewal** for a lower plan or another interval.
  - **Move to Free at period end**, or **Cancel subscription**: you keep the
    plan until the period ends; nothing is deleted. **Keep my subscription**
    undoes it.
  - **Contact sales** for Enterprise.
- **Invoices to pay** and **Invoices**: open invoices have **Pay**; every
  invoice has its number, amount and status.

Subscribing opens the payment provider's checkout page. In production that is
Paymob, once its account keys are set. On this test server it is the sandbox
checkout, which moves no money:

![Sandbox checkout (test mode) for Professional, monthly: invoice INV-2026-001000, EGP 2,900](user-guide/images/checkout.png)

After payment you return to Billing, which waits for the provider's
confirmation and then shows **Payment received**. The owner also gets an email
receipt.

![Billing after subscribing: Professional, active, renews on 26 Nov 2026](user-guide/images/billing-subscribed.png)

**Renewals.** A week before renewal, the owner gets the renewal invoice by
email. If it is not paid by the renewal date, the plan stays active for a
7-day grace period and the top bar shows **Payment overdue — Pay now**. After
that, the organization moves to the Free plan; nothing is deleted. Three days
before a trial ends, the owner gets a reminder.

## 11. Students and the student portal

Schools can create accounts for their students. A student signs in with the
school's code, a username and a password; no email is needed. They see the
books the school chose for their grade, in the scope the school assigns. The
student portal is off until a platform administrator turns it on for the
school (no plan includes it yet). After that, **Students** appears in the menu
of owners and admins.

![Students: how students sign in, the school code and link, accounts in use, and the list of four students](user-guide/images/students.png)

- **How students sign in**: the school code and a sign-in link with the code
  filled in. **Copy sign-in link** copies it. On this test server the link
  starts with `http://localhost:3100`; on a live server it shows your
  address.
- **Add student**: a username (3–40 letters, digits, dots, dashes or
  underscores), the student's name, the grade, and the **Curriculum**: the
  scope whose books the student sees.

  ![Add a student: omar.khaled, Omar Khaled, Primary 1, Primary 1–3 core books](user-guide/images/student-add-dialog.png)

- The password is shown **once**, with the school code. Write it down or
  **Download passwords (CSV)**. **New password** in the list sets a fresh one
  and signs the student out everywhere.

  ![Student passwords: Omar Khaled's password and the school code](user-guide/images/student-passwords.png)

- **Import CSV…** adds up to 300 students from a spreadsheet with the columns
  `username`, `name`, `grade` (1–12) and, optionally, `scope` (a scope's
  name). In Excel, save as "CSV UTF-8". **Download a template** gives the
  layout. The file is checked first: problems are listed by line, and nothing
  is imported until there are none.

  ![Import students: two students ready, one problem on line 4 (a space in the username)](user-guide/images/student-import.png)

- **Edit** changes a student's name, grade or curriculum; **Remove** deletes
  the account for good.
- **Privacy**: only each student's name, username, grade and curriculum are
  stored. Platform staff see only how many student accounts a school has.

### The student portal

Students open the sign-in link (or **Student? Sign in with your school
account** on the sign-in page) and enter the school code, their username and
their password.

![Student sign-in: school code, username and password](user-guide/images/student-sign-in.png)

They see **My curriculum**: the books of their grade, grouped like the picker,
with the kind of each book. They can change their password and switch to
Arabic. Students cannot change the list; it says to ask a teacher if
something is missing.

![Omar's curriculum: the books Nile Valley Language School chose for Primary 1](user-guide/images/student-portal.png)

![The same page in Arabic, right to left](user-guide/images/student-portal-arabic.png)

## 12. Organization settings: API keys, webhooks, support access

**Settings** (owners and admins):

![Organization settings: name, default language, the two-factor rule, API keys and webhooks](user-guide/images/settings.png)

### Organization

The organization's **Name** and **Default language**, which is used for
invitation emails. **Require two-factor authentication for owners and
admins** (Starter plan and above) makes them set it up before they can open
the organization.

### API keys (Professional and above)

API keys give read-only access to your scopes and the catalogue, for your own
content pipeline (`GET /api/v1/scopes`, `/api/v1/scopes/:id`,
`/api/v1/catalog/versions`). Enter a name and click **Create key**. The key is
shown **once**; copy it then.

![API key created: the key and an example curl command](user-guide/images/api-key-created.png)

The list shows each key's start, when it was last used, and **Revoke**.
Details are in `docs/API_DOCUMENTATION.md`.

### Webhooks (with API access)

Webhooks tell your own systems when a scope changes. Each change is sent to
your address as a signed POST request. Add up to 5 endpoints: an **https**
address of your system (private and local addresses are refused), an optional
description, and which events to send. The events are scope created, renamed
or described, deleted, books added or removed, and notes, assignees, statuses
or due dates changed.

The signing secret is shown once. Your system checks each request's
`X-CurriculumScope-Signature` header with it before trusting the request.

![Endpoint added: the signing secret and how to check the signature](user-guide/images/webhook-secret.png)

![The webhook endpoint in Settings: its events, last delivery and buttons](user-guide/images/settings-webhooks.png)

The demo's endpoint is a local address (`http://127.0.0.1:…`), which only a
test server accepts. For each endpoint:

- **Send test** sends a test event.
- **Deliveries** shows what was sent and the result.
- **Edit** changes the address, the events, or switches the endpoint off.
- **New secret** replaces the signing secret.
- **Delete** removes the endpoint.

Failed deliveries are retried; an endpoint that keeps failing is switched off
and marked.

![Deliveries: a books-changed event and a test, both delivered (200)](user-guide/images/webhook-deliveries.png)

In **Deliveries**, open **Payload** to see what was sent, and use **Send
again** to repeat a delivery. **Download history (CSV)** saves the kept
deliveries. Deliveries are kept for 30 days.

### Support access (owner)

The platform's support team **cannot see your scopes** unless the owner
allows it here, with a reason and a duration (for example 24 hours). Every
view by support is recorded in your audit log. **Revoke** ends it early.

![Support access granted for ticket 2041 until the next day; the Danger zone below](user-guide/images/settings-support.png)

### Danger zone (owner)

**Delete organization** permanently deletes the organization with all its
scopes, members, invitations, API keys and billing records. You confirm it by
typing the organization's name and your password.

## 13. Audit log

**Audit log** (owners and admins) is the organization's security and change
history: sign-ins, scope changes, members, invitations, billing, API keys,
webhooks, support access, students. The plan decides how long entries are
kept (7 to 730 days). **Filter** by the start of an action, such as
`scope.`, `member.` or `billing`. **Older entries** loads more.

![Audit log: support access granted, a scope changed, a webhook tested and created, an API key created, a student sign-in](user-guide/images/audit-log.png)

**Who** shows the person's email. Students have no email, so a student's
sign-in shows "user" there and the username under **Details**. Wide entries
scroll sideways inside the table.

## 14. Your account

Click your name in the top bar.

![Your account: profile, email choices, password and security](user-guide/images/account.png)

- **Profile**: your name and language, and your email choices:
  - emails when the catalogue changes for your scopes;
  - emails when books are assigned to you: right away, one summary each
    morning (from 8:00 Cairo time, across all your organizations), or none;
  - reminders when your books are due soon or overdue.
- **Password**: change it with your current password; your other sessions
  are signed out.
- **Security**: **Set up two-factor authentication**. Scan the QR code with an
  authenticator app (Google Authenticator, Microsoft Authenticator,
  1Password…) or type the key, then enter the 6-digit code. Save the recovery
  codes shown next; each works once if you lose your phone. Platform
  administrators must keep two-factor authentication on.

  ![Setting up two-factor authentication: the steps, QR code and key](user-guide/images/account-two-factor.png)

- **Active sessions**: where you are signed in, with **Sign out** for each
  and **Sign out all other sessions**.
- **Organizations**: yours, with your role, and **Create organization**.
- **Your data**: **Download my data (JSON)** (your profile, memberships,
  sessions, notifications and recent activity) and **Delete my account**.
  Transfer or delete the organizations you own first.

## 15. Arabic and phones

**العربية** in the top bar switches the whole interface to Arabic, laid out
right to left; **English** switches back. Your choice is saved in your
account. Catalogue entries keep their English and Arabic names, and English
book titles are marked so screen readers read them in English.

![The picker in Arabic](user-guide/images/picker-arabic.png)

![The scopes list in Arabic](user-guide/images/scopes-arabic.png)

On a phone, the layout stacks: the menu wraps and stays at the top of the page
rather than following you down. Each subject's books sit under its name, and
the selection bar stays at the bottom.

![The picker on a phone: Primary 1 with chosen books, notes marked ✎](user-guide/images/picker-phone.png)

## 16. Emails the system sends

All emails are plain text, in the person's language. Links to other people's
data always need signing in. Examples from the demo (links shortened):

**Confirm your email** (on sign-up; the link expires in 48 hours)

```text
Hello Mona Hassan,

Confirm your email address to activate your account:
https://…/verify-email?token=…

The link expires in 48 hours. If you did not sign up, ignore this message.

— Curriculum Scope
```

**Invitation** (expires in 7 days)

```text
Mona Hassan invited you to join Nile Valley Language School as editor.

Accept the invitation:
https://…/invite?token=…

The invitation expires in 7 days.

— Curriculum Scope
```

**A book was assigned to you** (right away; or one morning summary, as you
choose)

```text
Mona Hassan assigned you a book to follow up in the scope “Primary 1–3 core books” (Nile Valley Language School):
• Ministry assessments book (weekly tests)

See your books, their notes and due dates:
https://…/org/…/scopes/…/items?show=mine

You receive this because books were assigned to you. Turn these emails off in your account settings: https://…/account

— Curriculum Scope
```

**Books due soon or overdue** (each book is reminded once when due soon and
once when overdue; sent from 8:00 Cairo time)

```text
Hello Karim Adel,

These books assigned to you in Nile Valley Language School need attention:

Overdue (1):
• Ministry assessments book (weekly tests) — “Primary 1–3 core books”, was due 19 Oct 2026

Due soon (1):
• Ministry textbook (Term 1 & Term 2) — “Primary 1–3 core books”, due tomorrow

Update their status or see all your books:
https://…/org/…/assignments

You receive this because books with a due date are assigned to you. Each book is reminded once when it is due soon and once when it is overdue. Turn these emails off in your account settings: https://…/account

— Curriculum Scope
```

**A new catalogue year is published** (to editors, admins and owners)

```text
The 2027/2028 catalogue (Egypt K-12 curriculum — academic year 2027/2028) is now available in Curriculum Scope. These content scopes of Nile Valley Language School still use an older catalogue:
• Primary 1–3 core books
• Primary 1–3 core books — Campus B

Review what changed for each scope (missing books, new editions, subject changes) and carry it forward:
https://…/org/…/scopes

You receive this because you can edit scopes in Nile Valley Language School. Turn these emails off in your account settings: https://…/account

— Curriculum Scope
```

**Payment received**

```text
We received EGP 2,900.00 for invoice INV-2026-001000 (Nile Valley Language School). Thank you.

— Curriculum Scope
```

The system also sends:

- password reset links;
- a notice when your password changes;
- a notice when someone tries to sign up with your address;
- ownership transfers;
- catalogue entries flagged for review;
- the daily summary of assigned books;
- the trial-ending reminder and the end of the trial;
- renewal invoices, failed payments and overdue renewals;
- the end of a subscription.

## 17. Platform administration

Platform administrators run the service. Their menu replaces the organization
menu. They must sign in with two-factor authentication. They **do not**
see customers' scopes, notes or students, except while an organization's
owner has granted support access. Then every view is recorded in that
organization's audit log.

### Overview

![Platform overview: revenue, organizations, users, plans, platform health and alerts](user-guide/images/admin-overview.png)

The **Overview** shows:

- monthly recurring revenue and the last 30 days' revenue;
- active, suspended and new organizations, and the number of users;
- organizations by plan and by billing state;
- **Platform health**: the database, migrations, the background worker, the
  email outbox, failed webhooks, the billing provider and the server;
- **Alerts**: active and recently resolved operational alerts, the
  configured alert channels (email, webhook) and **Send test alert**.

The demo server ran without the background worker, so its health shows **no
heartbeat** and its emails wait in the outbox. A live server runs the worker
and sets an alert channel.

### Organizations

![Organizations: name, plan, members, scopes, status and creation date](user-guide/images/admin-organizations.png)

**Search** finds an organization; its name opens it:

![An organization: subscription, manual plan assignment, members and support access](user-guide/images/admin-organization.png)

- **Suspend organization** / **Restore organization**, with a reason recorded
  in the audit log.
- **Subscription** and **Manual plan assignment**: set a plan, status and
  period end (open-ended for contracts), with optional overrides for seats
  and **Student accounts**. A number there turns the student portal on for
  that school, up to that many accounts.
- Open invoices can be **Mark paid** for payments received offline (bank
  transfer, cheque).
- **Members**, the number of scopes and student accounts.
- **Support access**: with an active grant from the owner, **View customer
  scopes** (audited). Without one: "No active grant. Customer business data is
  not accessible."
- The organization's audit log.

### Users

![Users: name, email, status, two-factor and last sign-in](user-guide/images/admin-users.png)

Search users; **Suspend** or **Restore** an account (with a reason);
**Unlock** an account locked by wrong passwords.

### Catalogue

The catalogue has one version per academic year. A published version is
read-only for content. Its verification marks can still be updated. To
prepare the next year, create a **draft** copied from an existing version:

![Catalogue versions, and the form for a new 2027/2028 draft](user-guide/images/admin-catalogue-versions.png)

Opening a version shows its grades and subjects, with **Verified: x/231
subjects, y/1038 materials** and a **Show** filter (all, not verified,
verified, needs review). In a draft, subjects and materials can be added and
edited.

![The 2026/2027 catalogue in the editor: Primary 1, with Arabic Language verified](user-guide/images/admin-catalogue-editor.png)

**Verification…** on a subject (or **Verify whole grade…**, or **verify** on a
material) records the result of checking it against an official source:

- **Verified**, with the source (required), an optional link, and optionally
  the subject's materials too;
- **Needs review**, with a public note (required);
- **Not verified**.

Customers see the status, date, source and note, but not who reviewed the
entry. Changing an entry's content in a draft clears its mark.

![The verification dialog: Verified against Ministerial Decree 123/2026, also applied to its 7 materials](user-guide/images/admin-verification-dialog.png)

**Download spreadsheet (CSV)** and **Upload edited spreadsheet…** let you do
the same work in Excel. In a draft, the spreadsheet can also correct entries
and add materials (an empty `material_id`). Save as "CSV UTF-8". Every change
is listed before it is applied, and nothing is saved while the sheet has
problems.

![Spreadsheet preview: 1,268 rows read, 3 verification marks changed](user-guide/images/admin-spreadsheet-preview.png)

**Publish** makes a draft available to every customer and freezes its
content. Customers whose scopes use an older year are then notified
(section 9). **Archive** keeps an old version readable for existing scopes
but stops new scopes from choosing it.

![Publish: “Publishing makes this version available to all customers and freezes its content”](user-guide/images/admin-publish-dialog.png)

### Plans

![Plans: name, prices in piastres, limits and features as JSON, active](user-guide/images/admin-plans.png)

Edit each plan's name, monthly and yearly price (in piastres: 99000 is
EGP 990), limits and features (as JSON; `null` means unlimited), and whether
it is active. Changes apply to new invoices, including a subscription's next
renewal invoice; invoices already issued keep their amount.

### Audit and payment webhooks

**Audit** is the platform-wide audit log, filtered by action, actor email or
organization.

![The platform audit log](user-guide/images/admin-audit.png)

**Webhooks** lists the payment provider's notifications (processed, ignored or
failed), for checking payments.

![Payment provider webhooks: one processed payment.succeeded from the sandbox](user-guide/images/admin-events.png)

## 18. Limits and things to know

- **Plan limits** apply as you work. When a limit is reached (seats, scopes,
  exports, students, API requests), the message says which limit and, for the
  owner, links to Billing.
- **Catalogue verification**: the catalogue's entries are being verified
  against official sources. Until a subject shows **✓ Verified**, check it
  against the Ministry's decree or the publisher before contracting content.
- **Payments**: this guide's screenshots use the test-mode checkout. Live
  payments go through Paymob once the account's keys are configured.
- **Students**: the portal is turned on per school by a platform
  administrator.
- **Integrations**: the read API and webhooks are part of the Professional
  plan and above. Single sign-on (Google, Microsoft) is not available yet.

---

## About this guide

The screenshots are produced by `tests/e2e/user-guide.spec.ts`, using
`npm run docs:screenshots` (config `playwright.guide.config.ts`). It starts the
same test server and fresh database as the end-to-end tests. It then builds
the demo school through the interface, as its people would: sign-up, scopes,
members, notes, a new catalogue year, payment, students, settings and the
admin console. Each screen is saved to `docs/user-guide/images/`. Run it after
changing the interface, and check that the pictures still match the text. The
run fails if a step stops working, and also if a dialog's content is wider
than the dialog.
