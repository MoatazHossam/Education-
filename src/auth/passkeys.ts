import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { sql } from 'kysely';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import type { Executor } from '../db/index.js';
import type { StaffUser } from '../db/types.js';
import { AppError } from '../lib/errors.js';

// Passkeys (WebAuthn) for staff accounts (migration 0025, docs/SECURITY_DESIGN.md §2). A passkey is a key pair
// the person's device makes for this site: the device keeps the private key behind the person's fingerprint,
// face or PIN, and the server keeps the public key. Signing in proves both, so a passkey sign-in counts as
// two-step verification, and it cannot be phished: the browser only uses a passkey on the site it was made for.

/** At most this many passkeys per account. */
export const MAX_PASSKEYS = 10;
/** A challenge must be answered within this time, once. */
export const CHALLENGE_TTL_MS = 5 * 60_000;
const TRANSPORTS = new Set(['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb']);

/** This site as WebAuthn sees it: its host name, and the origin the browser reports. */
export interface RelyingParty {
  id: string;
  name: string;
  origin: string;
}

export function relyingParty(config: AppConfig): RelyingParty {
  return { id: new URL(config.APP_URL).hostname, name: 'Midad', origin: config.appOrigin };
}

const b64url = z.string().regex(/^[A-Za-z0-9_-]+$/, 'base64url');
const Transports = z.array(z.string().max(20)).max(10).optional();
/** What navigator.credentials.create() gives, as JSON (the browser's toJSON(), or public/js/passkeys.js). */
export const RegistrationResponse = z.object({
  id: b64url.max(1400),
  rawId: b64url.max(1400),
  type: z.literal('public-key'),
  authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
  clientExtensionResults: z.record(z.string(), z.unknown()).default({}),
  response: z.looseObject({
    clientDataJSON: b64url.max(4096),
    attestationObject: b64url.max(16384),
    transports: Transports,
  }),
});
/** What navigator.credentials.get() gives, as JSON. */
export const AuthenticationResponse = z.object({
  id: b64url.max(1400),
  rawId: b64url.max(1400),
  type: z.literal('public-key'),
  authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
  clientExtensionResults: z.record(z.string(), z.unknown()).default({}),
  response: z.looseObject({
    clientDataJSON: b64url.max(4096),
    authenticatorData: b64url.max(4096),
    signature: b64url.max(2048),
    userHandle: b64url.max(128).optional(),
  }),
});

/** The 16 bytes of an account's id, which the passkey keeps as its user handle. */
export function userHandleOf(userId: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Buffer.from(userId.replace(/-/g, ''), 'hex'));
}

async function saveChallenge(exec: Executor, purpose: 'register' | 'login', userId: string | null, challenge: string): Promise<void> {
  await exec.insertInto('webauthn_challenges').values({ purpose, user_id: userId, challenge, expires_at: new Date(Date.now() + CHALLENGE_TTL_MS) }).execute();
}

/** Takes a challenge if it is the purpose's (and the account's, for a registration) and has not expired: once only. */
async function consumeChallenge(exec: Executor, purpose: 'register' | 'login', userId: string | null, challenge: string): Promise<boolean> {
  const row = await exec
    .deleteFrom('webauthn_challenges')
    .where('challenge', '=', challenge)
    .where('purpose', '=', purpose)
    .where((eb) => (userId === null ? eb('user_id', 'is', null) : eb('user_id', '=', userId)))
    .where('expires_at', '>', sql<Date>`now()`)
    .returning('id')
    .executeTakeFirst();
  return Boolean(row);
}

const invalid = (status: number) => new AppError(status, 'PASSKEY_INVALID', 'The passkey could not be checked. Try again.');

/** Options for navigator.credentials.create(): a discoverable passkey that needs the person's fingerprint, face or PIN. */
export async function registrationOptions(exec: Executor, rp: RelyingParty, user: StaffUser): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const existing = await exec.selectFrom('passkeys').select(['credential_id', 'transports']).where('user_id', '=', user.id).execute();
  if (existing.length >= MAX_PASSKEYS) throw new AppError(409, 'PASSKEY_LIMIT', `An account can have at most ${MAX_PASSKEYS} passkeys. Remove one first.`);
  const options = await generateRegistrationOptions({
    rpName: rp.name,
    rpID: rp.id,
    userName: user.email,
    userDisplayName: user.name,
    userID: userHandleOf(user.id),
    attestationType: 'none',
    // The same device cannot be added twice.
    excludeCredentials: existing.map((c) => ({ id: c.credential_id, transports: c.transports })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    timeout: CHALLENGE_TTL_MS,
  });
  await saveChallenge(exec, 'register', user.id, options.challenge);
  return options;
}

export interface PasskeyInfo {
  id: string;
  name: string;
  backedUp: boolean;
  createdAt: Date;
  lastUsedAt: Date | null;
}

