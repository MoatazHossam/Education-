import { expect, test } from '@playwright/test';
import { parseCsv, toCsv, unguardCell } from '../../src/lib/csv.js';
import { createScope, login, orgIdFromUrl, PASSWORD, payInSandbox, registerAndVerify, signInAsPlatformAdmin, token, uid } from './helpers.js';
import { latestEmailText, ownerQuery, startServer, stopServer } from './server.js';

test.describe.configure({ mode: 'serial' });

let ownerEmail = '';
let orgAId = '';

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
  const editor = await editorCtx.newPage();
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
  const page = await ctx.newPage();
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

test('platform admin signs in with two-factor authentication, sends a test alert, and suspends then restores an organization', async ({ page, browser }) => {
  await signInAsPlatformAdmin(page);
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Platform overview' })).toBeVisible();
  // No alert channel is configured in the E2E environment, and the test alert says so.
  await expect(page.getByRole('heading', { name: 'Alerts' })).toBeVisible();
  await expect(page.getByText(/No alert channel is configured/)).toBeVisible();
  await page.getByRole('button', { name: 'Send test alert' }).click();
  await expect(page.getByText('Test alert: email not configured, webhook not configured')).toBeVisible();
  await page.goto(`/admin/orgs/${orgAId}`);
  await expect(page.getByRole('heading', { name: 'Nile Learning' })).toBeVisible();
  await expect(page.getByText('No active grant. Customer business data is not accessible.')).toBeVisible();
  await page.getByRole('button', { name: 'Suspend organization' }).click();
  await page.getByRole('dialog').getByLabel(/Reason/).fill('E2E suspension check');
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('button', { name: 'Restore organization' })).toBeVisible();

  const ownerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  await login(owner, ownerEmail);
  await owner.goto(`/org/${orgAId}`);
  await expect(owner.getByRole('heading', { name: 'Organization suspended' })).toBeVisible();

  await page.getByRole('button', { name: 'Restore organization' }).click();
  await expect(page.getByRole('button', { name: 'Suspend organization' })).toBeVisible();
  await owner.reload();
  await expect(owner.locator('.picker h1')).toBeVisible();
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
  const owner = await ownerCtx.newPage();
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
  const page = await ctx.newPage();
  await login(page, ownerEmail);
  await page.goto(`/org/${orgAId}`);
  await expect(page.locator('.picker h1')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.locator('.topbar').getByRole('button', { name: 'العربية', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('link', { name: 'دليل المناهج' })).toBeVisible();
  await expect(page.locator('.verif.ok summary').first()).toHaveText('تم التحقق');
  const overflowAr = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
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
  const owner = await ownerCtx.newPage();
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
