# English translation of the narration

The English translation used for the English subtitles (english.srt, english-3min.srt). Times come from the current narration takes (a generated guide voice; see PRODUCTION_STATUS.md).

## Midad — Product Showcase

Duration 21:08.9 · 1817 Arabic words · 59 scenes · 134 lines

### 1. The education challenge

**c1-open** · 00:00.0–00:22.6

- `00:02.6` At the start of every academic year, schools and educational institutions face the same questions.
- `00:10.7` Which books will we teach? Which edition? For which grades and tracks?
- `00:16.5` Who follows up on homework, tests and grades? And where are the answers kept?

**c1-problems** · 00:22.6–01:06.3

- `00:23.1` In many institutions, those answers are spread across separate spreadsheets, chat groups and tools that do not connect to each other.
- `00:33.9` Each department may work its own way, so a unified picture of what is really happening is hard to get.
- `00:41.5` Manual follow-up takes up teachers’ and administrators’ time, instead of it going to teaching itself.
- `00:49.6` And the student may have no single place to see what is due, what they have done, and how they are progressing.
- `00:57.9` These are not verdicts on every institution, but questions we hear often — and they deserve a better answer.

**c1-question** · 01:06.3–01:17.1

- `01:06.9` So how can an educational institution connect its people, its processes and the learning experience in one integrated platform?

**c1-reveal** · 01:17.1–01:23.4

- `01:18.9` Introducing Midad.

### 2. Product vision

**c2-origin** · 01:27.0–02:05.5

- `01:27.6` The idea began with a simple tool: a single page for choosing Egypt’s curriculum, from Primary 1 to Secondary 3.
- `01:37.5` It was designed to define the content scope of an education product for the 2026/2027 academic year.
- `01:47.7` But it worked in one browser only — no accounts, no sharing, no record of decisions.
- `01:56.1` Today it is an integrated cloud platform, delivered as SaaS, for school teams, their teachers and their students.

**c2-layers** · 02:05.5–02:37.1

- `02:06.0` The platform rests on three connected layers.
- `02:10.1` The first is the curriculum: an up-to-date catalogue of Egypt’s curricula, where the institution decides what it covers and keeps a record of that decision.
- `02:19.4` The second is the classroom: classes, homework, online tests and a gradebook, built on that curriculum.
- `02:29.0` The third is the institution: roles, permissions, subscriptions, the audit log and protection.

**c2-flow** · 02:37.1–03:04.8

- `02:37.6` The value of integration is that information is entered once, then travels to where it is needed.
- `02:44.6` The books the school chooses become the class’s curriculum; from them the teacher picks the homework material, and the mark then reaches the gradebook and the student.
- `02:56.0` All with one account, one sign-in and one interface, in Arabic and English.

**c2-principles** · 03:04.8–03:24.5

- `03:05.2` And it is built on clear principles: Arabic first, with full right-to-left support;
- `03:14.1` privacy by design, accessibility for everyone, and automated tests that check every main user journey.

### 3. Target customers

**c3-segments** · 03:28.1–05:12.3

- `03:28.6` Who is this platform for? Groups with different needs, brought together by the curriculum.
- `03:35.4` First: private and international schools, and school groups.
- `03:40.8` They need to coordinate what is taught in every grade and every campus, and to follow the daily work of teachers and students.
- `03:49.7` The platform gives them shared content scopes, comparison between campuses, classes, homework and tests, a gradebook, and a student portal.
- `04:01.7` Second: education technology companies, content producers and publishers.
- `04:08.0` Their key question: which part of the curriculum do we cover this year? The platform keeps the answer and sends it to their systems through an API and signed webhooks.
- `04:21.7` Third: tutoring centres and curriculum consultants, who prepare clear coverage plans, export them and compare them.
- `04:31.7` Universities and higher education are a later expansion opportunity; they are not fully supported today.
- `04:40.6` Classes, tests and the gradebook can be used, but the catalogue is designed for pre-university education, and there are no credit hours or course registration yet.
- `04:54.6` In every case, the intended value is the same: a clear, documented decision, less repeated work, and a clearer view.
- `05:04.2` It is value that partner institutions will measure in the pilot — not figures we claim in advance.

