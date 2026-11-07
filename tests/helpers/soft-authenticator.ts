import { createHash, createSign, generateKeyPairSync, randomBytes, type KeyObject } from 'node:crypto';

// A software passkey authenticator for the integration tests: what a phone, a laptop or a security key does in
// navigator.credentials.create() and .get(), built from the WebAuthn Level 3 specification
// (https://www.w3.org/TR/webauthn-3/): ES256 (P-256) keys, "none" attestation, a client data JSON with the
// challenge and origin, authenticator data with the flags and signature counter, and the signature over
// authenticator data || SHA-256(client data). Each step can be made wrong on purpose, to test what the server refuses.

const b64u = (b: Uint8Array) => Buffer.from(b).toString('base64url');
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest();

// CBOR (RFC 8949), only what attestation objects and COSE keys need: integers, byte and text strings, maps.
function head(major: number, n: number): Buffer {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 256) return Buffer.from([(major << 5) | 24, n]);
  if (n < 65536) {
    const b = Buffer.alloc(3);
    b[0] = (major << 5) | 25;
    b.writeUInt16BE(n, 1);
    return b;
  }
  const b = Buffer.alloc(5);
  b[0] = (major << 5) | 26;
  b.writeUInt32BE(n, 1);
  return b;
}
type Cbor = number | string | Uint8Array | Map<number | string, Cbor>;
function cbor(v: Cbor): Buffer {
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === 'string') {
    const s = Buffer.from(v, 'utf8');
    return Buffer.concat([head(3, s.length), s]);
  }
  if (v instanceof Uint8Array) return Buffer.concat([head(2, v.length), Buffer.from(v)]);
  return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, val]) => [cbor(k), cbor(val)])]);
}

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_BE = 0x08;
const FLAG_BS = 0x10;
const FLAG_AT = 0x40;

interface Credential {
  id: Buffer;
  privateKey: KeyObject;
  userHandle: string;
  counter: number;
}

/** What may be made wrong in one ceremony. */
export interface Tamper {
  origin?: string;
  rpId?: string;
  challenge?: string;
  userVerified?: boolean;
  /** The signature counter to report (sign-in), instead of the next one. */
  counter?: number;
  /** A user handle other than the credential's. */
  userHandle?: string;
  /** Sign over other bytes than the ones sent. */
  badSignature?: boolean;
}

interface CreationOptions {
  challenge: string;
  rp: { id?: string };
  user: { id: string };
  excludeCredentials?: { id: string }[];
}
interface RequestOptions {
  challenge: string;
  rpId?: string;
}

export class SoftAuthenticator {
  readonly credentials: Credential[] = [];

  /**
   * @param origin the page's origin, as the browser would report it
   * @param counting whether the authenticator keeps a signature counter (security keys do; synced passkeys report 0)
   * @param synced whether the passkey is backed up (synced across the person's devices)
   */
  constructor(private readonly origin: string, private readonly opts: { counting?: boolean; synced?: boolean } = {}) {}

  /** navigator.credentials.create() */
  create(options: CreationOptions, tamper: Tamper = {}) {
    const rpId = tamper.rpId ?? options.rp.id!;
    if (options.excludeCredentials?.some((c) => this.credentials.some((k) => b64u(k.id) === c.id))) throw new Error('InvalidStateError: already registered');
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' });
    const cose = cbor(new Map<number, Cbor>([
      [1, 2], // kty: EC2
      [3, -7], // alg: ES256
      [-1, 1], // crv: P-256
      [-2, Buffer.from(jwk.x!, 'base64url')],
      [-3, Buffer.from(jwk.y!, 'base64url')],
    ]));
    const id = randomBytes(32);
    const credIdLen = Buffer.alloc(2);
    credIdLen.writeUInt16BE(id.length);
    const counter = this.opts.counting ? 1 : 0;
    const authData = Buffer.concat([
      sha256(rpId),
      Buffer.from([this.flags(tamper) | FLAG_AT]),
      this.counterBytes(counter),
      Buffer.alloc(16), // AAGUID: unknown model, as with "none" attestation
      credIdLen,
      id,
      cose,
    ]);
    const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: tamper.challenge ?? options.challenge, origin: tamper.origin ?? this.origin, crossOrigin: false }));
    const attestationObject = cbor(new Map<string, Cbor>([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]));
    this.credentials.push({ id, privateKey, userHandle: options.user.id, counter });
    return {
      id: b64u(id),
      rawId: b64u(id),
      type: 'public-key' as const,
      authenticatorAttachment: 'platform' as const,
      clientExtensionResults: {},
      response: { clientDataJSON: b64u(clientDataJSON), attestationObject: b64u(attestationObject), transports: ['internal', 'hybrid'] },
    };
  }

  /** navigator.credentials.get(): with the given credential, or the newest one. */
  get(options: RequestOptions, tamper: Tamper = {}, credential = this.credentials.at(-1)!) {
    const rpId = tamper.rpId ?? options.rpId!;
    if (this.opts.counting) credential.counter += 1;
    const authData = Buffer.concat([sha256(rpId), Buffer.from([this.flags(tamper)]), this.counterBytes(tamper.counter ?? credential.counter)]);
    const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: tamper.challenge ?? options.challenge, origin: tamper.origin ?? this.origin, crossOrigin: false }));
    const signer = createSign('SHA256');
    signer.update(Buffer.concat([authData, sha256(clientDataJSON)]));
    if (tamper.badSignature) signer.update('x');
    const signature = signer.sign(credential.privateKey); // DER, as authenticators send it
    return {
      id: b64u(credential.id),
      rawId: b64u(credential.id),
      type: 'public-key' as const,
      authenticatorAttachment: 'platform' as const,
      clientExtensionResults: {},
      response: { clientDataJSON: b64u(clientDataJSON), authenticatorData: b64u(authData), signature: b64u(signature), userHandle: tamper.userHandle ?? credential.userHandle },
    };
  }

  private flags(tamper: Tamper): number {
    const synced = this.opts.synced ? FLAG_BE | FLAG_BS : 0;
    return FLAG_UP | (tamper.userVerified === false ? 0 : FLAG_UV) | synced;
  }

  private counterBytes(n: number): Buffer {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n);
    return b;
  }
}
