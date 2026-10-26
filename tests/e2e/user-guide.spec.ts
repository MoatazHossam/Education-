import { mkdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { authenticator } from 'otplib';
import { hashPassword } from '../../src/auth/password.js';
import { encryptSecret } from '../../src/lib/crypto.js';
import { parseCsv, toCsv, unguardCell } from '../../src/lib/csv.js';
import { PASSWORD, token } from './helpers.js';
import { E2E_ENV, latestEmailText, ownerQuery, runReminderPass, runWebhookPass } from './server.js';

// Screenshots for docs/USER_GUIDE.md and, with GUIDE_LANG=ar, docs/USER_GUIDE.ar.md
// (`npm run docs:screenshots`, `npm run docs:screenshots:ar`). Builds a demo school on a
// fresh database through the interface, as its people would, and captures each screen.
// Every label comes from the interface's own dictionaries, so the same steps drive the
// English or the Arabic interface. All names and addresses are invented.

const LANG: 'en' | 'ar' = process.env.GUIDE_LANG === 'ar' ? 'ar' : 'en';
const OTHER: 'en' | 'ar' = LANG === 'ar' ? 'en' : 'ar';
const OUT = LANG === 'ar' ? 'docs/user-guide/images-ar' : 'docs/user-guide/images';
const EMAILS = `test-results/user-guide-emails${LANG === 'ar' ? '-ar' : ''}.json`;
mkdirSync(OUT, { recursive: true });
mkdirSync('test-results', { recursive: true });
const taken: string[] = [];
const emails: Record<string, string> = {};

// ---------------------------------------------------------------- the interface's words
type Dict = Record<string, string>;
let dicts: Record<'en' | 'ar', Dict>;
const I18N = new URL('../../public/js/i18n.js', import.meta.url).href;
test.beforeAll(async () => {
  dicts = ((await import(I18N)) as { _dicts: Record<'en' | 'ar', Dict> })._dicts;
});
function word(lang: 'en' | 'ar', key: string, params: Record<string, string | number> = {}) {
  const s = dicts[lang][key];
  if (s === undefined) throw new Error(`No "${key}" in the ${lang} dictionary`);
  return s.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`));
}
/** A label of the interface in the guide's language. */
const L = (key: string, params?: Record<string, string | number>) => word(LANG, key, params);
/** The same label in the other language (for the screens taken after switching language). */
const LO = (key: string, params?: Record<string, string | number>) => word(OTHER, key, params);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A label whose {placeholders} can be anything; anchored unless `partial`. */
function like(key: string, partial = false) {
  const body = dicts[LANG][key]!.split(/\{\w+\}/).map(escapeRe).join('.+');
  return new RegExp(partial ? body : `^${body}$`);
}
const startsWith = (key: string) => new RegExp(`^${escapeRe(L(key))}`);
/**
 * A form field by its label. A label that wraps its control also carries the control's text
 * ("StatusNot verifiedVerified…"), so the label is matched as the start of the name.
 */
const field = (key: string) => new RegExp(`^${escapeRe(L(key))}`);
/** The name of a grade button in the picker ("Grade 1", "الصف 1"). */
const grade = (n: number, lang = LANG) => `${word(lang, 'picker.grade')} ${n}`;
/** The language button in the top bar or on a signed-out page switches to the other language. */
const switchLabel = (to: 'en' | 'ar') => (to === 'ar' ? 'العربية' : 'English');

// ---------------------------------------------------------------- the demo school
const DEMO = {
  en: {
    school: 'Nile Valley Language School', mona: 'Mona Hassan', karim: 'Karim Adel', salma: 'Salma Fathy', support: 'Curriculum Scope Support',
    scope: 'Primary 1–3 core books', scopeDescription: 'Arabic, English, maths and science for the lower primary platform.',
    campusB: 'Primary 1–3 core books — Campus B', summerOrg: 'Nile Valley Summer Programme', summerScope: 'Summer reading 2027',
    note1: 'Order 120 copies before September; check the new cover.', note2: 'Waiting for the 2027 edition from the publisher.',
    decree: 'Ministerial Decree 123/2026', publisherSource: 'Publisher catalogue 2027', nextLabel: 'Egypt K-12 curriculum — academic year 2027/2028',
    keyName: 'Content pipeline', hookDescription: 'Lesson platform: sync selected books', supportReason: 'Ticket 2041: the Grade 2 export looks wrong',
    omar: 'Omar Khaled', laila: 'Laila Mostafa', youssef: 'Youssef Ali', nour: 'Nour Ahmed',
  },
  ar: {
    school: 'مدرسة وادي النيل للغات', mona: 'منى حسن', karim: 'كريم عادل', salma: 'سلمى فتحي', support: 'دعم نطاق المناهج',
    scope: 'الكتب الأساسية للصفوف 1–3', scopeDescription: 'العربي والإنجليزي والرياضيات والعلوم لمنصة المرحلة الابتدائية الأولى.',
    campusB: 'الكتب الأساسية للصفوف 1–3 — الفرع ب', summerOrg: 'برنامج وادي النيل الصيفي', summerScope: 'قراءات صيف 2027',
    note1: 'اطلب 120 نسخة قبل سبتمبر، وراجع الغلاف الجديد.', note2: 'في انتظار طبعة 2027 من الناشر.',
    decree: 'القرار الوزاري 123/2026', publisherSource: 'كتالوج الناشر 2027', nextLabel: 'مناهج مصر من الروضة حتى الثانوي — العام الدراسي 2027/2028',
    keyName: 'خط إنتاج المحتوى', hookDescription: 'منصة الدروس: مزامنة الكتب المختارة', supportReason: 'تذكرة 2041: تصدير الصف الثاني يبدو خاطئًا',
    omar: 'عمر خالد', laila: 'ليلى مصطفى', youssef: 'يوسف علي', nour: 'نور أحمد',
  },
}[LANG];

const MONA = 'mona.hassan@nilevalley.example';
const KARIM = 'karim.adel@nilevalley.example';
const SALMA = 'salma.fathy@nilevalley.example';
const ADMIN = 'support@curriculumscope.example';
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

// ---------------------------------------------------------------- capture helpers
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
/** A new browser window; its language decides the signed-out pages' language. */
async function newPage(browser: Browser, opts: Parameters<Browser['newContext']>[0] = {}) {
  const page = await (await browser.newContext({ locale: LANG === 'ar' ? 'ar-EG' : 'en-GB', ...opts })).newPage();
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

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel(field('auth.email')).fill(email);
  await page.getByLabel(field('auth.password')).fill(PASSWORD);
  await page.getByRole('button', { name: L('auth.signIn') }).click();
  await page.waitForURL(/\/(org\/|mfa|account)/);
}

async function payInSandbox(page: Page) {
  await expect(page.getByRole('heading', { name: L('sandbox.title') })).toBeVisible();
  await page.getByRole('button', { name: like('sandbox.pay') }).click();
  await expect(page.getByText(L('billing.paid'))).toBeVisible({ timeout: 20_000 });
}

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
  await expect(guest.getByRole('heading', { name: L('pricing.title') })).toBeVisible();
  await shot(guest, 'pricing');

  await guest.goto('/register');
  await guest.getByLabel(field('auth.name')).fill(DEMO.mona);
  await guest.getByLabel(field('auth.email')).fill(MONA);
  await guest.getByLabel(field('auth.password')).fill(PASSWORD);
  await guest.getByLabel(field('auth.orgName')).fill(DEMO.school);
  await shot(guest, 'register', card(guest), { pad: 32 });
  await guest.getByRole('button', { name: L('auth.createAccount') }).click();
  await expect(guest.getByText(L('auth.checkEmail', { email: MONA }))).toBeVisible();
  await shot(guest, 'register-check-email', card(guest), { pad: 32 });
  const verify = await keepEmail(MONA, 'verify_email');
  await guest.goto(`/verify-email?token=${token(verify)}`);
  await expect(guest.getByText(L('auth.verified'))).toBeVisible();
  await shot(guest, 'email-confirmed', card(guest), { pad: 32 });

  await guest.goto('/login');
  await guest.getByLabel(field('auth.email')).fill(MONA);
  await shot(guest, 'sign-in', card(guest), { pad: 32 });
  await guest.goto('/forgot-password');
  await guest.getByLabel(field('auth.email')).fill(MONA);
  await shot(guest, 'forgot-password', card(guest), { pad: 32 });
  await guest.getByRole('button', { name: L('auth.sendReset') }).click();
  await expect(guest.getByText(L('auth.resetSent'))).toBeVisible();
  const reset = await keepEmail(MONA, 'reset_password');
  await guest.goto(`/reset-password?token=${token(reset)}`);
  await shot(guest, 'reset-password', card(guest), { pad: 32 });

  // ================================================================ the owner's first visit
  const mona = await newPage(browser);
  await signIn(mona, MONA);
  const orgId = /\/org\/([0-9a-f-]{36})/.exec(mona.url())![1]!;
  await expect(mona.getByRole('heading', { name: L('picker.onboardTitle') })).toBeVisible();
  await shot(mona, 'picker-first-visit');
  await mona.getByRole('button', { name: L('scopes.createFirst') }).first().click();
  await dialog(mona).getByLabel(field('scopes.name')).fill(DEMO.scope);
  await dialog(mona).getByLabel(field('scopes.description')).fill(DEMO.scopeDescription);
  await shot(mona, 'new-scope-dialog', dialog(mona));
  await dialog(mona).getByRole('button', { name: L('common.create') }).click();
  await expect(mona.locator('.scopebar select option:checked')).toContainText(DEMO.scope);

  for (const g of [1, 2, 3]) await mona.getByRole('button', { name: grade(g), exact: true }).click();
  const books = mona.locator('.mat');
  for (const i of [0, 1, 3, 7, 8, 10, 14, 15, 40, 41, 52, 53]) await books.nth(i).click();
  await expect(mona.locator('.tray .toast')).toHaveText(L('picker.saved'));
  await shot(mona, 'picker-filters', mona.locator('.controls'));

  // ================================================================ platform administrator: two-factor sign-in, verification, students
  const admin = await newPage(browser);
  const secret = authenticator.generateSecret();
  await ownerQuery(
    `INSERT INTO users (email, name, password_hash, email_verified_at, is_platform_admin, mfa_enabled, mfa_secret_enc, locale) VALUES ($1, $2, $3, now(), true, true, $4, $5)`,
    [ADMIN, DEMO.support, await hashPassword(PASSWORD), encryptSecret(E2E_ENV.DATA_ENCRYPTION_KEY!, secret), LANG],
  );
  await signIn(admin, ADMIN);
  await expect(admin.getByRole('heading', { name: L('mfa.title') })).toBeVisible();
  await shot(admin, 'two-factor-sign-in', card(admin), { pad: 32 });
  await admin.getByLabel(field('mfa.code')).fill(authenticator.generate(secret));
  await admin.getByRole('button', { name: L('mfa.verify') }).click();
  await admin.waitForURL((u) => !u.pathname.startsWith('/mfa'));

  await admin.goto('/admin/catalog');
  await admin.getByRole('link', { name: /^2026\/2027/ }).first().click();
  await admin.waitForURL(/\/admin\/catalog\/[0-9a-f-]{36}$/);
  // The first grade, Primary 1 ("Primary 1 — 13 subjects").
  await admin.locator('details > summary', { hasText: ' — ' }).first().click();
  await admin.getByRole('button', { name: L('verify.set') }).first().click();
  await dialog(admin).getByLabel(field('verify.status')).selectOption('verified');
  await dialog(admin).getByLabel(field('verify.source')).fill(DEMO.decree);
  await dialog(admin).getByLabel(field('verify.url')).fill('https://moe.gov.eg/decrees/123');
  await shot(admin, 'admin-verification-dialog', dialog(admin));
  await dialog(admin).getByRole('button', { name: L('common.save') }).click();
  await expect(admin.locator('#toasts')).toContainText(L('verify.applied'));
  await shot(admin, 'admin-catalogue-editor');

  await admin.goto(`/admin/orgs/${orgId}`);
  await admin.getByLabel(field('admin.overrideStudents')).fill('300');
  await admin.getByRole('button', { name: L('admin.applyPlan') }).click();
  await expect(admin.getByText(L('common.saved'))).toBeVisible();

  // ================================================================ the picker, with a verified subject
  await mona.goto(`/org/${orgId}`);
  await mona.getByRole('button', { name: grade(1), exact: true }).click();
  await mona.locator('.verif.ok summary').first().click();
  await scrollTo(mona, mona.locator('section.grade').first());
  await shot(mona, 'picker-books');
  await mona.getByRole('button', { name: L('picker.viewList') }).click();
  await shot(mona, 'picker-tray', mona.locator('.tray'));
  await mona.getByRole('button', { name: L('picker.hideList') }).click();

  // ================================================================ members and invitations
  await mona.goto(`/org/${orgId}/members`);
  await mona.getByLabel(field('auth.email')).fill(KARIM);
  await mona.getByLabel(field('members.role')).selectOption('editor');
  await mona.getByRole('button', { name: L('members.invite') }).click();
  await expect(mona.getByText(L('members.invited', { email: KARIM }))).toBeVisible();
  await mona.getByLabel(field('auth.email')).fill(SALMA);
  await mona.getByLabel(field('members.role')).selectOption('viewer');
  await mona.getByRole('button', { name: L('members.invite') }).click();
  await expect(mona.getByText(L('members.invited', { email: SALMA }))).toBeVisible();

  const karim = await newPage(browser);
  const invite = await keepEmail(KARIM, 'invitation');
  await karim.goto(`/invite?token=${token(invite)}`);
  await expect(karim.getByText(L('invite.summary', { inviter: DEMO.mona, org: DEMO.school, role: L('role.editor') }))).toBeVisible();
  await karim.getByLabel(field('auth.name')).fill(DEMO.karim);
  await karim.getByLabel(field('auth.password')).fill(PASSWORD);
  await shot(karim, 'invitation', card(karim), { pad: 32 });
  await karim.getByRole('button', { name: L('invite.createAndJoin') }).click();
  await expect(karim.locator('.picker h1')).toBeVisible();

  await mona.reload();
  await expect(mona.getByText(DEMO.karim)).toBeVisible();
  await shot(mona, 'members');

  const salma = await newPage(browser);
  await salma.goto(`/invite?token=${token(await latestEmailText(SALMA, 'invitation'))}`);
  await salma.getByLabel(field('auth.name')).fill(DEMO.salma);
  await salma.getByLabel(field('auth.password')).fill(PASSWORD);
  await salma.getByRole('button', { name: L('invite.createAndJoin') }).click();
  await expect(salma.locator('.picker h1')).toBeVisible();
  await salma.getByRole('button', { name: grade(1), exact: true }).click();
  await expect(salma.locator('section.grade').first()).toBeVisible();
  // A viewer's click is refused with a message. The click goes to the book itself: a sticky bar may cover it.
  await salma.locator('.mat[aria-pressed="false"]').first().dispatchEvent('click');
  await expect(salma.locator('#toasts')).toContainText(L('picker.viewerReadOnly'));
  await scrollTo(salma, salma.locator('section.grade').first());
  await shot(salma, 'picker-viewer', undefined, { keepToasts: true });

  // ================================================================ notes, assignees, status and due dates
  await mona.goto(`/org/${orgId}`);
  await mona.locator('.scopebar').getByRole('link', { name: L('items.link') }).click();
  await expect(mona.getByRole('heading', { name: L('items.title'), level: 1 })).toBeVisible();
  const edit = mona.getByRole('button', { name: like('items.editFor') });
  await edit.nth(0).click();
  await dialog(mona).getByLabel(field('items.note')).fill(DEMO.note1);
  await dialog(mona).getByLabel(field('items.assignee')).selectOption({ label: DEMO.karim });
  await dialog(mona).getByLabel(field('items.statusLabel')).selectOption({ label: L('items.status.todo') });
  await dialog(mona).getByLabel(field('items.dueLabel')).fill(day(1));
  await shot(mona, 'note-dialog', dialog(mona));
  await dialog(mona).getByRole('button', { name: L('common.save') }).click();
  await expect(dialog(mona)).toHaveCount(0);
  await edit.nth(1).click();
  await dialog(mona).getByLabel(field('items.assignee')).selectOption({ label: DEMO.karim });
  await dialog(mona).getByLabel(field('items.statusLabel')).selectOption({ label: L('items.status.in_progress') });
  await dialog(mona).getByLabel(field('items.dueLabel')).fill(day(-7));
  await dialog(mona).getByRole('button', { name: L('common.save') }).click();
  await expect(dialog(mona)).toHaveCount(0);
  await edit.nth(3).click();
  await dialog(mona).getByLabel(field('items.note')).fill(DEMO.note2);
  await dialog(mona).getByRole('button', { name: L('common.save') }).click();
  await expect(dialog(mona)).toHaveCount(0);
  await edit.nth(4).click();
  await dialog(mona).getByLabel(field('items.assignee')).selectOption({ label: DEMO.mona });
  await dialog(mona).getByLabel(field('items.statusLabel')).selectOption({ label: L('items.status.done') });
  await dialog(mona).getByRole('button', { name: L('common.save') }).click();
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
  await expect(dialog(karim).locator('li').first()).toBeVisible();
  await shot(karim, 'notifications', dialog(karim));
  await karim.keyboard.press('Escape');
  await karim.locator('.topbar').getByRole('link', { name: startsWith('nav.assignments') }).click();
  await expect(karim.getByRole('heading', { name: L('assignments.title'), level: 1 })).toBeVisible();
  await shot(karim, 'my-assignments');
  const cairoMorning = new Date(Date.now());
  cairoMorning.setUTCHours(8, 30, 0, 0); // 10:30 or 11:30 in Cairo, inside the reminder window
  await runReminderPass(cairoMorning);
  await keepEmail(KARIM, 'items_due');

  // A second organization for Karim, so My assignments in all organizations has two.
  await mona.goto('/account?new-org=1');
  await mona.locator('#new-org').getByLabel(field('auth.orgName')).fill(DEMO.summerOrg);
  await mona.getByRole('button', { name: L('account.createOrg') }).click();
  await mona.waitForURL(/\/org\/[0-9a-f-]{36}$/);
  const summerId = /\/org\/([0-9a-f-]{36})/.exec(mona.url())![1]!;
  await ownerQuery(`INSERT INTO memberships (org_id, user_id, role) SELECT $1, id, 'editor' FROM users WHERE email = $2`, [summerId, KARIM]);
  await mona.getByRole('button', { name: L('scopes.createFirst') }).first().click();
  await dialog(mona).getByLabel(field('scopes.name')).fill(DEMO.summerScope);
  await dialog(mona).getByRole('button', { name: L('common.create') }).click();
  await mona.getByRole('button', { name: grade(4), exact: true }).click();
  await mona.locator('.mat').nth(1).click();
  await expect(mona.locator('.tray .toast')).toHaveText(L('picker.saved'));
  await mona.locator('.scopebar').getByRole('link', { name: L('items.link') }).click();
  await mona.getByRole('button', { name: like('items.editFor') }).first().click();
  await dialog(mona).getByLabel(field('items.assignee')).selectOption({ label: DEMO.karim });
  await dialog(mona).getByLabel(field('items.dueLabel')).fill(day(10));
  await dialog(mona).getByRole('button', { name: L('common.save') }).click();
  await expect(dialog(mona)).toHaveCount(0);
  await karim.goto('/assignments');
  await expect(karim.getByRole('heading', { name: L('assignments.allTitle') })).toBeVisible();
  await shot(karim, 'my-assignments-all');
  await shot(mona, 'organization-switcher', mona.locator('.topbar'));

  // ================================================================ scopes, duplicate, compare
  await mona.goto(`/org/${orgId}/scopes`);
  await mona.getByRole('button', { name: L('scopes.duplicate') }).first().click();
  await dialog(mona).getByRole('textbox').fill(DEMO.campusB);
  await dialog(mona).getByRole('button', { name: L('common.confirm') }).click();
  // The copy opens in the picker; Campus B swaps a few books.
  await mona.waitForURL(/\?scope=/);
  const campusB = new URL(mona.url()).searchParams.get('scope')!;
  await expect(mona.locator('.scopebar select option:checked')).toContainText(DEMO.campusB);
  await mona.getByRole('button', { name: grade(1), exact: true }).click();
  for (const i of [3, 5, 6]) await mona.locator('.mat').nth(i).click();
  await expect(mona.locator('.tray .toast')).toHaveText(L('picker.saved'));
  await mona.goto(`/org/${orgId}/scopes`);
  await shot(mona, 'scopes');
  await mona.getByRole('link', { name: L('compare.action') }).click();
  await expect(mona.getByRole('heading', { name: L('compare.title'), level: 1 })).toBeVisible();
  await shot(mona, 'compare');

  // ================================================================ a new academic year: admin prepares and publishes 2027/2028
  await admin.goto('/admin/catalog');
  await admin.getByLabel(field('admin.academicYear')).fill('2027/2028');
  await admin.getByLabel(field('admin.label')).fill(DEMO.nextLabel);
  await shot(admin, 'admin-catalogue-versions');
  await admin.getByRole('button', { name: L('admin.createDraft') }).click();
  await admin.waitForURL(/\/admin\/catalog\/[0-9a-f-]{36}$/);
  const nextId = /catalog\/([0-9a-f-]{36})/.exec(admin.url())![1]!;
  // One of the school's books is dropped from the new year.
  const chosen = await ownerQuery(
    `SELECT m.id, m.title FROM scope_items i JOIN scopes s ON s.id = i.scope_id JOIN catalog_materials m ON m.id = i.material_id
     WHERE s.org_id = $1 AND s.name = $2 ORDER BY m.sort_order, m.title`,
    [orgId, DEMO.scope],
  );
  const sameIn = (alias: string) => `ns.version_id = $1 AND ns.grade = os.grade AND ns.track = os.track AND ns.block = os.block AND ns.code = os.code AND ${alias}.title = om.title`;
  await ownerQuery(`DELETE FROM catalog_materials nm USING catalog_subjects ns, catalog_materials om, catalog_subjects os WHERE om.id = $2 AND os.id = om.subject_id AND nm.subject_id = ns.id AND ${sameIn('nm')}`, [nextId, chosen[2].id]);
  // The spreadsheet route: mark three Primary 1 books verified in the draft, preview, apply.
  const sheet = await admin.request.get(`/api/admin/catalog/versions/${nextId}/sheet`);
  const records = parseCsv(await sheet.text()).map((r) => r.map(unguardCell));
  const col = (c: string) => records[0]!.indexOf(c);
  for (const r of records.filter((x) => x[col('row_type')] === 'material' && x[col('grade')] === '1').slice(0, 3)) {
    r[col('verification_status')] = 'verified';
    r[col('verification_source')] = DEMO.publisherSource;
  }
  await admin.reload();
  await admin.locator('input[type="file"]').setInputFiles({ name: 'catalogue-2027-2028.csv', mimeType: 'text/csv', buffer: Buffer.from(toCsv(records)) });
  await expect(dialog(admin).getByRole('heading', { name: L('sheet.previewTitle') })).toBeVisible();
  await shot(admin, 'admin-spreadsheet-preview', dialog(admin));
  await dialog(admin).getByRole('button', { name: like('sheet.apply') }).click();
  await admin.goto('/admin/catalog');
  await admin.getByRole('button', { name: L('admin.publish') }).click();
  await shot(admin, 'admin-publish-dialog', dialog(admin));
  await dialog(admin).getByRole('button', { name: L('common.confirm') }).click();
  await expect(admin.getByRole('button', { name: L('admin.publish') })).toHaveCount(0);
  await keepEmail(MONA, 'catalog_published');

  // ================================================================ carry forward
  await mona.goto(`/org/${orgId}`);
  await expect(mona.locator('.carry-banner')).toContainText(L('carry.banner', { year: '2027/2028' }));
  await shot(mona, 'carry-banner', mona.locator('.picker > header'));
  await mona.locator('.topbar button.iconbtn', { hasText: '🔔' }).click();
  await shot(mona, 'notifications-catalogue', dialog(mona));
  await mona.keyboard.press('Escape');
  await mona.locator('.carry-banner').getByRole('link', { name: L('carry.bannerLink') }).click();
  await expect(mona.getByRole('heading', { name: like('carry.title') })).toBeVisible();
  await shot(mona, 'carry-review');
  await mona.getByRole('button', { name: L('carry.submit') }).click();
  await mona.waitForURL(/\/org\/[0-9a-f-]{36}\?scope=/);
  await expect(mona.locator('.eyebrow')).toContainText('2027/2028');

  // ================================================================ billing
  await mona.goto(`/org/${orgId}/billing`);
  await expect(mona.getByRole('heading', { name: L('billing.title'), level: 1 })).toBeVisible();
  await shot(mona, 'billing', undefined, { fullPage: true });
  await mona.locator('.plan', { has: mona.getByRole('heading', { name: 'Professional' }) }).getByRole('button', { name: L('billing.subscribe') }).click();
  await expect(mona.getByRole('heading', { name: L('sandbox.title') })).toBeVisible();
  await shot(mona, 'checkout', card(mona), { pad: 32 });
  await payInSandbox(mona);
  await keepEmail(MONA, 'payment_succeeded');
  await mona.goto(`/org/${orgId}/billing`);
  await expect(mona.getByText(like('billing.state.renews', true))).toBeVisible();
  await shot(mona, 'billing-subscribed', undefined, { fullPage: true });

  // ================================================================ students
  await mona.goto(`/org/${orgId}/students`);
  await expect(mona.getByRole('heading', { name: L('students.title'), level: 1 })).toBeVisible();
  const schoolCode = (await mona.locator('.code-big').textContent())!.trim();
  await mona.getByRole('button', { name: L('students.add') }).click();
  await dialog(mona).getByLabel(field('students.username')).fill('omar.khaled');
  await dialog(mona).getByLabel(field('students.name')).fill(DEMO.omar);
  await dialog(mona).getByLabel(field('picker.grade')).selectOption('1');
  await dialog(mona).getByLabel(field('students.curriculum')).selectOption({ label: `${DEMO.scope} (2026/2027)` });
  await shot(mona, 'student-add-dialog', dialog(mona));
  await dialog(mona).getByRole('button', { name: L('students.add') }).click();
  await expect(dialog(mona)).toContainText(L('students.passwordsTitle'));
  await shot(mona, 'student-passwords', dialog(mona));
  const omarPassword = (await dialog(mona).locator('.cred').textContent())!.trim();
  await dialog(mona).getByRole('button', { name: L('common.done') }).click();
  await mona.getByRole('button', { name: L('students.import') }).click();
  const roster = (rows: string) => ({ name: 'grade-2-roster.csv', mimeType: 'text/csv', buffer: Buffer.from(`username,name,grade,scope\n${rows}`) });
  const rows = (nour: string) => `laila.mostafa,${DEMO.laila},2,${DEMO.scope}\nyoussef.ali,${DEMO.youssef},2,${DEMO.scope}\n${nour},${DEMO.nour},2,\n`;
  const problems = dialog(mona).getByText(like('students.importErrors', true));
  await dialog(mona).getByLabel(field('students.chooseFile')).setInputFiles(roster(rows('nour ahmed')));
  await expect(problems).toBeVisible();
  await shot(mona, 'student-import', dialog(mona));
  await dialog(mona).getByLabel(field('students.chooseFile')).setInputFiles(roster(rows('nour.ahmed')));
  await expect(problems).toHaveCount(0);
  await dialog(mona).getByRole('button', { name: L('students.importApply'), exact: true }).click();
  await expect(dialog(mona)).toContainText(L('students.passwordsTitle'));
  await dialog(mona).getByRole('button', { name: L('common.done') }).click();
  await shot(mona, 'students');

  const student = await newPage(browser);
  await student.goto(`/student-login?school=${schoolCode}`);
  await student.getByLabel(field('student.username')).fill('omar.khaled');
  await student.getByLabel(field('auth.password')).fill(omarPassword);
  await shot(student, 'student-sign-in', card(student), { pad: 32 });
  await student.getByRole('button', { name: L('auth.signIn') }).click();
  await student.waitForURL(/\/student$/);
  // The portal opens on Today (homework); the curriculum is under My books.
  await student.locator('.topbar').getByRole('link', { name: L('portal.books') }).click();
  await expect(student.locator('.subj .mat.book').first()).toBeVisible();
  await shot(student, 'student-portal');
  await student.locator('.topbar').getByRole('button', { name: switchLabel(OTHER), exact: true }).click();
  await expect(student.locator('html')).toHaveAttribute('dir', OTHER === 'ar' ? 'rtl' : 'ltr');
  await shot(student, `student-portal-${OTHER === 'ar' ? 'arabic' : 'english'}`);

  // ================================================================ settings: organization, API keys, webhooks, support access
  await mona.goto(`/org/${orgId}/settings`);
  await expect(mona.getByRole('heading', { name: L('settings.title'), level: 1 })).toBeVisible();
  await shot(mona, 'settings');
  await mona.getByLabel(field('apikeys.name')).fill(DEMO.keyName);
  await mona.getByRole('button', { name: L('apikeys.create') }).click();
  await expect(dialog(mona)).toContainText(L('apikeys.created'));
  await shot(mona, 'api-key-created', dialog(mona));
  await dialog(mona).getByRole('button', { name: L('common.done') }).click();
  // The page redraws with the new key; wait for it before typing into the webhook form.
  await expect(mona.locator('#main table.data b', { hasText: DEMO.keyName })).toBeVisible();
  await settle(mona);
  await mona.getByLabel(field('webhooks.url')).fill(hookUrl);
  await mona.getByLabel(field('webhooks.description')).fill(DEMO.hookDescription);
  await mona.getByRole('button', { name: L('webhooks.add') }).click();
  await expect(dialog(mona).getByRole('heading', { name: L('webhooks.created') })).toBeVisible();
  await shot(mona, 'webhook-secret', dialog(mona));
  await dialog(mona).getByRole('button', { name: L('common.done') }).click();
  await settle(mona);
  await mona.getByRole('button', { name: L('webhooks.testFor', { url: hookUrl }) }).click();
  await expect(mona.locator('#toasts').getByText(like('webhooks.testOk'))).toBeVisible();
  await mona.goto(`/org/${orgId}?scope=${campusB}`);
  await mona.getByRole('button', { name: grade(2), exact: true }).click();
  await mona.locator('.mat[aria-pressed="false"]').first().click();
  await expect(mona.locator('.tray .toast')).toHaveText(L('picker.saved'));
  await runWebhookPass();
  expect(received.length).toBeGreaterThanOrEqual(2);
  await mona.goto(`/org/${orgId}/settings`);
  await scrollTo(mona, mona.locator('#webhooks'));
  await shot(mona, 'settings-webhooks');
  await mona.getByRole('button', { name: L('webhooks.deliveriesFor', { url: hookUrl }) }).click();
  await shot(mona, 'webhook-deliveries', dialog(mona));
  await dialog(mona).getByRole('button', { name: L('common.close') }).click();
  await mona.getByLabel(field('support.reason')).fill(DEMO.supportReason);
  await mona.getByRole('button', { name: L('support.grant') }).click();
  await expect(mona.getByText(L('support.granted'))).toBeVisible();
  await scrollTo(mona, mona.getByRole('heading', { name: L('support.title') }));
  await shot(mona, 'settings-support');

  // ================================================================ audit log, account
  await mona.goto(`/org/${orgId}/audit`);
  await shot(mona, 'audit-log');
  await mona.goto('/account');
  await expect(mona.getByRole('heading', { name: L('account.title'), level: 1 })).toBeVisible();
  await shot(mona, 'account');
  await mona.getByRole('button', { name: L('mfa.setup') }).click();
  await expect(mona.getByRole('img', { name: L('mfa.qrAlt') })).toBeVisible();
  await scrollTo(mona, mona.getByRole('img', { name: L('mfa.qrAlt') }), 160);
  await shot(mona, 'account-two-factor');

  // ================================================================ the other language, and a phone
  const otherName = OTHER === 'ar' ? 'arabic' : 'english';
  await mona.goto(`/org/${orgId}?scope=${campusB}`);
  await mona.locator('.topbar').getByRole('button', { name: switchLabel(OTHER), exact: true }).click();
  await expect(mona.locator('html')).toHaveAttribute('dir', OTHER === 'ar' ? 'rtl' : 'ltr');
  await mona.getByRole('button', { name: grade(1, OTHER) }).first().click().catch(() => {});
  await shot(mona, `picker-${otherName}`);
  await mona.goto(`/org/${orgId}/scopes`);
  await expect(mona.getByRole('heading', { name: LO('scopes.title'), level: 1 })).toBeVisible();
  await shot(mona, `scopes-${otherName}`);
  await mona.locator('.topbar').getByRole('button', { name: switchLabel(LANG), exact: true }).click();
  await expect(mona.locator('html')).toHaveAttribute('dir', LANG === 'ar' ? 'rtl' : 'ltr');

  const phone = await newPage(browser, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await signIn(phone, MONA);
  await phone.goto(`/org/${orgId}?scope=${campusB}`);
  await expect(phone.locator('.mat').first()).toBeVisible();
  await phone.getByRole('button', { name: grade(1), exact: true }).click();
  await scrollTo(phone, phone.locator('section.grade').first());
  await shot(phone, 'picker-phone');

  // ================================================================ platform administration
  await admin.goto('/admin');
  await expect(admin.getByRole('heading', { name: L('admin.overview') })).toBeVisible();
  await shot(admin, 'admin-overview');
  await admin.goto('/admin/orgs');
  await shot(admin, 'admin-organizations');
  await admin.goto(`/admin/orgs/${orgId}`);
  await expect(admin.getByText(like('admin.grantActive', true))).toBeVisible();
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