### 4. Platform walkthrough

**c4-signup** · 05:15.9–05:36.7

- `05:16.5` Let’s start the tour at the beginning. Mona creates an account for her school in one step: her name, her email and the school’s name.
- `05:26.4` She receives an email to confirm her address, then signs in, and her first organization starts with a 14-day trial.

**c4-2fa** · 05:36.7–05:49.3

- `05:37.1` To protect accounts, the platform supports two-step verification: it is mandatory for platform administrators, and an organization can require it for its owner and admins.

**c4-account** · 05:49.3–06:00.2

- `05:49.6` From the account page, each user turns on two-step verification, sees their active sessions, and downloads their personal data whenever they like.

**c4-members** · 06:00.2–06:23.3

- `06:00.6` Next, Mona invites her team. Each member has a role: owner, admin, editor or viewer.
- `06:08.8` Karim receives the invitation link, chooses his password and joins right away.
- `06:14.9` Permissions are enforced on the server itself, not only in the interface: a viewer can see, but cannot change anything.

**c4-tenancy** · 06:23.3–06:31.9

- `06:23.7` One person can belong to more than one organization and switch between them from the menu at the top of the page.

**c4-isolation** · 06:31.9–06:44.5

- `06:32.3` This is multi-tenancy at work: every organization is isolated from the others inside the database itself, with row-level security policies.

**c4-navigation** · 06:44.5–07:08.7

- `06:44.9` Navigation is clear: the curriculum guide, scopes, classes, students, members, billing, settings and the audit log.
- `06:54.9` The notifications bell tells each member what concerns them, in their own language.
- `07:00.2` With one click, the whole interface switches from Arabic to English, and from right-to-left to left-to-right.

**c4-access** · 07:08.7–07:29.1

- `07:09.1` The same interface works on a phone, and it is designed to be accessible: 149 screens were checked automatically against the WCAG guidelines, with no findings.
- `07:22.6` A manual review with a screen reader is still a step ahead of the launch.

**c4-oversight** · 07:29.1–07:56.1

- `07:29.5` Every important action is recorded in the audit log: who did what, and when.
- `07:35.6` At platform level, the operations team has an admin dashboard showing organizations, subscriptions, system health and alerts.
- `07:45.6` But it cannot see a school’s work unless the school grants temporary access, and every access is logged in the school’s own log.

### 5. Feature showcase

**c5-card** · 07:56.1–08:02.5

- `07:57.3` Now to the features in detail, as they actually work in the platform.

**c5-catalogue** · 08:02.5–08:30.8

- `08:02.9` At the heart of the platform is the curriculum catalogue: twelve grades, five tracks and 231 subjects, with more than a thousand books and references.
- `08:15.6` From Ministry schools to the new Egyptian Bakaloria, Thanaweya Amma and international programmes.
- `08:23.8` The team picks grades, then ticks books with a click, and every choice is saved automatically.

**c5-verified** · 08:30.8–08:44.6

- `08:31.1` The platform team records the review of each subject and its source, and schools see a verification mark beside it.
- `08:40.3` So everyone knows what has been checked, and against which source.

**c5-scopes** · 08:44.6–09:02.7

- `08:44.9` Each selection is saved as a named content scope, shared by the whole team, and it can be copied for another campus.
- `08:53.7` A scope can be exported as text, a CSV table or a JSON file, or read directly through the API.

**c5-compare** · 09:02.7–09:12.7

- `09:03.0` On the comparison page, two scopes sit side by side — even from different academic years — and only the differences are shown.

**c5-notes** · 09:12.7–09:27.9

- `09:13.0` Each selected book can have a note, a person responsible for following it up, a status and a due date.
- `09:20.5` Mona assigns tasks to her team in one go, and each member is notified in their own language.

**c5-assignments** · 09:27.9–09:47.7

- `09:28.2` On “My assignments”, each member sees what they owe across all their organizations, overdue first.
- `09:35.7` Reminders go out as a due date approaches and once it has passed, and each member chooses to get assignment emails right away or in one morning summary.

