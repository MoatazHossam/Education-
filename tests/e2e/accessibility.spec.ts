import { writeFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { hashPassword } from '../../src/auth/password.js';
import { createScope, login, orgIdFromUrl, PASSWORD, registerAndVerify, signInAsPlatformAdmin, uid } from './helpers.js';
import { checkTranscript, heard, headingSkips, listen, readPage, saveTranscript, TRANSCRIPTS, unmarkedLanguage, type SrFinding } from './screen-reader.js';
import { ownerQuery, runFileCheckPass } from './server.js';

// Automated WCAG 2.2 A/AA audit (axe-core) of every screen and the main
// dialogs, in English and Arabic, light and dark, desktop and phone. Runs after
// the journeys so pages show real data. Findings are collected and reported
// together. Automated checks cover only part of WCAG; see TEST_REPORT.md.

// A 1×1 PNG, for a student's photo of their work.
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000970485973000003e8000003e801b57b526b0000000d4944415408d763606060600000000500015ef32a3a0000000049454e44ae426082', 'hex');

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
interface Finding { where: string; rule: string; impact: string | null | undefined; help: string; nodes: string[] }
const findings: Finding[] = [];
const audited: string[] = [];
// The same screens read by a simulated screen reader (screen-reader.ts): transcripts and what they reveal.
const srFindings: SrFinding[] = [];

async function audit(page: Page, where: string) {
  await page.waitForLoadState('networkidle');
  await page.locator('h1, h2').first().waitFor();
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  audited.push(where);
  for (const v of violations) findings.push({ where, rule: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 4).map((n) => n.target.join(' ')) });
  // Not an axe rule: a key or link wider than its dialog runs past the edge and is cut off.
  if (await page.evaluate(() => [...document.querySelectorAll('dialog[open]')].some((d) => d.scrollWidth > d.clientWidth + 1))) {
    findings.push({ where, rule: 'dialog-overflow', impact: 'serious', help: 'Content is wider than its dialog', nodes: ['dialog[open]'] });
  }
  const { phrases, complete } = await readPage(page);
  saveTranscript(audited.length, where, phrases, complete);
  srFindings.push(...checkTranscript(where, phrases), ...headingSkips(where, phrases), ...(await unmarkedLanguage(page, where)));
}

async function visit(page: Page, path: string, where: string) {
  await page.goto(path);
  await audit(page, where);
}

const report = () => findings.map((f) => `[${f.impact}] ${f.rule} — ${f.help}\n    at ${f.where}: ${f.nodes.join(' | ')}`).join('\n');

// bypassCSP lets the simulated screen reader be loaded into the page; the journeys run under the real CSP.
async function newPage(browser: Browser, opts: Parameters<Browser['newContext']>[0] = {}) {
  return (await browser.newContext({ bypassCSP: true, ...opts })).newPage();
}

