import { createCipheriv, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { decryptSecret, encryptSecret, envelopeKeyId, keyId } from '../../src/lib/crypto.js';
import { TEST_ENV } from '../helpers/env.js';

const OLD = Buffer.alloc(32, 11).toString('base64');
const NEW = Buffer.alloc(32, 12).toString('base64');
const OTHER = Buffer.alloc(32, 13).toString('base64');

/** An envelope in the format written before key ids were recorded (v1.iv.tag.ciphertext). */
function v1Envelope(keyBase64: string, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(keyBase64, 'base64'), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

describe('encryption keys', () => {
  it('new values name their key; the key id is a short fingerprint', () => {
    expect(keyId(OLD)).toMatch(/^[0-9a-f]{8}$/);
    expect(keyId(OLD)).toBe(keyId(OLD));
    expect(keyId(OLD)).not.toBe(keyId(NEW));
    const env = encryptSecret({ current: NEW, previous: [OLD] }, 'JBSWY3DPEHPK3PXP');
    expect(env.startsWith(`v2.${keyId(NEW)}.`)).toBe(true);
    expect(envelopeKeyId(env)).toBe(keyId(NEW));
  });

  it('previous keys still decrypt; a key that is not configured is named in the error', () => {
    const old = encryptSecret(OLD, 'secret-under-old');
    expect(decryptSecret({ current: NEW, previous: [OLD] }, old)).toBe('secret-under-old');
    expect(() => decryptSecret({ current: NEW, previous: [] }, old)).toThrow(`Encrypted with a key that is not configured (${keyId(OLD)})`);
    expect(() => decryptSecret({ current: NEW, previous: [OTHER] }, old)).toThrow(/not configured/);
  });

  it('envelopes from before key ids were recorded are read with whichever configured key opens them', () => {
    const legacy = v1Envelope(OLD, 'legacy-secret');
    expect(envelopeKeyId(legacy)).toBeNull();
    expect(decryptSecret(OLD, legacy)).toBe('legacy-secret');
    expect(decryptSecret({ current: NEW, previous: [OTHER, OLD] }, legacy)).toBe('legacy-secret');
    expect(() => decryptSecret({ current: NEW, previous: [OTHER] }, legacy)).toThrow('None of the configured keys decrypts this value');
    expect(() => decryptSecret(OLD, 'v3.x.y')).toThrow('Unsupported secret envelope');
  });

  it('DATA_ENCRYPTION_KEYS_PREVIOUS takes up to five other 32-byte keys', () => {
    const cfg = loadConfig({ ...TEST_ENV, DATA_ENCRYPTION_KEY: NEW, DATA_ENCRYPTION_KEYS_PREVIOUS: ` ${OLD}, ${OTHER} ` });
    expect(cfg.dataKeys).toEqual({ current: NEW, previous: [OLD, OTHER] });
    expect(loadConfig({ ...TEST_ENV, DATA_ENCRYPTION_KEY: NEW }).dataKeys).toEqual({ current: NEW, previous: [] });
    expect(() => loadConfig({ ...TEST_ENV, DATA_ENCRYPTION_KEY: NEW, DATA_ENCRYPTION_KEYS_PREVIOUS: 'short' })).toThrow(/each previous key must be 32 bytes/);
    expect(() => loadConfig({ ...TEST_ENV, DATA_ENCRYPTION_KEY: NEW, DATA_ENCRYPTION_KEYS_PREVIOUS: `${OLD},${NEW}` })).toThrow(/must not contain the current DATA_ENCRYPTION_KEY/);
    const six = Array.from({ length: 6 }, (_, i) => Buffer.alloc(32, 20 + i).toString('base64')).join(',');
    expect(() => loadConfig({ ...TEST_ENV, DATA_ENCRYPTION_KEY: NEW, DATA_ENCRYPTION_KEYS_PREVIOUS: six })).toThrow(/DATA_ENCRYPTION_KEYS_PREVIOUS/);
  });
});
