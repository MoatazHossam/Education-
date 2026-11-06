// Passkeys in the browser (WebAuthn): the server's JSON options (src/auth/passkeys.ts) to navigator.credentials,
// and the answer back as JSON. Binary fields travel as base64url.

function toBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function toB64u(buffer) {
  let s = '';
  for (const byte of new Uint8Array(buffer)) s += String.fromCharCode(byte);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const credentialList = (list) => (list || []).map((c) => ({ ...c, id: toBytes(c.id) }));

/** Whether this browser can create and use passkeys. */
export function passkeysSupported() {
  return typeof window.PublicKeyCredential === 'function' && Boolean(navigator.credentials?.create);
}

/** Makes a passkey on this device (the person confirms with a fingerprint, face or PIN). */
export async function createPasskey(options) {
  const publicKey = { ...options, challenge: toBytes(options.challenge), user: { ...options.user, id: toBytes(options.user.id) }, excludeCredentials: credentialList(options.excludeCredentials) };
  const cred = await navigator.credentials.create({ publicKey });
  const r = cred.response;
  return {
    id: cred.id,
    rawId: toB64u(cred.rawId),
    type: cred.type,
    authenticatorAttachment: cred.authenticatorAttachment || undefined,
    clientExtensionResults: cred.getClientExtensionResults(),
    response: {
      clientDataJSON: toB64u(r.clientDataJSON),
      attestationObject: toB64u(r.attestationObject),
      transports: typeof r.getTransports === 'function' ? r.getTransports() : [],
    },
  };
}

/** Signs in with a passkey on this device, or on a phone nearby. */
export async function getPasskey(options) {
  const publicKey = { ...options, challenge: toBytes(options.challenge), allowCredentials: credentialList(options.allowCredentials) };
  const cred = await navigator.credentials.get({ publicKey });
  const r = cred.response;
  return {
    id: cred.id,
    rawId: toB64u(cred.rawId),
    type: cred.type,
    authenticatorAttachment: cred.authenticatorAttachment || undefined,
    clientExtensionResults: cred.getClientExtensionResults(),
    response: {
      clientDataJSON: toB64u(r.clientDataJSON),
      authenticatorData: toB64u(r.authenticatorData),
      signature: toB64u(r.signature),
      userHandle: r.userHandle ? toB64u(r.userHandle) : undefined,
    },
  };
}

/** The message for a browser's refusal: cancelled or timed out, or this device already has one. */
export function passkeyErrorKey(err) {
  if (err?.name === 'InvalidStateError') return 'passkeys.exists';
  if (err?.name === 'NotAllowedError' || err?.name === 'AbortError') return 'passkeys.cancelled';
  return null;
}
