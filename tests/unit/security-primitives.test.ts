import { authenticator } from 'otplib';
import { describe, expect, it } from 'vitest';
import { generateRecoveryCodes, normalizeRecoveryCode, verifyTotp } from '../../src/auth/mfa.js';
import { hashPassword, verifyPassword } from '../../src/auth/password.js';
import { paymobHmac, paymobTransactionHmac, PaymobProvider, type PaymobTransaction } from '../../src/billing/providers/paymob.js';
import { SandboxProvider } from '../../src/billing/providers/sandbox.js';
import { WebhookSignatureError } from '../../src/billing/providers/types.js';
import { loadConfig } from '../../src/config.js';
import { decryptSecret, encryptSecret, hmacHex } from '../../src/lib/crypto.js';
import { toCsv, toText, type ExportRow } from '../../src/scopes/export.js';
import { TEST_ENV } from '../helpers/env.js';

describe('passwords', () => {
  it('hashes with argon2id and verifies', async () => {
    const h = await hashPassword('a-long-enough-passphrase');
    expect(h.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(h, 'a-long-enough-passphrase')).toBe(true);
    expect(await verifyPassword(h, 'wrong')).toBe(false);
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
  });
});

describe('secret encryption', () => {
  const key = Buffer.alloc(32, 1).toString('base64');
  it('round-trips and detects tampering', () => {
    const env = encryptSecret(key, 'JBSWY3DPEHPK3PXP');
    expect(env).not.toContain('JBSWY3DPEHPK3PXP');
    expect(decryptSecret(key, env)).toBe('JBSWY3DPEHPK3PXP');
    const parts = env.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => decryptSecret(key, parts.join('.'))).toThrow();
    expect(() => decryptSecret(Buffer.alloc(32, 2).toString('base64'), env)).toThrow();
  });
});

