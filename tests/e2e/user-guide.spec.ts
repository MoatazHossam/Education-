import { mkdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { authenticator } from 'otplib';
import { hashPassword } from '../../src/auth/password.js';
import { encryptSecret } from '../../src/lib/crypto.js';
import { parseCsv, toCsv, unguardCell } from '../../src/lib/csv.js';
import { login, PASSWORD, payInSandbox, token } from './helpers.js';
import { E2E_ENV, latestEmailText, ownerQuery, runReminderPass, runWebhookPass } from './server.js';

// Screenshots for docs/USER_GUIDE.md (`npm run docs:screenshots`). Builds a
// demo school on a fresh database through the interface, as its people would,
// and captures each screen. All names and addresses are invented.

const OUT = 'docs/user-guide/images';
const EMAILS = 'test-results/user-guide-emails.json';
mkdirSync(OUT, { recursive: true });
mkdirSync('test-results', { recursive: true });
const taken: string[] = [];
const emails: Record<string, string> = {};

async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
}

/**
 * The visible page, the whole page, or one element of it (with a margin of the page around it when `pad` is set).
 * Passing messages ("Saved") are waited out unless they are the point.
 */
async function shot(page: Page, name: string, el?: Locator, { keepToasts = false, pad = 0, fullPage = false } = {}) {
  if (!keepToasts) await expect(page.locator('#toasts > *')).toHaveCount(0, { timeout: 10_000 });
  await settle(page);
  expect(await page.evaluate(() => [...document.querySelectorAll('dialog[open]')].some((d) => d.scrollWidth > d.clientWidth + 1)), `${name}: content wider than its dialog`).toBe(false);
  const path = `${OUT}/${name}.png`;
  if (el && pad) {
    const box = (await el.boundingBox())!;
    const view = page.viewportSize()!;
    const x = Math.max(0, box.x - pad);
    const y = Math.max(0, box.y - pad);
    await page.screenshot({ path, clip: { x, y, width: Math.min(view.width, box.x + box.width + pad) - x, height: Math.min(view.height, box.y + box.height + pad) - y } });
  } else if (el) await el.screenshot({ path });
  else await page.screenshot({ path, fullPage });
  taken.push(name);
}

/** The card of a signed-out page (sign-in, invitation, checkout), with some of the page around it. */
const card = (page: Page) => page.locator('.auth-card');

/** Scrolls so `el` sits just below the picker's sticky filters (or the top of the page). */
async function scrollTo(page: Page, el: Locator, offset = 12) {
  await el.evaluate((node, offset) => {
    const top = node.getBoundingClientRect().top + window.scrollY;
    // What stays stuck at the top (the top bar, the picker's filters) covers that much of the page.
    const covered = Math.max(0, ...[...document.querySelectorAll('.topbar, .controls')]
      .filter((s) => getComputedStyle(s).position === 'sticky')
      .map((s) => (parseFloat(getComputedStyle(s).top) || 0) + s.getBoundingClientRect().height));
    window.scrollTo(0, Math.max(0, top - covered - offset));
  }, offset);
}

const dialog = (page: Page) => page.getByRole('dialog');

const pages: Page[] = [];
async function newPage(browser: Browser, opts: Parameters<Browser['newContext']>[0] = {}) {
  const page = await (await browser.newContext(opts)).newPage();
  pages.push(page);
  return page;
}

// When a step fails, keep what each person's window showed.
// eslint-disable-next-line no-empty-pattern -- Playwright passes fixtures first; none are needed here.
test.afterEach(async ({}, info) => {
  if (info.status === info.expectedStatus) return;
  for (const [i, page] of pages.entries()) await page.screenshot({ path: info.outputPath(`page-${i}.png`) }).catch(() => {});
});

async function keepEmail(to: string, template: string, label = template) {
  const text = await latestEmailText(to, template);
  emails[label] = text.replace(/token=[A-Za-z0-9_-]+/g, 'token=…');
  return text;
}

