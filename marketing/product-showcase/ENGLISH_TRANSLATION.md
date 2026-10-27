# English translation of the narration

The English translation used for the English subtitles (english.srt, english-3min.srt). Times are estimates until the narration is recorded; then they come from the recording.

## Curriculum Scope — Product Showcase

Estimated duration 19:38.6 · 1819 Arabic words · 59 scenes · 134 lines

### 1. The education challenge

**c1-open** · 00:00.0–00:21.3

- `00:02.6` At the start of every academic year, schools and educational institutions face the same questions.
- `00:09.6` Which books will we teach? Which edition? For which grades and tracks?
- `00:15.1` Who follows up on homework, tests and grades? And where are the answers kept?

**c1-problems** · 00:21.3–00:59.8

- `00:21.8` In many institutions, those answers are spread across separate spreadsheets, chat groups and tools that do not connect to each other.
- `00:31.1` Each department may work its own way, so a unified picture of what is really happening is hard to get.
- `00:37.5` Manual follow-up takes up teachers’ and administrators’ time, instead of it going to teaching itself.
- `00:45.1` And the student may have no single place to see what is due, what they have done, and how they are progressing.
- `00:52.5` These are not verdicts on every institution, but questions we hear often — and they deserve a better answer.

**c1-question** · 00:59.8–01:09.6

- `01:00.4` So how can an educational institution connect its people, its processes and the learning experience in one integrated platform?

**c1-reveal** · 01:09.6–01:18.1

- `01:11.4` Introducing: Curriculum Scope — نطاق المناهج.

### 2. Product vision

**c2-origin** · 01:21.7–01:55.4

- `01:22.3` The idea began with a simple tool: a single page for choosing Egypt’s curriculum, from Primary 1 to Secondary 3.
- `01:31.7` It was designed to define the content scope of an education product for the 2026/2027 academic year.
- `01:40.3` But it worked in one browser only — no accounts, no sharing, no record of decisions.
- `01:47.4` Today it is an integrated cloud platform, delivered as SaaS, for school teams, their teachers and their students.

**c2-layers** · 01:55.4–02:25.6

- `01:55.9` The platform rests on three connected layers.
- `01:59.6` The first is the curriculum: an up-to-date catalogue of Egypt’s curricula, where the institution decides what it covers and keeps a record of that decision.
- `02:08.0` The second is the classroom: classes, homework, online tests and a gradebook, built on that curriculum.
- `02:16.9` The third is the institution: roles, permissions, subscriptions, the audit log and protection.

**c2-flow** · 02:25.6–02:50.9

- `02:26.1` The value of integration is that information is entered once, then travels to where it is needed.
- `02:32.4` The books the school chooses become the class’s curriculum; from them the teacher picks the homework material, and the mark then reaches the gradebook and the student.
- `02:43.3` All with one account, one sign-in and one interface, in Arabic and English.

**c2-principles** · 02:50.9–03:08.8

- `02:51.3` And it is built on clear principles: Arabic first, with full right-to-left support;
- `02:59.4` privacy by design, accessibility for everyone, and automated tests that check every main user journey.

### 3. Target customers

**c3-segments** · 03:12.4–04:47.5

- `03:12.9` Who is this platform for? Groups with different needs, brought together by the curriculum.
- `03:19.1` First: private and international schools, and school groups.
- `03:24.3` They need to coordinate what is taught in every grade and every campus, and to follow the daily work of teachers and students.
- `03:32.2` The platform gives them shared content scopes, comparison between campuses, classes, homework and tests, a gradebook, and a student portal.
- `03:42.6` Second: education technology companies, content producers and publishers.
- `03:49.2` Their key question: which part of the curriculum do we cover this year? The platform keeps the answer and sends it to their systems through an API and signed webhooks.
- `04:02.1` Third: tutoring centres and curriculum consultants, who prepare clear coverage plans, export them and compare them.
- `04:11.0` Universities and higher education are a later expansion opportunity; they are not fully supported today.
- `04:19.1` Classes, tests and the gradebook can be used, but the catalogue is designed for pre-university education, and there are no credit hours or course registration yet.
- `04:31.1` In every case, the intended value is the same: a clear, documented decision, less repeated work, and a clearer view.
- `04:39.6` It is value that partner institutions will measure in the pilot — not figures we claim in advance.

