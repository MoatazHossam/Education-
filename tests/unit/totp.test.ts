import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { enrollmentPayload, generateTotpSecret, verifyTotp } from '../../src/auth/mfa.js';

// Two-step sign-in codes (src/auth/mfa.ts) checked against RFC 6238 itself, not against the library that
// computes them, so a library upgrade cannot change which codes are accepted without a test failing.
// RFC 6238 appendix B: the ASCII secret "12345678901234567890" (base32 below), SHA-1, 30-second steps.
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(s: string): Buffer {
  let bits = '';
  for (const c of s.replace(/=+$/, '')) bits += BASE32.indexOf(c).toString(2).padStart(5, '0');
  return Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
}
/** RFC 4226 HOTP truncated to 6 digits, for time step `step`. */
function rfcCode(secretB32: string, step: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', base32Decode(secretB32)).update(msg).digest();
  const off = mac[mac.length - 1]! & 0xf;
  return String((mac.readUInt32BE(off) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}
const at = (seconds: number) => vi.setSystemTime(new Date(seconds * 1000));

afterEach(() => {
  vi.useRealTimers();
});

describe('two-step sign-in codes (TOTP)', () => {
  it('match RFC 6238 test values', () => {
    vi.useFakeTimers();
    // RFC 6238 B: T = 59 s → 94287082 (8 digits), so 287082 in 6; T = 1111111109 → 07081804 → 081804.
    expect(rfcCode(RFC_SECRET, 1)).toBe('287082');
    at(59);
    expect(verifyTotp(RFC_SECRET, '287082', null)).toBe(1);
    at(1111111109);
    expect(verifyTotp(RFC_SECRET, '081804', null)).toBe(37037036);
    expect(verifyTotp(RFC_SECRET, '081 804', null)).toBe(37037036); // spaces as some apps show them
  });

  it('accept one step either side of now for clock drift, and no further', () => {
    vi.useFakeTimers();
    const now = 1_800_000_000; // step 60_000_000
    at(now);
    const step = Math.floor(now / 30);
    for (const d of [-1, 0, 1]) expect(verifyTotp(RFC_SECRET, rfcCode(RFC_SECRET, step + d), null), `delta ${d}`).toBe(step + d);
    for (const d of [-2, 2]) expect(verifyTotp(RFC_SECRET, rfcCode(RFC_SECRET, step + d), null), `delta ${d}`).toBeNull();
  });

  it('refuse a code at or before the last step used (no replay), and accept a later one', () => {
    vi.useFakeTimers();
    at(1_800_000_000);
    const step = 60_000_000;
    expect(verifyTotp(RFC_SECRET, rfcCode(RFC_SECRET, step), step)).toBeNull();
    expect(verifyTotp(RFC_SECRET, rfcCode(RFC_SECRET, step - 1), step)).toBeNull();
    expect(verifyTotp(RFC_SECRET, rfcCode(RFC_SECRET, step + 1), step)).toBe(step + 1);
    expect(verifyTotp(RFC_SECRET, '12345', null)).toBeNull();
    expect(verifyTotp(RFC_SECRET, 'abcdef', null)).toBeNull();
  });

  it('new secrets are 160 bits of base32, and the enrollment link names Midad and the account', async () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(secret)).toHaveLength(20);
    expect(generateTotpSecret()).not.toBe(secret);
    const { otpauthUrl, qrSvg } = await enrollmentPayload('owner@example.com', secret);
    const url = new URL(otpauthUrl);
    expect(url.protocol).toBe('otpauth:');
    expect(url.host).toBe('totp');
    expect(decodeURIComponent(url.pathname)).toBe('/Midad:owner@example.com');
    expect(url.searchParams.get('secret')).toBe(secret);
    expect(url.searchParams.get('issuer')).toBe('Midad');
    // Absent or the defaults every app assumes (SHA-1, 6 digits, 30 s).
    expect(url.searchParams.get('algorithm') ?? 'SHA1').toBe('SHA1');
    expect(url.searchParams.get('digits') ?? '6').toBe('6');
    expect(url.searchParams.get('period') ?? '30').toBe('30');
    expect(qrSvg).toMatch(/^<svg/);
    // A code an authenticator app would show now is accepted.
    const step = Math.floor(Date.now() / 30_000);
    expect(verifyTotp(secret, rfcCode(secret, step), null)).toBe(step);
  });
});