**c5-newyear** · 09:47.7–10:13.6

- `09:48.0` With each new academic year, the platform team publishes an updated edition of the catalogue, and schools are notified at once.
- `09:57.9` In one step, the scope is carried to the new year, with a review showing what changed, what was removed and what can be carried.
- `10:07.7` Notes and responsibilities move with it, so the team does not start from zero.

**c5-students** · 10:13.6–10:40.8

- `10:14.2` Now to the classroom. The school creates its students’ accounts itself, one by one or from a roster file.
- `10:22.8` A preview catches the file’s mistakes before import, with clear Arabic messages, then gives out one-time passwords.
- `10:32.6` Students need no email address and cannot sign themselves up: the school is responsible for the account.

**c5-classes** · 10:40.8–10:59.9

- `10:41.1` Then the class is created: its name, its grade and its curriculum from the school’s scope — then its students, and a teacher for each subject.

**c5-homework** · 10:59.9–11:27.7

- `11:00.2` The teacher sets homework linked to the curriculum’s books, with instructions, a due time and a full mark.
- `11:09.0` They see who handed in, who was late and who has not, then mark it, write a comment and return the work to the student.
- `11:18.0` Every file a student uploads is scanned for viruses before anyone opens it, and photos are resized with their location data removed.

**c5-tests** · 11:27.7–11:49.9

- `11:28.0` Online tests come with complete tools: multiple choice, true or false, short answers and written questions.
- `11:38.9` The teacher sets the time, the number of attempts and a start code read out in the room. The server keeps the time — not the student’s device.

**c5-monitor** · 11:49.9–12:16.5

- `11:50.2` On the live monitoring screen, the teacher sees each student’s state, the time left and the number of answers.
- `11:58.6` And sees what the page noticed: leaving it, pasting into it, or losing the connection — with no camera, no microphone and no screen recording.
- `12:10.1` They can give extra time or another attempt, or close the test at once.

**c5-marking** · 12:16.5–12:33.1

- `12:16.8` Every question is marked automatically with fixed rules — accepting Arabic spelling variants — except written answers, which the teacher marks.
- `12:27.1` No AI sets any mark: the decision always rests with the teacher.

**c5-gradebook** · 12:33.1–12:44.2

- `12:33.4` Marks come together in the gradebook: a row per student, a column per homework and test, with the average and a CSV download.

**c5-teacher-value** · 12:44.2–13:14.6

- `12:44.7` So what does the teacher gain? Their class’s homework, tests and marks in one place, tied to the curriculum they teach.
- `12:55.5` Manual follow-up gets lighter: hand-ins and late work show up by themselves, and objective questions are marked automatically.
- `13:04.9` And the educational decision stays in their hands: they review, adjust, write their comments, and decide when students see the results.

**c5-governance** · 13:14.6–13:35.7

- `13:14.9` Around all of this are tools for integration and governance: API keys, and webhooks with their delivery history;
- `13:24.1` retention periods for classroom data that each school sets, with notice fourteen days before anything is deleted — and an audit log for all of it.

### 6. Student experience & AI

**c6-signin** · 13:39.3–13:50.6

- `13:39.8` Now, let’s look from the student’s side.
- `13:42.9` Omar signs in with his school code, username and password, from a computer or a phone.

**c6-today** · 13:50.6–14:01.5

- `13:50.9` The Student Portal opens on “Today”: what he has to do, what he missed, what came back marked, and the tests open right now.

**c6-homework** · 14:01.5–14:17.2

- `14:01.8` He opens the homework, writes his answer or photographs his sheet and attaches it, then hands it in.
- `14:08.6` He can take his work back to change it until it is marked, and when the teacher returns it, he sees his mark and the comment.

**c6-test** · 14:17.2–14:39.5

- `14:17.5` In a test, he enters the start code, the countdown begins, and every answer is saved as he writes it.
- `14:25.6` If the connection weakens, the page retries by itself and tells him what is not saved yet.
- `14:32.9` And the page tells him plainly what the teacher can see during the test.

