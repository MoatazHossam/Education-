import { generateSecret, generateURI, verifySync } from 'otplib';
import QRCode from 'qrcode';
import { randomBytes } from 'node:crypto';
import { sha256Hex } from '../lib/crypto.js';

const ISSUER = 'Midad';
/** RFC 6238 defaults (30-second steps, SHA-1, 6 digits), which every authenticator app uses. */
const STEP_SECONDS = 30;

export function generateTotpSecret(): string {
  return generateSecret({ length: 20 }); // 160 bits, base32
}

export async function enrollmentPayload(email: string, secret: string): Promise<{ secret: string; otpauthUrl: string; qrSvg: string }> {
  const otpauthUrl = generateURI({ issuer: ISSUER, label: email, secret });
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
  // One step either side of now, for clock drift (as before: window 1). A code whose step is at or
  // before the last accepted one is refused here too.
  const result = verifySync({ secret, token, period: STEP_SECONDS, epochTolerance: STEP_SECONDS, afterTimeStep: lastStep ?? undefined });
  return result.valid && 'timeStep' in result ? result.timeStep : null;
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