describe('TOTP', () => {
  it('accepts a current code once and rejects replay of the same step', () => {
    const secret = authenticator.generateSecret();
    const code = authenticator.generate(secret);
    const step = verifyTotp(secret, code, null);
    expect(step).not.toBeNull();
    expect(verifyTotp(secret, code, step)).toBeNull();
    expect(verifyTotp(secret, 'abcdef', null)).toBeNull();
  });
  it('generates unique recovery codes and normalizes input', () => {
    const { codes, hashes } = generateRecoveryCodes();
    expect(new Set(codes).size).toBe(10);
    expect(hashes[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(normalizeRecoveryCode(codes[0]!.toUpperCase().replace('-', ' '))).toBe(codes[0]);
  });
});

describe('webhook signatures', () => {
  it('sandbox: verifies signed payloads, rejects tampering and stale timestamps', () => {
    const p = new SandboxProvider('sandbox-secret-1234567', 'http://localhost');
    const body = JSON.stringify({ id: 'evt_1', type: 'payment.succeeded', data: { invoice_id: 'i', txn_id: 't', amount_cents: 1, currency: 'EGP' } });
    const ok = p.parseWebhook({ rawBody: Buffer.from(body), headers: { 'x-sandbox-signature': p.sign(body) }, query: {} });
    expect(ok.type).toBe('payment.succeeded');
    expect(() => p.parseWebhook({ rawBody: Buffer.from(body.replace('"amount_cents":1', '"amount_cents":2')), headers: { 'x-sandbox-signature': p.sign(body) }, query: {} })).toThrow(WebhookSignatureError);
    const old = p.sign(body, Math.floor(Date.now() / 1000) - 3600);
    expect(() => p.parseWebhook({ rawBody: Buffer.from(body), headers: { 'x-sandbox-signature': old }, query: {} })).toThrow(/tolerance/);
    expect(() => p.parseWebhook({ rawBody: Buffer.from(body), headers: {}, query: {} })).toThrow(WebhookSignatureError);
  });

  it('paymob: HMAC-SHA512 over the documented field order', () => {
    const txn = {
      id: 192036465, pending: false, amount_cents: 99000, success: true, is_auth: false, is_capture: false, is_standalone_payment: true,
      is_voided: false, is_refunded: false, is_3d_secure: true, integration_id: 4097558, has_parent_transaction: false,
      created_at: '2026-10-22T12:00:00.000000', currency: 'EGP', error_occured: false, owner: 302852,
      order: { id: 217503754, merchant_order_id: '7c1a3f7e-0000-4000-8000-000000000001.abc' }, source_data: { pan: '2346', type: 'card', sub_type: 'MasterCard' },
    };
    const concatenated = '990002026-10-22T12:00:00.000000EGPfalsefalse1920364654097558truefalsefalsefalsetruefalse217503754302852false2346MasterCardcardtrue';
    expect(paymobTransactionHmac('hmac-secret', txn)).toBe(hmacHex('hmac-secret', concatenated, 'sha512'));
    const provider = new PaymobProvider({ apiBase: 'https://accept.paymob.com', secretKey: 's', publicKey: 'p', hmacSecret: 'hmac-secret', integrationIds: [1] });
    const raw = Buffer.from(JSON.stringify({ type: 'TRANSACTION', obj: txn }));
    const evt = provider.parseWebhook({ rawBody: raw, headers: {}, query: { hmac: paymobTransactionHmac('hmac-secret', txn) } });
    expect(evt).toMatchObject({ type: 'payment.succeeded', invoiceId: '7c1a3f7e-0000-4000-8000-000000000001', checkoutRef: '217503754', amountCents: 99000, currency: 'EGP' });
    expect(() => provider.parseWebhook({ rawBody: raw, headers: {}, query: { hmac: 'deadbeef' } })).toThrow(WebhookSignatureError);
  });

  // Independent reference: the fixture and expected signature in Odoo's
  // payment_paymob module (odoo/odoo, branch 19.0, addons/payment_paymob/tests/common.py),
  // where the same HMAC is asserted for the redirect query and the webhook object.
  it('paymob: matches the signature vector of an independent implementation (Odoo)', () => {
    const expected = '51860052ecc6d9f08ac30a549359019e2eee837913b5673094c242c817ddf57c055ba5e3e9c0894b1171e62c2d37cd55ff98a46a0e28e1ccf2e4a907e6683aa5';
    const redirect = {
      amount_cents: '111111', created_at: '2025-04-01T17:29:16.967925', currency: 'EGP', error_occured: 'false', has_parent_transaction: 'false',
      id: 'dummy_id', integration_id: '1234', is_3d_secure: 'true', is_auth: 'false', is_capture: 'false', is_refunded: 'false',
      is_standalone_payment: 'true', is_voided: 'false', order: '123', owner: '12', pending: 'false', 'source_data.pan': '1111',
      'source_data.sub_type': 'Visa', 'source_data.type': 'card', success: 'true', 'data.message': 'Approved', merchant_order_id: 'S00001',
    };
    expect(paymobHmac('dummy_hmac', redirect)).toBe(expected);
    const webhookObj = {
      amount_cents: 111111, created_at: '2025-04-01T17:29:16.967925', currency: 'EGP', error_occured: false, has_parent_transaction: false,
      id: 'dummy_id', integration_id: 1234, is_3d_secure: true, is_auth: false, is_capture: false, is_hidden: false, is_refunded: false,
      is_standalone_payment: true, is_voided: false, order: { id: '123', merchant_order_id: 'S00001' }, owner: 12, pending: false,
      source_data: { pan: '1111', sub_type: 'Visa', type: 'card' }, success: true, data: { message: 'Approved' },
    };
    expect(paymobTransactionHmac('dummy_hmac', webhookObj as unknown as PaymobTransaction)).toBe(expected);
  });
});

describe('exports', () => {
  const row = (over: Partial<ExportRow>): ExportRow => ({
    grade: 1, gradeEn: 'Primary 1', gradeAr: 'الصف الأول الابتدائي', track: 'moe', block: 'Block', subjectCode: 'ma', subjectEn: 'Mathematics',
    subjectAr: 'الرياضيات', subjectStatus: 'scored', materialId: 'id', materialKind: 'moe', materialTitle: 'Book',
    subjectVerification: 'unverified', subjectVerificationSource: null, subjectReviewedAt: null,
    materialVerification: 'unverified', materialVerificationSource: null, materialReviewedAt: null, note: null, assignee: null, status: null, dueOn: null, ...over,
  });
  it('text export keeps the original "Copy list" layout', () => {
    expect(toText([row({}), row({ materialTitle: 'Workbook' })])).toBe('Primary 1 / الصف الأول الابتدائي\n  • Block — Mathematics\n      - Book\n      - Workbook');
    expect(toText([])).toBe('Nothing selected yet.');
  });
  it('CSV neutralises spreadsheet formulas and quotes properly', () => {
    const csv = toCsv([row({ materialTitle: '=HYPERLINK("http://evil")' }), row({ materialTitle: 'A, "quoted" title' })]);
    expect(csv.startsWith('﻿grade,')).toBe(true);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv).toContain('"A, ""quoted"" title"');
  });
  it('CSV carries verification columns, with the same formula guard on sources', () => {
    const csv = toCsv([row({ subjectVerification: 'verified', subjectVerificationSource: '=cmd|calc', subjectReviewedAt: '2026-10-23T10:00:00.000Z' })]);
    const [header, line] = csv.replace('﻿', '').split('\r\n');
    // Columns added later go at the end, so earlier positions never move.
    expect(header!.split(',').slice(-10, -4)).toEqual(['subject_verification', 'subject_verification_source', 'subject_reviewed_at', 'material_verification', 'material_verification_source', 'material_reviewed_at']);
    expect(line!.split(',').slice(-10, -4)).toEqual(['verified', "'=cmd|calc", '2026-10-23T10:00:00.000Z', 'unverified', '', '']);
  });
  it('CSV ends with the item note, assignee, status and due date, formula-guarded', () => {
    const csv = toCsv([row({ note: '=1+1 waiting for the 2027 edition', assignee: 'Mona Ali', status: 'in_progress', dueOn: '2026-11-15' }), row({})]);
    const [header, line, empty] = csv.replace('\uFEFF', '').split('\r\n');
    expect(header!.split(',').slice(-4)).toEqual(['note', 'assignee', 'status', 'due_on']);
    expect(line!.split(',').slice(-4)).toEqual(["'=1+1 waiting for the 2027 edition", 'Mona Ali', 'in_progress', '2026-11-15']);
    expect(empty!.split(',').slice(-4)).toEqual(['', '', '', '']);
  });
});

describe('configuration', () => {
  it('refuses unsafe production settings', () => {
    expect(() => loadConfig({ ...TEST_ENV, NODE_ENV: 'production' })).toThrow(/sandbox billing provider cannot be used in production/);
    expect(() => loadConfig({ ...TEST_ENV, NODE_ENV: 'production', BILLING_PROVIDER: 'disabled', EMAIL_TRANSPORT: 'smtp', SMTP_URL: 'smtp://x', APP_URL: 'http://insecure' })).toThrow(/https/);
    expect(() => loadConfig({ ...TEST_ENV, NODE_ENV: 'production', BILLING_PROVIDER: 'disabled', EMAIL_TRANSPORT: 'smtp', SMTP_URL: 'smtp://x', APP_URL: 'https://app.example', ALERT_WEBHOOK_URL: 'http://hooks.example/x' })).toThrow(/ALERT_WEBHOOK_URL must use https/);
    expect(() => loadConfig({ ...TEST_ENV, NODE_ENV: 'production', BILLING_PROVIDER: 'disabled', EMAIL_TRANSPORT: 'smtp', SMTP_URL: 'smtp://x', APP_URL: 'https://app.example', WEBHOOK_ALLOW_INSECURE_TARGETS: 'true' })).toThrow(/WEBHOOK_ALLOW_INSECURE_TARGETS cannot be used in production/);
    expect(() => loadConfig({ ...TEST_ENV, ALERT_EMAILS: 'ops@example.com,not-an-email' })).toThrow(/ALERT_EMAILS/);
    expect(() => loadConfig({ ...TEST_ENV, SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/);
    expect(() => loadConfig({ ...TEST_ENV, DATA_ENCRYPTION_KEY: 'abc' })).toThrow(/DATA_ENCRYPTION_KEY/);
    // Homework files: production chooses virus scanning explicitly, and ClamAV needs its address.
    expect(() => loadConfig({ ...TEST_ENV, NODE_ENV: 'production', BILLING_PROVIDER: 'disabled', EMAIL_TRANSPORT: 'smtp', SMTP_URL: 'smtp://x', APP_URL: 'https://app.example' })).toThrow(/FILE_SCAN must be set in production/);
    expect(() => loadConfig({ ...TEST_ENV, FILE_SCAN: 'clamav' })).toThrow(/CLAMAV_HOST is required/);
    expect(loadConfig({ ...TEST_ENV, FILE_SCAN: 'clamav', CLAMAV_HOST: 'clamav' }).CLAMAV_PORT).toBe(3310);
    const ok = loadConfig({ ...TEST_ENV, NODE_ENV: 'production', BILLING_PROVIDER: 'disabled', EMAIL_TRANSPORT: 'smtp', SMTP_URL: 'smtp://x', APP_URL: 'https://app.example', SALES_EMAIL: '', PAYMOB_SECRET_KEY: '', FILE_SCAN: 'off' });
    expect(ok.SALES_EMAIL).toBeUndefined();
    expect(ok.secureCookies).toBe(true);
    expect(ok.WEBHOOK_ALLOW_INSECURE_TARGETS).toBe(false);
  });
});
