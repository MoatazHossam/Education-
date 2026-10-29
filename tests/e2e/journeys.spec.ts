import { createHmac } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';
import { parseCsv, toCsv, unguardCell } from '../../src/lib/csv.js';
import { createScope, login, navigable, openPage, orgIdFromUrl, PASSWORD, payInSandbox, registerAndVerify, signInAsPlatformAdmin, token, uid } from './helpers.js';
import { latestEmailText, ownerQuery, runDigestPass, runFileCheckPass, runReminderPass, runRetentionPass, runWebhookPass, startServer, stopServer } from './server.js';

test.describe.configure({ mode: 'serial' });
// The built-in page navigates like the others (helpers.ts, navigable).
test.beforeEach(({ page }) => {
  navigable(page);
});

let ownerEmail = '';
let orgAId = '';
// The notes team (journey 14) is reused by journeys 15 to 19: sign-ups are limited to 10 an hour per address.
const notesTeam = { ownerEmail: '', orgId: '', editorEmail: '' };
// The school of journey 13 (students) is reused by journey 20 (classes and homework), for the same reason.
const delta = { ownerEmail: '', orgId: '', schoolCode: '', subject: '', firstBook: '', lailaPassword: '' };

test('owner registers, verifies email, signs in and builds a content scope that persists', async ({ page }) => {
  ownerEmail = `owner.${uid()}@e2e.test`;
  await registerAndVerify(page, ownerEmail, 'Nile Learning');
  await login(page, ownerEmail);
  await expect(page.getByRole('heading', { name: 'Create your first content scope' })).toBeVisible();
  await expect(page.getByText('Professional trial.')).toBeVisible();
  orgAId = orgIdFromUrl(page);

  await createScope(page, 'Grade 4 pilot');
  await expect(page.locator('.scopebar select')).toHaveValue(/.+/);
  await page.getByRole('button', { name: 'Grade 4' }).click();
  const mats = page.locator('.mat');
  for (let i = 0; i < 3; i++) await mats.nth(i).click();
  await expect(page.locator('.tray .count')).toHaveText(/Selected: 3 items/);
  await expect(page.locator('.tray .toast')).toHaveText('Saved');

  // A change made just before the page is reloaded is kept: what is waiting is sent as the page goes.
  // It can reach the server just after the reloaded page has asked; then a second reload shows it.
  await mats.nth(2).click();
  await page.reload();
  const count = page.locator('.tray .count');
  await expect(count).toHaveText(/Selected: [23] items/);
  if ((await count.textContent())?.includes('3')) await page.reload();
  await expect(count).toHaveText(/Selected: 2 items/);
  await page.getByRole('button', { name: 'Grade 4' }).click();
  await mats.nth(2).click();
  await expect(page.locator('.tray .count')).toHaveText(/Selected: 3 items/);
  await expect(page.locator('.tray .toast')).toHaveText('Saved');

  // Persistence: reload and a brand-new browser session see the same selection.
  await page.reload();
  await expect(page.locator('.tray .count')).toHaveText(/Selected: 3 items/);
  await page.getByRole('button', { name: 'View list' }).click();
  await expect(page.locator('.panel pre')).toContainText('Primary 4 / الصف الرابع الابتدائي');
});

test('owner invites an editor, changes the role to viewer, and the viewer becomes read-only', async ({ page, browser }) => {
  await login(page, ownerEmail);
  await page.goto(`/org/${orgAId}/members`);
  const editorEmail = `editor.${uid()}@e2e.test`;
  await page.getByLabel('Email').fill(editorEmail);
  await page.getByLabel('Role').selectOption('editor');
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByText(`Invitation sent to ${editorEmail}`)).toBeVisible();

  const editorCtx = await browser.newContext();
  const editor = await openPage(editorCtx);
  await editor.goto(`/invite?token=${token(await latestEmailText(editorEmail, 'invitation'))}`);
  await expect(editor.getByText('invited you to Nile Learning as Editor')).toBeVisible();
  await editor.getByLabel('Your name').fill('E2E Editor');
  await editor.getByLabel('Password').fill(PASSWORD);
  await editor.getByRole('button', { name: 'Create account and join' }).click();
  await expect(editor.locator('.picker h1')).toBeVisible();
  await editor.locator('.mat').nth(10).click();
  await expect(editor.locator('.tray .count')).toHaveText(/Selected: 4 items/);
  await expect(editor.locator('.tray .toast')).toHaveText('Saved');

  // Owner assigns the viewer role.
  await page.reload();
  await page.getByLabel('Role for E2E Editor').selectOption('viewer');
  await expect(page.getByText('Role updated')).toBeVisible();

  await editor.reload();
  await expect(editor.getByText('Read-only: viewers cannot change selections.').first()).toBeVisible();
  await expect(editor.locator('.mat').first()).toHaveAttribute('aria-disabled', 'true');
  // aria-disabled buttons are still clickable by users; the click explains why nothing changes.
  await editor.locator('.mat').first().click({ force: true });
  await expect(editor.locator('#toasts')).toContainText('Read-only: viewers cannot change selections.');
  await expect(editor.locator('.tray .count')).toHaveText(/Selected: 4 items/);
  await editorCtx.close();
});

test('another organization cannot reach the first organization’s data', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await openPage(ctx);
  const email = `other.${uid()}@e2e.test`;
  await registerAndVerify(page, email, 'Rival Academy');
  await login(page, email);
  await expect(page.locator('.picker h1')).toBeVisible();
  await page.goto(`/org/${orgAId}`);
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  const api = await page.request.get(`/api/orgs/${orgAId}/scopes`);
  expect(api.status()).toBe(404);
  await ctx.close();
});

