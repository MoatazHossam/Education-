import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { randomBytes } from 'node:crypto';
import { sha256Hex } from '../lib/crypto.js';

authenticator.options = { window: 1, step: 30 };

const ISSUER = 'Midad';

export function generateTotpSecret(): string {
  return authenticator.generateSecret(20);
}

export async function enrollmentPayload(email: string, secret: string): Promise<{ secret: string; otpauthUrl: string; qrSvg: string }> {
  const otpauthUrl = authenticator.keyuri(email, ISSUER, secret);
  const qrSvg = await QRCode.toString(otpauthUrl, { type: 'svg', margin: 1, width: 192 });
  return { secret, otpauthUrl, qrSvg };
}

/**
 * Verifies a TOTP code and returns the matched time step, or null. Callers
 * persist the step and reject codes at or before it, which prevents replaying
 * a code that was already used inside its validity window.
 */
export function verifyTotp(secret: string, code: string, lastStep: number | null): number | null {
  const token = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(token)) return null;
  const delta = authenticator.checkDelta(token, secret);
  if (delta === null) return null;
  const step = Math.floor(Date.now() / 30_000) + delta;
  if (lastStep !== null && step <= lastStep) return null;
  return step;
}

export function generateRecoveryCodes(count = 10): { codes: string[]; hashes: string[] } {
  const codes = Array.from({ length: count }, () => {
    const raw = randomBytes(5).toString('hex'); // 40 bits each, single use
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
  return { codes, hashes: codes.map((c) => sha256Hex(c)) };
}

export function normalizeRecoveryCode(code: string): string {
  const c = code.trim().toLowerCase().replace(/[^a-f0-9]/g, '');
  return c.length === 10 ? `${c.slice(0, 5)}-${c.slice(5)}` : code.trim().toLowerCase();
}