### 4. Platform walkthrough

**c4-signup** · 04:51.1–05:10.1

- `04:51.7` Let’s start the tour at the beginning. Mona creates an account for her school in one step: her name, her email and the school’s name.
- `05:01.1` She receives an email to confirm her address, then signs in, and her first organization starts with a 14-day trial.

**c4-2fa** · 05:10.1–05:21.9

- `05:10.5` To protect accounts, the platform supports two-step verification: it is mandatory for platform administrators, and an organization can require it for its owner and admins.

**c4-account** · 05:21.9–05:31.9

- `05:22.2` From the account page, each user turns on two-step verification, sees their active sessions, and downloads their personal data whenever they like.

**c4-members** · 05:31.9–05:54.3

- `05:32.3` Next, Mona invites her team. Each member has a role: owner, admin, editor or viewer.
- `05:40.4` Karim receives the invitation link, chooses his password and joins right away.
- `05:46.0` Permissions are enforced on the server itself, not only in the interface: a viewer can see, but cannot change anything.

**c4-tenancy** · 05:54.3–06:02.4

- `05:54.7` One person can belong to more than one organization and switch between them from the menu at the top of the page.

**c4-isolation** · 06:02.4–06:14.1

- `06:02.8` This is multi-tenancy at work: every organization is isolated from the others inside the database itself, with row-level security policies.

**c4-navigation** · 06:14.1–06:37.6

- `06:14.5` Navigation is clear: the curriculum guide, scopes, classes, students, members, billing, settings and the audit log.
- `06:24.9` The notifications bell tells each member what concerns them, in their own language.
- `06:29.4` With one click, the whole interface switches from Arabic to English, and from right-to-left to left-to-right.

**c4-access** · 06:37.6–06:55.8

- `06:38.0` The same interface works on a phone, and it is designed to be accessible: 149 screens were checked automatically against the WCAG guidelines, with no findings.
- `06:50.1` A manual review with a screen reader is still a step ahead of the launch.

**c4-oversight** · 06:55.8–07:20.3

- `06:56.2` Every important action is recorded in the audit log: who did what, and when.
- `07:01.8` At platform level, the operations team has an admin dashboard showing organizations, subscriptions, system health and alerts.
- `07:11.1` But it cannot see a school’s work unless the school grants temporary access, and every access is logged in the school’s own log.

### 5. Feature showcase

**c5-card** · 07:20.3–07:27.1

- `07:21.5` Now to the features in detail, as they actually work in the platform.

**c5-catalogue** · 07:27.1–07:53.8

- `07:27.5` At the heart of the platform is the curriculum catalogue: twelve grades, five tracks and 231 subjects, with more than a thousand books and references.
- `07:38.7` From Ministry schools to the new Egyptian Bakaloria, Thanaweya Amma and international programmes.
- `07:46.9` The team picks grades, then ticks books with a click, and every choice is saved automatically.

**c5-verified** · 07:53.8–08:07.1

- `07:54.1` The platform team records the review of each subject and its source, and schools see a verification mark beside it.
- `08:02.1` So everyone knows what has been checked, and against which source.

**c5-scopes** · 08:07.1–08:23.7

- `08:07.4` Each selection is saved as a named content scope, shared by the whole team, and it can be copied for another campus.
- `08:15.0` A scope can be exported as text, a CSV table or a JSON file, or read directly through the API.

**c5-compare** · 08:23.7–08:33.6

- `08:24.0` On the comparison page, two scopes sit side by side — even from different academic years — and only the differences are shown.

**c5-notes** · 08:33.6–08:47.3

- `08:33.9` Each selected book can have a note, a person responsible for following it up, a status and a due date.
- `08:40.4` Mona assigns tasks to her team in one go, and each member is notified in their own language.

**c5-assignments** · 08:47.3–09:04.9

- `08:47.6` On “My assignments”, each member sees what they owe across all their organizations, overdue first.
- `08:54.0` Reminders go out as a due date approaches and once it has passed, and each member chooses to get assignment emails right away or in one morning summary.

