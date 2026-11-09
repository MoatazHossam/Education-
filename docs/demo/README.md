# Demo script in Word, Arabic

[Midad-Demo-Scenario-AR.docx](Midad-Demo-Scenario-AR.docx) is a step-by-step script, in Arabic (right to left), for
whoever presents Midad to a school with the demo school that `demo-school.js` builds
([DEPLOYMENT_GUIDE.md §3.9](../DEPLOYMENT_GUIDE.md#39-a-demo-school-optional)). About 45 minutes with questions:

1. The owner (منى حسن): the picker, the scope with its notes and the overdue book, teaching plans, students, the
   class page and the gradebook.
2. The maths teacher (سلمى فتحي): My assignments, marking a homework and returning it, the quiz's questions,
   results and live monitor.
3. A student (هنا طارق) takes the quiz while the teacher watches the monitor; the teacher marks the written answer;
   the student hands in a homework.
4. Optional: another student (أحمد علي) sees the mark returned in part 2, his grades and his books.
5. Optional: the Arabic teacher (كريم عادل) shows the exam with its start code.

It also has the preparation (accounts, devices, a checklist, the buttons not to press), what to say and what not to
claim (prices, AI, real students' data, parent accounts), answers to likely questions, what to do when something
goes wrong, and an appendix for whoever runs the server: resetting the demo school before each demo, since the quiz
stays open for 7 days from the moment the school is created. Every button is named as the Arabic interface shows it.
The document never holds a password: the server operator gives the presenter the school code and the passwords on
paper.

## A copy for your installation

The file here uses example addresses (`https://midad.example.com`, `you@example.com`). Build a copy with the
installation's address and the address the demo school was created with:

```bash
npm i --no-save docx@9.7.1
node scripts/demo-scenario/build.mjs Midad-Demo-Scenario-AR.docx --site https://midad.your-domain.com --email you@example.com
```

`--copy-from /home/<user>/demo-school.js` names where the compiled command lies on the server, for installations of
package `4d92a28` (later releases have the command in the image). After a change to the screens or labels the script
names, update `scripts/demo-scenario/build.mjs` and rebuild the file here with no options.

## How it was checked

Every step was run in order on the production stack built from package `4d92a28` with the demo command added, on
2026-11-09, in Chromium (Playwright) with the Arabic interface: the staff screens at desktop size, the student's at
phone size (390 px wide). The screenshots in `scripts/demo-scenario/shots/` come from that run; dates and the school
code differ on every installation. See [TEST_REPORT.md](../TEST_REPORT.md), "Demo script".