test('owner subscribes, upgrades with proration, schedules a downgrade and cancels', async ({ page }) => {
  await login(page, ownerEmail);
  await page.goto(`/org/${orgAId}/billing`);
  const plan = (name: string) => page.locator('.plan', { has: page.getByRole('heading', { name }) });

  // During the trial, the trialled plan is current and can still be subscribed to.
  await expect(plan('Professional')).toContainText('Current plan');
  await expect(plan('Professional').getByRole('button', { name: 'Subscribe' })).toBeVisible();
  await plan('Starter').getByRole('button', { name: 'Subscribe' }).click();
  await payInSandbox(page);
  await expect(page.locator('.card').first()).toContainText('Starter');
  await expect(page.getByText(/Renews on/)).toBeVisible();

  await plan('Professional').getByRole('button', { name: 'Upgrade now' }).click();
  await payInSandbox(page);
  await expect(page.locator('.plan.current')).toContainText('Professional');
  await expect(page.locator('table.data')).toContainText('upgrade (prorated)');

  await plan('Starter').getByRole('button', { name: 'Switch at renewal' }).click();
  await expect(page.getByText(/Switching to Starter on/)).toBeVisible();

  await page.getByRole('button', { name: 'Cancel subscription' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel subscription' }).click();
  await expect(page.getByText(/Canceled — access continues until/)).toBeVisible();
  await page.getByRole('button', { name: 'Keep my subscription' }).click();
  await expect(page.getByText(/Renews on/)).toBeVisible();
});

test('plan limits are enforced in the UI (second organization starts on Free)', async ({ page }) => {
  await login(page, ownerEmail);
  await page.goto('/account?new-org=1');
  await page.locator('#new-org').getByLabel('Organization name').fill('Side Project');
  await page.getByRole('button', { name: 'Create organization' }).click();
  await expect(page.getByRole('heading', { name: 'Create your first content scope' })).toBeVisible();
  await expect(page.getByText('Professional trial.')).toHaveCount(0);
  await createScope(page, 'Only scope');
  await expect(page.locator('.scopebar select')).toBeVisible();
  await page.getByRole('button', { name: 'New scope' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Name').fill('Second scope');
  await dlg.getByRole('button', { name: 'Create' }).click();
  await expect(dlg.getByText(/Free plan allows 1 content scope/)).toBeVisible();
  await expect(dlg.getByRole('link', { name: 'See plans' })).toBeVisible();
});

test('service recovers after a server crash: sessions and saved selections survive a restart', async ({ page }) => {
  await login(page, ownerEmail);
  await page.goto(`/org/${orgAId}`);
  await expect(page.locator('.tray .count')).toHaveText(/Selected: 4 items/);
  await stopServer();
  const down = await page.request.get('/healthz').catch(() => null);
  expect(down).toBeNull();
  await startServer();
  await page.reload();
  await expect(page.locator('.tray .count')).toHaveText(/Selected: 4 items/);
  await page.locator('.mat').nth(20).click();
  await expect(page.locator('.tray .toast')).toHaveText('Saved');
});

test('platform admin signs in with two-factor authentication, sends a test alert, tests the AI provider, turns AI on for a school, and suspends then restores it', async ({ page, browser }) => {
  await signInAsPlatformAdmin(page);
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Platform overview' })).toBeVisible();
  // No alert channel is configured in the E2E environment, and the test alert says so.
  await expect(page.getByRole('heading', { name: 'Alerts' })).toBeVisible();
  await expect(page.getByText(/No alert channel is configured/)).toBeVisible();
  await page.getByRole('button', { name: 'Send test alert' }).click();
  await expect(page.getByText('Test alert: email not configured, webhook not configured')).toBeVisible();
  // AI assistance: the E2E server's provider is the local simulator (tests/e2e/server.ts).
  await expect(page.getByRole('heading', { name: 'AI assistance' })).toBeVisible();
  await expect(page.getByText('Provider: Google Gemini · model gemini-2.5-pro')).toBeVisible();
  await expect(page.getByText(/No school has an AI allowance yet/)).toBeVisible();
  await page.getByRole('button', { name: 'Test the connection' }).click();
  await expect(page.getByText(/^The AI provider answered: gemini-2\.5-pro, \d+ ms$/)).toBeVisible();
  await page.goto(`/admin/orgs/${orgAId}`);
  await expect(page.getByRole('heading', { name: 'Nile Learning' })).toBeVisible();
  await page.getByLabel('AI requests per month (override)').fill('100');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  await page.goto('/admin');
  await expect(page.getByRole('region', { name: /^Schools with AI assistance/ }).getByRole('row', { name: /Nile Learning/ })).toContainText('0 / 100');
  await page.goto(`/admin/orgs/${orgAId}`);
  await expect(page.getByText('No active grant. Customer business data is not accessible.')).toBeVisible();
  await page.getByRole('button', { name: 'Suspend organization' }).click();
  await page.getByRole('dialog').getByLabel(/Reason/).fill('E2E suspension check');
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('button', { name: 'Restore organization' })).toBeVisible();

  const ownerCtx = await browser.newContext();
  const owner = await openPage(ownerCtx);
  await login(owner, ownerEmail);
  await owner.goto(`/org/${orgAId}`);
  await expect(owner.getByRole('heading', { name: 'Organization suspended' })).toBeVisible();

  await page.getByRole('button', { name: 'Restore organization' }).click();
  await expect(page.getByRole('button', { name: 'Suspend organization' })).toBeVisible();
  await owner.reload();
  await expect(owner.locator('.picker h1')).toBeVisible();
  // The school sees its AI allowance on the billing page.
  await owner.goto(`/org/${orgAId}/billing`);
  await expect(owner.getByRole('meter', { name: 'AI requests this month' })).toHaveAttribute('aria-valuetext', '0 / 100');
  await ownerCtx.close();
});

test('platform admin verifies a subject against a decree; customers see the mark and its source', async ({ page, browser }) => {
  await signInAsPlatformAdmin(page);
  await page.goto('/admin/catalog');
  await page.getByRole('link', { name: /^2026\/2027/ }).first().click();
  await expect(page.getByText('Verified: 0/231 subjects')).toBeVisible();
  await page.locator('summary', { hasText: /^Primary 1 —/ }).click();
  await page.getByRole('button', { name: 'Verification…' }).first().click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Status').selectOption('verified');
  await dlg.getByLabel(/^Source checked/).fill('Ministerial Decree 123/2026');
  await dlg.getByLabel('Source link (optional)').fill('https://moe.gov.eg/decrees/123');
  await dlg.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/^Verified: 1\/231 subjects/)).toBeVisible();
  await expect(page.locator('.verif.ok summary').first()).toHaveText('Verified');

  const ownerCtx = await browser.newContext();
  const owner = await openPage(ownerCtx);
  await login(owner, ownerEmail);
  await owner.goto(`/org/${orgAId}`);
  await expect(owner.locator('.vcoverage')).toContainText('1 of 231 subjects verified');
  const badge = owner.locator('.verif.ok').first();
  await badge.locator('summary').click();
  // The subject and its materials were marked together, so one line covers them all.
  await expect(badge.locator('li')).toHaveCount(1);
  await expect(badge.locator('li')).toContainText(/Subject and all \d+ materials: checked/);
  await expect(badge.getByRole('link', { name: 'Ministerial Decree 123/2026' })).toHaveAttribute('href', 'https://moe.gov.eg/decrees/123');
  await expect(owner.locator('.mat .mv.ok').first()).toBeVisible();
  await ownerCtx.close();
});

test('Arabic interface switches to right-to-left and the picker fits a phone screen', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await openPage(ctx);
  await login(page, ownerEmail);
  await page.goto(`/org/${orgAId}`);
  await expect(page.locator('.picker h1')).toBeVisible();
  // Measured with the fonts in place, however far the page's own loading has got.
  const overflow = await page.evaluate(async () => { await document.fonts.ready; return document.documentElement.scrollWidth - window.innerWidth; });
  expect(overflow).toBeLessThanOrEqual(1);
  await page.locator('.topbar').getByRole('button', { name: 'العربية', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('link', { name: 'دليل المناهج' })).toBeVisible();
  await expect(page.locator('.verif.ok summary').first()).toHaveText('تم التحقق');
  const overflowAr = await page.evaluate(async () => { await document.fonts.ready; return document.documentElement.scrollWidth - window.innerWidth; });
  expect(overflowAr).toBeLessThanOrEqual(1);
  await page.locator('.topbar').getByRole('button', { name: 'English', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await ctx.close();
});

test('a newer catalogue is published and the owner carries a scope forward after reviewing what changed', async ({ page, browser }) => {
  // The platform admin prepares 2027/2028 from the admin UI; one book in the owner's scope is dropped from the new year.
  await signInAsPlatformAdmin(page);
  await page.goto('/admin/catalog');
  await page.getByLabel('Academic year').fill('2027/2028');
  await page.getByLabel('Label').fill('Egypt K-12 curriculum — academic year 2027/2028');
  await page.getByRole('button', { name: 'Create draft' }).click();
  await page.waitForURL(/\/admin\/catalog\/[0-9a-f-]{36}$/);
  const nextId = /catalog\/([0-9a-f-]{36})/.exec(page.url())![1]!;
  const items = await ownerQuery(
    `SELECT i.material_id, m.title FROM scope_items i JOIN scopes s ON s.id = i.scope_id JOIN catalog_materials m ON m.id = i.material_id
     WHERE s.org_id = $1 AND s.name = 'Grade 4 pilot' ORDER BY m.title`,
    [orgAId],
  );
  const dropped = items[0] as { material_id: string; title: string };
  await ownerQuery(
    `DELETE FROM catalog_materials nm USING catalog_subjects ns, catalog_materials om, catalog_subjects os
     WHERE om.id = $2 AND os.id = om.subject_id AND ns.version_id = $1 AND nm.subject_id = ns.id AND nm.title = om.title
       AND ns.grade = os.grade AND ns.track = os.track AND ns.block = os.block AND ns.code = os.code`,
    [nextId, dropped.material_id],
  );
  await page.goto('/admin/catalog');
  await page.getByRole('button', { name: 'Publish' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('button', { name: 'Publish' })).toHaveCount(0);

  const ownerCtx = await browser.newContext();
  const owner = await openPage(ownerCtx);
  await login(owner, ownerEmail);
  await owner.goto(`/org/${orgAId}`);
  await expect(owner.locator('.carry-banner')).toContainText('A newer catalogue (2027/2028) has been published.');
  // Publishing also notified the owner; the notification opens the review page.
  await owner.getByRole('button', { name: 'Notifications' }).click();
  // One notification per organization the owner runs; this one is for "Nile Learning".
  const note = owner.getByRole('dialog').locator('li', { hasText: '“Grade 4 pilot” still uses an older catalogue.' });
  await expect(note).toContainText('The 2027/2028 catalogue is published');
  await note.getByRole('link', { name: 'Open' }).click();
  await expect(owner.getByRole('dialog')).toHaveCount(0);
  await expect(owner.getByRole('heading', { name: 'Carry “Grade 4 pilot” forward' })).toBeVisible();
  await expect(owner.getByText(`${items.length - 1} of ${items.length} selected items carry over as they are. 1 need your decision.`)).toBeVisible();
  await expect(owner.getByRole('heading', { name: 'Not in the 2027/2028 catalogue' })).toBeVisible();
  await expect(owner.locator('.carry-subj li', { hasText: dropped.title })).toBeVisible();
  await owner.getByRole('button', { name: 'Carry forward' }).click();

  await owner.waitForURL(/\/org\/[0-9a-f-]{36}\?scope=/);
  await expect(owner.locator('.eyebrow')).toContainText('Academic year 2027/2028');
  await expect(owner.locator('.scopebar select option:checked')).toHaveText('Grade 4 pilot (2027/2028)');
  await expect(owner.locator('.tray .count')).toHaveText(`Selected: ${items.length - 1} items`);
  await expect(owner.locator('.carry-banner')).toHaveCount(0);
  await ownerCtx.close();
});

test('platform admin records verification marks in bulk from an edited spreadsheet', async ({ page }) => {
  await signInAsPlatformAdmin(page);
  await page.goto('/admin/catalog');
  await page.getByRole('link', { name: /^2027\/2028/ }).first().click();
  await page.waitForURL(/\/admin\/catalog\/[0-9a-f-]{36}$/);
  const versionId = /catalog\/([0-9a-f-]{36})/.exec(page.url())![1]!;
  await expect(page.getByText(/^Verified: 0\/231 subjects, 0\/\d+ materials/)).toBeVisible();

  // What the curriculum specialist does in Excel: mark three Primary 1 books as verified.
  const res = await page.request.get(`/api/admin/catalog/versions/${versionId}/sheet`);
  expect(res.ok()).toBe(true);
  const records = parseCsv(await res.text()).map((r) => r.map(unguardCell));
  const col = (c: string) => records[0]!.indexOf(c);
  for (const r of records.filter((x) => x[col('row_type')] === 'material' && x[col('grade')] === '1').slice(0, 3)) {
    r[col('verification_status')] = 'verified';
    r[col('verification_source')] = 'Publisher catalogue 2027';
  }
  await page.locator('input[type="file"]').setInputFiles({ name: 'catalogue.csv', mimeType: 'text/csv', buffer: Buffer.from(toCsv(records)) });

  const dlg = page.getByRole('dialog', { name: 'Spreadsheet preview' });
  await expect(dlg).toContainText('rows read: 3 with changes');
  await expect(dlg).toContainText('Mark: Not verified → Verified (Publisher catalogue 2027)');
  await dlg.getByRole('button', { name: 'Apply 3 changes' }).click();
  await expect(page.getByText(/^Verified: 0\/231 subjects, 3\/\d+ materials/)).toBeVisible();

  // In Arabic the preview names subjects in Arabic and says each problem in Arabic.
  await page.locator('.topbar').getByRole('button', { name: 'العربية', exact: true }).click();
  const again = parseCsv(await (await page.request.get(`/api/admin/catalog/versions/${versionId}/sheet`)).text()).map((r) => r.map(unguardCell));
  const subjectAt = again.findIndex((x) => x[col('row_type')] === 'subject' && x[col('grade')] === '1');
  const materialAt = again.findIndex((x, i) => i > subjectAt && x[col('row_type')] === 'material');
  const nameAr = again[subjectAt]![col('name_ar')]!;
  again[subjectAt]![col('name_en')] += ' (edited)';
  again[materialAt]![col('verification_status')] = 'needs_review';
  await page.locator('input[type="file"]').setInputFiles({ name: 'catalogue.csv', mimeType: 'text/csv', buffer: Buffer.from(toCsv(again)) });
  const ar = page.getByRole('dialog', { name: 'معاينة جدول البيانات' });
  await expect(ar.locator('.alert.error li')).toHaveText([
    `السطر ${subjectAt + 1}: الإصدارات المنشورة للقراءة فقط: لا يتغير فيها إلا أعمدة التحقق (تغيّر: \u2068name_en\u2069)`,
    `السطر ${materialAt + 1}: العنصر الذي يحتاج إلى مراجعة يحتاج إلى قيمة في verification_note`,
  ]);
  await expect(ar).toContainText(`السطر ${subjectAt + 1} الصف الأول الابتدائي · ${nameAr}`);
  await ar.getByRole('button', { name: 'إلغاء' }).click();
  await page.locator('.topbar').getByRole('button', { name: 'English', exact: true }).click();
  await expect(page.getByText(/^Verified: 0\/231 subjects, 3\/\d+ materials/)).toBeVisible();
});

test('owner compares two scopes side by side and downloads the comparison', async ({ page }) => {
  const email = `compare.${uid()}@e2e.test`;
  await registerAndVerify(page, email, 'Twin Campus School');
  await login(page, email);
  const orgId = orgIdFromUrl(page);
  const mats = page.locator('.mat');
  // The title is the button's first text node (a verification badge may follow).
  const titles: string[] = [];
  for (let i = 0; i < 3; i++) titles.push(await mats.nth(i).evaluate((el) => (el.firstChild?.textContent ?? '').trim()));

  await createScope(page, 'Campus North');
  await expect(page.locator('.scopebar select option:checked')).toHaveText(/Campus North/);
  for (const i of [0, 1]) await mats.nth(i).click();
  await expect(page.locator('.tray .toast')).toHaveText('Saved');
  await createScope(page, 'Campus South');
  await expect(page.locator('.scopebar select option:checked')).toHaveText(/Campus South/);
  for (const i of [1, 2]) await mats.nth(i).click();
  await expect(page.locator('.tray .toast')).toHaveText('Saved');

  await page.goto(`/org/${orgId}/scopes`);
  await page.getByRole('link', { name: 'Compare scopes' }).click();
  await expect(page.getByRole('heading', { name: 'Compare scopes', level: 1 })).toBeVisible();
  await expect(page.locator('.stat', { hasText: 'Only in Campus North' }).locator('.v')).toHaveText('1');
  await expect(page.locator('.stat', { hasText: 'Only in Campus South' }).locator('.v')).toHaveText('1');
  await expect(page.locator('.stat', { hasText: 'In both' }).locator('.v')).toHaveText('1');
  // Differences only by default: the shared book is hidden until the filter is cleared.
  const rows = page.locator('table.compare tbody tr:not(.group)');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText(titles[0]!);
  await expect(rows.first().locator('td').first()).toHaveText('✓Included');
  await expect(rows.first().locator('td').last()).toHaveText('—Not included');
  await page.getByLabel('Show only differences').uncheck();
  await expect(rows).toHaveCount(3);

  // Swapping puts Campus South first.
  await page.getByRole('button', { name: 'Swap' }).click();
  await expect(page.getByLabel('First scope')).toHaveValue(/.+/);
  await expect(page.locator('.stat').first()).toContainText('Only in Campus South');

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download comparison (CSV)' }).click()]);
  expect(download.suggestedFilename()).toBe('compare-Campus-South-Campus-North.csv');
  const csv = parseCsv(await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c).toString('utf8')));
  expect(csv[0]![7]).toMatch(/^Campus South \(\d{4}\/\d{4}\)$/);
  expect(csv[0]![8]).toMatch(/^Campus North \(\d{4}\/\d{4}\)$/);
  expect(csv.slice(1).map((r) => [r[5], r[7], r[8]])).toEqual([[titles[0], 'no', 'yes'], [titles[1], 'yes', 'yes'], [titles[2], 'yes', 'no']]);
});

test('a platform admin turns on student accounts; the school adds students; a student signs in and sees their books', async ({ page, browser }) => {
  const email = `students.${uid()}@e2e.test`;
  await registerAndVerify(page, email, 'Delta Prep School');
  await login(page, email);
  const orgId = orgIdFromUrl(page);
  await createScope(page, 'Prep 1 books');
  await expect(page.locator('.scopebar select option:checked')).toHaveText(/Prep 1 books/);
  await page.getByRole('button', { name: 'Grade 7' }).click();
  const titles: string[] = [];
  for (let i = 0; i < 3; i++) {
    titles.push(await page.locator('.mat').nth(i).evaluate((el) => (el.firstChild?.textContent ?? '').trim()));
    await page.locator('.mat').nth(i).click();
  }
  Object.assign(delta, { ownerEmail: email, orgId, subject: (await page.locator('.subj').first().locator('.sname b').textContent())!.trim(), firstBook: titles[0] });
  await expect(page.locator('.tray .toast')).toHaveText('Saved');

  // Off until the platform turns it on for this school.
  await expect(page.locator('.topbar').getByRole('link', { name: 'Students' })).toHaveCount(0);
  await page.goto(`/org/${orgId}/students`);
  await expect(page.getByRole('heading', { name: 'Student accounts are not turned on' })).toBeVisible();

  const adminCtx = await browser.newContext();
  const admin = await openPage(adminCtx);
  await signInAsPlatformAdmin(admin);
  await admin.goto(`/admin/orgs/${orgId}`);
  await admin.getByLabel('Student accounts (override)').fill('30');
  await admin.getByRole('button', { name: 'Apply' }).click();
  await expect(admin.getByText('Saved')).toBeVisible();
  await expect(admin.getByText('Student accounts: 0')).toBeVisible();

  // The school adds one student by hand and one from a roster file.
  await page.goto(`/org/${orgId}`);
  await page.locator('.topbar').getByRole('link', { name: 'Students' }).click();
  await expect(page.getByRole('heading', { name: 'Students', level: 1 })).toBeVisible();
  const schoolCode = (await page.locator('.code-big').textContent())!.trim();
  await page.getByRole('button', { name: 'Add student' }).click();
  let dlg = page.getByRole('dialog');
  await dlg.getByLabel('Username').fill('laila.e2e');
  await dlg.getByLabel('Student’s name').fill('Laila Hassan');
  await dlg.getByLabel('Grade', { exact: true }).selectOption('7');
  const scopeOption = await dlg.getByLabel('Curriculum').locator('option', { hasText: 'Prep 1 books' }).getAttribute('value');
  await dlg.getByLabel('Curriculum').selectOption(scopeOption!);
  await dlg.getByRole('button', { name: 'Add student' }).click();
  dlg = page.getByRole('dialog', { name: 'Student passwords' });
  const password = (await dlg.locator('.cred').textContent())!.trim();
  expect(password).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
  await dlg.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('button', { name: 'Import CSV…' }).click();
  dlg = page.getByRole('dialog', { name: 'Import students' });
  await dlg.getByLabel('Roster file (CSV)').setInputFiles({ name: 'roster.csv', mimeType: 'text/csv', buffer: Buffer.from('username,name,grade,scope\nomar.e2e,Omar Adel,7,Prep 1 books\nbad name,X,7,\n') });
  await expect(dlg.getByText('Problems to fix first: 1.')).toBeVisible();
  await dlg.getByLabel('Roster file (CSV)').setInputFiles({ name: 'roster.csv', mimeType: 'text/csv', buffer: Buffer.from('username,name,grade,scope\nomar.e2e,Omar Adel,7,Prep 1 books\n') });
  await expect(dlg.getByText('Students ready to import: 1')).toBeVisible();
  await dlg.getByRole('button', { name: 'Import' }).click();
  dlg = page.getByRole('dialog', { name: 'Student passwords' });
  const [download] = await Promise.all([page.waitForEvent('download'), dlg.getByRole('button', { name: 'Download passwords (CSV)' }).click()]);
  const sheet = parseCsv(await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c).toString('utf8')));
  expect(sheet[0]).toEqual(['school_code', 'username', 'name', 'password', 'sign_in_link']);
  expect(sheet[1]!.slice(0, 3)).toEqual([schoolCode, 'omar.e2e', 'Omar Adel']);
  await dlg.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('table.data tbody tr')).toHaveCount(2);

  // The student signs in from the staff sign-in page's link and sees only their grade's books.
  const studentCtx = await browser.newContext();
  const student = await openPage(studentCtx);
  await student.goto('/login');
  await student.getByRole('link', { name: 'Student? Sign in with your school account' }).click();
  await student.getByLabel('School code').fill(schoolCode);
  await student.getByLabel('Username').fill('laila.e2e');
  await student.getByLabel('Password').fill('wrong-password');
  await student.getByRole('button', { name: 'Sign in' }).click();
  await expect(student.getByText('Incorrect school code, username or password')).toBeVisible();
  await student.getByLabel('Password').fill(password);
  await student.getByRole('button', { name: 'Sign in' }).click();
  await student.waitForURL(/\/student$/);
  await expect(student.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
  await expect(student.getByText('You are not in a class yet.')).toBeVisible();
  await student.locator('.topbar').getByRole('link', { name: 'My books' }).click();
  await expect(student.getByRole('heading', { name: 'My curriculum', level: 1 })).toBeVisible();
  await expect(student.getByText('Hello Laila Hassan.')).toBeVisible();
  const books = student.locator('.subj .mat.book');
  await expect(books).toHaveCount(3);
  for (const title of titles) await expect(books.filter({ hasText: title })).toHaveCount(1);
  // Staff pages are not reachable: the app sends the student back to the portal.
  await student.goto(`/org/${orgId}/members`);
  await student.waitForURL(/\/student$/);
  await student.locator('.topbar').getByRole('button', { name: 'العربية', exact: true }).click();
  await expect(student.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(student.getByRole('heading', { name: 'اليوم', level: 1 })).toBeVisible();
  await student.locator('.topbar').getByRole('link', { name: 'كتبي' }).click();
  await expect(student.getByRole('heading', { name: 'منهجي', level: 1 })).toBeVisible();
  await student.locator('.topbar').getByRole('button', { name: 'English', exact: true }).click();

  // A staff password reset signs the student out.
  await page.getByRole('button', { name: 'New password for Laila Hassan' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'New password' }).click();
  await expect(page.getByRole('dialog', { name: 'Student passwords' }).locator('.cred')).not.toHaveText(password);
  Object.assign(delta, { schoolCode, lailaPassword: (await page.getByRole('dialog', { name: 'Student passwords' }).locator('.cred').textContent())!.trim() });
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
  await student.reload();
  await student.waitForURL(/\/student-login$/);
  await studentCtx.close();
  await adminCtx.close();
});

test('the team notes and assigns selected books; the assignee is notified and finds them; deselecting asks first', async ({ page, browser }) => {
  const email = `notes.${uid()}@e2e.test`;
  await registerAndVerify(page, email, 'Notes Academy');
  await login(page, email);
  const orgId = orgIdFromUrl(page);
  Object.assign(notesTeam, { ownerEmail: email, orgId });
  await createScope(page, 'Grade 5 books');
  await expect(page.locator('.scopebar select option:checked')).toHaveText(/Grade 5 books/);
  await page.getByRole('button', { name: 'Grade 5' }).click();
  const titles: string[] = [];
  for (let i = 0; i < 3; i++) {
    titles.push(await page.locator('.mat').nth(i).evaluate((el) => (el.firstChild?.textContent ?? '').trim()));
    await page.locator('.mat').nth(i).click();
  }
  await expect(page.locator('.tray .toast')).toHaveText('Saved');

  // An editor joins.
  await page.goto(`/org/${orgId}/members`);
  const editorEmail = `notes.editor.${uid()}@e2e.test`;
  notesTeam.editorEmail = editorEmail;
  await page.getByLabel('Email').fill(editorEmail);
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByText(`Invitation sent to ${editorEmail}`)).toBeVisible();
  const editorCtx = await browser.newContext();
  const editor = await openPage(editorCtx);
  await editor.goto(`/invite?token=${token(await latestEmailText(editorEmail, 'invitation'))}`);
  await editor.getByLabel('Your name').fill('Hana Editor');
  await editor.getByLabel('Password').fill(PASSWORD);
  await editor.getByRole('button', { name: 'Create account and join' }).click();
  await expect(editor.locator('.picker h1')).toBeVisible();

  // The owner writes a note on one book and assigns two books to the editor at once.
  await page.goto(`/org/${orgId}`);
  await page.locator('.scopebar').getByRole('link', { name: 'Notes and assignees' }).click();
  await expect(page.getByRole('heading', { name: 'Notes and assignees', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: `Edit the note on ${titles[0]}` }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Note').fill('Waiting for the 2027 edition');
  await dlg.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: `Edit the note on ${titles[0]}` })).toBeFocused();
  await page.getByLabel(`Choose ${titles[0]}`).check();
  await page.getByLabel(`Choose ${titles[1]}`).check();
  await expect(page.getByText('2 chosen')).toBeVisible();
  await page.getByLabel('Assigned to', { exact: true }).selectOption({ label: 'Hana Editor' });
  await page.getByRole('button', { name: 'Apply to the chosen books' }).click();
  await expect(page.getByText('Saved for 2 books')).toBeVisible();
  await expect(page.locator('.stat', { hasText: 'Assigned' }).first().locator('.v')).toHaveText('2');

  // The editor is notified, follows the link and sees only their books.
  await editor.reload();
  await editor.getByRole('button', { name: 'Notifications' }).click();
  await expect(editor.getByText('E2E Owner assigned you 2 books')).toBeVisible();
  await editor.getByRole('dialog').getByRole('link', { name: 'Open' }).click();
  await expect(editor.getByRole('heading', { name: 'Notes and assignees', level: 1 })).toBeVisible();
  await expect(editor.getByLabel('Show', { exact: true })).toHaveValue('mine');
  const rows = editor.locator('table.items tbody tr:not(.group)');
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: titles[0] })).toContainText('Waiting for the 2027 edition');
  await expect(rows.filter({ hasText: titles[2] })).toHaveCount(0);

  // The scopes list counts them, and the picker marks annotated books and asks before dropping one.
  await page.goto(`/org/${orgId}/scopes`);
  await expect(page.getByRole('link', { name: '1 with notes · 2 assigned' })).toBeVisible();
  await page.goto(`/org/${orgId}`);
  await page.getByRole('button', { name: 'Grade 5' }).click();
  // The first book carries the note (several books share a title, so go by position).
  const annotated = page.locator('.mat').nth(0);
  await expect(annotated.locator('.note-mark')).toBeVisible();
  await annotated.click();
  await expect(page.getByRole('dialog', { name: 'Remove this book?' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(annotated).toHaveAttribute('aria-pressed', 'true');
  await annotated.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
  await expect(annotated).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.tray .toast')).toHaveText('Saved');
  await page.goto(`/org/${orgId}/scopes`);
  await expect(page.getByRole('link', { name: '0 with notes · 1 assigned' })).toBeVisible();
  await editorCtx.close();
});

test('status and due dates: the owner plans the work, the assignee gets an email and closes a book from My assignments', async ({ page, browser }) => {
  // Journey 14's school: Hana becomes a viewer, and viewers can still update the status of books assigned to them.
  await login(page, notesTeam.ownerEmail);
  const orgId = notesTeam.orgId;
  await page.goto(`/org/${orgId}/members`);
  await page.getByLabel('Role for Hana Editor').selectOption('viewer');
  await expect(page.getByText('Role updated')).toBeVisible();
  await page.goto(`/org/${orgId}`);
  await createScope(page, 'Grade 6 books');
  await expect(page.locator('.scopebar select option:checked')).toHaveText(/Grade 6 books/);
  await page.getByRole('button', { name: 'Grade 6' }).click();
  for (let i = 0; i < 3; i++) await page.locator('.mat').nth(i).click();
  await expect(page.locator('.tray .toast')).toHaveText('Saved');
  const viewerCtx = await browser.newContext();
  const viewer = await openPage(viewerCtx);
  await login(viewer, notesTeam.editorEmail);

  // The owner assigns two books with a status and a due date in one go, then moves one date later.
  await page.goto(`/org/${orgId}`);
  await page.locator('.scopebar').getByRole('link', { name: 'Notes and assignees' }).click();
  const boxes = page.locator('table.items tbody tr:not(.group) input[type="checkbox"]');
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await page.getByLabel('Assigned to', { exact: true }).selectOption({ label: 'Hana Editor' });
  await page.getByLabel('Status', { exact: true }).selectOption({ label: 'To do' });
  await page.getByLabel('Due date', { exact: true }).fill('2020-01-05');
  await page.getByRole('button', { name: 'Apply to the chosen books' }).click();
  await expect(page.getByText('Saved for 2 books')).toBeVisible();
  await expect(page.locator('.stat', { hasText: 'Overdue' }).locator('.v')).toHaveText('2');
  await page.getByRole('button', { name: /^Edit the note on / }).nth(1).click();
  await page.getByRole('dialog').getByLabel('Due date').fill('2099-06-30');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.stat', { hasText: 'Overdue' }).locator('.v')).toHaveText('1');
  await page.getByLabel('Show', { exact: true }).selectOption({ label: 'Overdue' });
  await expect(page.locator('table.items tbody tr:not(.group)')).toHaveCount(1);
  await expect(page.locator('table.items tbody tr:not(.group)').first()).toContainText('overdue');

  // The viewer got an email listing the books, and finds them under My assignments, overdue first.
  expect(await latestEmailText(notesTeam.editorEmail, 'items_assigned')).toContain('E2E Owner assigned you 2 books to follow up in the scope “Grade 6 books” (Notes Academy)');
  await viewer.goto(`/org/${orgId}`);
  // Two new books plus the one still assigned to Hana from journey 14.
  await viewer.locator('.topbar').getByRole('link', { name: 'My assignments (3)' }).click();
  await expect(viewer.getByRole('heading', { name: 'My assignments', level: 1 })).toBeVisible();
  const rows = viewer.locator('table.items tbody tr');
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText('overdue');
  await rows.first().getByRole('combobox').selectOption({ label: 'Done' });
  await expect(viewer.locator('#toasts').getByText('Saved', { exact: true }).first()).toBeVisible();
  await expect(rows.first()).not.toContainText('overdue');
  await expect(rows.first().locator('td.prog')).toContainText('Done');
  await viewer.getByLabel('Show', { exact: true }).selectOption({ label: 'Done' });
  await expect(viewer.locator('table.items tbody tr')).toHaveCount(1);
  await viewer.reload();
  await expect(viewer.locator('.topbar').getByRole('link', { name: 'My assignments (2)' })).toBeVisible();

  // The viewer turns assignment emails off in their account.
  await viewer.goto('/account');
  await viewer.getByLabel('Emails when books are assigned to me').selectOption({ label: 'None (notifications in the app only)' });
  await viewer.getByRole('button', { name: 'Save' }).first().click();
  await expect(viewer.locator('#toasts').getByText('Saved', { exact: true }).first()).toBeVisible();
  await viewer.reload();
  await expect(viewer.getByLabel('Emails when books are assigned to me')).toHaveValue('off');
  await viewerCtx.close();
});

test('due-date reminders: a book due tomorrow is marked due soon and its assignee gets one reminder', async ({ page, browser }) => {
  // Journey 15's school and scope. Hana turned assignment emails off there; reminders are a separate choice.
  const orgId = notesTeam.orgId;
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  await login(page, notesTeam.ownerEmail);
  await page.goto(`/org/${orgId}`);
  const option = page.locator('.scopebar select option', { hasText: 'Grade 6 books' });
  await page.locator('.scopebar select').selectOption((await option.getAttribute('value'))!);
  await page.locator('.scopebar').getByRole('link', { name: 'Notes and assignees' }).click();
  await page.getByRole('button', { name: /^Edit the note on / }).nth(2).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Assigned to').selectOption({ label: 'Hana Editor' });
  await dlg.getByLabel('Due date').fill(day(1));
  await dlg.getByRole('button', { name: 'Save' }).click();
  await expect(dlg).toHaveCount(0);
  const row = page.locator('table.items tbody tr:not(.group)').nth(2);
  await expect(row.locator('.pill')).toHaveText('due soon');

  // The worker's reminder pass at 10:30 Cairo time: one reminder, and none the second time.
  const morning = new Date();
  morning.setUTCHours(8, 30, 0, 0);
  expect(await runReminderPass(morning)).toMatchObject({ members: 1, reminded: 1, emails: 1 });
  expect(await runReminderPass(morning)).toMatchObject({ members: 0, reminded: 0 });
  const mail = await latestEmailText(notesTeam.editorEmail, 'items_due');
  expect(mail).toContain('These books assigned to you in Notes Academy need attention:');
  expect(mail).toMatch(/Due soon \(1\):\n• .+ — “Grade 6 books”, due tomorrow/);
  expect(mail).toContain(`/org/${orgId}/assignments`);

  // Hana sees the reminder, the book due soon on My assignments, and turns reminder emails off.
  const ctx = await browser.newContext();
  const hana = await openPage(ctx);
  await login(hana, notesTeam.editorEmail);
  await hana.goto(`/org/${orgId}/assignments`);
  await expect(hana.locator('.stat', { hasText: 'Due soon' }).locator('.v')).toHaveText('1');
  await expect(hana.locator('table.items tbody tr', { hasText: 'due soon' })).toHaveCount(1);
  await hana.getByRole('button', { name: 'Notifications' }).click();
  await expect(hana.getByRole('dialog').getByText('1 book is due soon')).toBeVisible();
  await hana.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await hana.goto('/account');
  await expect(hana.getByLabel('Emails when books are assigned to me')).toHaveValue('off');
  await hana.getByLabel('Email me a reminder when my books are due soon or overdue').uncheck();
  await hana.getByRole('button', { name: 'Save' }).first().click();
  await expect(hana.locator('#toasts').getByText('Saved', { exact: true }).first()).toBeVisible();
  await hana.reload();
  await expect(hana.getByLabel('Email me a reminder when my books are due soon or overdue')).not.toBeChecked();
  await ctx.close();
});

test('daily summary: the assignee chooses one email each morning; a new assignment waits for it', async ({ page, browser }) => {
  // Journey 15's school. Hana switches assignment emails from none to one summary each morning.
  const orgId = notesTeam.orgId;
  const ctx = await browser.newContext();
  const hana = await openPage(ctx);
  await login(hana, notesTeam.editorEmail);
  await hana.goto('/account');
  await hana.getByLabel('Emails when books are assigned to me').selectOption({ label: 'One summary each morning' });
  await hana.getByRole('button', { name: 'Save' }).first().click();
  await expect(hana.locator('#toasts').getByText('Saved', { exact: true }).first()).toBeVisible();
  await hana.reload();
  await expect(hana.getByLabel('Emails when books are assigned to me')).toHaveValue('daily');

  // The owner selects a fourth book and assigns it to Hana: she is notified in the app, and no email goes yet.
  const assignedEmails = async () =>
    Number((await ownerQuery(`SELECT count(*) AS n FROM email_outbox WHERE to_email = $1 AND template = 'items_assigned'`, [notesTeam.editorEmail]))[0].n);
  const before = await assignedEmails();
  await login(page, notesTeam.ownerEmail);
  await page.goto(`/org/${orgId}`);
  const option = page.locator('.scopebar select option', { hasText: 'Grade 6 books' });
  await page.locator('.scopebar select').selectOption((await option.getAttribute('value'))!);
  await page.getByRole('button', { name: 'Grade 6' }).click();
  await page.locator('.mat').nth(3).click();
  await expect(page.locator('.tray .toast')).toHaveText('Saved');
  await page.locator('.scopebar').getByRole('link', { name: 'Notes and assignees' }).click();
  // The three earlier books are Hana's; the new one is the only book not assigned.
  await page.getByLabel('Show', { exact: true }).selectOption({ label: 'Not assigned' });
  const row = page.locator('table.items tbody tr:not(.group)');
  await expect(row).toHaveCount(1);
  const title = (await row.locator('th[scope="row"] > span').first().innerText()).trim();
  await row.getByRole('button', { name: /^Edit the note on / }).click();
  await page.getByRole('dialog').getByLabel('Assigned to').selectOption({ label: 'Hana Editor' });
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await assignedEmails()).toBe(before);

  // The worker's summary pass the next morning (run directly: the E2E run starts no worker) sends one summary, once.
  const morning = new Date(Date.now() + 86_400_000);
  morning.setUTCHours(8, 30, 0, 0);
  expect(await runDigestPass(morning)).toMatchObject({ members: 1, emails: 1, books: 1 });
  expect(await runDigestPass(morning)).toMatchObject({ members: 0, emails: 0 });
  const mail = await latestEmailText(notesTeam.editorEmail, 'items_assigned_daily');
  expect(mail).toContain(`Books assigned to you since your last summary:\n\nNotes Academy (1 book):\n“Grade 6 books”, assigned by E2E Owner:\n• ${title}`);
  expect(mail).toContain(`/org/${orgId}/assignments`);
  await ctx.close();
});

