import { expect, type BrowserContext, type Page } from '@playwright/test';
import { authenticator } from 'otplib';
import { hashPassword } from '../../src/auth/password.js';
import { encryptSecret } from '../../src/lib/crypto.js';
import { E2E_ENV, latestEmailText, ownerQuery } from './server.js';

// Browser helpers shared by the journey and accessibility specs.
export const PASSWORD = 'e2e-correct-horse-battery';
export const uid = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
export const token = (text: string) => /[?&]token=([A-Za-z0-9_-]+)/.exec(text)![1]!;

/**
 * Works around two faults of Playwright 1.56's browser builds, not of the app. Every page the journeys
 * open goes through here (the built-in `page` in a beforeEach). Chromium is left as it is.
 * - Firefox sometimes loses a navigation's "load" event although the page has loaded, and page.goto
 *   then waits until the test times out: 11 of 100 fresh pages in a probe, none of 100 when waiting
 *   for DOMContentLoaded, which its navigations do here. The app needs nothing that arrives in
 *   between: it draws from its module script and API calls, which the assertions wait for.
 * - WebKit's Linux build aborts the page (an assertion on an empty std::optional) on the second
 *   reload after a history.pushState, which every in-app link makes; a bare page with one pushState
 *   does the same. Its reloads are made as a new load of the same address, which never failed.
 */
export function navigable(page: Page): Page {
  const browser = page.context().browser()?.browserType().name();
  const [goto, reload, waitForURL] = [page.goto.bind(page), page.reload.bind(page), page.waitForURL.bind(page)];
  if (browser === 'firefox') {
    page.goto = (url, options) => goto(url, { waitUntil: 'domcontentloaded', ...options });
    page.reload = (options) => reload({ waitUntil: 'domcontentloaded', ...options });
    page.waitForURL = (url, options) => waitForURL(url, { waitUntil: 'domcontentloaded', ...options });
  }
  if (browser === 'webkit') page.reload = (options) => goto(page.url(), options);
  return page;
}

export const openPage = async (ctx: BrowserContext) => navigable(await ctx.newPage());

export async function registerAndVerify(page: Page, email: string, org: string) {
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

export async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/(org\/|mfa|account)/);
}

export async function createScope(page: Page, name: string) {
  await page.getByRole('button', { name: /Create your first scope|New scope/ }).first().click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Name').fill(name);
  await dlg.getByRole('button', { name: 'Create' }).click();
}

export async function payInSandbox(page: Page) {
  await expect(page.getByRole('heading', { name: 'Sandbox checkout' })).toBeVisible();
  await page.getByRole('button', { name: /^Pay / }).click();
  await expect(page.getByText('Payment received')).toBeVisible({ timeout: 20_000 });
}

/** `onCodePage` runs on the two-factor page, before the code is entered. */
export async function signInAsPlatformAdmin(page: Page, onCodePage?: () => Promise<void>) {
  const email = `admin.${uid()}@e2e.test`;
  const secret = authenticator.generateSecret();
  await ownerQuery(
    `INSERT INTO users (email, name, password_hash, email_verified_at, is_platform_admin, mfa_enabled, mfa_secret_enc) VALUES ($1, 'E2E Admin', $2, now(), true, true, $3)`,
    [email, await hashPassword(PASSWORD), encryptSecret(E2E_ENV.DATA_ENCRYPTION_KEY!, secret)],
  );
  await login(page, email);
  await expect(page.getByRole('heading', { name: 'Two-factor verification' })).toBeVisible();
  await onCodePage?.();
  await page.getByLabel('Authentication code').fill(authenticator.generate(secret));
  await page.getByRole('button', { name: 'Verify' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/mfa'));
}

export function orgIdFromUrl(page: Page): string {
  return /\/org\/([0-9a-f-]{36})/.exec(page.url())![1]!;
}