const SCHOOL = 'Nile Valley Language School';
const MONA = 'mona.hassan@nilevalley.example';
const KARIM = 'karim.adel@nilevalley.example';
const SALMA = 'salma.fathy@nilevalley.example';
const ADMIN = 'support@curriculumscope.example';
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

test('user guide screenshots', async ({ browser }) => {
  // A local receiver stands in for the school's content system (webhooks).
  const received: string[] = [];
  const receiver = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => { received.push(body); res.writeHead(200).end('ok'); });
  });
  await new Promise<void>((r) => receiver.listen(0, '127.0.0.1', r));
  const hookUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/curriculum-sync`;

  // ================================================================ signed out
  const guest = await newPage(browser);
  await guest.goto('/pricing');
  await expect(guest.getByRole('heading', { name: 'Pricing' })).toBeVisible();
  await shot(guest, 'pricing');

  await guest.goto('/register');
  await guest.getByLabel('Your name').fill('Mona Hassan');
  await guest.getByLabel('Email').fill(MONA);
  await guest.getByLabel('Password').fill(PASSWORD);
  await guest.getByLabel('Organization name').fill(SCHOOL);
  await shot(guest, 'register', card(guest), { pad: 32 });
  await guest.getByRole('button', { name: 'Create account' }).click();
  await expect(guest.getByText(`Check ${MONA}`)).toBeVisible();
  await shot(guest, 'register-check-email', card(guest), { pad: 32 });
  const verify = await keepEmail(MONA, 'verify_email');
  await guest.goto(`/verify-email?token=${token(verify)}`);
  await expect(guest.getByText('Your email is confirmed')).toBeVisible();
  await shot(guest, 'email-confirmed', card(guest), { pad: 32 });

  await guest.goto('/login');
  await guest.getByLabel('Email').fill(MONA);
  await shot(guest, 'sign-in', card(guest), { pad: 32 });
  await guest.goto('/forgot-password');
  await guest.getByLabel('Email').fill(MONA);
  await shot(guest, 'forgot-password', card(guest), { pad: 32 });
  await guest.getByRole('button', { name: 'Send reset link' }).click();
  await expect(guest.getByText(/reset link is on its way/)).toBeVisible();
  const reset = await keepEmail(MONA, 'reset_password');
  await guest.goto(`/reset-password?token=${token(reset)}`);
  await shot(guest, 'reset-password', card(guest), { pad: 32 });

  // ================================================================ the owner's first visit
  const mona = await newPage(browser);
  await login(mona, MONA);
  const orgId = /\/org\/([0-9a-f-]{36})/.exec(mona.url())![1]!;
  await expect(mona.getByRole('heading', { name: 'Create your first content scope' })).toBeVisible();
  await shot(mona, 'picker-first-visit');
  await mona.getByRole('button', { name: 'Create your first scope' }).first().click();
  await dialog(mona).getByLabel('Name').fill('Primary 1–3 core books');
  await dialog(mona).getByLabel('Description').fill('Arabic, English, maths and science for the lower primary platform.');
  await shot(mona, 'new-scope-dialog', dialog(mona));
  await dialog(mona).getByRole('button', { name: 'Create' }).click();
  await expect(mona.locator('.scopebar select option:checked')).toHaveText(/Primary 1–3 core books/);

  for (const g of [1, 2, 3]) await mona.getByRole('button', { name: `Grade ${g}`, exact: true }).click();
  const books = mona.locator('.mat');
  for (const i of [0, 1, 3, 7, 8, 10, 14, 15, 40, 41, 52, 53]) await books.nth(i).click();
  await expect(mona.locator('.tray .toast')).toHaveText('Saved');
  await shot(mona, 'picker-filters', mona.locator('.controls'));

  // ================================================================ platform administrator: two-factor sign-in, verification, students
  const admin = await newPage(browser);
  const secret = authenticator.generateSecret();
  await ownerQuery(
    `INSERT INTO users (email, name, password_hash, email_verified_at, is_platform_admin, mfa_enabled, mfa_secret_enc) VALUES ($1, 'Curriculum Scope Support', $2, now(), true, true, $3)`,
    [ADMIN, await hashPassword(PASSWORD), encryptSecret(E2E_ENV.DATA_ENCRYPTION_KEY!, secret)],
  );
  await login(admin, ADMIN);
  await expect(admin.getByRole('heading', { name: 'Two-factor verification' })).toBeVisible();
  await shot(admin, 'two-factor-sign-in', card(admin), { pad: 32 });
  await admin.getByLabel('Authentication code').fill(authenticator.generate(secret));
  await admin.getByRole('button', { name: 'Verify' }).click();
  await admin.waitForURL((u) => !u.pathname.startsWith('/mfa'));

  await admin.goto('/admin/catalog');
  await admin.getByRole('link', { name: /^2026\/2027/ }).first().click();
  await admin.waitForURL(/\/admin\/catalog\/[0-9a-f-]{36}$/);
  await admin.locator('summary', { hasText: /^Primary 1 —/ }).click();
  await admin.getByRole('button', { name: 'Verification…' }).first().click();
  await dialog(admin).getByLabel('Status').selectOption('verified');
  await dialog(admin).getByLabel(/^Source checked/).fill('Ministerial Decree 123/2026');
  await dialog(admin).getByLabel('Source link (optional)').fill('https://moe.gov.eg/decrees/123');
  await shot(admin, 'admin-verification-dialog', dialog(admin));
  await dialog(admin).getByRole('button', { name: 'Save' }).click();
  await expect(admin.getByText(/^Verified: 1\/231 subjects/)).toBeVisible();
  await shot(admin, 'admin-catalogue-editor');

  await admin.goto(`/admin/orgs/${orgId}`);
  await admin.getByLabel('Student accounts (override)').fill('300');
  await admin.getByRole('button', { name: 'Apply' }).click();
  await expect(admin.getByText('Saved')).toBeVisible();

  // ================================================================ the picker, with a verified subject
  await mona.goto(`/org/${orgId}`);
  await mona.getByRole('button', { name: 'Grade 1', exact: true }).click();
  await mona.locator('.verif.ok summary').first().click();
  await scrollTo(mona, mona.locator('section.grade').first());
  await shot(mona, 'picker-books');
  await mona.getByRole('button', { name: 'View list' }).click();
  await shot(mona, 'picker-tray', mona.locator('.tray'));
  await mona.getByRole('button', { name: 'Hide list' }).click();

  // ================================================================ members and invitations
  await mona.goto(`/org/${orgId}/members`);
  await mona.getByLabel('Email').fill(KARIM);
  await mona.getByLabel('Role').selectOption('editor');
  await mona.getByRole('button', { name: 'Send invitation' }).click();
  await expect(mona.getByText(`Invitation sent to ${KARIM}`)).toBeVisible();
  await mona.getByLabel('Email').fill(SALMA);
  await mona.getByLabel('Role').selectOption('viewer');
  await mona.getByRole('button', { name: 'Send invitation' }).click();
  await expect(mona.getByText(`Invitation sent to ${SALMA}`)).toBeVisible();

  const karim = await newPage(browser);
  const invite = await keepEmail(KARIM, 'invitation');
  await karim.goto(`/invite?token=${token(invite)}`);
  await expect(karim.getByText(`invited you to ${SCHOOL} as Editor`)).toBeVisible();
  await karim.getByLabel('Your name').fill('Karim Adel');
  await karim.getByLabel('Password').fill(PASSWORD);
  await shot(karim, 'invitation', card(karim), { pad: 32 });
  await karim.getByRole('button', { name: 'Create account and join' }).click();
  await expect(karim.locator('.picker h1')).toBeVisible();

  await mona.reload();
  await expect(mona.getByText('Karim Adel')).toBeVisible();
  await shot(mona, 'members');

  const salma = await newPage(browser);
  await salma.goto(`/invite?token=${token(await latestEmailText(SALMA, 'invitation'))}`);
  await salma.getByLabel('Your name').fill('Salma Fathy');
  await salma.getByLabel('Password').fill(PASSWORD);
  await salma.getByRole('button', { name: 'Create account and join' }).click();
  await expect(salma.locator('.picker h1')).toBeVisible();
  await salma.getByRole('button', { name: 'Grade 1', exact: true }).click();
  await salma.locator('.mat[aria-pressed="false"]').first().click({ force: true });
  await expect(salma.locator('#toasts')).toContainText('Read-only: viewers cannot change selections.');
  await scrollTo(salma, salma.locator('section.grade').first());
  await shot(salma, 'picker-viewer', undefined, { keepToasts: true });

  // ================================================================ notes, assignees, status and due dates
  await mona.goto(`/org/${orgId}`);
  await mona.locator('.scopebar').getByRole('link', { name: 'Notes and assignees' }).click();
  await expect(mona.getByRole('heading', { name: 'Notes and assignees', level: 1 })).toBeVisible();
  const edit = mona.getByRole('button', { name: /^Edit the note on / });
  await edit.nth(0).click();
  await dialog(mona).getByLabel('Note').fill('Order 120 copies before September; check the new cover.');
  await dialog(mona).getByLabel('Assigned to').selectOption({ label: 'Karim Adel' });
  await dialog(mona).getByLabel('Status').selectOption({ label: 'To do' });
  await dialog(mona).getByLabel('Due date').fill(day(1));
  await shot(mona, 'note-dialog', dialog(mona));
  await dialog(mona).getByRole('button', { name: 'Save' }).click();
  await expect(dialog(mona)).toHaveCount(0);
  await edit.nth(1).click();
  await dialog(mona).getByLabel('Assigned to').selectOption({ label: 'Karim Adel' });
  await dialog(mona).getByLabel('Status').selectOption({ label: 'In progress' });
  await dialog(mona).getByLabel('Due date').fill(day(-7));
  await dialog(mona).getByRole('button', { name: 'Save' }).click();
  await expect(dialog(mona)).toHaveCount(0);
  await edit.nth(3).click();
  await dialog(mona).getByLabel('Note').fill('Waiting for the 2027 edition from the publisher.');
  await dialog(mona).getByRole('button', { name: 'Save' }).click();
  await expect(dialog(mona)).toHaveCount(0);
  await edit.nth(4).click();
  await dialog(mona).getByLabel('Assigned to').selectOption({ label: 'Mona Hassan' });
  await dialog(mona).getByLabel('Status').selectOption({ label: 'Done' });
  await dialog(mona).getByRole('button', { name: 'Save' }).click();
  await expect(dialog(mona)).toHaveCount(0);
  await mona.locator('table.items input[type="checkbox"]').nth(6).check();
  await mona.locator('table.items input[type="checkbox"]').nth(7).check();
  await keepEmail(KARIM, 'items_assigned');
  await mona.evaluate(() => window.scrollTo(0, 0));
  await shot(mona, 'notes-page');
  await shot(mona, 'notes-bulk', mona.locator('.items-bulk'));

  // Karim: notifications, My assignments; then a reminder for tomorrow's book.
  await karim.goto(`/org/${orgId}`);
  await karim.locator('.topbar button.iconbtn', { hasText: '🔔' }).click();
  await expect(dialog(karim)).toContainText('assigned');
  await shot(karim, 'notifications', dialog(karim));
  await karim.keyboard.press('Escape');
  await karim.locator('.topbar').getByRole('link', { name: /^My assignments/ }).click();
  await expect(karim.getByRole('heading', { name: 'My assignments', level: 1 })).toBeVisible();
  await shot(karim, 'my-assignments');
  const cairoMorning = new Date(Date.now());
  cairoMorning.setUTCHours(8, 30, 0, 0); // 10:30 or 11:30 in Cairo, inside the reminder window
  await runReminderPass(cairoMorning);
  await keepEmail(KARIM, 'items_due');

  // A second organization for Karim, so My assignments in all organizations has two.
  await mona.goto('/account?new-org=1');
  await mona.locator('#new-org').getByLabel('Organization name').fill('Nile Valley Summer Programme');
  await mona.getByRole('button', { name: 'Create organization' }).click();
  await mona.waitForURL(/\/org\/[0-9a-f-]{36}$/);
  const summerId = /\/org\/([0-9a-f-]{36})/.exec(mona.url())![1]!;
  await ownerQuery(`INSERT INTO memberships (org_id, user_id, role) SELECT $1, id, 'editor' FROM users WHERE email = $2`, [summerId, KARIM]);
  await mona.getByRole('button', { name: 'Create your first scope' }).first().click();
  await dialog(mona).getByLabel('Name').fill('Summer reading 2027');
  await dialog(mona).getByRole('button', { name: 'Create' }).click();
  await mona.getByRole('button', { name: 'Grade 4', exact: true }).click();
  await mona.locator('.mat').nth(1).click();
  await expect(mona.locator('.tray .toast')).toHaveText('Saved');
  await mona.locator('.scopebar').getByRole('link', { name: 'Notes and assignees' }).click();
  await mona.getByRole('button', { name: /^Edit the note on / }).first().click();
  await dialog(mona).getByLabel('Assigned to').selectOption({ label: 'Karim Adel' });
  await dialog(mona).getByLabel('Due date').fill(day(10));
  await dialog(mona).getByRole('button', { name: 'Save' }).click();
  await expect(dialog(mona)).toHaveCount(0);
  await karim.goto('/assignments');
  await expect(karim.getByRole('heading', { name: 'My assignments in all my organizations' })).toBeVisible();
  await shot(karim, 'my-assignments-all');
  await shot(mona, 'organization-switcher', mona.locator('.topbar'));

  // ================================================================ scopes, duplicate, compare
  await mona.goto(`/org/${orgId}/scopes`);
  await mona.getByRole('button', { name: 'Duplicate' }).first().click();
  await dialog(mona).getByRole('textbox').fill('Primary 1–3 core books — Campus B');
  await dialog(mona).getByRole('button', { name: 'Confirm' }).click();
  // The copy opens in the picker; Campus B swaps a few books.
  await mona.waitForURL(/\?scope=/);
  const campusB = [{ id: new URL(mona.url()).searchParams.get('scope')! }];
  await expect(mona.locator('.scopebar select option:checked')).toHaveText(/Campus B/);
  await mona.getByRole('button', { name: 'Grade 1', exact: true }).click();
  for (const i of [3, 5, 6]) await mona.locator('.mat').nth(i).click();
  await expect(mona.locator('.tray .toast')).toHaveText('Saved');
  await mona.goto(`/org/${orgId}/scopes`);
  await shot(mona, 'scopes');
  await mona.getByRole('link', { name: 'Compare scopes' }).click();
  await expect(mona.getByRole('heading', { name: 'Compare scopes', level: 1 })).toBeVisible();
  await shot(mona, 'compare');

  // ================================================================ a new academic year: admin prepares and publishes 2027/2028
  await admin.goto('/admin/catalog');
  await admin.getByLabel('Academic year').fill('2027/2028');
  await admin.getByLabel('Label').fill('Egypt K-12 curriculum — academic year 2027/2028');
  await shot(admin, 'admin-catalogue-versions');
  await admin.getByRole('button', { name: 'Create draft' }).click();
  await admin.waitForURL(/\/admin\/catalog\/[0-9a-f-]{36}$/);
  const nextId = /catalog\/([0-9a-f-]{36})/.exec(admin.url())![1]!;
  // One of the school's books is dropped from the new year, and one is renamed.
  const chosen = await ownerQuery(
    `SELECT m.id, m.title FROM scope_items i JOIN scopes s ON s.id = i.scope_id JOIN catalog_materials m ON m.id = i.material_id
     WHERE s.org_id = $1 AND s.name = 'Primary 1–3 core books' ORDER BY m.sort_order, m.title`,
    [orgId],
  );
  const sameIn = (alias: string) => `ns.version_id = $1 AND ns.grade = os.grade AND ns.track = os.track AND ns.block = os.block AND ns.code = os.code AND ${alias}.title = om.title`;
  await ownerQuery(`DELETE FROM catalog_materials nm USING catalog_subjects ns, catalog_materials om, catalog_subjects os WHERE om.id = $2 AND os.id = om.subject_id AND nm.subject_id = ns.id AND ${sameIn('nm')}`, [nextId, chosen[2].id]);
  // The spreadsheet route: mark three Primary 1 books verified in the draft, preview, apply.
  const sheet = await admin.request.get(`/api/admin/catalog/versions/${nextId}/sheet`);
  const records = parseCsv(await sheet.text()).map((r) => r.map(unguardCell));
  const col = (c: string) => records[0]!.indexOf(c);
  for (const r of records.filter((x) => x[col('row_type')] === 'material' && x[col('grade')] === '1').slice(0, 3)) {
    r[col('verification_status')] = 'verified';
    r[col('verification_source')] = 'Publisher catalogue 2027';
  }
  await admin.reload();
  await admin.locator('input[type="file"]').setInputFiles({ name: 'catalogue-2027-2028.csv', mimeType: 'text/csv', buffer: Buffer.from(toCsv(records)) });
  await expect(dialog(admin)).toContainText('rows read');
  await shot(admin, 'admin-spreadsheet-preview', dialog(admin));
  await dialog(admin).getByRole('button', { name: /^Apply / }).click();
  await admin.goto('/admin/catalog');
  await admin.getByRole('button', { name: 'Publish' }).click();
  await shot(admin, 'admin-publish-dialog', dialog(admin));
  await dialog(admin).getByRole('button', { name: 'Confirm' }).click();
  await expect(admin.getByRole('button', { name: 'Publish' })).toHaveCount(0);
  await keepEmail(MONA, 'catalog_published');

  // ================================================================ carry forward
  await mona.goto(`/org/${orgId}`);
  await expect(mona.locator('.carry-banner')).toContainText('A newer catalogue (2027/2028) has been published.');
  await shot(mona, 'carry-banner', mona.locator('.picker > header'));
  await mona.locator('.topbar button.iconbtn', { hasText: '🔔' }).click();
  await shot(mona, 'notifications-catalogue', dialog(mona));
  await mona.keyboard.press('Escape');
  await mona.locator('.carry-banner').getByRole('link', { name: 'Carry this scope forward' }).click();
  await expect(mona.getByRole('heading', { name: /^Carry “.+” forward$/ })).toBeVisible();
  await shot(mona, 'carry-review');
  await mona.getByRole('button', { name: 'Carry forward' }).click();
  await mona.waitForURL(/\/org\/[0-9a-f-]{36}\?scope=/);
  await expect(mona.locator('.eyebrow')).toContainText('Academic year 2027/2028');

  // ================================================================ billing
  await mona.goto(`/org/${orgId}/billing`);
  await expect(mona.getByRole('heading', { name: 'Billing', level: 1 })).toBeVisible();
  await shot(mona, 'billing', undefined, { fullPage: true });
  await mona.locator('.plan', { has: mona.getByRole('heading', { name: 'Professional' }) }).getByRole('button', { name: 'Subscribe' }).click();
  await expect(mona.getByRole('heading', { name: 'Sandbox checkout' })).toBeVisible();
  await shot(mona, 'checkout', card(mona), { pad: 32 });
  await payInSandbox(mona);
  await keepEmail(MONA, 'payment_succeeded');
  await mona.goto(`/org/${orgId}/billing`);
  await expect(mona.getByText(/Renews on/)).toBeVisible();
  await shot(mona, 'billing-subscribed', undefined, { fullPage: true });

  // ================================================================ students
  await mona.goto(`/org/${orgId}/students`);
  await expect(mona.getByRole('heading', { name: 'Students', level: 1 })).toBeVisible();
  const schoolCode = (await mona.locator('.code-big').textContent())!.trim();
  await mona.getByRole('button', { name: 'Add student' }).click();
  await dialog(mona).getByLabel('Username').fill('omar.khaled');
  await dialog(mona).getByLabel('Student’s name').fill('Omar Khaled');
  await dialog(mona).getByLabel('Grade', { exact: true }).selectOption('1');
  await dialog(mona).getByLabel('Curriculum').selectOption({ label: 'Primary 1–3 core books (2026/2027)' }).catch(async () => {
    const v = await dialog(mona).getByLabel('Curriculum').locator('option', { hasText: 'Primary 1–3 core books' }).first().getAttribute('value');
    await dialog(mona).getByLabel('Curriculum').selectOption(v!);
  });
  await shot(mona, 'student-add-dialog', dialog(mona));
  await dialog(mona).getByRole('button', { name: 'Add student' }).click();
  await expect(dialog(mona)).toContainText('Student passwords');
  await shot(mona, 'student-passwords', dialog(mona));
  const omarPassword = (await dialog(mona).locator('.cred').textContent())!.trim();
  await dialog(mona).getByRole('button', { name: 'Done' }).click();
  await mona.getByRole('button', { name: 'Import CSV…' }).click();
  const roster = (rows: string) => ({ name: 'grade-2-roster.csv', mimeType: 'text/csv', buffer: Buffer.from(`username,name,grade,scope\n${rows}`) });
  await dialog(mona).getByLabel('Roster file (CSV)').setInputFiles(roster('laila.mostafa,Laila Mostafa,2,Primary 1–3 core books\nyoussef.ali,Youssef Ali,2,Primary 1–3 core books\nnour ahmed,Nour Ahmed,2,\n'));
  await expect(dialog(mona).getByText('Problems to fix first: 1.')).toBeVisible();
  await shot(mona, 'student-import', dialog(mona));
  await dialog(mona).getByLabel('Roster file (CSV)').setInputFiles(roster('laila.mostafa,Laila Mostafa,2,Primary 1–3 core books\nyoussef.ali,Youssef Ali,2,Primary 1–3 core books\nnour.ahmed,Nour Ahmed,2,\n'));
  await expect(dialog(mona).getByText('Students ready to import: 3')).toBeVisible();
  await dialog(mona).getByRole('button', { name: 'Import', exact: true }).click();
  await expect(dialog(mona)).toContainText('Student passwords');
  await dialog(mona).getByRole('button', { name: 'Done' }).click();
  await shot(mona, 'students');

  const student = await newPage(browser);
  await student.goto(`/student-login?school=${schoolCode}`);
  await student.getByLabel('Username').fill('omar.khaled');
  await student.getByLabel('Password').fill(omarPassword);
  await shot(student, 'student-sign-in', card(student), { pad: 32 });
  await student.getByRole('button', { name: 'Sign in' }).click();
  await student.waitForURL(/\/student$/);
  await expect(student.locator('.subj .mat.book').first()).toBeVisible();
  await shot(student, 'student-portal');
  await student.locator('.topbar').getByRole('button', { name: 'العربية', exact: true }).click();
  await expect(student.locator('html')).toHaveAttribute('dir', 'rtl');
  await shot(student, 'student-portal-arabic');

  // ================================================================ settings: organization, API keys, webhooks, support access
  await mona.goto(`/org/${orgId}/settings`);
  await expect(mona.getByRole('heading', { name: 'Organization settings', level: 1 })).toBeVisible();
  await shot(mona, 'settings');
  await mona.getByLabel('Key name').fill('Content pipeline');
  await mona.getByRole('button', { name: 'Create key' }).click();
  await expect(dialog(mona)).toContainText('API key created');
  await shot(mona, 'api-key-created', dialog(mona));
  await dialog(mona).getByRole('button', { name: 'Done' }).click();
  // The page redraws with the new key; wait for it before typing into the webhook form.
  await expect(mona.locator('#main table.data b', { hasText: 'Content pipeline' })).toBeVisible();
  await settle(mona);
  await mona.getByLabel('Endpoint URL').fill(hookUrl);
  await mona.getByLabel('Description (optional)').fill('Lesson platform: sync selected books');
  await mona.getByRole('button', { name: 'Add endpoint' }).click();
  await expect(dialog(mona)).toContainText('Copy this signing secret now');
  await shot(mona, 'webhook-secret', dialog(mona));
  await dialog(mona).getByRole('button', { name: 'Done' }).click();
  await settle(mona);
  await mona.getByRole('button', { name: `Send a test to ${hookUrl}` }).click();
  await expect(mona.locator('#toasts').getByText('Test delivered (200)')).toBeVisible();
  await mona.goto(`/org/${orgId}?scope=${campusB[0].id}`);
  await mona.getByRole('button', { name: 'Grade 2', exact: true }).click();
  await mona.locator('.mat[aria-pressed="false"]').first().click();
  await expect(mona.locator('.tray .toast')).toHaveText('Saved');
  await runWebhookPass();
  expect(received.length).toBeGreaterThanOrEqual(2);
  await mona.goto(`/org/${orgId}/settings`);
  await scrollTo(mona, mona.locator('#webhooks'));
  await shot(mona, 'settings-webhooks');
  await mona.getByRole('button', { name: `Deliveries to ${hookUrl}` }).click();
  await shot(mona, 'webhook-deliveries', dialog(mona));
  await dialog(mona).getByRole('button', { name: 'Close' }).click();
  await mona.getByLabel('Reason').fill('Ticket 2041: the Grade 2 export looks wrong');
  await mona.getByRole('button', { name: 'Allow support access' }).click();
  await expect(mona.getByText('Support access granted')).toBeVisible();
  await scrollTo(mona, mona.getByRole('heading', { name: 'Support access' }));
  await shot(mona, 'settings-support');

  // ================================================================ audit log, account
  await mona.goto(`/org/${orgId}/audit`);
  await shot(mona, 'audit-log');
  await mona.goto('/account');
  await expect(mona.getByRole('heading', { name: 'Your account', level: 1 })).toBeVisible();
  await shot(mona, 'account');
  await mona.getByRole('button', { name: 'Set up two-factor authentication' }).click();
  await expect(mona.getByRole('img', { name: 'QR code for your authenticator app' })).toBeVisible();
  await scrollTo(mona, mona.getByRole('img', { name: 'QR code for your authenticator app' }), 160);
  await shot(mona, 'account-two-factor');

  // ================================================================ Arabic and phone
  await mona.goto(`/org/${orgId}?scope=${campusB[0].id}`);
  await mona.locator('.topbar').getByRole('button', { name: 'العربية', exact: true }).click();
  await expect(mona.locator('html')).toHaveAttribute('dir', 'rtl');
  await mona.getByRole('button', { name: 'الصف 1', exact: false }).first().click().catch(() => {});
  await shot(mona, 'picker-arabic');
  await mona.goto(`/org/${orgId}/scopes`);
  await shot(mona, 'scopes-arabic');
  await mona.locator('.topbar').getByRole('button', { name: 'English', exact: true }).click();
  await expect(mona.locator('html')).toHaveAttribute('dir', 'ltr');

  const phone = await newPage(browser, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await login(phone, MONA);
  await phone.goto(`/org/${orgId}?scope=${campusB[0].id}`);
  await expect(phone.locator('.mat').first()).toBeVisible();
  await phone.getByRole('button', { name: 'Grade 1', exact: true }).click();
  await scrollTo(phone, phone.locator('section.grade').first());
  await shot(phone, 'picker-phone');

  // ================================================================ platform administration
  await admin.goto('/admin');
  await expect(admin.getByRole('heading', { name: 'Platform overview' })).toBeVisible();
  await shot(admin, 'admin-overview');
  await admin.goto('/admin/orgs');
  await shot(admin, 'admin-organizations');
  await admin.goto(`/admin/orgs/${orgId}`);
  await expect(admin.getByText(/The owner granted access until/)).toBeVisible();
  await shot(admin, 'admin-organization');
  await admin.goto('/admin/users');
  await shot(admin, 'admin-users');
  await admin.goto('/admin/plans');
  await shot(admin, 'admin-plans');
  await admin.goto('/admin/audit');
  await shot(admin, 'admin-audit');
  await admin.goto('/admin/events');
  await shot(admin, 'admin-events');

  writeFileSync(EMAILS, JSON.stringify(emails, null, 2));
  test.info().annotations.push({ type: 'screenshots', description: `${taken.length}: ${taken.join(', ')}` });
  receiver.closeAllConnections();
  receiver.close();
});