test('all organizations: a member of two organizations sees and updates all their books on one page', async ({ page }) => {
  // Hana (journeys 14–17) creates her own organization next to Notes Academy and gives herself a book due tomorrow.
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  await login(page, notesTeam.editorEmail);
  await page.goto('/account?new-org=1');
  await page.getByLabel('Organization name').fill('Hana Study Group');
  await page.getByRole('button', { name: 'Create organization' }).click();
  await expect(page.getByRole('heading', { name: 'Create your first content scope' })).toBeVisible();
  const ownOrgId = orgIdFromUrl(page);
  await createScope(page, 'Reading list');
  await expect(page.locator('.scopebar select')).toHaveValue(/.+/);
  await page.getByRole('button', { name: 'Grade 6' }).click();
  await page.locator('.mat').nth(0).click();
  await expect(page.locator('.tray .toast')).toHaveText('Saved');
  await page.locator('.scopebar').getByRole('link', { name: 'Notes and assignees' }).click();
  await page.getByRole('button', { name: /^Edit the note on / }).first().click();
  await page.getByRole('dialog').getByLabel('Assigned to').selectOption({ label: 'Hana Editor' });
  await page.getByRole('dialog').getByLabel('Due date').fill(tomorrow);
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // From Notes Academy's My assignments, the link opens the page for both organizations.
  await page.goto(`/org/${notesTeam.orgId}/assignments`);
  await page.getByRole('link', { name: 'See your books in all your organizations (2)' }).click();
  await expect(page.getByRole('heading', { name: 'My assignments in all my organizations', level: 1 })).toBeVisible();
  const rows = page.locator('table.items tbody tr');
  // Notes Academy: four open books (journeys 14–17); Hana Study Group: one. The two due tomorrow come first.
  await expect(rows).toHaveCount(5);
  await expect(page.locator('.stat', { hasText: 'Not done yet' }).locator('.v')).toHaveText('5');
  await expect(page.locator('.stat', { hasText: 'Due soon' }).locator('.v')).toHaveText('2');
  await expect(rows.nth(0)).toContainText('Hana Study Group');
  await expect(rows.nth(1)).toContainText('Notes Academy');
  await expect(page.getByText('Not done yet, by organization:')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Hana Study Group' }).first()).toHaveAttribute('href', `/org/${ownOrgId}/assignments`);

  // She marks her own organization's book done here; it moves to Done.
  await rows.nth(0).getByRole('combobox').selectOption({ label: 'Done' });
  await expect(page.locator('#toasts').getByText('Saved', { exact: true }).first()).toBeVisible();
  await page.getByLabel('Show', { exact: true }).selectOption({ label: 'Done' });
  await expect(page.locator('table.items tbody tr', { hasText: 'Hana Study Group' })).toHaveCount(1);
  await page.getByLabel('Show', { exact: true }).selectOption({ label: 'Not done yet' });
  await expect(page.locator('table.items tbody tr')).toHaveCount(4);
});

test('webhooks: the owner adds an endpoint, sends a test, and a scope change reaches it signed', async ({ page }) => {
  // A local receiver standing in for the school's own system.
  const received: { headers: http.IncomingHttpHeaders; body: string }[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => { received.push({ headers: req.headers, body }); res.writeHead(200).end('ok'); });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/curriculum`;
  const signedBy = (secret: string, r: { headers: http.IncomingHttpHeaders; body: string }) => {
    const [, t, v1] = /^t=(\d+),v1=([0-9a-f]+)$/.exec(String(r.headers['x-midad-signature']))!;
    return v1 === createHmac('sha256', secret).update(`${t}.${r.body}`).digest('hex');
  };
  try {
    const orgId = notesTeam.orgId;
    await login(page, notesTeam.ownerEmail);
    await page.goto(`/org/${orgId}/settings`);
    await expect(page.getByRole('heading', { name: 'Webhooks' })).toBeVisible();
    await page.getByLabel('Endpoint URL').fill(url);
    await page.getByLabel('Description (optional)').fill('Content pipeline');
    await page.getByLabel('Scope deleted').uncheck();
    await page.getByRole('button', { name: 'Add endpoint' }).click();
    const secret = (await page.getByRole('dialog').locator('pre').innerText()).trim();
    expect(secret).toMatch(/^whsec_/);
    await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
    const row = page.locator('#webhooks tbody tr', { hasText: url });
    await expect(row).toContainText('Active');
    await expect(row).toContainText('Scope created, Scope renamed or described, Books added or removed, Notes, assignees, statuses or due dates changed');

    await page.getByRole('button', { name: `Send a test to ${url}` }).click();
    await expect(page.locator('#toasts').getByText('Test delivered (200)')).toBeVisible();
    expect(JSON.parse(received[0]!.body)).toMatchObject({ type: 'ping', organizationId: orgId });
    expect(signedBy(secret, received[0]!)).toBe(true);

    // Selecting one more book in Grade 6 books is sent by the worker as "books added or removed".
    await page.goto(`/org/${orgId}`);
    const option = page.locator('.scopebar select option', { hasText: 'Grade 6 books' });
    await page.locator('.scopebar select').selectOption((await option.getAttribute('value'))!);
    await page.getByRole('button', { name: 'Grade 6' }).click();
    await page.locator('.mat[aria-pressed="false"]').first().click();
    await expect(page.locator('.tray .toast')).toHaveText('Saved');
    expect(await runWebhookPass()).toMatchObject({ delivered: 1 });
    const change = JSON.parse(received[1]!.body);
    expect(change).toMatchObject({ type: 'scope.items_changed', data: { scope: { name: 'Grade 6 books', itemCount: 5 } } });
    expect(received[1]!.headers['x-midad-event']).toBe('scope.items_changed');
    expect(signedBy(secret, received[1]!)).toBe(true);

    await page.goto(`/org/${orgId}/settings`);
    await page.getByRole('button', { name: `Deliveries to ${url}` }).click();
    const rows = page.getByRole('dialog').locator('tbody tr');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('Books added or removed');
    await expect(rows.first()).toContainText('Delivered (200)');
    await expect(rows.nth(1)).toContainText('Test');
    // The whole kept history downloads as a spreadsheet, newest first, with the exact bodies sent.
    await expect(page.getByRole('dialog')).toContainText('Deliveries are kept for 30 days.');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('dialog').getByRole('button', { name: 'Download history (CSV)' }).click()]);
    expect(download.suggestedFilename()).toMatch(/^webhook-deliveries-127\.0\.0\.1-\d{4}-\d{2}-\d{2}\.csv$/);
    const history = parseCsv(await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c).toString('utf8')));
    expect(history.slice(1).map((r) => [r[3], r[4], r[6], r[11]])).toEqual([['scope.items_changed', 'delivered', '200', 'Grade 6 books'], ['ping', 'delivered', '200', '']]);
    expect(history[1]![12]).toBe(received[1]!.body);
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();

    // A note on a book of Grade 6 books is sent as "notes, assignees, statuses or due dates changed", naming the book only.
    await page.goto(`/org/${orgId}`);
    const grade6 = page.locator('.scopebar select option', { hasText: 'Grade 6 books' });
    await page.locator('.scopebar select').selectOption((await grade6.getAttribute('value'))!);
    await page.locator('.scopebar').getByRole('link', { name: 'Notes and assignees' }).click();
    await page.getByRole('button', { name: /^Edit the note on / }).first().click();
    await page.getByRole('dialog').getByLabel('Note').fill('Order 30 copies');
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await runWebhookPass()).toMatchObject({ delivered: 1 });
    const annotated = JSON.parse(received[2]!.body);
    expect(annotated).toMatchObject({ type: 'scope.items_annotated', data: { scope: { name: 'Grade 6 books' } } });
    expect(annotated.data.materialIds).toHaveLength(1);
    expect(received[2]!.body).not.toContain('Order 30 copies');
    expect(signedBy(secret, received[2]!)).toBe(true);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

// A 1×1 PNG: the server keeps a file only when its first bytes are an image or a PDF.
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000970485973000003e8000003e801b57b526b0000000d4944415408d763606060600000000500015ef32a3a0000000049454e44ae426082', 'hex');

test('classes and homework: the school sets up a class, a student hands in work with a photo, the teacher marks and returns it', async ({ page, browser }) => {
  // Journey 13's school, which already has student accounts (Laila and Omar, Grade 7) and the "Prep 1 books" scope.
  await login(page, delta.ownerEmail);
  await page.goto(`/org/${delta.orgId}`);
  await page.locator('.topbar').getByRole('link', { name: 'Classes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Classes', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'New class' }).click();
  let dlg = page.getByRole('dialog', { name: 'New class' });
  await dlg.getByLabel('Class name').fill('7A');
  await dlg.getByLabel('Grade', { exact: true }).selectOption('7');
  await dlg.getByLabel('Curriculum').selectOption({ label: (await dlg.getByLabel('Curriculum').locator('option', { hasText: 'Prep 1 books' }).textContent())! });
  await dlg.getByRole('button', { name: 'Create class' }).click();
  await expect(page.getByRole('heading', { name: '7A', level: 1 })).toBeVisible();
  await expect(page.getByText('Curriculum: Prep 1 books')).toBeVisible();

  await page.getByRole('button', { name: 'Choose students' }).click();
  dlg = page.getByRole('dialog', { name: 'Students of 7A' });
  await dlg.getByLabel('Laila Hassan').check();
  await dlg.getByLabel('Omar Adel').check();
  await dlg.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Students (2)' })).toBeVisible();

  // The owner teaches the subject of the scope's first books.
  await page.getByRole('button', { name: 'Add teacher' }).click();
  dlg = page.getByRole('dialog', { name: 'Add a teacher to 7A' });
  await dlg.getByLabel('Teacher').selectOption({ label: 'E2E Owner (Owner)' });
  await dlg.getByLabel('Subject', { exact: true }).selectOption({ label: delta.subject });
  await dlg.getByRole('button', { name: 'Add teacher' }).click();
  await expect(page.locator('#te-h').locator('..').locator('..')).toContainText(`E2E Owner · ${delta.subject}`);

  await page.getByRole('button', { name: 'Set homework' }).click();
  dlg = page.getByRole('dialog', { name: 'Homework for 7A' });
  await dlg.getByLabel('Subject', { exact: true }).selectOption({ label: delta.subject });
  await dlg.getByLabel('Title').fill('Read chapter 1');
  await dlg.getByLabel('Instructions').fill('Read pages 4 to 9 and answer the three questions at the end.');
  await dlg.getByLabel(delta.firstBook).check();
  await dlg.getByLabel('Marks').fill('10');
  await dlg.getByRole('button', { name: 'Set homework' }).click();
  await expect(page.getByText('Homework set. The class’s students were told.')).toBeVisible();
  const row = page.locator('table.data tbody tr', { hasText: 'Read chapter 1' });
  await expect(row).toContainText('0 of 2');

  // Laila sees it on her Today page and in a notification, writes an answer, attaches a photo and hands it in.
  const studentCtx = await browser.newContext();
  const student = await openPage(studentCtx);
  await student.goto(`/student-login?school=${delta.schoolCode}`);
  await student.getByLabel('Username').fill('laila.e2e');
  await student.getByLabel('Password').fill(delta.lailaPassword);
  await student.getByRole('button', { name: 'Sign in' }).click();
  await student.waitForURL(/\/student$/);
  await expect(student.getByRole('heading', { name: 'To do (1)' })).toBeVisible();
  await expect(student.locator('.topbar').getByRole('button', { name: 'Notifications, 1 unread' })).toBeVisible();
  await student.getByRole('link', { name: 'Read chapter 1' }).click();
  await expect(student.getByRole('heading', { name: 'Read chapter 1', level: 1 })).toBeVisible();
  await expect(student.locator('.mats')).toContainText(delta.firstBook);
  await student.getByLabel('Your answer').fill('1) The Nile. 2) Upper Egypt. 3) Aswan.');
  await student.getByLabel('Attach photos or a PDF').setInputFiles({ name: 'notebook.jpg', mimeType: 'image/jpeg', buffer: PNG });
  // The server keeps the real type: a PNG, whatever the name says. It opens once the worker has
  // checked it (run directly here, as the E2E run starts no worker); the list updates by itself.
  await expect(student.locator('.files')).toContainText('notebook.png · Being checked…');
  expect(await runFileCheckPass()).toMatchObject({ ready: 1 });
  await expect(student.locator('.files a', { hasText: 'notebook.png' })).toBeVisible({ timeout: 10_000 });
  await expect(student.getByLabel('Your answer')).toHaveValue('1) The Nile. 2) Upper Egypt. 3) Aswan.');
  await student.getByRole('button', { name: 'Hand in' }).click();
  await expect(student.getByText(/You handed this in/)).toBeVisible();

  // The teacher sees one piece of work waiting, marks it and returns it.
  await page.goto(`/org/${delta.orgId}/classes`);
  await expect(page.locator('.topbar').getByRole('link', { name: 'Classes (1 to mark)' })).toBeVisible();
  await page.getByRole('link', { name: '7A' }).click();
  await page.getByRole('link', { name: 'Read chapter 1' }).click();
  await expect(page.getByText('1 of 2 handed in · 0 returned')).toBeVisible();
  const laila = page.locator('table.data tbody tr', { hasText: 'Laila Hassan' });
  await expect(laila).toContainText('Handed in');
  await expect(page.locator('table.data tbody tr', { hasText: 'Omar Adel' })).toContainText('Not handed in');
  await laila.getByRole('button', { name: 'Open the work of Laila Hassan' }).click();
  dlg = page.getByRole('dialog', { name: 'Work of Laila Hassan' });
  await expect(dlg.locator('.answer')).toHaveText('1) The Nile. 2) Upper Egypt. 3) Aswan.');
  await expect(dlg.locator('.file img')).toBeVisible();
  // Visible means laid out, not loaded: wait for the picture itself to arrive before reading its size.
  await expect.poll(() => dlg.locator('.file img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
  await dlg.getByLabel('Mark (out of 10)').fill('9');
  await dlg.getByLabel('Comments for the student').fill('Very good. Question 3: Aswan is right, add why.');
  await dlg.getByRole('button', { name: 'Return to student' }).click();
  await expect(page.getByText('Returned to Laila Hassan.')).toBeVisible();
  await expect(page.locator('table.data tbody tr', { hasText: 'Laila Hassan' })).toContainText('9 / 10');

  // Laila sees her mark and the comment; the work can no longer change.
  await student.reload();
  await expect(student.getByRole('heading', { name: 'Your mark' })).toBeVisible();
  await expect(student.locator('.mark-big')).toHaveText('9 / 10');
  await expect(student.getByText('Very good. Question 3: Aswan is right, add why.')).toBeVisible();
  await expect(student.getByRole('button', { name: 'Hand in' })).toHaveCount(0);
  await student.locator('.topbar').getByRole('link', { name: 'Today' }).click();
  await expect(student.getByRole('heading', { name: 'Returned this week' })).toBeVisible();
  await expect(student.getByText('Nothing to hand in. Well done!')).toBeVisible();
  await studentCtx.close();
});

test('online test: the teacher writes and publishes it, watches it live, the student takes it with a start code, and gets the mark', async ({ page, browser }) => {
  test.setTimeout(150_000);
  // Journey 20's class 7A (Laila and Omar), where the owner teaches delta.subject.
  await login(page, delta.ownerEmail);
  await page.goto(`/org/${delta.orgId}/classes`);
  await page.getByRole('link', { name: '7A' }).click();
  await page.getByRole('button', { name: 'New test' }).click();
  let dlg = page.getByRole('dialog', { name: 'New test for 7A' });
  await dlg.getByLabel('Title').fill('Chapter 1 quiz');
  await dlg.getByLabel('Time limit (minutes)').fill('20');
  await dlg.getByLabel('Students need a start code that I give in the room').check();
  await dlg.getByRole('button', { name: 'Create test' }).click();
  await expect(page.getByRole('heading', { name: 'Chapter 1 quiz', level: 1 })).toBeVisible();
  const code = (await page.locator('.code-big').textContent())!.trim();

  // Three questions: one correct choice, a short answer, a written answer.
  await page.getByRole('button', { name: 'Add question' }).click();
  dlg = page.getByRole('dialog', { name: 'Add question' });
  await dlg.getByLabel('Question', { exact: true }).fill('Which river flows through Cairo?');
  await dlg.getByLabel('Choice A', { exact: true }).fill('The Euphrates');
  await dlg.getByLabel('Choice B', { exact: true }).fill('The Nile');
  await dlg.getByLabel('Choice C', { exact: true }).fill('The Jordan');
  await dlg.getByLabel('Choice B is correct').check();
  await dlg.getByLabel('Points').fill('2');
  await dlg.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'Add question' }).click();
  dlg = page.getByRole('dialog', { name: 'Add question' });
  await dlg.getByLabel('Question type').selectOption('short');
  await dlg.getByLabel('Question', { exact: true }).fill('In which city is the High Dam?');
  await dlg.getByLabel('Accepted answers, one per line').fill('Aswan\nأسوان');
  await dlg.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'Add question' }).click();
  dlg = page.getByRole('dialog', { name: 'Add question' });
  await dlg.getByLabel('Question type').selectOption('essay');
  await dlg.getByLabel('Question', { exact: true }).fill('Why does the Nile matter to farmers?');
  await dlg.getByLabel('Points').fill('3');
  await dlg.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Questions (3, 6 points)' })).toBeVisible();
  await page.getByRole('button', { name: 'Publish' }).click();
  await page.getByRole('dialog', { name: 'Publish the test' }).getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published. The class’s students were told.')).toBeVisible();

  // Laila starts from Today with the code, answers, leaves the page once and pastes once.
  const studentCtx = await browser.newContext();
  const student = await openPage(studentCtx);
  await student.goto(`/student-login?school=${delta.schoolCode}`);
  await student.getByLabel('Username').fill('laila.e2e');
  await student.getByLabel('Password').fill(delta.lailaPassword);
  await student.getByRole('button', { name: 'Sign in' }).click();
  await expect(student.getByRole('heading', { name: 'Tests open now' })).toBeVisible();
  await student.getByRole('link', { name: 'Start Chapter 1 quiz' }).click();
  await student.getByLabel('Start code').fill('WRONG1');
  await student.getByRole('button', { name: 'Start' }).click();
  await student.getByRole('dialog', { name: 'Start the test' }).getByRole('button', { name: 'Start' }).click();
  await expect(student.getByText('Enter the start code your teacher gives you')).toBeVisible();
  await student.getByLabel('Start code').fill(code.toLowerCase());
  await student.getByRole('button', { name: 'Start' }).click();
  await student.getByRole('dialog', { name: 'Start the test' }).getByRole('button', { name: 'Start' }).click();
  await expect(student.getByRole('timer')).toContainText(/1[89]:[0-5]\d|20:00/);
  await student.getByLabel('The Nile').check();
  await student.getByLabel('Your answer').first().fill('أسوان');
  await student.getByLabel('Your answer').nth(1).fill('It waters the fields and its silt makes the soil rich.');
  await student.evaluate(async () => {
    const set = (v: string) => Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });
    set('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((r) => setTimeout(r, 1500));
    set('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    const data = new DataTransfer();
    data.setData('text/plain', 'copied text');
    document.querySelectorAll('textarea')[0]!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
  });
  await expect(student.getByText(/^Saved /)).toBeVisible();

  // The teacher's live monitor: Laila working, what was noticed; extra time for her.
  await page.getByRole('link', { name: 'Live monitor' }).click();
  const laila = page.locator('table.data tbody tr', { hasText: 'Laila Hassan' });
  await expect(laila).toContainText('Working');
  await expect(laila).toContainText('3 of 3 answered');
  await expect(laila).toContainText('Left the page 1×');
  await expect(laila).toContainText('Pasted 1×');
  await expect(page.locator('table.data tbody tr', { hasText: 'Omar Adel' })).toContainText('Not started');
  await laila.getByRole('button', { name: 'Extra time for Laila Hassan' }).click();
  await page.getByRole('dialog', { name: 'Extra time for Laila Hassan' }).getByLabel('Extra time').selectOption('10');
  await page.getByRole('dialog', { name: 'Extra time for Laila Hassan' }).getByRole('button', { name: 'Give time' }).click();
  await expect(page.getByText('Extra time given to Laila Hassan.')).toBeVisible();

  // Laila submits; results come when the test closes.
  await student.getByRole('button', { name: 'Submit' }).click();
  await student.getByRole('dialog', { name: 'Submit your answers' }).getByRole('button', { name: 'Submit' }).click();
  await expect(student.getByText('Your answers are saved. Your teacher will show the results later.')).toBeVisible();

  // The teacher closes the test and marks the written answer.
  await expect(laila).toContainText('Submitted', { timeout: 10_000 });
  await page.getByRole('button', { name: 'Close the test now' }).click();
  await page.getByRole('dialog', { name: 'Close the test now' }).getByRole('button', { name: 'Close the test now' }).click();
  await expect(page.locator('.page-head .pill')).toHaveText('Closed');
  await page.getByRole('link', { name: 'Results' }).click();
  await expect(page.locator('table.data tbody tr', { hasText: 'Laila Hassan' })).toContainText('To mark');
  await page.getByRole('link', { name: 'Attempt 1 of Laila Hassan' }).click();
  await expect(page.locator('.question').first()).toContainText('2 / 2');
  await expect(page.locator('.question').nth(1)).toContainText('1 / 1');
  await page.getByLabel('Mark (out of 3)').fill('2.5');
  await page.getByLabel('Comments for the student').nth(2).fill('Good. Mention the annual flood too.');
  await page.getByRole('button', { name: 'Save the mark for question 3' }).click();
  await expect(page.getByText('Saved. Total: 5.5 / 6')).toBeVisible();

  // Laila sees her mark and the comment.
  await student.goto('/student/tests');
  await expect(student.getByRole('heading', { name: 'Past tests' })).toBeVisible();
  await expect(student.locator('.hw-item', { hasText: 'Chapter 1 quiz' })).toContainText('5.5 / 6');
  await student.getByRole('link', { name: 'Chapter 1 quiz' }).click();
  await student.getByRole('link', { name: 'See your answers of attempt 1' }).click();
  await expect(student.locator('.mark-big')).toHaveText('5.5 / 6');
  await expect(student.getByText('Good. Mention the annual flood too.')).toBeVisible();
  await studentCtx.close();
});

test('gradebook: the teacher sees the class’s marks for a subject and downloads them; the student sees their own grades', async ({ page, browser }) => {
  // Journeys 20 and 21: in 7A, Laila has homework marked 9 / 10 and a test marked 5.5 / 6; Omar did not take the test.
  await login(page, delta.ownerEmail);
  await page.goto(`/org/${delta.orgId}/classes`);
  await page.getByRole('link', { name: '7A' }).click();
  await page.getByRole('link', { name: 'Gradebook' }).click();
  await expect(page.getByRole('heading', { name: 'Gradebook', level: 1 })).toBeVisible();
  await expect(page.getByLabel('Subject')).toHaveValue(delta.subject);
  const laila = page.locator('table.gradebook tbody tr', { hasText: 'Laila Hassan' });
  await expect(laila).toContainText('90.6%');
  const cells = await laila.locator('td').allTextContents();
  expect([cells.slice(0, 2).sort(), cells[2]]).toEqual([['5.5', '9'], '90.6%']);
  const omar = page.locator('table.gradebook tbody tr', { hasText: 'Omar Adel' });
  await expect(omar).toContainText('Missing');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download CSV' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^gradebook-7A-.+\.csv$/);
  const csv = parseCsv(await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c).toString('utf8')));
  expect(csv[0]![0]).toBe('Student');
  expect(csv.find((r) => r[0] === 'Laila Hassan')!.slice(-2)).toEqual(['90.6', '0']);

  // Laila's own grades.
  const studentCtx = await browser.newContext();
  const student = await openPage(studentCtx);
  await student.goto(`/student-login?school=${delta.schoolCode}`);
  await student.getByLabel('Username').fill('laila.e2e');
  await student.getByLabel('Password').fill(delta.lailaPassword);
  await student.getByRole('button', { name: 'Sign in' }).click();
  await student.getByRole('link', { name: 'Grades' }).click();
  await expect(student.getByRole('heading', { name: 'My grades', level: 1 })).toBeVisible();
  const card = student.locator('section.card', { has: student.getByRole('heading', { name: `${delta.subject} · 7A` }) });
  await expect(card).toContainText('Average: 90.6%');
  await expect(card.locator('tbody tr', { hasText: 'Read chapter 1' })).toContainText('9 / 10');
  await expect(card.locator('tbody tr', { hasText: 'Chapter 1 quiz' })).toContainText('5.5 / 6');
  await studentCtx.close();
});

test('keeping classroom data: the owner sets how long work is kept, keeps a test, and after the notice the work is deleted but the mark stays', async ({ page, browser }) => {
  // Journeys 20–22's class 7A: Laila's homework (with a photo, marked 9 / 10) and her test (5.5 / 6), both now 40 days old.
  await ownerQuery(`UPDATE homework SET publish_at = now() - interval '50 days', due_at = now() - interval '40 days' WHERE org_id = $1 AND title = 'Read chapter 1'`, [delta.orgId]);
  // (A test closed early ends when it was closed, so that moves too.)
  await ownerQuery(`UPDATE tests SET opens_at = now() - interval '41 days', closes_at = now() - interval '40 days', closed_early_at = CASE WHEN closed_early_at IS NULL THEN NULL ELSE now() - interval '40 days' END WHERE org_id = $1 AND title = 'Chapter 1 quiz'`, [delta.orgId]);
  await login(page, delta.ownerEmail);
  await page.goto(`/org/${delta.orgId}/classes`);
  await page.getByRole('link', { name: 'Keeping data' }).click();
  await expect(page.getByRole('heading', { name: 'Keeping classroom data', level: 1 })).toBeVisible();
  await expect(page.getByText('Nothing is due to be deleted.')).toBeVisible();
  await expect(page.getByLabel('Students’ work')).toHaveValue('');

  // Thirty days for students' work: both are past it, so saving asks first.
  await page.getByLabel('Students’ work').selectOption({ label: '30 days' });
  await page.getByRole('button', { name: 'Save periods' }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete data past these periods?' });
  await expect(confirm).toContainText('homework: 1, tests: 1');
  await confirm.getByRole('button', { name: 'Save periods' }).click();
  await expect(page.getByText('Saved. Owners and admins were told what will be deleted (2).')).toBeVisible();
  const due = page.locator('section.card', { has: page.getByRole('heading', { name: 'Due to be deleted' }) });
  await expect(due.locator('tbody tr', { hasText: 'Read chapter 1' })).toContainText('Students’ work');
  await expect(due.locator('tbody tr', { hasText: 'Chapter 1 quiz' })).toContainText('Students’ answers');
  expect(await latestEmailText(delta.ownerEmail, 'classroom_retention')).toContain('• 7A — “Read chapter 1”: students’ work, on or after');

  // The test is under appeal: keep it.
  await page.getByRole('button', { name: 'Keep “Chapter 1 quiz”' }).click();
  await expect(page.getByText('Kept: Chapter 1 quiz')).toBeVisible();
  const kept = page.locator('section.card', { has: page.getByRole('heading', { name: 'Kept whatever the periods say' }) });
  await expect(kept).toContainText('Chapter 1 quiz');
  await expect(due.locator('tbody tr')).toHaveCount(1);

  // Fourteen days after the notice the worker deletes the homework work; the kept test is untouched.
  expect(await runRetentionPass(new Date(Date.now() + 15 * 86_400_000))).toMatchObject({ removed: 1, failed: 0 });
  await page.goto(`/org/${delta.orgId}/classes`);
  await page.getByRole('link', { name: '7A' }).click();
  await page.getByRole('link', { name: 'Read chapter 1' }).click();
  await expect(page.getByText(/^Students’ work was deleted on .+, under your school’s retention periods\. Hand-in times, marks and comments are kept\.$/)).toBeVisible();
  await page.getByRole('button', { name: 'Open the work of Laila Hassan' }).click();
  const work = page.getByRole('dialog');
  await expect(work).toContainText('The answer and files were deleted under the school’s retention periods.');
  await expect(work.getByLabel('Mark (out of 10)')).toHaveValue('9');
  await work.getByRole('button', { name: 'Cancel' }).click();

  // Laila still has her mark; her answer and photo are gone, and she is told why.
  const studentCtx = await browser.newContext();
  const student = await openPage(studentCtx);
  await student.goto(`/student-login?school=${delta.schoolCode}`);
  await student.getByLabel('Username').fill('laila.e2e');
  await student.getByLabel('Password').fill(delta.lailaPassword);
  await student.getByRole('button', { name: 'Sign in' }).click();
  await student.getByRole('link', { name: 'Grades' }).click();
  const card = student.locator('section.card', { has: student.getByRole('heading', { name: `${delta.subject} · 7A` }) });
  await expect(card.locator('tbody tr', { hasText: 'Read chapter 1' })).toContainText('9 / 10');
  await card.getByRole('link', { name: 'Read chapter 1' }).click();
  await expect(student.getByText(/^Your answer and files were deleted on .+, because your school keeps work for a limited time\./)).toBeVisible();
  await expect(student.locator('.mark-big')).toHaveText('9 / 10');
  await studentCtx.close();
});

test('online test: an answer that does not reach the server is saved again, and submitting warns while one is waiting', async ({ page, browser }) => {
  test.setTimeout(150_000);
  // Journey 20's class 7A; a short test Laila takes on a weak connection.
  await login(page, delta.ownerEmail);
  await page.goto(`/org/${delta.orgId}/classes`);
  await page.getByRole('link', { name: '7A' }).click();
  await page.getByRole('button', { name: 'New test' }).click();
  let dlg = page.getByRole('dialog', { name: 'New test for 7A' });
  await dlg.getByLabel('Title').fill('Weak Wi-Fi quiz');
  await dlg.getByRole('button', { name: 'Create test' }).click();
  await expect(page.getByRole('heading', { name: 'Weak Wi-Fi quiz', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Add question' }).click();
  dlg = page.getByRole('dialog', { name: 'Add question' });
  await dlg.getByLabel('Question', { exact: true }).fill('Which sea lies north of Egypt?');
  await dlg.getByLabel('Choice A', { exact: true }).fill('The Mediterranean');
  await dlg.getByLabel('Choice B', { exact: true }).fill('The Red Sea');
  await dlg.getByLabel('Choice C', { exact: true }).fill('The Dead Sea');
  await dlg.getByLabel('Choice A is correct').check();
  await dlg.getByLabel('Points').fill('1');
  await dlg.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Questions (1, 1 point)' })).toBeVisible();
  await page.getByRole('button', { name: 'Publish' }).click();
  await page.getByRole('dialog', { name: 'Publish the test' }).getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published. The class’s students were told.')).toBeVisible();

  const studentCtx = await browser.newContext();
  const student = await openPage(studentCtx);
  await student.goto(`/student-login?school=${delta.schoolCode}`);
  await student.getByLabel('Username').fill('laila.e2e');
  await student.getByLabel('Password').fill(delta.lailaPassword);
  await student.getByRole('button', { name: 'Sign in' }).click();
  await student.getByRole('link', { name: 'Start Weak Wi-Fi quiz' }).click();
  await student.getByRole('button', { name: 'Start' }).click();
  await student.getByRole('dialog', { name: 'Start the test' }).getByRole('button', { name: 'Start' }).click();
  await expect(student.getByRole('timer')).toBeVisible();
  const bar = student.locator('.testbar');
  const answers = '**/api/student/attempts/*/answers/*';
  const unavailable = { status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Service unavailable' } }) };

  // The first save is lost on the way; the page says so and tries again by itself 5 seconds later.
  let lost = 1;
  await student.route(answers, (route) => (lost-- > 0 ? route.fulfill(unavailable) : route.continue()));
  await student.getByLabel('The Mediterranean').check();
  await expect(bar).toContainText('Not saved yet (1): trying again');
  await expect(bar).toContainText(/Saved \d/, { timeout: 15_000 });

  // While the server cannot be reached, submitting asks first instead of losing the answer.
  await student.unroute(answers);
  await student.route(answers, (route) => route.fulfill(unavailable));
  await student.getByLabel('The Red Sea').check();
  await expect(bar).toContainText('Not saved yet (1): trying again');
  await student.getByRole('button', { name: 'Submit' }).click();
  const warning = student.getByRole('dialog', { name: 'Some answers are not saved' });
  await expect(warning).toContainText('Answers not saved yet: 1.');
  await warning.getByRole('button', { name: 'Cancel' }).click();

  // The connection is back: the next try saves the answer, and submitting is as usual.
  await student.unroute(answers);
  await expect(bar).toContainText(/Saved \d/, { timeout: 40_000 });
  await student.getByRole('button', { name: 'Submit' }).click();
  await student.getByRole('dialog', { name: 'Submit your answers' }).getByRole('button', { name: 'Submit' }).click();
  await expect(student.getByText('Your answers are saved. Your teacher will show the results later.')).toBeVisible();
  const stored = await ownerQuery(
    `SELECT x.answer FROM test_answers x JOIN test_attempts a ON a.id = x.attempt_id JOIN tests t ON t.id = a.test_id WHERE t.org_id = $1 AND t.title = 'Weak Wi-Fi quiz'`,
    [delta.orgId],
  );
  expect(stored).toEqual([{ answer: 'b' }]);
  await studentCtx.close();
});

test('questions suggested by AI: the platform gives the school AI requests; the teacher asks for questions, keeps two, and they are ordinary questions', async ({ page, browser }) => {
  // AI requests for Delta Prep School. The E2E server's AI provider is the simulator (tests/e2e/server.ts).
  const adminCtx = await browser.newContext();
  const admin = await openPage(adminCtx);
  await signInAsPlatformAdmin(admin);
  await admin.goto(`/admin/orgs/${delta.orgId}`);
  await admin.getByLabel('AI requests per month (override)').fill('20');
  await admin.getByRole('button', { name: 'Apply' }).click();
  await expect(admin.getByText('Saved')).toBeVisible();
  await adminCtx.close();

  // Journey 20's class 7A, where the owner teaches delta.subject.
  await login(page, delta.ownerEmail);
  await page.goto(`/org/${delta.orgId}/classes`);
  await page.getByRole('link', { name: '7A' }).click();
  await page.getByRole('button', { name: 'New test' }).click();
  let dlg = page.getByRole('dialog', { name: 'New test for 7A' });
  await dlg.getByLabel('Title').fill('Forces practice');
  await dlg.getByRole('button', { name: 'Create test' }).click();
  await expect(page.getByRole('heading', { name: 'Forces practice', level: 1 })).toBeVisible();

  await page.getByRole('button', { name: 'Suggest questions with AI' }).click();
  dlg = page.getByRole('dialog', { name: 'Suggest questions with AI' });
  await expect(dlg.getByText('AI requests left for your school this month: 20')).toBeVisible();
  await expect(dlg.getByLabel('Language of the questions')).toHaveValue('en');
  // Without a topic, the form says so before anything is sent.
  await dlg.getByRole('button', { name: 'Suggest' }).click();
  await expect(dlg.getByRole('alert')).toHaveText('Write the topic (at least 3 characters).');
  await dlg.getByLabel('Topic or lesson').fill('Forces and motion');
  await dlg.getByLabel('Lesson text (optional)').fill('A force is a push or a pull. Friction slows things down. Gravity pulls objects towards the Earth.');
  await dlg.getByLabel('How many questions (1–10)').fill('3');
  await dlg.getByRole('button', { name: 'Suggest' }).click();

  dlg = page.getByRole('dialog', { name: 'Suggested questions' });
  await expect(dlg.getByText('Which of these is a force?')).toBeVisible();
  await expect(dlg.getByText('Why: A force is a push or a pull.')).toBeVisible();
  await expect(dlg.getByText('Correct answer: gravity · the force of gravity')).toBeVisible();
  await dlg.getByLabel('Add question 2').uncheck();
  await dlg.getByRole('button', { name: 'Add selected' }).click();
  await expect(page.getByText('Questions added: 2')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Questions (2, 3 points)' })).toBeVisible();
  const questions = page.locator('ol.questions > li');
  await expect(questions.nth(0)).toContainText('Which of these is a force?');
  await expect(questions.nth(1)).toContainText('What pulls objects towards the Earth?');

  // A kept suggestion is an ordinary question: the teacher edits it like any other.
  await page.getByRole('button', { name: 'Edit question 2' }).click();
  dlg = page.getByRole('dialog', { name: 'Edit question' });
  await dlg.getByLabel('Points').fill('1');
  await dlg.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Questions (2, 2 points)' })).toBeVisible();

  // One request was used.
  await page.getByRole('button', { name: 'Suggest questions with AI' }).click();
  await expect(page.getByRole('dialog').getByText('AI requests left for your school this month: 19')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
});
