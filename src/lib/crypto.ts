import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hmacHex(secret: string, value: string, algorithm: 'sha256' | 'sha512' = 'sha256'): string {
  return createHmac(algorithm, secret).update(value).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Keys for small secrets at rest (DATA_ENCRYPTION_KEY and DATA_ENCRYPTION_KEYS_PREVIOUS):
 * new values are encrypted with `current`; `previous` keys still decrypt during a
 * rotation, until the re-encryption tool has rewritten every value
 * (src/ops/data-keys.ts).
 */
export interface KeyRing {
  current: string;
  previous: readonly string[];
}

const asRing = (keys: string | KeyRing): KeyRing => (typeof keys === 'string' ? { current: keys, previous: [] } : keys);

/** A short fingerprint of a key: the first 8 hex characters of the SHA-256 of its bytes. It reveals nothing useful about the key. */
export function keyId(keyBase64: string): string {
  return createHash('sha256').update(Buffer.from(keyBase64, 'base64')).digest('hex').slice(0, 8);
}

/**
 * AES-256-GCM envelope for small secrets at rest (TOTP seeds, webhook signing secrets).
 * Format: v2.<key id>.<iv>.<tag>.<ciphertext>. Envelopes written before key rotation
 * existed (v1.<iv>.<tag>.<ciphertext>) are still read.
 */
export function encryptSecret(keys: string | KeyRing, plaintext: string): string {
  const { current } = asRing(keys);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(current, 'base64'), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return ['v2', keyId(current), iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

function decryptWith(keyBase64: string, iv: string, tag: string, ct: string): string {
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(keyBase64, 'base64'), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
}

export function decryptSecret(keys: string | KeyRing, envelope: string): string {
  const ring = asRing(keys);
  const all = [ring.current, ...ring.previous];
  const parts = envelope.split('.');
  if (parts[0] === 'v2' && parts.length === 5) {
    const [, kid, iv, tag, ct] = parts as [string, string, string, string, string];
    const key = all.find((k) => keyId(k) === kid);
    if (!key) throw new Error(`Encrypted with a key that is not configured (${kid})`);
    return decryptWith(key, iv, tag, ct);
  }
  if (parts[0] === 'v1' && parts.length === 4) {
    const [, iv, tag, ct] = parts as [string, string, string, string];
    // A v1 envelope does not name its key: try each one (GCM's tag rejects a wrong key).
    for (const key of all) {
      try {
        return decryptWith(key, iv, tag, ct);
      } catch {
        // the next key
      }
    }
    throw new Error('None of the configured keys decrypts this value');
  }
  throw new Error('Unsupported secret envelope');
}

/** The id of the key an envelope was written with; null for a v1 envelope, which does not record it. */
export function envelopeKeyId(envelope: string): string | null {
  const parts = envelope.split('.');
  return parts[0] === 'v2' && parts.length === 5 ? (parts[1] ?? null) : null;
}