**c6-result** · 14:39.5–14:48.5

- `14:39.8` After he submits, the result appears when the teacher decides, with the correct answers if the teacher allows them to be shown.

**c6-grades** · 14:48.5–15:08.2

- `14:48.8` In “My grades” Omar sees his marks in each subject, and in “My books” his curriculum, as his school chose it.
- `14:56.9` A clear portal, in Arabic or English, designed to be accessible to all, bringing the student’s school day together in one place.

**c6-student-value** · 15:08.2–15:37.4

- `15:08.7` And what does the student gain? One place for the school day, showing what is due and when, without searching through scattered messages.
- `15:19.7` And a fair test experience: time kept by the server, equally for everyone, answers saved as they go, and clarity about what the teacher sees.
- `15:31.2` All in their own language, from their phone, with an account their school manages.

**c6-ai-status** · 15:37.4–16:01.2

- `15:38.0` And what about artificial intelligence? We want to be precise here.
- `15:43.3` Today the platform includes no artificial-intelligence feature, and its integration with the Wise EduAgent educational assistant has not been built yet.
- `15:53.6` Inspecting the Wise application and choosing an AI provider are both steps still ahead.

**c6-ai-vision** · 16:01.2–16:46.2

- `16:01.8` What we show now is a future vision, not a feature ready to sell.
- `16:07.7` An educational assistant inside the same student portal, with the same account, that knows the curriculum the school has chosen.
- `16:16.6` It could help a student understand a lesson, organize their study and practise questions, and help teachers prepare.
- `16:25.6` Its rules are set in advance: every answer is labelled as machine-generated, it never changes an official record or a grade, and it is subject to usage limits within the same subscription.
- `16:39.5` AI here is meant to support teachers and students — not to replace the teacher.

**c6-ai-ready** · 16:46.2–16:57.5

- `16:46.6` The foundation it needs is ready today: student identity, curriculum context, subscriptions, usage metering and the audit log.

### 7. SaaS model & commercial value

**c7-plans** · 17:01.1–17:49.8

- `17:01.6` The platform runs on an institutional subscription model: a free plan, paid plans, and an enterprise plan under a custom contract.
- `17:12.2` The prices shown are launch proposals, open to review.
- `17:17.7` Each plan’s limits are enforced on the server: members, scopes, exports, API requests and the features available.
- `17:28.5` The system runs the whole subscription cycle: trial, upgrade, renewal, invoices, and a grace period when a payment is late.
- `17:38.9` The Paymob payment integration is built and tested against a simulation of its interface, and awaits the merchant account keys to go live.

**c7-isolation** · 17:49.8–18:19.5

- `17:50.3` Technically, all organizations run on one system, but each one’s data is isolated by security policies inside the database.
- `18:01.4` So even if a piece of code were wrong, the database would refuse to show one organization’s data to another.
- `18:09.6` Stored secrets are encrypted, with tools to rotate the encryption keys, and request limits that protect against abuse.

**c7-deploy** · 18:19.5–18:50.7

- `18:20.0` The platform is containerized, with two application instances behind a load balancer, so it can be updated without stopping the service.
- `18:29.7` In a load test on a local environment, three hundred students took one test from a single network, without a single request being refused.
- `18:39.9` Encrypted backups are taken, and restoring them has been rehearsed — including rebuilding a lost server from an off-site copy.

**c7-central** · 18:50.7–19:11.4

- `18:51.2` And because it is SaaS, every update to the catalogue or the system reaches every institution together, with nothing to install.
- `19:00.8` When AI is added, it can be offered as an add-on module within the existing subscriptions, with no second billing system.

**c7-value** · 19:11.4–19:39.8

- `19:11.9` And what does the institution gain? A documented curriculum decision the team shares, and a unified view of classes, homework and grades.
- `19:22.0` Clear governance: roles, an audit log, retention periods it decides itself, and privacy that even the platform team cannot bypass.
- `19:33.2` And a platform that grows with it, with no servers to run and no software to install.

### 8. Vision & next steps

**c8-ready** · 19:43.4–20:10.2