**c5-newyear** · 09:04.9–09:28.7

- `09:05.2` With each new academic year, the platform team publishes an updated edition of the catalogue, and schools are notified at once.
- `09:13.7` In one step, the scope is carried to the new year, with a review showing what changed, what was removed and what can be carried.
- `09:22.5` Notes and responsibilities move with it, so the team does not start from zero.

**c5-students** · 09:28.7–09:54.8

- `09:29.3` Now to the classroom. The school creates its students’ accounts itself, one by one or from a roster file.
- `09:38.0` A preview catches the file’s mistakes before import, with clear Arabic messages, then gives out one-time passwords.
- `09:46.5` Students need no email address and cannot sign themselves up: the school is responsible for the account.

**c5-classes** · 09:54.8–10:13.9

- `09:55.1` Then the class is created: its name, its grade and its curriculum from the school’s scope — then its students, and a teacher for each subject.

**c5-homework** · 10:13.9–10:39.5

- `10:14.2` The teacher sets homework linked to the curriculum’s books, with instructions, a due time and a full mark.
- `10:22.1` They see who handed in, who was late and who has not, then mark it, write a comment and return the work to the student.
- `10:30.4` Every file a student uploads is scanned for viruses before anyone opens it, and photos are resized with their location data removed.

**c5-tests** · 10:39.5–11:01.7

- `10:39.8` Online tests come with complete tools: multiple choice, true or false, short answers and written questions.
- `10:49.2` The teacher sets the time, the number of attempts and a start code read out in the room. The server keeps the time — not the student’s device.

**c5-monitor** · 11:01.7–11:27.7

- `11:02.0` On the live monitoring screen, the teacher sees each student’s state, the time left and the number of answers.
- `11:10.1` And sees what the page noticed: leaving it, pasting into it, or losing the connection — with no camera, no microphone and no screen recording.
- `11:21.2` They can give extra time or another attempt, or close the test at once.

**c5-marking** · 11:27.7–11:43.4

- `11:28.0` Every question is marked automatically with fixed rules — accepting Arabic spelling variants — except written answers, which the teacher marks.
- `11:37.4` No AI sets any mark: the decision always rests with the teacher.

**c5-gradebook** · 11:43.4–11:54.1

- `11:43.7` Marks come together in the gradebook: a row per student, a column per homework and test, with the average and a CSV download.

**c5-teacher-value** · 11:54.1–12:22.4

- `11:54.6` So what does the teacher gain? Their class’s homework, tests and marks in one place, tied to the curriculum they teach.
- `12:04.2` Manual follow-up gets lighter: hand-ins and late work show up by themselves, and objective questions are marked automatically.
- `12:12.9` And the educational decision stays in their hands: they review, adjust, write their comments, and decide when students see the results.

**c5-governance** · 12:22.4–12:41.3

- `12:22.7` Around all of this are tools for integration and governance: API keys, and webhooks with their delivery history;
- `12:31.3` retention periods for classroom data that each school sets, with notice fourteen days before anything is deleted — and an audit log for all of it.

### 6. Student experience & AI

**c6-signin** · 12:44.9–12:56.1

- `12:45.4` Now, let’s look from the student’s side.
- `12:48.5` Omar signs in with his school code, username and password, from a computer or a phone.

**c6-today** · 12:56.1–13:07.1

- `12:56.4` The Student Portal opens on “Today”: what he has to do, what he missed, what came back marked, and the tests open right now.

**c6-homework** · 13:07.1–13:21.2

- `13:07.4` He opens the homework, writes his answer or photographs his sheet and attaches it, then hands it in.
- `13:13.3` He can take his work back to change it until it is marked, and when the teacher returns it, he sees his mark and the comment.

**c6-test** · 13:21.2–13:42.5

- `13:21.5` In a test, he enters the start code, the countdown begins, and every answer is saved as he writes it.
- `13:29.3` If the connection weakens, the page retries by itself and tells him what is not saved yet.
- `13:36.1` And the page tells him plainly what the teacher can see during the test.