test('every screen passes an automated WCAG 2.2 AA check (English and Arabic, light and dark, desktop and phone)', async ({ browser }) => {
  // About 150 screens, each checked by axe and read by the simulated screen reader.
  test.setTimeout(480_000);

  // Signed out.
  const guest = await newPage(browser);
  for (const [path, where] of [
    ['/login', 'sign in'], ['/register', 'register'], ['/forgot-password', 'forgot password'], ['/pricing', 'pricing'],
    ['/verify-email?token=invalid', 'email confirmation (invalid link)'], ['/reset-password?token=invalid', 'password reset'], ['/invite?token=invalid', 'invitation (invalid link)'],
  ] as const) await visit(guest, path, where);
  await guest.emulateMedia({ colorScheme: 'dark' });
  await visit(guest, '/login', 'sign in (dark)');

  // An owner with a scope on last year's catalogue (2027/2028 was published by the journeys).
  const page = await newPage(browser);
  const email = `a11y.${uid()}@e2e.test`;
  await registerAndVerify(page, email, 'Accessible Learning');
  await login(page, email);
  const orgId = orgIdFromUrl(page);
  await audit(page, 'picker (first visit)');
  await page.getByRole('button', { name: /Create your first scope|New scope/ }).first().click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Name').fill('Last year plan');
  const lastYear = await dlg.getByLabel('Catalogue version').locator('option', { hasText: '2026/2027' }).getAttribute('value');
  await dlg.getByLabel('Catalogue version').selectOption(lastYear!);
  await audit(page, 'new scope dialog');
  await dlg.getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('.carry-banner')).toBeVisible();
  for (let i = 0; i < 3; i++) await page.locator('.mat').nth(i).click();
  await expect(page.locator('.tray .toast')).toHaveText('Saved');
  await audit(page, 'picker (scope with selections, newer catalogue banner)');
  await page.getByRole('button', { name: 'View list' }).click();
  await audit(page, 'picker (list panel open)');
  await page.getByRole('button', { name: 'Notifications' }).click();
  await audit(page, 'notifications dialog');
  await page.keyboard.press('Escape');
  const scopeId = new URL(page.url()).searchParams.get('scope') ?? (await page.locator('.scopebar select').inputValue());
  for (const [path, where] of [
    [`/org/${orgId}/scopes`, 'scopes'], [`/org/${orgId}/scopes/${scopeId}/carry`, 'carry forward review'], [`/org/${orgId}/members`, 'members'],
    [`/org/${orgId}/billing`, 'billing'], [`/org/${orgId}/settings`, 'settings'], [`/org/${orgId}/audit`, 'audit log'], ['/account', 'account'],
  ] as const) await visit(page, path, where);

  // A webhook endpoint (the E2E server allows a local address): the secret dialog, the list, deliveries and edit dialogs.
  await page.goto(`/org/${orgId}/settings`);
  await page.getByLabel('Endpoint URL').fill('http://127.0.0.1:9/hook');
  await page.getByRole('button', { name: 'Add endpoint' }).click();
  await expect(page.getByRole('dialog')).toContainText('Copy this signing secret now');
  await audit(page, 'webhook secret dialog');
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('#webhooks table')).toContainText('http://127.0.0.1:9/hook');
  await audit(page, 'settings (webhook endpoint)');
  // Nothing listens on port 9, so the test fails and the deliveries dialog has a row, its history note and the download.
  await page.getByRole('button', { name: 'Send a test to http://127.0.0.1:9/hook' }).click();
  await expect(page.locator('#toasts').getByText(/^Test failed/)).toBeVisible();
  await page.getByRole('button', { name: 'Deliveries to http://127.0.0.1:9/hook' }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Download history (CSV)' })).toBeVisible();
  await audit(page, 'webhook deliveries dialog');
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Edit http://127.0.0.1:9/hook' }).click();
  await audit(page, 'webhook edit dialog');
  await page.keyboard.press('Escape');

  // Two-factor setup on the account page: the QR code's description and the key as text.
  await page.goto('/account');
  await page.getByRole('button', { name: 'Set up two-factor authentication' }).click();
  await expect(page.getByRole('img', { name: 'QR code for your authenticator app' })).toBeVisible();
  await audit(page, 'account (two-factor setup)');

  // A second scope on the newest catalogue: the comparison then matches books across catalogue years.
  await page.goto(`/org/${orgId}`);
  await createScope(page, 'This year plan');
  await expect(page.locator('.scopebar select option:checked')).toHaveText(/This year plan/);
  for (const i of [1, 2, 3]) await page.locator('.mat').nth(i).click();
  await expect(page.locator('.tray .toast')).toHaveText('Saved');
  const comparePath = `/org/${orgId}/scopes/compare?a=${scopeId}&b=${await page.locator('.scopebar select').inputValue()}`;
  await visit(page, comparePath, 'compare scopes (two catalogue years)');
  await page.getByLabel('Show only differences').uncheck();
  await audit(page, 'compare scopes (everything shown)');

  // Notes and assignees on the scope's selected books, and the note dialog.
  const itemsPath = `/org/${orgId}/scopes/${scopeId}/items`;
  await visit(page, itemsPath, 'notes and assignees');
  await page.getByRole('button', { name: /^Edit the note on / }).first().click();
  await audit(page, 'note and assignee dialog');
  await page.getByRole('dialog').getByLabel('Note').fill('Waiting for the 2027 edition');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.locator('table.items input[type="checkbox"]').nth(1).check();
  await audit(page, 'notes and assignees (a note, a book chosen)');
  // Assign the first book to yourself with a past due date: the page shows it overdue, and My assignments lists it.
  await page.getByRole('button', { name: /^Edit the note on / }).first().click();
  await page.getByRole('dialog').getByLabel('Assigned to').selectOption({ index: 1 });
  await page.getByRole('dialog').getByLabel('Status').selectOption({ label: 'In progress' });
  await page.getByRole('dialog').getByLabel('Due date').fill('2020-01-05');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // And the second book due tomorrow: marked "due soon" here and counted on My assignments.
  await page.getByRole('button', { name: /^Edit the note on / }).nth(1).click();
  await page.getByRole('dialog').getByLabel('Assigned to').selectOption({ index: 1 });
  await page.getByRole('dialog').getByLabel('Due date').fill(new Date(Date.now() + 86_400_000).toISOString().slice(0, 10));
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('table.items .pill', { hasText: 'due soon' })).toHaveCount(1);
  await audit(page, 'notes and assignees (status, overdue, due soon)');
  const assignmentsPath = `/org/${orgId}/assignments`;
  await visit(page, assignmentsPath, 'my assignments');
  // Also a member of a second organization (the journeys' Notes Academy): My assignments across both.
  await ownerQuery(`INSERT INTO memberships (org_id, user_id, role) SELECT o.id, u.id, 'viewer' FROM organizations o, users u WHERE o.name = 'Notes Academy' AND u.email = $1`, [email]);
  const allAssignmentsPath = '/assignments';
  await visit(page, allAssignmentsPath, 'my assignments in all organizations');
  // Notes Academy's picker as that viewer: every book is read-only.
  const [notesAcademy] = await ownerQuery(`SELECT id FROM organizations WHERE name = 'Notes Academy'`);
  await visit(page, `/org/${notesAcademy.id}`, 'picker (viewer, read-only)');
  await expect(page.locator('.mat').first()).toHaveAttribute('aria-disabled', 'true');


  // the Students page and its dialogs, then the student sign-in and portal.
  await ownerQuery(`UPDATE subscriptions SET limit_overrides = limit_overrides || '{"max_students": 10}'::jsonb WHERE org_id = $1`, [orgId]);
  await visit(page, `/org/${orgId}/students`, 'students (none yet)');
  await page.getByRole('button', { name: 'Add student' }).click();
  await audit(page, 'add student dialog');
  const username = `ally.${uid()}`;
  let sd = page.getByRole('dialog');
  await sd.getByLabel('Username').fill(username);
  await sd.getByLabel('Student’s name').fill('Ally Student');
  const lastYearScope = await sd.getByLabel('Curriculum').locator('option', { hasText: 'Last year plan' }).getAttribute('value');
  await sd.getByLabel('Curriculum').selectOption(lastYearScope!);
  await sd.getByRole('button', { name: 'Add student' }).click();
  sd = page.getByRole('dialog', { name: 'Student passwords' });
  await audit(page, 'student password dialog');
  const studentPassword = (await sd.locator('.cred').textContent())!.trim();
  await sd.getByRole('button', { name: 'Done' }).click();
  await audit(page, 'students (with a student)');
  await page.getByRole('button', { name: 'Import CSV…' }).click();
  sd = page.getByRole('dialog', { name: 'Import students' });
  await sd.getByLabel('Roster file (CSV)').setInputFiles({ name: 'roster.csv', mimeType: 'text/csv', buffer: Buffer.from('username,name,grade\nok.one,One,1\nbad name,Two,1\n') });
  await expect(sd.getByText('Problems to fix first: 1.')).toBeVisible();
  await audit(page, 'import students dialog (preview with a problem)');
  await page.keyboard.press('Escape');
  const schoolCode = (await page.locator('.code-big').textContent())!.trim();
  const studentPage = await newPage(browser);
  await visit(studentPage, `/student-login?school=${schoolCode}`, 'student sign-in');
  await studentPage.getByLabel('Username').fill(username);
  await studentPage.getByLabel('Password').fill(studentPassword);
  await studentPage.getByRole('button', { name: 'Sign in' }).click();
  await studentPage.waitForURL(/\/student$/);
  await audit(studentPage, 'student today (no class yet)');
  await studentPage.locator('.topbar').getByRole('link', { name: 'My books' }).click();
  await expect(studentPage.locator('.subj .mat.book').first()).toBeVisible();
  await audit(studentPage, 'student portal');
  await studentPage.locator('.topbar').getByRole('button', { name: 'Change password' }).click();
  await audit(studentPage, 'student change password dialog');
  await studentPage.keyboard.press('Escape');
  await studentPage.locator('.topbar').getByRole('button', { name: 'العربية', exact: true }).click();
  await expect(studentPage.locator('html')).toHaveAttribute('dir', 'rtl');
  await audit(studentPage, 'student portal (Arabic)');
  await studentPage.emulateMedia({ colorScheme: 'dark' });
  await audit(studentPage, 'student portal (Arabic, dark)');
  await studentPage.locator('.topbar').getByRole('button', { name: 'English', exact: true }).click();
  await audit(studentPage, 'student portal (dark)');
  const studentPhone = await newPage(browser, { viewport: { width: 390, height: 844 } });
  await studentPhone.goto(`/student-login?school=${schoolCode}`);
  await studentPhone.getByLabel('Username').fill(username);
  await studentPhone.getByLabel('Password').fill(studentPassword);
  await studentPhone.getByRole('button', { name: 'Sign in' }).click();
  await studentPhone.waitForURL(/\/student$/);
  await audit(studentPhone, 'student today (phone)');

  // Classes and homework (docs/CLASSROOM.md): the owner sets up a class for the student and sets homework,
  // the student hands in an answer with a photo, the owner marks it and returns it.
  await visit(page, `/org/${orgId}/classes`, 'classes (none yet)');
  await page.getByRole('button', { name: 'New class' }).click();
  await audit(page, 'new class dialog');
  let cd = page.getByRole('dialog', { name: 'New class' });
  await cd.getByLabel('Class name').fill('1A');
  await cd.getByLabel('Curriculum').selectOption(lastYearScope!);
  await cd.getByRole('button', { name: 'Create class' }).click();
  await expect(page.getByRole('heading', { name: '1A', level: 1 })).toBeVisible();
  const classPath = new URL(page.url()).pathname;
  await page.getByRole('button', { name: 'Choose students' }).click();
  await audit(page, 'choose students dialog');
  await page.getByRole('dialog').getByLabel('Ally Student').check();
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Students (1)' })).toBeVisible();
  await page.getByRole('button', { name: 'Add teacher' }).click();
  await audit(page, 'add teacher dialog');
  await page.getByRole('dialog').getByRole('button', { name: 'Add teacher' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Set homework' }).click();
  await audit(page, 'set homework dialog');
  cd = page.getByRole('dialog');
  await cd.getByLabel('Title').fill('Practise the letters');
  await cd.getByLabel('Instructions').fill('Write each letter five times in your notebook.');
  await cd.getByRole('button', { name: 'Set homework' }).click();
  await expect(page.locator('table.data tbody tr')).toHaveCount(1);
  await audit(page, 'class (with homework)');
  await studentPage.emulateMedia({ colorScheme: 'light' });
  await visit(studentPage, '/student', 'student today (homework due)');
  await studentPage.getByRole('link', { name: 'Practise the letters' }).click();
  await audit(studentPage, 'student homework');
  const studentHomeworkPath = new URL(studentPage.url()).pathname;
  await studentPage.getByLabel('Your answer').fill('a a a a a');
  await studentPage.getByLabel('Attach photos or a PDF').setInputFiles({ name: 'letters.png', mimeType: 'image/png', buffer: PNG });
  await expect(studentPage.locator('.files')).toContainText('letters.png');
  await audit(studentPage, 'student homework (draft, photo being checked)');
  await runFileCheckPass();
  await expect(studentPage.locator('.files a', { hasText: 'letters.png' })).toBeVisible({ timeout: 10_000 });
  await audit(studentPage, 'student homework (draft with a photo)');
  await studentPage.getByRole('button', { name: 'Hand in' }).click();
  await expect(studentPage.getByText(/You handed this in/)).toBeVisible();
  await audit(studentPage, 'student homework (handed in)');
  await visit(studentPage, '/student/homework?show=all', 'student homework list');
  await page.getByRole('link', { name: 'Practise the letters' }).click();
  await expect(page.getByText('1 of 1 handed in · 0 returned')).toBeVisible();
  await audit(page, 'homework (work handed in)');
  const homeworkPath = new URL(page.url()).pathname;
  await page.getByRole('button', { name: 'Open the work of Ally Student' }).click();
  await audit(page, 'mark work dialog');
  await page.getByRole('dialog').getByLabel('Mark (out of 10)').fill('8');
  await page.getByRole('dialog').getByLabel('Comments for the student').fill('Neat work.');
  await page.getByRole('dialog').getByRole('button', { name: 'Return to student' }).click();
  await expect(page.locator('table.data tbody tr')).toContainText('8 / 10');
  await audit(page, 'homework (returned)');
  await visit(page, `/org/${orgId}/classes`, 'classes');
  await visit(studentPage, studentHomeworkPath, 'student homework (returned with a mark)');
  await studentPage.locator('.topbar').getByRole('button', { name: 'العربية', exact: true }).click();
  await expect(studentPage.locator('html')).toHaveAttribute('dir', 'rtl');
  await audit(studentPage, 'student homework (Arabic)');
  await visit(studentPage, '/student', 'student today (Arabic)');
  await studentPage.locator('.topbar').getByRole('button', { name: 'English', exact: true }).click();
  await visit(studentPhone, studentHomeworkPath, 'student homework (phone)');
  await visit(studentPhone, '/student/homework?show=all', 'student homework list (phone)');
  await studentPage.emulateMedia({ colorScheme: 'dark' });
  await visit(studentPage, studentHomeworkPath, 'student homework (dark)');
  await studentPage.emulateMedia({ colorScheme: 'light' });

  // Online tests (docs/ONLINE_TESTS.md): the owner writes a test with a start code and publishes it; the student
  // takes it while the owner watches the monitor; then results and marking.
  await page.goto(classPath);
  await page.getByRole('button', { name: 'New test' }).click();
  await audit(page, 'new test dialog');
  let td = page.getByRole('dialog');
  await td.getByLabel('Title').fill('Letters quiz');
  await td.getByLabel('Students need a start code that I give in the room').check();
  await td.getByRole('button', { name: 'Create test' }).click();
  await expect(page.getByRole('heading', { name: 'Letters quiz', level: 1 })).toBeVisible();
  const testPath = new URL(page.url()).pathname;
  const testCode = (await page.locator('.code-big').textContent())!.trim();
  await page.getByRole('button', { name: 'Add question' }).click();
  await audit(page, 'add question dialog (choices)');
  td = page.getByRole('dialog');
  await td.getByLabel('Question', { exact: true }).fill('Which letter comes first?');
  await td.getByLabel('Choice A', { exact: true }).fill('A');
  await td.getByLabel('Choice B', { exact: true }).fill('B');
  await td.getByLabel('Choice C', { exact: true }).fill('C');
  await td.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'Add question' }).click();
  td = page.getByRole('dialog');
  await td.getByLabel('Question type').selectOption('essay');
  await audit(page, 'add question dialog (written answer)');
  await td.getByLabel('Question', { exact: true }).fill('Write a word that starts with B.');
  await td.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Questions (2, 2 points)' })).toBeVisible();
  await audit(page, 'test (draft with questions)');
  await page.getByRole('button', { name: 'Publish' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published. The class’s students were told.')).toBeVisible();
  await visit(studentPage, '/student', 'student today (test open)');
  await visit(studentPage, '/student/tests', 'student tests');
  await studentPage.getByRole('link', { name: 'Start Letters quiz' }).click();
  await audit(studentPage, 'student test start page');
  await studentPage.getByLabel('Start code').fill(testCode);
  await studentPage.getByRole('button', { name: 'Start' }).click();
  await audit(studentPage, 'start test dialog');
  await studentPage.getByRole('dialog').getByRole('button', { name: 'Start' }).click();
  await expect(studentPage.getByRole('timer')).toBeVisible();
  await audit(studentPage, 'taking a test');
  const attemptPath = new URL(studentPage.url()).pathname;
  await studentPage.getByLabel('A', { exact: true }).check();
  await studentPage.getByLabel('Your answer').fill('Ball');
  await expect(studentPage.getByText(/^Saved /)).toBeVisible();
  await page.getByRole('link', { name: 'Live monitor' }).click();
  await expect(page.locator('table.data tbody tr', { hasText: 'Ally Student' })).toContainText('2 of 2 answered');
  await audit(page, 'test live monitor');
  const monitorPath = new URL(page.url()).pathname;
  await page.getByRole('button', { name: 'Extra time for Ally Student' }).click();
  await audit(page, 'extra time dialog');
  await page.keyboard.press('Escape');
  await studentPage.locator('.topbar').getByRole('button', { name: 'العربية', exact: true }).click();
  await expect(studentPage.getByRole('timer')).toBeVisible();
  await audit(studentPage, 'taking a test (Arabic)');
  await studentPage.locator('.topbar').getByRole('button', { name: 'English', exact: true }).click();
  await visit(studentPhone, attemptPath, 'taking a test (phone)');
  await studentPage.goto(attemptPath);
  await studentPage.getByRole('button', { name: 'Submit' }).click();
  await audit(studentPage, 'submit test dialog');
  await studentPage.getByRole('dialog').getByRole('button', { name: 'Submit' }).click();
  await expect(studentPage.getByText('Your answers are saved. Your teacher will show the results later.')).toBeVisible();
  await audit(studentPage, 'test submitted (results later)');
  await page.goto(monitorPath);
  await page.getByRole('button', { name: 'Close the test now' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Close the test now' }).click();
  await expect(page.locator('.page-head .pill')).toHaveText('Closed');
  await page.getByRole('link', { name: 'Results' }).click();
  await audit(page, 'test results');
  const resultsPath = new URL(page.url()).pathname;
  await page.getByRole('link', { name: 'Attempt 1 of Ally Student' }).click();
  await audit(page, 'test attempt marking');
  await page.getByLabel('Mark (out of 1)').fill('1');
  await page.getByRole('button', { name: 'Save the mark for question 2' }).click();
  await expect(page.getByText(/^Saved\. Total/)).toBeVisible();
  await studentPage.goto('/student/tests');
  await studentPage.getByRole('link', { name: 'Letters quiz' }).click();
  await studentPage.getByRole('link', { name: 'See your answers of attempt 1' }).click();
  await expect(studentPage.locator('.mark-big')).toBeVisible();
  await audit(studentPage, 'student test result');
  const studentResultPath = new URL(studentPage.url()).pathname;
  await visit(studentPhone, studentResultPath, 'student test result (phone)');
  // The gradebook (docs/CLASSROOM.md §10): the class's homework and test marks, and the student's own grades.
  const gradebookPath = `${classPath}/gradebook`;
  await visit(page, gradebookPath, 'gradebook');
  await visit(studentPage, '/student/grades', 'student grades');
  await visit(studentPhone, '/student/grades', 'student grades (phone)');
  await studentPage.locator('.topbar').getByRole('button', { name: 'العربية', exact: true }).click();
  await expect(studentPage.getByRole('heading', { name: 'درجاتي', level: 1 })).toBeVisible();
  await audit(studentPage, 'student grades (Arabic)');
  await studentPage.locator('.topbar').getByRole('button', { name: 'English', exact: true }).click();
  // Keeping classroom data (docs/CLASSROOM.md §11): the periods, the confirmation, what is due and what is kept.
  const retentionPath = `/org/${orgId}/classes/retention`;
  await visit(page, retentionPath, 'keeping classroom data (nothing set)');
  await page.getByLabel('Test monitoring records').selectOption({ label: '7 days' });
  await page.getByRole('button', { name: 'Save periods' }).click();
  await expect(page.getByRole('dialog', { name: 'Delete data past these periods?' })).toBeVisible();
  await audit(page, 'retention confirmation dialog');
  await page.getByRole('dialog').getByRole('button', { name: 'Save periods' }).click();
  await expect(page.getByRole('button', { name: 'Keep “Letters quiz”' })).toBeVisible();
  await audit(page, 'keeping classroom data (due to be deleted)');
  await page.getByRole('button', { name: 'Keep “Letters quiz”' }).click();
  await expect(page.getByRole('heading', { name: 'Kept whatever the periods say' })).toBeVisible();
  await audit(page, 'keeping classroom data (kept)');

  // Arabic (right to left).
  await page.goto(`/org/${orgId}?scope=${scopeId}`);
  await page.locator('.topbar').getByRole('button', { name: 'العربية', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await audit(page, 'picker (Arabic)');
  for (const [path, where] of [
    [`/org/${orgId}/scopes`, 'scopes (Arabic)'], [`/org/${orgId}/scopes/${scopeId}/carry`, 'carry forward review (Arabic)'],
    [`/org/${orgId}/billing`, 'billing (Arabic)'], ['/account', 'account (Arabic)'], [comparePath, 'compare scopes (Arabic)'], [`/org/${orgId}/settings`, 'settings (Arabic)'],
    [itemsPath, 'notes and assignees (Arabic)'], [assignmentsPath, 'my assignments (Arabic)'], [allAssignmentsPath, 'my assignments in all organizations (Arabic)'],
    [`/org/${orgId}/classes`, 'classes (Arabic)'], [classPath, 'class (Arabic)'], [homeworkPath, 'homework (Arabic)'],
    [testPath, 'test (Arabic)'], [monitorPath, 'test live monitor (Arabic)'], [resultsPath, 'test results (Arabic)'], [gradebookPath, 'gradebook (Arabic)'],
    [retentionPath, 'keeping classroom data (Arabic)'],
  ] as const) await visit(page, path, where);
  // Latin text keeps its own order in the Arabic interface: an email address is one left-to-right piece
  // (not "e2e.test@a11y…"), and a book title keeps the bracket it closes.
  await page.goto('/account');
  await expect(page.locator('.page-head p span[lang="en"][dir="ltr"]')).toHaveText(email);
  await page.goto(itemsPath);
  await expect(page.locator('#main span[lang="en"][dir="ltr"]', { hasText: /^Ministry textbook \(Term 1 & Term 2\)$/ }).first()).toBeVisible();
  await page.goto(`/org/${orgId}`);
  await page.locator('.topbar').getByRole('button', { name: 'English', exact: true }).click();

  // Dark colour scheme.
  await page.emulateMedia({ colorScheme: 'dark' });
  await visit(page, `/org/${orgId}?scope=${scopeId}`, 'picker (dark)');
  await visit(page, `/org/${orgId}/billing`, 'billing (dark)');
  await visit(page, `/org/${orgId}/settings`, 'settings (dark)');
  await visit(page, `/org/${orgId}/scopes/${scopeId}/carry`, 'carry forward review (dark)');
  await visit(page, comparePath, 'compare scopes (dark)');
  await visit(page, itemsPath, 'notes and assignees (dark)');
  await visit(page, assignmentsPath, 'my assignments (dark)');
  await visit(page, classPath, 'class (dark)');
  await visit(page, homeworkPath, 'homework (dark)');
  await visit(page, testPath, 'test (dark)');
  await visit(page, monitorPath, 'test live monitor (dark)');
  await visit(page, gradebookPath, 'gradebook (dark)');
  await visit(page, retentionPath, 'keeping classroom data (dark)');
  await visit(page, allAssignmentsPath, 'my assignments in all organizations (dark)');

  // Phone.
  const phone = await newPage(browser, { viewport: { width: 390, height: 844 } });
  await login(phone, email);
  await visit(phone, `/org/${orgId}?scope=${scopeId}`, 'picker (phone)');
  await visit(phone, `/org/${orgId}/scopes/${scopeId}/carry`, 'carry forward review (phone)');
  await visit(phone, comparePath, 'compare scopes (phone)');
  await visit(phone, itemsPath, 'notes and assignees (phone)');
  await visit(phone, assignmentsPath, 'my assignments (phone)');
  await visit(phone, `/org/${orgId}/settings`, 'settings (phone)');
  await visit(phone, retentionPath, 'keeping classroom data (phone)');
  await visit(phone, allAssignmentsPath, 'my assignments in all organizations (phone)');

  // Platform admin.
  const admin = await newPage(browser);
  await signInAsPlatformAdmin(admin, () => audit(admin, 'two-factor sign-in'));
  for (const [path, where] of [
    ['/admin', 'admin overview'], ['/admin/orgs', 'admin organizations'], [`/admin/orgs/${orgId}`, 'admin organization detail'], ['/admin/users', 'admin users'],
    ['/admin/catalog', 'admin catalogue versions'], ['/admin/plans', 'admin plans'], ['/admin/audit', 'admin audit'], ['/admin/events', 'admin webhooks'],
  ] as const) await visit(admin, path, where);
  await admin.goto('/admin/catalog');
  await admin.getByRole('link', { name: /^2026\/2027/ }).first().click();
  await admin.locator('summary', { hasText: /^Primary 1 —/ }).click();
  await audit(admin, 'admin catalogue editor (grade open, verification badges)');
  await admin.getByRole('button', { name: 'Verification…' }).first().click();
  await audit(admin, 'admin verification dialog');
  await admin.keyboard.press('Escape');
  await admin.emulateMedia({ colorScheme: 'dark' });
  await audit(admin, 'admin catalogue editor (dark)');

  test.info().annotations.push({ type: 'audited screens', description: `${audited.length}: ${audited.join('; ')}` });
  writeFileSync(`${TRANSCRIPTS}/findings.json`, JSON.stringify(srFindings, null, 2));
  expect(findings, `${findings.length} accessibility findings:\n${report()}`).toEqual([]);
  // What the simulated screen reader found on the same screens (transcripts in test-results/screen-reader).
  expect(srFindings, srFindings.map((f) => `${f.where}: ${f.problem}: ${f.phrase}`).join('\n')).toEqual([]);
});

test('the picker and dialogs can be used with the keyboard alone', async ({ browser }) => {
  const page = await newPage(browser);
  const email = `keys.${uid()}@e2e.test`;
  await registerAndVerify(page, email, 'Keyboard School');
  await login(page, email);

  // After navigation focus is on the page heading. From the top of the page the first
  // Tab reaches the skip link, and following it returns to the heading without a reload.
  await expect(page.locator('#main h1')).toBeFocused();
  await page.evaluate(() => {
    document.body.tabIndex = -1;
    document.body.focus();
    document.body.removeAttribute('tabindex');
  });
  await page.keyboard.press('Tab');
  await expect(page.locator('#skip-link')).toBeFocused();
  await expect(page.locator('#skip-link')).toBeInViewport();
  await page.locator('#main h1').evaluate((el) => el.setAttribute('data-before-skip', ''));
  await page.keyboard.press('Enter');
  await expect(page.locator('#main h1[data-before-skip]')).toBeFocused();
  expect(new URL(page.url()).hash).toBe('');

  // A dialog opened from the keyboard takes focus; Escape closes it and returns focus.
  const create = page.getByRole('button', { name: /Create your first scope/ }).first();
  await create.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest('dialog')))).toBe(true);
  await page.keyboard.type('Keyboard plan');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(create).toBeFocused();
  await page.keyboard.press('Enter');
  await page.getByRole('dialog').getByLabel('Name').fill('Keyboard plan');
  await page.getByRole('dialog').getByRole('button', { name: 'Create' }).press('Enter');
  await expect(page.locator('.scopebar select')).toHaveValue(/.+/);

  // Tab through the filters to the first material; Space selects it; focus stays visible.
  let onMaterial = false;
  for (let i = 0; i < 120 && !onMaterial; i++) {
    await page.keyboard.press('Tab');
    onMaterial = await page.evaluate(() => document.activeElement?.classList.contains('mat') ?? false);
  }
  expect(onMaterial).toBe(true);
  const focused = page.locator('.mat:focus');
  await expect(focused).toHaveAttribute('aria-pressed', 'false');
  expect(await focused.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
  await page.keyboard.press('Space');
  await expect(focused).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.tray .count')).toHaveText(/Selected: 1 item/);
});

// What a screen reader gets that the axe rules do not check (docs/SCREEN_READER_REVIEW.md §4).
test('screen readers get page titles, the unread count, each book\'s kind and field errors', async ({ browser }) => {
  // A member created directly: the run has already used most of the 10 sign-ups an hour allowed from one address.
  const email = `reader.${uid()}@e2e.test`;
  await ownerQuery(`INSERT INTO users (email, name, password_hash, email_verified_at) VALUES ($1, 'Screen Reader', $2, now())`, [email, await hashPassword(PASSWORD)]);
  const page = await newPage(browser);
  await login(page, email);
  // The page area is not a live region: pages are announced through the heading that takes focus.
  await expect(page.locator('#app')).not.toHaveAttribute('aria-live');

  // Field hints and errors describe their field; a corrected field loses its old error. Neither submission changes the password.
  await page.goto('/account');
  await expect(page).toHaveTitle(`${(await page.locator('#main h1').innerText()).trim()} · Curriculum Scope`);
  const current = page.getByLabel('Current password');
  const fresh = page.getByLabel('New password');
  const hint = 'At least 10 characters. A passphrase works well.';
  await expect(fresh).toHaveAccessibleDescription(hint);
  await current.fill(PASSWORD);
  await fresh.fill('short');
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(fresh).toHaveAttribute('aria-invalid', 'true');
  // Field errors are not announced by themselves, so focus moves to the first field in error.
  await expect(fresh).toBeFocused();
  const error = (await page.locator('.field .err:not([hidden])').innerText()).trim();
  expect(error).not.toBe('');
  await expect(fresh).toHaveAccessibleDescription(`${hint} ${error}`);
  await current.fill('');
  await fresh.fill('a-long-enough-new-password');
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(current).toHaveAttribute('aria-invalid', 'true');
  await expect(current).toBeFocused();
  await expect(fresh).toHaveAccessibleDescription(hint);
  await expect(fresh).not.toHaveAttribute('aria-invalid');

  // Page titles follow the heading, in both languages; picker books say their kind.
  await page.getByLabel('Organization name').fill('Reader School');
  await page.getByRole('button', { name: 'Create organization' }).click();
  await page.waitForURL(/\/org\/[0-9a-f-]{36}$/);
  await expect(page).toHaveTitle('Egypt Curriculum Picker · دليل المناهج · Curriculum Scope');
  await expect(page.locator('.mat.moe').first()).toHaveAccessibleName(/\(Ministry material\)/);
  await expect(page.locator('.mat.ext').first()).toHaveAccessibleName(/\(External reference\)/);
  // A title mixing scripts stays one flex item: its lang span is inside it, so the gap cannot split it.
  const mixed = page.locator('.mat', { hasText: 'Al-Adwaa (' }).first();
  await expect(mixed.locator('xpath=./span[1]')).toHaveText('Al-Adwaa (الأضواء)');
  await expect(mixed.locator('xpath=./span[1]/span[@lang="ar"]')).toHaveText('الأضواء');
  for (const path of [`/org/${orgIdFromUrl(page)}/settings`, '/no-such-page']) {
    await page.goto(path);
    await expect(page).toHaveTitle(`${(await page.locator('#main h1').innerText()).trim()} · Curriculum Scope`);
  }
  await page.goto('/account');
  await page.locator('.topbar').getByRole('button', { name: 'العربية', exact: true }).click();
  await expect(page).toHaveTitle(/ · نطاق المناهج$/);
  await page.locator('.topbar').getByRole('button', { name: 'English', exact: true }).click();
  await expect(page).toHaveTitle(/ · Curriculum Scope$/);

  // The unread count is part of the notifications button's name, until the list is opened.
  await ownerQuery(
    `INSERT INTO notifications (user_id, kind, title, body) SELECT id, 'test', 'Hello', 'One' FROM users WHERE email = $1 UNION ALL SELECT id, 'test', 'Hello again', 'Two' FROM users WHERE email = $1`,
    [email],
  );
  await page.reload();
  const bell = page.locator('.topbar button.iconbtn', { hasText: '🔔' });
  await expect(bell).toHaveAccessibleName('Notifications, 2 unread');
  await bell.click();
  await expect(page.getByRole('dialog', { name: 'Notifications' })).toContainText('Hello again');
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await expect(bell).toHaveAccessibleName('Notifications');
  await expect(bell).toBeFocused();
});

// What the simulated screen reader announces after an action (screen-reader.ts; docs/SCREEN_READER_PRECHECK.md).
test('a simulated screen reader hears saving, dialogs and form errors', async ({ browser }) => {
  const email = `listener.${uid()}@e2e.test`;
  await ownerQuery(`INSERT INTO users (email, name, password_hash, email_verified_at) VALUES ($1, 'Listener', $2, now())`, [email, await hashPassword(PASSWORD)]);
  const page = await newPage(browser);
  await login(page, email);
  await page.getByLabel('Organization name').fill('Listening School');
  await page.getByRole('button', { name: 'Create organization' }).click();
  await page.waitForURL(/\/org\/[0-9a-f-]{36}$/);
  await createScope(page, 'Heard plan');
  await expect(page.locator('.scopebar select')).toHaveValue(/.+/);

  await listen(page);
  await page.locator('.mat').first().click();
  await expect(page.locator('.tray .toast')).toHaveText('Saved');
  // The book is named with its kind, and the save is announced politely.
  const toggled = await heard(page);
  expect(toggled[0]).toMatch(/^button, .+ \(Ministry material\)( \(.+\))?, (not )?pressed$/);
  expect(toggled).toContain('polite: Saved');

  await listen(page);
  await page.getByRole('button', { name: 'New scope' }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  // A dialog is announced by its title and focus lands on its first field.
  const opened = await heard(page);
  expect(opened).toEqual(expect.arrayContaining(['dialog, New scope', 'textbox, Name, required']));
  await page.keyboard.press('Escape');

  await page.goto('/account');
  await listen(page);
  await page.getByLabel('Current password').fill('not-the-password');
  await page.getByLabel('New password').fill('a-long-enough-new-password');
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.locator('.alert.error:not(:empty)')).toBeVisible();
  // An error for the whole form is announced at once, and once.
  const refused = await heard(page);
  expect(refused.filter((p) => p === 'assertive: Current password is incorrect')).toHaveLength(1);

  await listen(page);
  await page.getByLabel('New password').fill('short');
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByLabel('New password')).toBeFocused();
  // A field error: the field takes focus and is read with its error; no form-level message is announced.
  const invalid = await heard(page);
  expect(invalid).toContain('New password, short, At least 10 characters. A passphrase works well. Password must be at least 10 characters');
  expect(invalid.filter((p) => p.startsWith('assertive: ') && p !== 'assertive: ')).toEqual([]);
});
