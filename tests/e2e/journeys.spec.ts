import { expect, test, type Page } from '@playwright/test';
import { authenticator } from 'otplib';
import { hashPassword } from '../../src/auth/password.js';
import { encryptSecret } from '../../src/lib/crypto.js';
import { E2E_ENV, latestEmailText, ownerQuery, startServer, stopServer } from './server.js';

const PASSWORD = 'e2e-correct-horse-battery';
const uid = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const token = (text: string) => /[?&]token=([A-Za-z0-9_-]+)/.exec(text)![1]!;

async function registerAndVerify(page: Page, email: string, org: string) {
  await page.goto('/register');
  await page.getByLabel('Your name').fill('E2E Owner');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByLabel('Organization name').fill(org);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText(`Check ${email}`)).toBeVisible();
  await page.goto(`/verify-email?token=${token(await latestEmailText(email, 'verify_email'))}`);
  await expect(page.getByText('Your email is confirmed')).toBeVisible();
}

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/(org\/|mfa|account)/);
}

async function createScope(page: Page, name: string) {
  await page.getByRole('button', { name: /Create your first scope|New scope/ }).first().click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Name').fill(name);
  await dlg.getByRole('button', { name: 'Create' }).click();
}

async function payInSandbox(page: Page) {
  await expect(page.getByRole('heading', { name: 'Sandbox checkout' })).toBeVisible();
  await page.getByRole('button', { name: /^Pay / }).click();
  await expect(page.getByText('Payment received')).toBeVisible({ timeout: 20_000 });
}

async function signInAsPlatformAdmin(page: Page) {
  const email = `admin.${uid()}@e2e.test`;
  const secret = authenticator.generateSecret();
  await ownerQuery(
    `INSERT INTO users (email, name, password_hash, email_verified_at, is_platform_admin, mfa_enabled, mfa_secret_enc) VALUES ($1, 'E2E Admin', $2, now(), true, true, $3)`,
    [email, await hashPassword(PASSWORD), encryptSecret(E2E_ENV.DATA_ENCRYPTION_KEY!, secret)],
  );
  await login(page, email);
  await expect(page.getByRole('heading', { name: 'Two-factor verification' })).toBeVisible();
  await page.getByLabel('Authentication code').fill(authenticator.generate(secret));
  await page.getByRole('button', { name: 'Verify' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/mfa'));
}

function orgIdFromUrl(page: Page): string {
  return /\/org\/([0-9a-f-]{36})/.exec(page.url())![1]!;
}

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

test('platform admin signs in with two-factor authentication and suspends then restores an organization', async ({ page, browser }) => {
  await signInAsPlatformAdmin(page);
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Platform overview' })).toBeVisible();
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
  const banner = owner.locator('.carry-banner');
  await expect(banner).toContainText('A newer catalogue (2027/2028) has been published.');
  await banner.getByRole('link', { name: 'Carry this scope forward' }).click();
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