- `19:43.9` Where do we stand today? The platform is functionally complete and tested locally with more than three hundred automated tests, and full user journeys in three browser engines.
- `19:57.1` Before the commercial launch, clear steps remain: activating payments, the hosting environment, the legal review of student data, and the editorial review of the catalogue.

**c8-roadmap** · 20:10.2–20:34.9

- `20:10.7` The next stage starts with a pilot with a few partner institutions, whose feedback will set the priorities.
- `20:20.2` On the roadmap: the intelligent educational assistant, parent accounts, a question bank, term reports, single sign-on, and the curricula of other Arab countries.

**c8-invite** · 20:34.9–21:08.9

- `20:35.5` So we invite schools, school groups, and education and publishing companies to join the pilot programme and build the next stage with us.
- `20:46.7` And we welcome partners and investors who believe in more connected, clearer education.
- `20:53.9` Midad: a clear curriculum, a connected classroom, and an institution that sees the whole picture.
- `21:00.3` Contact us for a live demo, or to join the pilot.

## Midad — in three minutes

Duration 03:06.4 · 235 Arabic words · 14 scenes · 28 lines

### 1. The challenge and the answer

**m-open** · 00:00.0–00:13.4

- `00:01.6` Every academic year, curriculum decisions and student follow-up get spread across separate tools.
- `00:09.5` Which books? Who follows up? And where are the grades?

**m-reveal** · 00:13.4–00:21.5

- `00:15.0` Midad: one platform that connects the curriculum, the classroom and the institution.

**m-layers** · 00:21.5–00:39.5

- `00:21.9` Three connected layers:
- `00:24.3` an up-to-date catalogue of Egypt’s curricula, where the school decides what it covers;
- `00:30.1` classes, homework and tests built on it;
- `00:34.3` and secure institutional management, in Arabic and English.

**m-who** · 00:39.5–00:53.3

- `00:39.9` It is built for private and international schools and school groups, education technology companies and publishers, and tutoring centres.
- `00:50.0` Universities are a later expansion.

### 2. The platform at work

**m-curriculum** · 00:53.3–01:14.3

- `00:53.7` A catalogue of twelve grades, 231 subjects and more than a thousand books and references.
- `01:03.0` The team picks the books for each grade and track, and the decision is kept as a shared scope,
- `01:09.2` exported, compared, and carried to the next year in one step.

**m-notes** · 01:14.3–01:24.2

- `01:14.6` Every book has an owner, a due date and a reminder, so nothing gets lost between messages.

**m-homework** · 01:24.2–01:35.3

- `01:24.5` The teacher sets homework linked to the curriculum,
- `01:29.3` then marks it and returns it with comments.

**m-tests** · 01:35.3–01:49.1

- `01:35.6` Online tests run on time kept by the server, with live monitoring and automatic marking — the final say stays with the teacher.
- `01:45.6` Then the marks come together in one gradebook.

**m-student** · 01:49.1–01:59.8

- `01:49.4` Students find their school day on their phone: homework and tests,
- `01:55.0` their grades and their books, with an account their school manages.

**m-value** · 01:59.8–02:10.4

- `02:00.2` Teachers get lighter manual follow-up, students find everything in one place, and the institution sees the whole picture.

### 3. Trust and vision

**m-trust** · 02:10.4–02:25.1

- `02:10.8` Each institution’s data is isolated inside the database, with roles, two-step verification and an audit log,
- `02:19.7` and the platform team sees a school’s work only with its permission.

**m-ai** · 02:25.1–02:37.5

- `02:25.5` The intelligent educational assistant is a future vision, not built yet;
- `02:31.0` it will work under clear rules: it never changes a grade, and the teacher decides.

### 4. Next step

**m-next** · 02:37.5–02:47.1

- `02:37.9` The platform is functionally complete and tested locally, and is getting ready for a pilot with partner institutions.

**m-end** · 02:47.1–03:06.4

- `02:47.5` We invite schools and education and publishing companies to the pilot programme.
- `02:53.4` Midad: a clear curriculum, a connected classroom, and an institution that sees the whole picture.
- `02:59.8` Contact us for a live demo.