**c6-result** · 13:42.5–13:51.5

- `13:42.8` After he submits, the result appears when the teacher decides, with the correct answers if the teacher allows them to be shown.

**c6-grades** · 13:51.5–14:09.2

- `13:51.8` In “My grades” Omar sees his marks in each subject, and in “My books” his curriculum, as his school chose it.
- `13:59.0` A clear portal, in Arabic or English, designed to be accessible to all, bringing the student’s school day together in one place.

**c6-student-value** · 14:09.2–14:35.8

- `14:09.7` And what does the student gain? One place for the school day, showing what is due and when, without searching through scattered messages.
- `14:19.9` And a fair test experience: time kept by the server, equally for everyone, answers saved as they go, and clarity about what the teacher sees.
- `14:30.2` All in their own language, from their phone, with an account their school manages.

**c6-ai-status** · 14:35.8–14:58.4

- `14:36.4` And what about artificial intelligence? We want to be precise here.
- `14:41.7` Today the platform includes no artificial-intelligence feature, and its integration with the Wise EduAgent educational assistant has not been built yet.
- `14:51.0` Inspecting the Wise application and choosing an AI provider are both steps still ahead.

**c6-ai-vision** · 14:58.4–15:38.9

- `14:59.0` What we show now is a future vision, not a feature ready to sell.
- `15:03.8` An educational assistant inside the same student portal, with the same account, that knows the curriculum the school has chosen.
- `15:12.0` It could help a student understand a lesson, organize their study and practise questions, and help teachers prepare.
- `15:20.7` Its rules are set in advance: every answer is labelled as machine-generated, it never changes an official record or a grade, and it is subject to usage limits within the same subscription.
- `15:32.3` AI here is meant to support teachers and students — not to replace the teacher.

**c6-ai-ready** · 15:38.9–15:50.2

- `15:39.3` The foundation it needs is ready today: student identity, curriculum context, subscriptions, usage metering and the audit log.

### 7. SaaS model & commercial value

**c7-plans** · 15:53.8–16:38.2

- `15:54.3` The platform runs on an institutional subscription model: a free plan, paid plans, and an enterprise plan under a custom contract.
- `16:03.0` The prices shown are launch proposals, open to review.
- `16:07.9` Each plan’s limits are enforced on the server: members, scopes, exports, API requests and the features available.
- `16:18.2` The system runs the whole subscription cycle: trial, upgrade, renewal, invoices, and a grace period when a payment is late.
- `16:28.1` The Paymob payment integration is built and tested against a simulation of its interface, and awaits the merchant account keys to go live.

**c7-isolation** · 16:38.2–17:04.3

- `16:38.7` Technically, all organizations run on one system, but each one’s data is isolated by security policies inside the database.
- `16:47.8` So even if a piece of code were wrong, the database would refuse to show one organization’s data to another.
- `16:54.9` Stored secrets are encrypted, with tools to rotate the encryption keys, and request limits that protect against abuse.

**c7-deploy** · 17:04.3–17:31.6

- `17:04.8` The platform is containerized, with two application instances behind a load balancer, so it can be updated without stopping the service.
- `17:13.5` In a load test on a local environment, three hundred students took one test from a single network, without a single request being refused.
- `17:22.2` Encrypted backups are taken, and restoring them has been rehearsed — including rebuilding a lost server from an off-site copy.

**c7-central** · 17:31.6–17:50.0

- `17:32.1` And because it is SaaS, every update to the catalogue or the system reaches every institution together, with nothing to install.
- `17:40.2` When AI is added, it can be offered as an add-on module within the existing subscriptions, with no second billing system.

**c7-value** · 17:50.0–18:14.9

- `17:50.5` And what does the institution gain? A documented curriculum decision the team shares, and a unified view of classes, homework and grades.
- `17:59.4` Clear governance: roles, an audit log, retention periods it decides itself, and privacy that even the platform team cannot bypass.
- `18:08.8` And a platform that grows with it, with no servers to run and no software to install.

### 8. Vision & next steps

**c8-ready** · 18:18.5–18:42.9