/** Checks the browser's answer to registrationOptions and keeps the new passkey. */
export async function finishRegistration(exec: Executor, rp: RelyingParty, user: StaffUser, response: z.infer<typeof RegistrationResponse>, name: string, onError?: (err: unknown) => void): Promise<PasskeyInfo> {
  let info;
  try {
    const result = await verifyRegistrationResponse({
      response: response as RegistrationResponseJSON,
      expectedChallenge: (challenge) => consumeChallenge(exec, 'register', user.id, challenge),
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      requireUserVerification: true,
    });
    if (!result.verified) throw new Error('not verified');
    info = result.registrationInfo;
  } catch (err) {
    onError?.(err);
    throw invalid(400);
  }
  const count = await exec.selectFrom('passkeys').select((eb) => eb.fn.countAll<string>().as('n')).where('user_id', '=', user.id).executeTakeFirstOrThrow();
  if (Number(count.n) >= MAX_PASSKEYS) throw new AppError(409, 'PASSKEY_LIMIT', `An account can have at most ${MAX_PASSKEYS} passkeys. Remove one first.`);
  const row = await exec
    .insertInto('passkeys')
    .values({
      user_id: user.id,
      credential_id: info.credential.id,
      public_key: Buffer.from(info.credential.publicKey),
      counter: String(info.credential.counter),
      transports: (info.credential.transports ?? response.response.transports ?? []).filter((t) => TRANSPORTS.has(t)),
      device_type: info.credentialDeviceType,
      backed_up: info.credentialBackedUp,
      name,
    })
    .onConflict((oc) => oc.column('credential_id').doNothing())
    .returning(['id', 'name', 'backed_up', 'created_at', 'last_used_at'])
    .executeTakeFirst();
  if (!row) throw new AppError(409, 'PASSKEY_EXISTS', 'This passkey is already registered.');
  return { id: row.id, name: row.name, backedUp: row.backed_up, createdAt: row.created_at, lastUsedAt: row.last_used_at };
}

/** Options for navigator.credentials.get(): any of this site's passkeys on the device, with user verification. */
export async function loginOptions(exec: Executor, rp: RelyingParty): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const options = await generateAuthenticationOptions({ rpID: rp.id, userVerification: 'required', timeout: CHALLENGE_TTL_MS });
  await saveChallenge(exec, 'login', null, options.challenge);
  return options;
}

export type LoginResult = { ok: true; userId: string; passkeyId: string } | { ok: false; reason: 'unknown' } | { ok: false; reason: 'invalid'; userId: string };

/**
 * Checks the browser's answer to loginOptions: a registered passkey, this site and origin, an unused
 * challenge, the person verified on the device, a valid signature, and a signature counter that went up
 * (when the authenticator keeps one). Records the use.
 */
export async function finishLogin(exec: Executor, rp: RelyingParty, response: z.infer<typeof AuthenticationResponse>, onError?: (err: unknown) => void): Promise<LoginResult> {
  const passkey = await exec.selectFrom('passkeys').selectAll().where('credential_id', '=', response.id).executeTakeFirst();
  if (!passkey) return { ok: false, reason: 'unknown' };
  // The account the device says the passkey is for must be the one it was registered to.
  const handle = response.response.userHandle;
  if (handle !== undefined && handle !== Buffer.from(userHandleOf(passkey.user_id)).toString('base64url')) return { ok: false, reason: 'invalid', userId: passkey.user_id };
  try {
    const result = await verifyAuthenticationResponse({
      response: response as AuthenticationResponseJSON,
      expectedChallenge: (challenge) => consumeChallenge(exec, 'login', null, challenge),
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      credential: { id: passkey.credential_id, publicKey: new Uint8Array(passkey.public_key), counter: Number(passkey.counter), transports: passkey.transports },
      requireUserVerification: true,
    });
    if (!result.verified) throw new Error('not verified');
    await exec
      .updateTable('passkeys')
      .set({ counter: String(result.authenticationInfo.newCounter), backed_up: result.authenticationInfo.credentialBackedUp, last_used_at: new Date() })
      .where('id', '=', passkey.id)
      .execute();
  } catch (err) {
    onError?.(err);
    return { ok: false, reason: 'invalid', userId: passkey.user_id };
  }
  return { ok: true, userId: passkey.user_id, passkeyId: passkey.id };
}

export async function listPasskeys(exec: Executor, userId: string): Promise<PasskeyInfo[]> {
  const rows = await exec.selectFrom('passkeys').select(['id', 'name', 'backed_up', 'created_at', 'last_used_at']).where('user_id', '=', userId).orderBy('created_at').execute();
  return rows.map((r) => ({ id: r.id, name: r.name, backedUp: r.backed_up, createdAt: r.created_at, lastUsedAt: r.last_used_at }));
}
