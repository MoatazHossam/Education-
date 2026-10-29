import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { authenticator } from 'otplib';
import { hashPassword } from '../../../../src/auth/password.js';
import { encryptSecret } from '../../../../src/lib/crypto.js';
import { parseCsv, toCsv, unguardCell } from '../../../../src/lib/csv.js';
import { PASSWORD, token } from '../../../../tests/e2e/helpers.js';
import { E2E_ENV, latestEmailText, ownerQuery, runFileCheckPass, runReminderPass, runWebhookPass } from '../../../../tests/e2e/server.js';
import { blur, Shots, type Recorder } from './recorder.js';

// Records the product demonstrations of the showcase video from the real application, in its Arabic
// interface, on a fresh test database (`npm run capture` in video-project). It follows the journey of
// docs/USER_GUIDE.ar.md's demo school, built through the interface as its people would, and records
// each step as real screenshots with the place of every click (recorder.ts). All names, schools and
// addresses are invented; one-time passwords, keys and the two-factor QR code are blurred.

const OUT = fileURLToPath(new URL('../../recordings/', import.meta.url));
const shots = new Shots(OUT);

// ---------------------------------------------------------------- the interface's words (Arabic)
type Dict = Record<string, string>;
let dicts: Record<'en' | 'ar', Dict>;
test.beforeAll(async () => {
  dicts = ((await import(new URL('../../../../public/js/i18n.js', import.meta.url).href)) as { _dicts: Record<'en' | 'ar', Dict> })._dicts;
});
function word(lang: 'en' | 'ar', key: string, params: Record<string, string | number> = {}) {
  const s = dicts[lang][key];
  if (s === undefined) throw new Error(`No "${key}" in the ${lang} dictionary`);
  return s.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`));
}
const L = (key: string, params?: Record<string, string | number>) => word('ar', key, params);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function like(key: string, partial = false) {
  const body = dicts.ar[key]!.split(/\{\w+\}/).map(escapeRe).join('.+');
  return new RegExp(partial ? body : `^${body}$`);
}
const startsWith = (key: string) => new RegExp(`^${escapeRe(L(key))}`);
const field = (key: string) => new RegExp(`^${escapeRe(L(key))}`);
const grade = (n: number, lang: 'en' | 'ar' = 'ar') => `${word(lang, 'picker.grade')} ${n}`;
const fmt = (n: number) => new Intl.NumberFormat('ar-EG').format(n);

const DEMO = {
  school: 'مدرسة وادي النيل للغات', mona: 'منى حسن', karim: 'كريم عادل', salma: 'سلمى فتحي', support: 'دعم مِداد',
  scope: 'الكتب الأساسية للصفوف 1–3', scopeDescription: 'العربي والإنجليزي والرياضيات والعلوم لمنصة المرحلة الابتدائية الأولى.',
  campusB: 'الكتب الأساسية للصفوف 1–3 — الفرع ب', summerOrg: 'برنامج وادي النيل الصيفي', summerScope: 'قراءات صيف 2027',
  note1: 'اطلب 120 نسخة قبل سبتمبر، وراجع الغلاف الجديد.', note2: 'في انتظار طبعة 2027 من الناشر.',
  decree: 'القرار الوزاري 123/2026', publisherSource: 'كتالوج الناشر 2027', nextLabel: 'مناهج مصر من الروضة حتى الثانوي — العام الدراسي 2027/2028',
  keyName: 'خط إنتاج المحتوى', hookDescription: 'منصة الدروس: مزامنة الكتب المختارة', supportReason: 'تذكرة 2041: تصدير الصف الثاني يبدو خاطئًا',
  omar: 'عمر خالد', laila: 'ليلى مصطفى', youssef: 'يوسف علي', nour: 'نور أحمد', hana: 'هنا سمير', adam: 'آدم طارق',
  className: 'الأول أ', hwTitle: 'اقرأ قصة «البذرة الصغيرة»', hwInstructions: 'اقرأ الصفحات من 12 إلى 15 وأجب عن الأسئلة الثلاثة في آخرها.',
  omarAnswer: '1) بذرة. 2) الماء والشمس. 3) صارت شجرة.', hwFeedback: 'أحسنت. اكتب جملًا كاملة في المرة القادمة.',
  testTitle: 'اختبار الوحدة الثانية', q1: 'ما أول حرف في الحروف الهجائية؟', q2: 'ما عكس كلمة «كبير»؟', q3: 'اكتب جملتين عن أسرتك.',
  omarQ3: 'أسرتي خمسة أفراد. نسكن في الجيزة.', hanaQ3: 'لي أخ واحد. عمره سبع سنوات.', testFeedback: 'جمل جيدة. في المرة القادمة اذكر عمل كل فرد.',
};
const MONA = 'mona.hassan@nilevalley.example';
const KARIM = 'karim.adel@nilevalley.example';
const SALMA = 'salma.fathy@nilevalley.example';
const ADMIN = 'support@midad.example';
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

// Desktop windows are 1440 × 810 (16:9) at 2.5 device pixels per CSS pixel (3600 × 2025 frames);
// phones are 390 × 844 at 3.
const DESKTOP = { viewport: { width: 1440, height: 810 }, deviceScaleFactor: 2.5 };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };

const dialog = (page: Page) => page.getByRole('dialog');

async function newPage(browser: Browser, opts: Parameters<Browser['newContext']>[0] = DESKTOP) {
  const ctx = await browser.newContext({ locale: 'ar-EG', timezoneId: 'Africa/Cairo', colorScheme: 'light', ...opts });
  return ctx.newPage();
}

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel(field('auth.email')).fill(email);
  await page.getByLabel(field('auth.password')).fill(PASSWORD);
  await page.getByRole('button', { name: L('auth.signIn') }).click();
  await page.waitForURL(/\/(org\/|mfa|account)/);
}

async function studentSignIn(page: Page, school: string, username: string, password: string) {
  await page.goto(`/student-login?school=${school}`);
  await page.getByLabel(field('student.username')).fill(username);
  await page.getByLabel(field('auth.password')).fill(password);
  await page.getByRole('button', { name: L('auth.signIn') }).click();
  await page.waitForURL(/\/student$/);
}

/** A phone photo of a notebook page with Omar's answer (invented), drawn in the browser. */
async function notebookPhoto(browser: Browser) {
  const page = await newPage(browser, { viewport: { width: 600, height: 800 }, deviceScaleFactor: 2 });
  await page.setContent(`<!doctype html><html dir="rtl"><body style="margin:0;background:#8a8478">
    <div style="position:absolute;inset:34px 30px;background:repeating-linear-gradient(#fbf8ef 0 37px,#9db7d8 37px 38px);
      transform:rotate(-1.6deg);box-shadow:0 18px 40px rgba(0,0,0,.35);border-radius:4px;font:300 27px/38px 'Readex Pro',sans-serif;color:#1d2a52;padding:64px 54px 0 40px">
      <div style="position:absolute;top:0;bottom:0;right:44px;width:2px;background:#d77a72"></div>
      <div style="padding-top:2px">قصة «البذرة الصغيرة»</div><div>١) بذرة.</div><div>٢) الماء والشمس.</div><div>٣) صارت شجرة كبيرة.</div><div style="margin-top:38px">عمر خالد — الأول أ</div>
    </div><div style="position:absolute;inset:0;background:radial-gradient(ellipse at 30% 20%,rgba(255,240,210,.25),rgba(0,0,0,.18))"></div></body></html>`);
  const buffer = await page.screenshot({ type: 'jpeg', quality: 88 });
  await page.context().close();
  return buffer;
}

test('showcase recordings', async ({ browser }) => {
  test.setTimeout(1_800_000);
  const receiver = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => res.writeHead(200).end('ok'));
  });
  // The school's lesson platform, played by a local receiver under a demo name (/etc/hosts maps it to 127.0.0.1).
  await new Promise<void>((r) => receiver.listen(80, '127.0.0.1', r));
  const hookUrl = 'http://lessons.nilevalley.example/curriculum-sync';
  let r: Recorder;

  // ================================================================ the original artifact, for the origin story
  const legacy = await newPage(browser);
  await legacy.goto(new URL('../../../../legacy/egypt-curriculum-picker.html', import.meta.url).href);
  r = await shots.start(legacy, 'legacy');
  await r.scroll(500);
  await legacy.context().close();

  // ================================================================ signed out: pricing, register, confirm
  const guest = await newPage(browser);
  await guest.goto('/pricing');
  await expect(guest.getByRole('heading', { name: L('pricing.title') })).toBeVisible();
  r = await shots.start(guest, 'pricing');
  await r.scroll(9999);

  await guest.goto('/register');
  r = await shots.start(guest, 'register');
  await r.type(guest.getByLabel(field('auth.name')), DEMO.mona, 'name', 3);
  await r.type(guest.getByLabel(field('auth.email')), MONA, 'email', 5);
  await r.type(guest.getByLabel(field('auth.password')), PASSWORD, 'password', 4);
  await r.type(guest.getByLabel(field('auth.orgName')), DEMO.school, 'school', 4);
  await r.click(guest.getByRole('button', { name: L('auth.createAccount') }), 'check email', () => expect(guest.getByText(L('auth.checkEmail', { email: MONA }))).toBeVisible());
  const verify = await latestEmailText(MONA, 'verify_email');
  await guest.goto(`/verify-email?token=${token(verify)}`);
  await expect(guest.getByText(L('auth.verified'))).toBeVisible();
  await shots.start(guest, 'email-confirmed');

  // ================================================================ the owner's first visit
  const mona = await newPage(browser);
  await mona.goto('/login');
  r = await shots.start(mona, 'sign-in');
  await r.type(mona.getByLabel(field('auth.email')), MONA, 'email', 5);
  await r.type(mona.getByLabel(field('auth.password')), PASSWORD, 'password', 3);
  await r.click(mona.getByRole('button', { name: L('auth.signIn') }), 'picker', () => expect(mona.getByRole('heading', { name: L('picker.onboardTitle') })).toBeVisible());
  const orgId = /\/org\/([0-9a-f-]{36})/.exec(mona.url())![1]!;

  r = await shots.start(mona, 'first-scope');
  await r.click(mona.getByRole('button', { name: L('scopes.createFirst') }).first(), 'dialog');
  await r.type(dialog(mona).getByLabel(field('scopes.name')), DEMO.scope, 'name', 4);
  await r.type(dialog(mona).getByLabel(field('scopes.description')), DEMO.scopeDescription, 'description', 6);
  await r.click(dialog(mona).getByRole('button', { name: L('common.create') }), 'created', () => expect(mona.locator('.scopebar select option:checked')).toContainText(DEMO.scope));

  r = await shots.start(mona, 'pick-books');
  for (const g of [1, 2, 3]) await r.click(mona.getByRole('button', { name: grade(g), exact: true }), `grade ${g}`);
  const books = mona.locator('.mat');
  for (const i of [0, 1, 3, 7, 8]) await r.click(books.nth(i), 'book');
  for (const i of [10, 14, 15, 40, 41, 52, 53]) await books.nth(i).click();
  await expect(mona.locator('.mat[aria-pressed="true"]')).toHaveCount(12);
  await mona.waitForTimeout(600);
  r.dirty();
  await r.state('saved');
  await r.scroll(mona.locator('section.grade').nth(1), 'scroll');
  await mona.evaluate(() => window.scrollTo(0, 0));

  // ================================================================ platform administrator: two-factor sign-in, verification, students switch
  const admin = await newPage(browser);
  const secret = authenticator.generateSecret();
  await ownerQuery(
    `INSERT INTO users (email, name, password_hash, email_verified_at, is_platform_admin, mfa_enabled, mfa_secret_enc, locale) VALUES ($1, $2, $3, now(), true, true, $4, 'ar')`,
    [ADMIN, DEMO.support, await hashPassword(PASSWORD), encryptSecret(E2E_ENV.DATA_ENCRYPTION_KEY!, secret)],
  );
  await signIn(admin, ADMIN);
  await expect(admin.getByRole('heading', { name: L('mfa.title') })).toBeVisible();
  r = await shots.start(admin, 'admin-2fa');
  await r.type(admin.getByLabel(field('mfa.code')), authenticator.generate(secret), 'code', 3);
  await r.click(admin.getByRole('button', { name: L('mfa.verify') }), 'signed in', () => admin.waitForURL((u) => !u.pathname.startsWith('/mfa')));

  await admin.goto('/admin/catalog');
  await admin.getByRole('link', { name: /^2026\/2027/ }).first().click();
  await admin.waitForURL(/\/admin\/catalog\/[0-9a-f-]{36}$/);
  r = await shots.start(admin, 'verify-subject');
  await r.click(admin.locator('details > summary', { hasText: ' — ' }).first(), 'grade 1');
  await r.click(admin.getByRole('button', { name: L('verify.set') }).first(), 'dialog');
  await r.select(dialog(admin).getByLabel(field('verify.status')), 'verified', 'verified');
  await r.type(dialog(admin).getByLabel(field('verify.source')), DEMO.decree, 'source', 4);
  await r.type(dialog(admin).getByLabel(field('verify.url')), 'https://moe.gov.eg/decrees/123', 'url', 4);
  await r.click(dialog(admin).getByRole('button', { name: L('common.save') }), 'saved', () => expect(admin.locator('#toasts')).toContainText(L('verify.applied')));

  await admin.goto(`/admin/orgs/${orgId}`);
  await admin.getByLabel(field('admin.overrideStudents')).fill('300');
  await admin.getByRole('button', { name: L('admin.applyPlan') }).click();
  await expect(admin.getByText(L('common.saved'))).toBeVisible();

  // ================================================================ the picker: verified subject, list, filters, exports
  await mona.goto(`/org/${orgId}`);
  r = await shots.start(mona, 'picker-verified');
  await r.click(mona.getByRole('button', { name: grade(1), exact: true }), 'grade 1');
  await r.scroll(mona.locator('section.grade').first(), 'to grade');
  await r.click(mona.locator('.verif.ok summary').first(), 'verified details');
  await r.click(mona.getByRole('button', { name: L('picker.viewList') }), 'list');
  await r.scroll(mona.locator('.tray'), 'tray');
  await mona.getByRole('button', { name: L('picker.hideList') }).click();
  await mona.evaluate(() => window.scrollTo(0, 0));

  await mona.goto(`/org/${orgId}`);
  r = await shots.start(mona, 'filters');
  await r.click(mona.getByRole('button', { name: L('track.bac') }), 'bakaloria');
  await r.click(mona.getByRole('button', { name: grade(10), exact: true }), 'grade 10');
  await r.click(mona.getByRole('button', { name: L('track.intl') }), 'international');
  await r.type(mona.getByLabel(field('picker.search')), 'Cambridge', 'search', 3);
  await r.scroll(mona.locator('section.grade').first(), 'results');
  await mona.getByLabel(field('picker.search')).fill('');
  await mona.getByRole('button', { name: L('track.all') }).click();
  await mona.evaluate(() => window.scrollTo(0, 0));

  // ================================================================ members and invitations, a viewer
  await mona.goto(`/org/${orgId}/members`);
  r = await shots.start(mona, 'members-invite');
  await r.type(mona.getByLabel(field('auth.email')), KARIM, 'email', 5);
  await r.select(mona.getByLabel(field('members.role')), 'editor', 'editor');
  await r.click(mona.getByRole('button', { name: L('members.invite') }), 'invited', () => expect(mona.getByText(L('members.invited', { email: KARIM }))).toBeVisible());
  await mona.getByLabel(field('auth.email')).fill(SALMA);
  await mona.getByLabel(field('members.role')).selectOption('viewer');
  await mona.getByRole('button', { name: L('members.invite') }).click();
  await expect(mona.getByText(L('members.invited', { email: SALMA }))).toBeVisible();

  const karim = await newPage(browser);
  await karim.goto(`/invite?token=${token(await latestEmailText(KARIM, 'invitation'))}`);
  r = await shots.start(karim, 'invitation');
  await r.type(karim.getByLabel(field('auth.name')), DEMO.karim, 'name', 3);
  await r.type(karim.getByLabel(field('auth.password')), PASSWORD, 'password', 3);
  await r.click(karim.getByRole('button', { name: L('invite.createAndJoin') }), 'joined', () => expect(karim.locator('.picker h1')).toBeVisible());

  await mona.reload();
  await expect(mona.getByText(DEMO.karim)).toBeVisible();
  await shots.start(mona, 'members');

  const salma = await newPage(browser);
  await salma.goto(`/invite?token=${token(await latestEmailText(SALMA, 'invitation'))}`);
  await salma.getByLabel(field('auth.name')).fill(DEMO.salma);
  await salma.getByLabel(field('auth.password')).fill(PASSWORD);
  await salma.getByRole('button', { name: L('invite.createAndJoin') }).click();
  await expect(salma.locator('.picker h1')).toBeVisible();
  await salma.getByRole('button', { name: grade(1), exact: true }).click();
  await salma.locator('section.grade').first().evaluate((n) => window.scrollTo(0, n.getBoundingClientRect().top + window.scrollY - 220));
  r = await shots.start(salma, 'viewer');
  // The click goes to the book itself: a sticky bar may cover it.
  const viewerBook = salma.locator('.mat[aria-pressed="false"]').first();
  const vbox = await r.box(viewerBook);
  await viewerBook.dispatchEvent('click');
  await expect(salma.locator('#toasts')).toContainText(L('picker.viewerReadOnly'));
  r.data.steps.push({ kind: 'click', at: vbox, frame: await r.snap('read only', 100) });

  // From here on the background worker runs, as in production (it marks sent emails as delivered, so it
  // starts after the last email the journey reads): file checks, webhooks, reminders, its heartbeat.
  startWorker();

  // ================================================================ notes, assignees, status, due dates
  await mona.goto(`/org/${orgId}`);
  r = await shots.start(mona, 'notes');
  await r.click(mona.locator('.scopebar').getByRole('link', { name: L('items.link') }), 'notes page', () => expect(mona.getByRole('heading', { name: L('items.title'), level: 1 })).toBeVisible());
  const edit = mona.getByRole('button', { name: like('items.editFor') });
  await r.click(edit.nth(0), 'dialog');
  await r.type(dialog(mona).getByLabel(field('items.note')), DEMO.note1, 'note', 6);
  await r.select(dialog(mona).getByLabel(field('items.assignee')), { label: DEMO.karim }, 'assignee');
  await r.select(dialog(mona).getByLabel(field('items.statusLabel')), { label: L('items.status.todo') }, 'status');
  await dialog(mona).getByLabel(field('items.dueLabel')).fill(day(1));
  r.dirty();
  await r.click(dialog(mona).getByRole('button', { name: L('common.save') }), 'saved', () => expect(dialog(mona)).toHaveCount(0));
  for (const [i, fill] of [
    [1, async () => {
      await dialog(mona).getByLabel(field('items.assignee')).selectOption({ label: DEMO.karim });
      await dialog(mona).getByLabel(field('items.statusLabel')).selectOption({ label: L('items.status.in_progress') });
      await dialog(mona).getByLabel(field('items.dueLabel')).fill(day(-7));
    }],
    [3, async () => { await dialog(mona).getByLabel(field('items.note')).fill(DEMO.note2); }],
    [4, async () => {
      await dialog(mona).getByLabel(field('items.assignee')).selectOption({ label: DEMO.mona });
      await dialog(mona).getByLabel(field('items.statusLabel')).selectOption({ label: L('items.status.done') });
    }],
  ] as const) {
    await edit.nth(i).click();
    await fill();
    await dialog(mona).getByRole('button', { name: L('common.save') }).click();
    await expect(dialog(mona)).toHaveCount(0);
  }
  r.dirty();
  await r.check(mona.locator('table.items input[type="checkbox"]').nth(6), 'pick');
  await r.check(mona.locator('table.items input[type="checkbox"]').nth(7), 'pick');
  await r.focus(mona.locator('.items-bulk'), 'bulk bar');

  // Karim: the bell, My assignments, and a reminder for tomorrow's book.
  await karim.goto(`/org/${orgId}`);
  r = await shots.start(karim, 'karim-bell');
  await r.click(karim.locator('.topbar button.iconbtn', { hasText: '🔔' }), 'notifications', () => expect(dialog(karim).locator('li').first()).toBeVisible());
  await karim.keyboard.press('Escape');
  r.dirty();
  await r.click(karim.locator('.topbar').getByRole('link', { name: startsWith('nav.assignments') }), 'my assignments', () => expect(karim.getByRole('heading', { name: L('assignments.title'), level: 1 })).toBeVisible());
  const cairoMorning = new Date(Date.now());
  cairoMorning.setUTCHours(8, 30, 0, 0);
  await runReminderPass(cairoMorning);

  // A second organization: Karim's assignments in all his organizations, Mona's organization switcher.
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
  for (const i of [1, 2, 5]) await mona.locator('.mat').nth(i).click();
  await expect(mona.locator('.tray .toast')).toHaveText(L('picker.saved'));
  await mona.locator('.scopebar').getByRole('link', { name: L('items.link') }).click();
  await mona.getByRole('button', { name: like('items.editFor') }).first().click();
  await dialog(mona).getByLabel(field('items.assignee')).selectOption({ label: DEMO.karim });
  await dialog(mona).getByLabel(field('items.dueLabel')).fill(day(10));
  await dialog(mona).getByRole('button', { name: L('common.save') }).click();
  await expect(dialog(mona)).toHaveCount(0);
  await karim.goto('/assignments');
  await expect(karim.getByRole('heading', { name: L('assignments.allTitle') })).toBeVisible();
  await shots.start(karim, 'assignments-all');

  await mona.goto(`/org/${summerId}`);
  r = await shots.start(mona, 'org-switch');
  await r.select(mona.getByLabel(L('shell.switchOrg')), orgId, 'school', );
  await mona.waitForURL(new RegExp(`/org/${orgId}`));
  await r.state('school picker');

  // ================================================================ scopes: duplicate for campus B, compare
  await mona.goto(`/org/${orgId}/scopes`);
  r = await shots.start(mona, 'duplicate');
  await r.click(mona.getByRole('button', { name: L('scopes.duplicate') }).first(), 'dialog');
  await r.type(dialog(mona).getByRole('textbox'), DEMO.campusB, 'name', 4);
  await r.click(dialog(mona).getByRole('button', { name: L('common.confirm') }), 'copy', () => mona.waitForURL(/\?scope=/));
  const campusB = new URL(mona.url()).searchParams.get('scope')!;
  await expect(mona.locator('.scopebar select option:checked')).toContainText(DEMO.campusB);
  await mona.getByRole('button', { name: grade(1), exact: true }).click();
  for (const i of [3, 5, 6]) await mona.locator('.mat').nth(i).click();
  await expect(mona.locator('.tray .toast')).toHaveText(L('picker.saved'));
  await mona.goto(`/org/${orgId}/scopes`);
  r = await shots.start(mona, 'scopes');
  await r.click(mona.getByRole('link', { name: L('compare.action') }), 'compare', () => expect(mona.getByRole('heading', { name: L('compare.title'), level: 1 })).toBeVisible());
  await r.scroll(500, 'differences');

  // Exports from the picker.
  await mona.goto(`/org/${orgId}`);
  await mona.getByRole('button', { name: L('picker.viewList') }).click();
  r = await shots.start(mona, 'exports');
  await r.scroll(mona.locator('.tray'), 'tray');
  await mona.getByRole('button', { name: L('picker.hideList') }).click();

  // ================================================================ a new academic year: prepare, import a sheet, publish
  await admin.goto('/admin/catalog');
  r = await shots.start(admin, 'new-year');
  await r.type(admin.getByLabel(field('admin.academicYear')), '2027/2028', 'year', 3);
  await r.type(admin.getByLabel(field('admin.label')), DEMO.nextLabel, 'label', 5);
  await r.click(admin.getByRole('button', { name: L('admin.createDraft') }), 'draft', () => admin.waitForURL(/\/admin\/catalog\/[0-9a-f-]{36}$/));
  const nextId = /catalog\/([0-9a-f-]{36})/.exec(admin.url())![1]!;
  const chosen = await ownerQuery(
    `SELECT m.id, m.title FROM scope_items i JOIN scopes s ON s.id = i.scope_id JOIN catalog_materials m ON m.id = i.material_id
     WHERE s.org_id = $1 AND s.name = $2 ORDER BY m.sort_order, m.title`,
    [orgId, DEMO.scope],
  );
  const sameIn = (alias: string) => `ns.version_id = $1 AND ns.grade = os.grade AND ns.track = os.track AND ns.block = os.block AND ns.code = os.code AND ${alias}.title = om.title`;
  await ownerQuery(`DELETE FROM catalog_materials nm USING catalog_subjects ns, catalog_materials om, catalog_subjects os WHERE om.id = $2 AND os.id = om.subject_id AND nm.subject_id = ns.id AND ${sameIn('nm')}`, [nextId, chosen[2].id]);
  const sheet = await admin.request.get(`/api/admin/catalog/versions/${nextId}/sheet`);
  const records = parseCsv(await sheet.text()).map((row) => row.map(unguardCell));
  const col = (c: string) => records[0]!.indexOf(c);
  for (const row of records.filter((x) => x[col('row_type')] === 'material' && x[col('grade')] === '1').slice(0, 3)) {
    row[col('verification_status')] = 'verified';
    row[col('verification_source')] = DEMO.publisherSource;
  }
  await admin.reload();
  r.dirty();
  await r.state('editor');
  await admin.locator('input[type="file"]').setInputFiles({ name: 'catalogue-2027-2028.csv', mimeType: 'text/csv', buffer: Buffer.from(toCsv(records)) });
  await expect(dialog(admin).getByRole('heading', { name: L('sheet.previewTitle') })).toBeVisible();
  await r.state('sheet preview');
  await dialog(admin).getByRole('button', { name: like('sheet.apply') }).click();
  await admin.goto('/admin/catalog');
  r.dirty();
  await r.click(admin.getByRole('button', { name: L('admin.publish') }), 'publish dialog');
  await r.click(dialog(admin).getByRole('button', { name: L('common.confirm') }), 'published', () => expect(admin.getByRole('button', { name: L('admin.publish') })).toHaveCount(0));

  // ================================================================ carry forward to 2027/2028
  await mona.goto(`/org/${orgId}`);
  await expect(mona.locator('.carry-banner')).toContainText(L('carry.banner', { year: '2027/2028' }));
  r = await shots.start(mona, 'carry');
  await r.click(mona.locator('.topbar button.iconbtn', { hasText: '🔔' }), 'notification');
  await mona.keyboard.press('Escape');
  r.dirty();
  await r.click(mona.locator('.carry-banner').getByRole('link', { name: L('carry.bannerLink') }), 'review', () => expect(mona.getByRole('heading', { name: like('carry.title') })).toBeVisible());
  await r.scroll(700, 'details');
  await r.click(mona.getByRole('button', { name: L('carry.submit') }), 'carried', () => mona.waitForURL(/\/org\/[0-9a-f-]{36}\?scope=/));
  await expect(mona.locator('.eyebrow')).toContainText('2027/2028');

  // ================================================================ billing: subscribe in the sandbox
  await mona.goto(`/org/${orgId}/billing`);
  await expect(mona.getByRole('heading', { name: L('billing.title'), level: 1 })).toBeVisible();
  r = await shots.start(mona, 'billing');
  await r.scroll(mona.locator('.plan').first(), 'plans');
  await r.click(mona.locator('.plan', { has: mona.getByRole('heading', { name: 'Professional' }) }).getByRole('button', { name: L('billing.subscribe') }), 'checkout', () => expect(mona.getByRole('heading', { name: L('sandbox.title') })).toBeVisible());
  await r.click(mona.getByRole('button', { name: like('sandbox.pay') }), 'paid', () => expect(mona.getByText(L('billing.paid'))).toBeVisible({ timeout: 20_000 }));
  await mona.goto(`/org/${orgId}/billing`);
  await expect(mona.getByText(like('billing.state.renews', true))).toBeVisible();
  r.dirty();
  await r.state('subscribed');

  // ================================================================ students: add one, import a roster
  await mona.goto(`/org/${orgId}/students`);
  await expect(mona.getByRole('heading', { name: L('students.title'), level: 1 })).toBeVisible();
  const schoolCode = (await mona.locator('.code-big').textContent())!.trim();
  r = await shots.start(mona, 'student-add');
  await r.click(mona.getByRole('button', { name: L('students.add') }), 'dialog');
  await r.type(dialog(mona).getByLabel(field('students.username')), 'omar.khaled', 'username', 3);
  await r.type(dialog(mona).getByLabel(field('students.name')), DEMO.omar, 'name', 3);
  await r.select(dialog(mona).getByLabel(field('picker.grade')), '1', 'grade');
  await r.select(dialog(mona).getByLabel(field('students.curriculum')), { label: `${DEMO.scope} (2026/2027)` }, 'curriculum');
  await dialog(mona).getByRole('button', { name: L('students.add') }).click();
  await expect(dialog(mona)).toContainText(L('students.passwordsTitle'));
  const omarPassword = (await dialog(mona).locator('.cred').textContent())!.trim();
  await blur(dialog(mona).locator('.cred'));
  r.dirty();
  await r.state('one-time password (blurred)');
  await dialog(mona).getByRole('button', { name: L('common.done') }).click();

  const roster = (rows: string) => ({ name: 'grade-2-roster.csv', mimeType: 'text/csv', buffer: Buffer.from(`username,name,grade,scope\n${rows}`) });
  const rows = (nour: string) => `laila.mostafa,${DEMO.laila},2,${DEMO.scope}\nyoussef.ali,${DEMO.youssef},2,${DEMO.scope}\n${nour},${DEMO.nour},2,\n`;
  r = await shots.start(mona, 'student-import');
  await r.click(mona.getByRole('button', { name: L('students.import') }), 'dialog');
  await dialog(mona).getByLabel(field('students.chooseFile')).setInputFiles(roster(rows('nour ahmed')));
  await expect(dialog(mona).getByText(like('students.importErrors', true))).toBeVisible();
  await r.state('problems');
  await dialog(mona).getByLabel(field('students.chooseFile')).setInputFiles(roster(rows('nour.ahmed')));
  await expect(dialog(mona).getByText(like('students.importErrors', true))).toHaveCount(0);
  await r.state('fixed');
  await dialog(mona).getByRole('button', { name: L('students.importApply'), exact: true }).click();
  await expect(dialog(mona)).toContainText(L('students.passwordsTitle'));
  await blur(dialog(mona).locator('.cred'));
  await r.state('passwords (blurred)');
  await dialog(mona).getByRole('button', { name: L('common.done') }).click();
  r.dirty();
  await r.state('students');

  const passwords: Record<string, string> = {};
  for (const [username, name] of [['hana.samir', DEMO.hana], ['adam.tarek', DEMO.adam]] as const) {
    await mona.getByRole('button', { name: L('students.add') }).click();
    await dialog(mona).getByLabel(field('students.username')).fill(username);
    await dialog(mona).getByLabel(field('students.name')).fill(name);
    await dialog(mona).getByLabel(field('picker.grade')).selectOption('1');
    await dialog(mona).getByLabel(field('students.curriculum')).selectOption({ label: `${DEMO.scope} (2026/2027)` });
    await dialog(mona).getByRole('button', { name: L('students.add') }).click();
    await expect(dialog(mona)).toContainText(L('students.passwordsTitle'));
    passwords[username] = (await dialog(mona).locator('.cred').textContent())!.trim();
    await dialog(mona).getByRole('button', { name: L('common.done') }).click();
  }
  const [arabic] = await ownerQuery(
    `SELECT DISTINCT s.name_ar, s.sort_order FROM scope_items si JOIN scopes sc ON sc.id = si.scope_id JOIN catalog_materials m ON m.id = si.material_id
     JOIN catalog_subjects s ON s.id = m.subject_id WHERE sc.org_id = $1 AND sc.name = $2 AND s.grade = 1 AND s.name_en = 'Arabic Language' ORDER BY s.sort_order`,
    [orgId, DEMO.scope],
  );

  // ================================================================ a class with its students and teacher
  await mona.goto(`/org/${orgId}/classes`);
  await expect(mona.getByRole('heading', { name: L('classes.title'), level: 1 })).toBeVisible();
  r = await shots.start(mona, 'class-create');
  await r.click(mona.getByRole('button', { name: L('classes.new') }), 'dialog');
  await r.type(dialog(mona).getByLabel(field('classes.name')), DEMO.className, 'name', 2);
  await r.select(dialog(mona).getByLabel(field('picker.grade')), '1', 'grade');
  await r.select(dialog(mona).getByLabel(field('classes.curriculum')), { label: `${DEMO.scope} (2026/2027)` }, 'curriculum');
  await r.click(dialog(mona).getByRole('button', { name: L('classes.create') }), 'class', () => expect(mona.getByRole('heading', { name: DEMO.className, level: 1 })).toBeVisible());
  const classPath = new URL(mona.url()).pathname;
  await r.click(mona.getByRole('button', { name: L('classes.chooseStudentsBtn') }), 'choose students');
  for (const name of [DEMO.omar, DEMO.hana, DEMO.adam]) await r.check(dialog(mona).getByLabel(name), name);
  await r.click(dialog(mona).getByRole('button', { name: L('common.save') }), 'students', () => expect(mona.getByRole('heading', { name: L('classes.studentsCount', { n: 3 }) })).toBeVisible());
  await r.click(mona.getByRole('button', { name: L('classes.addTeacher') }), 'teacher dialog');
  await r.select(dialog(mona).getByLabel(L('classes.teacher')), { label: `${DEMO.karim} (${L('role.editor')})` }, 'teacher');
  await r.select(dialog(mona).getByLabel(L('classes.subject'), { exact: true }), { label: arabic.name_ar as string }, 'subject');
  await r.click(dialog(mona).getByRole('button', { name: L('classes.addTeacher') }), 'teacher added', () => expect(dialog(mona)).toHaveCount(0));

  // ================================================================ Karim: homework, then a test with a start code
  await karim.goto(classPath);
  r = await shots.start(karim, 'homework-set');
  await r.click(karim.getByRole('button', { name: L('hw.set') }), 'dialog');
  await r.type(dialog(karim).getByLabel(field('hw.titleField')), DEMO.hwTitle, 'title', 4);
  await r.type(dialog(karim).getByLabel(field('hw.instructions')), DEMO.hwInstructions, 'instructions', 6);
  await r.check(dialog(karim).getByRole('group', { name: L('hw.books') }).getByRole('checkbox').first(), 'book');
  await r.type(dialog(karim).getByLabel(field('hw.maxPoints')), '10', 'points', 1);
  await r.click(dialog(karim).getByRole('button', { name: L('hw.set') }), 'set', () => expect(karim.getByText(L('hw.setDone'))).toBeVisible());

  r = await shots.start(karim, 'test-create');
  await r.click(karim.getByRole('button', { name: L('tests.new') }), 'dialog');
  await r.type(dialog(karim).getByLabel(field('hw.titleField')), DEMO.testTitle, 'title', 3);
  await r.type(dialog(karim).getByLabel(field('tests.duration')), '20', 'minutes', 1);
  await r.check(dialog(karim).getByLabel(L('tests.requireCode')), 'start code');
  await r.click(dialog(karim).getByRole('button', { name: L('tests.create') }), 'test page', () => expect(karim.getByRole('heading', { name: DEMO.testTitle, level: 1 })).toBeVisible());
  const testPath = new URL(karim.url()).pathname;
  const startCode = (await karim.locator('.code-big').textContent())!.trim();
  await r.click(karim.getByRole('button', { name: L('tests.addQuestion') }), 'question dialog');
  await r.type(dialog(karim).getByLabel(L('tests.prompt'), { exact: true }), DEMO.q1, 'prompt', 4);
  for (const [i, letter] of ['ب', 'أ', 'ت'].entries()) await r.type(dialog(karim).getByLabel(L('tests.choice', { n: 'ABC'[i]! }), { exact: true }), letter, 'choice', 1);
  await r.check(dialog(karim).getByLabel(L('tests.correctFor', { n: 'B' })), 'correct');
  await r.type(dialog(karim).getByLabel(field('tests.points')), '2', 'points', 1);
  await r.click(dialog(karim).getByRole('button', { name: L('common.save') }), 'saved');
  await karim.getByRole('button', { name: L('tests.addQuestion') }).click();
  await dialog(karim).getByLabel(field('tests.typeLabel')).selectOption('short');
  await dialog(karim).getByLabel(L('tests.prompt'), { exact: true }).fill(DEMO.q2);
  await dialog(karim).getByLabel(field('tests.accepted')).fill('صغير\nصغيرة');
  r.dirty();
  await r.state('short answer with spelling variants');
  await dialog(karim).getByRole('button', { name: L('common.save') }).click();
  await karim.getByRole('button', { name: L('tests.addQuestion') }).click();
  await dialog(karim).getByLabel(field('tests.typeLabel')).selectOption('essay');
  await dialog(karim).getByLabel(L('tests.prompt'), { exact: true }).fill(DEMO.q3);
  await dialog(karim).getByLabel(field('tests.points')).fill('3');
  await dialog(karim).getByRole('button', { name: L('common.save') }).click();
  await expect(karim.locator('ol.questions > li')).toHaveCount(3);
  r.dirty();
  await r.scroll(karim.locator('ol.questions'), 'questions');
  await r.click(karim.getByRole('button', { name: L('tests.publish') }), 'publish dialog');
  await r.click(dialog(karim).getByRole('button', { name: L('tests.publish') }), 'published', () => expect(karim.getByText(L('tests.published'))).toBeVisible());

  // ================================================================ Omar on his phone: sign in, Today, homework with a photo
  const omar = await newPage(browser, PHONE);
  await omar.goto(`/student-login?school=${schoolCode}`);
  r = await shots.start(omar, 'student-sign-in');
  await r.type(omar.getByLabel(field('student.username')), 'omar.khaled', 'username', 3);
  await r.type(omar.getByLabel(field('auth.password')), omarPassword, 'password', 3);
  await r.click(omar.getByRole('button', { name: L('auth.signIn') }), 'today', () => omar.waitForURL(/\/student$/));
  await expect(omar.getByRole('heading', { name: L('portal.testsOpen') })).toBeVisible();
  await r.scroll(9999, 'today');
  await omar.evaluate(() => window.scrollTo(0, 0));

  const photo = await notebookPhoto(browser);
  r = await shots.start(omar, 'student-homework');
  await r.click(omar.getByRole('link', { name: DEMO.hwTitle }), 'homework');
  await r.type(omar.getByLabel(L('portal.answer')), DEMO.omarAnswer, 'answer', 6);
  await omar.locator('input[type="file"]').setInputFiles({ name: 'notebook.jpg', mimeType: 'image/jpeg', buffer: photo });
  await expect(omar.getByText(L('hw.fileChecking'), { exact: false }).first()).toBeVisible();
  await r.state('photo being checked');
  await runFileCheckPass();
  await expect(omar.getByText(L('hw.fileChecking'), { exact: false })).toHaveCount(0, { timeout: 15_000 });
  await r.state('photo checked');
  await r.click(omar.getByRole('button', { name: L('portal.handIn') }), 'handed in', () => expect(omar.getByText(like('portal.handedInAt'))).toBeVisible());

  // A desktop window of the portal too, for wide shots.
  const omarDesk = await newPage(browser);
  await studentSignIn(omarDesk, schoolCode, 'omar.khaled', omarPassword);
  await shots.start(omarDesk, 'student-today-desktop');

  // ================================================================ the test: Omar on his phone, Hana on a computer, Karim watching
  await karim.goto(`${testPath}/monitor`);
  r = await shots.start(karim, 'monitor');
  await omar.goto('/student');
  const m = await shots.start(omar, 'student-test');
  await m.click(omar.getByRole('link', { name: L('ptests.startTest', { title: DEMO.testTitle }) }), 'start page');
  await m.type(omar.getByLabel(L('tests.code')), startCode, 'code', 2);
  await m.click(omar.getByRole('button', { name: L('ptests.start') }), 'confirm');
  await m.click(dialog(omar).getByRole('button', { name: L('ptests.start') }), 'started', () => expect(omar.getByRole('timer')).toBeVisible());
  await m.check(omar.getByLabel('أ', { exact: true }), 'choice');
  await m.type(omar.getByLabel(L('ptests.yourAnswer')).first(), 'صغير', 'short', 2);
  await m.type(omar.getByLabel(L('ptests.yourAnswer')).nth(1), DEMO.omarQ3, 'essay', 5);
  await expect(omar.getByText(like('ptests.savedAt'))).toBeVisible();
  await m.state('saved');
  await m.scroll(9999, 'to submit');

  await karim.waitForTimeout(5_500);
  await r.state('Omar working');
  const hana = await newPage(browser, { ...DESKTOP, permissions: ['clipboard-read', 'clipboard-write'] });
  await studentSignIn(hana, schoolCode, 'hana.samir', passwords['hana.samir']!);
  await hana.getByRole('link', { name: L('ptests.startTest', { title: DEMO.testTitle }) }).click();
  await hana.getByLabel(L('tests.code')).fill(startCode);
  await hana.getByRole('button', { name: L('ptests.start') }).click();
  await dialog(hana).getByRole('button', { name: L('ptests.start') }).click();
  await hana.getByLabel('ب', { exact: true }).check();
  await karim.waitForTimeout(5_500);
  await r.state('Hana started');
  await hana.getByLabel(L('ptests.yourAnswer')).first().fill('صغير');
  // Hana pastes her written answer, and her connection drops for a few seconds: the monitor shows both.
  await hana.evaluate((text) => navigator.clipboard.writeText(text), DEMO.hanaQ3);
  await hana.getByLabel(L('ptests.yourAnswer')).nth(1).focus();
  await hana.keyboard.press('Control+V');
  await expect(hana.getByLabel(L('ptests.yourAnswer')).nth(1)).toHaveValue(DEMO.hanaQ3);
  await hana.context().setOffline(true);
  await hana.waitForTimeout(4_000);
  await hana.context().setOffline(false);
  await expect(hana.getByText(like('ptests.savedAt'))).toBeVisible({ timeout: 15_000 });
  await expect(karim.locator('table.data tbody tr', { hasText: DEMO.hana })).toContainText(L('tests.progress', { n: fmt(3), total: fmt(3) }), { timeout: 15_000 });
  await r.state('both working');
  await r.click(karim.getByRole('button', { name: L('tests.extraTimeFor', { name: DEMO.hana }) }).first(), 'extra time dialog');
  await karim.keyboard.press('Escape');
  r.dirty();

  await m.click(omar.getByRole('button', { name: L('ptests.submit') }), 'submit dialog');
  await m.click(dialog(omar).getByRole('button', { name: L('ptests.submit') }), 'submitted', () => expect(omar.getByText(L('ptests.resultsLater'))).toBeVisible());
  await hana.getByRole('button', { name: L('ptests.submit') }).click();
  await dialog(hana).getByRole('button', { name: L('ptests.submit') }).click();
  await expect(hana.getByText(L('ptests.resultsLater'))).toBeVisible();
  await karim.waitForTimeout(5_500);
  await r.state('submitted');
  await r.click(karim.getByRole('button', { name: L('tests.closeNow') }), 'close dialog');
  await r.click(dialog(karim).getByRole('button', { name: L('tests.closeNow') }), 'closed', () => expect(karim.locator('.page-head .pill')).toHaveText(L('tests.phase.closed')));

  // ================================================================ marking: homework, written answers; the gradebook
  await karim.goto(classPath);
  r = await shots.start(karim, 'homework-mark');
  await r.click(karim.getByRole('link', { name: DEMO.hwTitle }), 'roster', () => expect(karim.locator('table.data tbody tr', { hasText: DEMO.omar })).toContainText(L('hw.status.submitted')));
  await r.click(karim.getByRole('button', { name: L('hw.openFor', { name: DEMO.omar }) }), 'work');
  await r.type(dialog(karim).getByLabel(L('hw.markOutOf', { max: 10 })), '9', 'mark', 1);
  await r.type(dialog(karim).getByLabel(L('hw.feedback')), DEMO.hwFeedback, 'feedback', 5);
  await r.click(dialog(karim).getByRole('button', { name: L('hw.return') }), 'returned', () => expect(karim.getByText(L('hw.returnedToast', { name: DEMO.omar }))).toBeVisible());

  await karim.goto(`${testPath}/results`);
  await expect(karim.locator('table.data tbody tr', { hasText: DEMO.omar })).toContainText(L('tests.toMark'));
  r = await shots.start(karim, 'test-results');
  await r.click(karim.getByRole('link', { name: L('tests.attemptOf', { n: 1, name: DEMO.omar }) }), 'attempt');
  await r.scroll(karim.getByLabel(L('tests.markOutOf', { max: fmt(3) })), 'written answer');
  await r.type(karim.getByLabel(L('tests.markOutOf', { max: fmt(3) })), '2.5', 'mark', 1);
  await r.type(karim.getByLabel(L('hw.feedback')).nth(2), DEMO.testFeedback, 'comment', 5);
  await r.click(karim.getByRole('button', { name: L('tests.saveMarkN', { n: 3 }) }), 'saved', () => expect(karim.getByText(like('tests.savedScore'))).toBeVisible());
  await karim.goto(`${testPath}/results`);
  await karim.getByRole('link', { name: L('tests.attemptOf', { n: 1, name: DEMO.hana }) }).click();
  await karim.getByLabel(L('tests.markOutOf', { max: fmt(3) })).fill('2');
  await karim.getByRole('button', { name: L('tests.saveMarkN', { n: 3 }) }).click();
  await expect(karim.getByText(like('tests.savedScore'))).toBeVisible();

  await karim.goto(`${classPath}/gradebook`);
  await expect(karim.locator('table.gradebook tbody tr', { hasText: DEMO.omar })).toContainText(L('grades.percent', { n: fmt(90.6) }));
  r = await shots.start(karim, 'gradebook');
  await karim.goto(classPath);
  r = await shots.start(karim, 'class-page');
  await r.scroll(9999, 'class');

  // ================================================================ Omar: result, grades, books, the other language
  await omar.goto(testPath.replace(/^\/org\/[^/]+\/tests\//, '/student/tests/'));
  r = await shots.start(omar, 'student-result');
  await r.click(omar.getByRole('link', { name: L('ptests.reviewN', { n: 1 }) }), 'review', () => expect(omar.locator('.mark-big')).toBeVisible());
  await r.scroll(9999, 'answers');
  await omar.goto('/student');
  r = await shots.start(omar, 'student-grades');
  await r.scroll(9999, 'returned');
  await omar.evaluate(() => window.scrollTo(0, 0));
  r.dirty();
  await r.click(omar.locator('.topbar').getByRole('link', { name: L('portal.grades') }), 'grades', () => expect(omar.getByRole('heading', { name: L('grades.mine'), level: 1 })).toBeVisible());
  await r.click(omar.locator('.topbar').getByRole('link', { name: L('portal.books') }), 'books', () => expect(omar.locator('.subj .mat.book').first()).toBeVisible());
  await r.scroll(700, 'books');
  await omar.evaluate(() => window.scrollTo(0, 0));
  r.dirty();
  await r.click(omar.locator('.topbar').getByRole('button', { name: 'English', exact: true }), 'english', () => expect(omar.locator('html')).toHaveAttribute('dir', 'ltr'));
  await omar.locator('.topbar').getByRole('button', { name: 'العربية', exact: true }).click();

  await omarDesk.goto('/student');
  await omarDesk.locator('.topbar').getByRole('link', { name: L('portal.grades') }).click();
  await expect(omarDesk.getByRole('heading', { name: L('grades.mine'), level: 1 })).toBeVisible();
  await shots.start(omarDesk, 'student-grades-desktop');

  // ================================================================ keeping classroom data
  await mona.goto(`/org/${orgId}/classes`);
  r = await shots.start(mona, 'retention');
  await r.click(mona.getByRole('link', { name: L('ret.link') }), 'page', () => expect(mona.getByRole('heading', { name: L('ret.title'), level: 1 })).toBeVisible());
  await r.select(mona.getByLabel(L('ret.stage.monitoring')), { label: L('ret.daysFew', { n: fmt(7) }) }, 'monitoring');
  await r.select(mona.getByLabel(L('ret.stage.work')), { label: L('ret.year1') }, 'work');
  await r.select(mona.getByLabel(L('ret.stage.records')), { label: L('ret.yearsFew', { n: fmt(3) }) }, 'records');
  await r.click(mona.getByRole('button', { name: L('ret.save') }), 'confirm');
  await r.click(dialog(mona).getByRole('button', { name: L('ret.save') }), 'saved', () => expect(mona.getByRole('button', { name: L('ret.keepItemLabel', { title: DEMO.testTitle }) })).toBeVisible());
  await r.scroll(9999, 'due');

  // ================================================================ settings: API key, webhook, support access; audit; account
  await mona.goto(`/org/${orgId}/settings`);
  await expect(mona.getByRole('heading', { name: L('settings.title'), level: 1 })).toBeVisible();
  await mona.getByLabel(field('apikeys.name')).fill(DEMO.keyName);
  await mona.getByRole('button', { name: L('apikeys.create') }).click();
  await expect(dialog(mona)).toContainText(L('apikeys.created'));
  await dialog(mona).getByRole('button', { name: L('common.done') }).click();
  await expect(mona.locator('#main table.data b', { hasText: DEMO.keyName })).toBeVisible();
  await mona.getByLabel(field('webhooks.url')).fill(hookUrl);
  await mona.getByLabel(field('webhooks.description')).fill(DEMO.hookDescription);
  await mona.getByRole('button', { name: L('webhooks.add') }).click();
  await expect(dialog(mona).getByRole('heading', { name: L('webhooks.created') })).toBeVisible();
  await dialog(mona).getByRole('button', { name: L('common.done') }).click();
  await mona.waitForLoadState('networkidle');
  await mona.getByRole('button', { name: L('webhooks.testFor', { url: hookUrl }) }).click();
  await expect(mona.locator('#toasts').getByText(like('webhooks.testOk'))).toBeVisible();
  await mona.goto(`/org/${orgId}?scope=${campusB}`);
  await mona.getByRole('button', { name: grade(2), exact: true }).click();
  await mona.locator('.mat[aria-pressed="false"]').first().click();
  await expect(mona.locator('.tray .toast')).toHaveText(L('picker.saved'));
  await runWebhookPass();
  await mona.goto(`/org/${orgId}/settings`);
  r = await shots.start(mona, 'settings');
  await r.scroll(mona.locator('#webhooks'), 'webhooks');
  await r.click(mona.getByRole('button', { name: L('webhooks.deliveriesFor', { url: hookUrl }) }), 'deliveries');
  await mona.getByRole('dialog').getByRole('button', { name: L('common.close') }).click();
  r.dirty();
  await r.scroll(mona.getByRole('heading', { name: L('support.title') }), 'support');
  await r.type(mona.getByLabel(field('support.reason')), DEMO.supportReason, 'reason', 5);
  await r.click(mona.getByRole('button', { name: L('support.grant') }), 'granted', () => expect(mona.getByText(L('support.granted'))).toBeVisible());

  await mona.goto(`/org/${orgId}/audit`);
  r = await shots.start(mona, 'audit');
  await r.scroll(600, 'entries');

  await mona.goto('/account');
  r = await shots.start(mona, 'account');
  await mona.getByRole('button', { name: L('mfa.setup') }).click();
  await expect(mona.getByRole('img', { name: L('mfa.qrAlt') })).toBeVisible();
  await blur(mona.getByRole('img', { name: L('mfa.qrAlt') }));
  await blur(mona.locator('p.mono', { hasText: L('mfa.manualKey') }));
  r.dirty();
  await r.scroll(mona.getByRole('img', { name: L('mfa.qrAlt') }), 'two-factor (QR blurred)');

  // ================================================================ the same pages in English; a phone
  await mona.goto(`/org/${orgId}?scope=${campusB}`);
  r = await shots.start(mona, 'language');
  await r.click(mona.locator('.topbar').getByRole('button', { name: 'English', exact: true }), 'english', () => expect(mona.locator('html')).toHaveAttribute('dir', 'ltr'));
  await r.click(mona.getByRole('button', { name: grade(1, 'en') }).first(), 'grade 1');
  await mona.locator('.topbar').getByRole('button', { name: 'العربية', exact: true }).click();
  await expect(mona.locator('html')).toHaveAttribute('dir', 'rtl');

  const phone = await newPage(browser, PHONE);
  await signIn(phone, MONA);
  await phone.goto(`/org/${orgId}?scope=${campusB}`);
  await phone.getByRole('button', { name: grade(1), exact: true }).click();
  r = await shots.start(phone, 'picker-phone');
  await r.scroll(phone.locator('section.grade').first(), 'books');

  // ================================================================ platform administration
  await admin.goto('/admin');
  await expect(admin.getByRole('heading', { name: L('admin.overview') })).toBeVisible();
  r = await shots.start(admin, 'admin-overview');
  await r.scroll(9999, 'alerts');
  for (const [id, path] of [['admin-orgs', '/admin/orgs'], ['admin-org', `/admin/orgs/${orgId}`], ['admin-users', '/admin/users'], ['admin-plans', '/admin/plans'], ['admin-audit', '/admin/audit']] as const) {
    await admin.goto(path);
    await admin.waitForLoadState('networkidle');
    await shots.start(admin, id);
  }

  shots.save();
  receiver.closeAllConnections();
  receiver.close();
});

let worker: ChildProcess | undefined;
function startWorker() {
  worker = spawn(process.execPath, ['--import', 'tsx', 'src/worker.ts'], {
    env: { ...process.env, ...E2E_ENV, WORKER_INTERVAL_MS: '5000' },
    stdio: ['ignore', 'ignore', 'inherit'],
    detached: true,
  });
}

test.afterAll(() => {
  shots.save();
  if (worker?.pid) process.kill(-worker.pid, 'SIGTERM');
});