- `18:19.0` Where do we stand today? The platform is functionally complete and tested locally with more than three hundred automated tests, and full user journeys in three browser engines.
- `18:30.2` Before the commercial launch, clear steps remain: activating payments, the hosting environment, the legal review of student data, and the editorial review of the catalogue.

**c8-roadmap** · 18:42.9–19:05.9

- `18:43.4` The next stage starts with a pilot with a few partner institutions, whose feedback will set the priorities.
- `18:51.7` On the roadmap: the intelligent educational assistant, parent accounts, a question bank, term reports, single sign-on, and the curricula of other Arab countries.

**c8-invite** · 19:05.9–19:38.6

- `19:06.5` So we invite schools, school groups, and education and publishing companies to join the pilot programme and build the next stage with us.
- `19:17.5` And we welcome partners and investors who believe in more connected, clearer education.
- `19:23.7` Curriculum Scope: a clear curriculum, a connected classroom, and an institution that sees the whole picture.
- `19:30.0` Contact us for a live demo, or to join the pilot.

## Curriculum Scope — in three minutes

Estimated duration 02:54.6 · 237 Arabic words · 14 scenes · 28 lines

### 1. The challenge and the answer

**m-open** · 00:00.0–00:12.3

- `00:01.6` Every academic year, curriculum decisions and student follow-up get spread across separate tools.
- `00:08.2` Which books? Who follows up? And where are the grades?

**m-reveal** · 00:12.3–00:21.0

- `00:13.9` Curriculum Scope: one platform that connects the curriculum, the classroom and the institution.

**m-layers** · 00:21.0–00:36.8

- `00:21.4` Three connected layers:
- `00:23.8` an up-to-date catalogue of Egypt’s curricula, where the school decides what it covers;
- `00:28.9` classes, homework and tests built on it;
- `00:32.3` and secure institutional management, in Arabic and English.

**m-who** · 00:36.8–00:49.6

- `00:37.2` It is built for private and international schools and school groups, education technology companies and publishers, and tutoring centres.
- `00:46.3` Universities are a later expansion.

### 2. The platform at work

**m-curriculum** · 00:49.6–01:08.6

- `00:50.0` A catalogue of twelve grades, 231 subjects and more than a thousand books and references.
- `00:57.8` The team picks the books for each grade and track, and the decision is kept as a shared scope,
- `01:03.4` exported, compared, and carried to the next year in one step.

**m-notes** · 01:08.6–01:18.5

- `01:08.9` Every book has an owner, a due date and a reminder, so nothing gets lost between messages.

**m-homework** · 01:18.5–01:29.6

- `01:18.8` The teacher sets homework linked to the curriculum,
- `01:22.9` then marks it and returns it with comments.

**m-tests** · 01:29.6–01:41.6

- `01:29.9` Online tests run on time kept by the server, with live monitoring and automatic marking — the final say stays with the teacher.
- `01:38.4` Then the marks come together in one gradebook.

**m-student** · 01:41.6–01:52.4

- `01:41.9` Students find their school day on their phone: homework and tests,
- `01:47.6` their grades and their books, with an account their school manages.

**m-value** · 01:52.4–02:02.4

- `01:52.8` Teachers get lighter manual follow-up, students find everything in one place, and the institution sees the whole picture.

### 3. Trust and vision

**m-trust** · 02:02.4–02:15.8

- `02:02.8` Each institution’s data is isolated inside the database, with roles, two-step verification and an audit log,
- `02:10.7` and the platform team sees a school’s work only with its permission.

**m-ai** · 02:15.8–02:27.5

- `02:16.2` The intelligent educational assistant is a future vision, not built yet;
- `02:21.5` it will work under clear rules: it never changes a grade, and the teacher decides.

### 4. Next step

**m-next** · 02:27.5–02:35.2

- `02:27.9` The platform is functionally complete and tested locally, and is getting ready for a pilot with partner institutions.

**m-end** · 02:35.2–02:54.6

- `02:35.6` We invite schools and education and publishing companies to the pilot programme.
- `02:41.5` Curriculum Scope: a clear curriculum, a connected classroom, and an institution that sees the whole picture.
- `02:47.9` Contact us for a live demo.
