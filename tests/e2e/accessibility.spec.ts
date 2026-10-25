import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { createScope, login, orgIdFromUrl, registerAndVerify, signInAsPlatformAdmin, uid } from './helpers.js';
import { ownerQuery } from './server.js';

// Automated WCAG 2.2 A/AA audit (axe-core) of every screen and the main
// dialogs, in English and Arabic, light and dark, desktop and phone. Runs after
// the journeys so pages show real data. Findings are collected and reported
// together. Automated checks cover only part of WCAG; see TEST_REPORT.md.

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
interface Finding { where: string; rule: string; impact: string | null | undefined; help: string; nodes: string[] }
const findings: Finding[] = [];
const audited: string[] = [];

async function audit(page: Page, where: string) {
  await page.waitForLoadState('networkidle');
  await page.locator('h1, h2').first().waitFor();
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  audited.push(where);
  for (const v of violations) findings.push({ where, rule: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 4).map((n) => n.target.join(' ')) });
}

async function visit(page: Page, path: string, where: string) {
  await page.goto(path);
  await audit(page, where);
}

const report = () => findings.map((f) => `[${f.impact}] ${f.rule} — ${f.help}\n    at ${f.where}: ${f.nodes.join(' | ')}`).join('\n');

async function newPage(browser: Browser, opts: Parameters<Browser['newContext']>[0] = {}) {
  return (await browser.newContext(opts)).newPage();
}

test('every screen passes an automated WCAG 2.2 AA check (English and Arabic, light and dark, desktop and phone)', async ({ browser }) => {
  test.setTimeout(300_000);

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
  await audit(studentPhone, 'student portal (phone)');

  // Arabic (right to left).
  await page.goto(`/org/${orgId}?scope=${scopeId}`);
  await page.locator('.topbar').getByRole('button', { name: 'العربية', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await audit(page, 'picker (Arabic)');
  for (const [path, where] of [
    [`/org/${orgId}/scopes`, 'scopes (Arabic)'], [`/org/${orgId}/scopes/${scopeId}/carry`, 'carry forward review (Arabic)'],
    [`/org/${orgId}/billing`, 'billing (Arabic)'], ['/account', 'account (Arabic)'], [comparePath, 'compare scopes (Arabic)'],
    [itemsPath, 'notes and assignees (Arabic)'], [assignmentsPath, 'my assignments (Arabic)'], [allAssignmentsPath, 'my assignments in all organizations (Arabic)'],
  ] as const) await visit(page, path, where);
  await page.goto(`/org/${orgId}`);
  await page.locator('.topbar').getByRole('button', { name: 'English', exact: true }).click();

  // Dark colour scheme.
  await page.emulateMedia({ colorScheme: 'dark' });
  await visit(page, `/org/${orgId}?scope=${scopeId}`, 'picker (dark)');
  await visit(page, `/org/${orgId}/billing`, 'billing (dark)');
  await visit(page, `/org/${orgId}/scopes/${scopeId}/carry`, 'carry forward review (dark)');
  await visit(page, comparePath, 'compare scopes (dark)');
  await visit(page, itemsPath, 'notes and assignees (dark)');
  await visit(page, assignmentsPath, 'my assignments (dark)');
  await visit(page, allAssignmentsPath, 'my assignments in all organizations (dark)');

  // Phone.
  const phone = await newPage(browser, { viewport: { width: 390, height: 844 } });
  await login(phone, email);
  await visit(phone, `/org/${orgId}?scope=${scopeId}`, 'picker (phone)');
  await visit(phone, `/org/${orgId}/scopes/${scopeId}/carry`, 'carry forward review (phone)');
  await visit(phone, comparePath, 'compare scopes (phone)');
  await visit(phone, itemsPath, 'notes and assignees (phone)');
  await visit(phone, assignmentsPath, 'my assignments (phone)');
  await visit(phone, allAssignmentsPath, 'my assignments in all organizations (phone)');

  // Platform admin.
  const admin = await newPage(browser);
  await signInAsPlatformAdmin(admin);
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
  expect(findings, `${findings.length} accessibility findings:\n${report()}`).toEqual([]);
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
