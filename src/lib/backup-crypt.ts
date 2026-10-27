import { createCipheriv, createDecipheriv, randomBytes, scrypt, type DecipherGCM } from 'node:crypto';
import { Transform, type Readable, type Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// Passphrase encryption of backup archives (ops/backup.sh, ops\cs.ps1). The scripts run
// it from the app image, so a host needs nothing but Docker. Layout:
//   "CSBACKUP1\n" | salt (16) | IV (12) | AES-256-GCM ciphertext | tag (16)
// The key comes from scrypt (N=2^15, r=8, p=1). Decryption streams the plaintext out and
// checks the tag at the end: callers write to a temporary file and keep it only on success.

export const MAGIC = Buffer.from('CSBACKUP1\n');
const SALT = 16;
const IV = 12;
const TAG = 16;
export const MIN_PASSPHRASE = 12;

function deriveKey(passphrase: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(passphrase, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function encryptStream(passphrase: string, input: Readable, output: Writable): Promise<void> {
  if (passphrase.length < MIN_PASSPHRASE) throw new Error(`The passphrase must be at least ${MIN_PASSPHRASE} characters`);
  const salt = randomBytes(SALT);
  const iv = randomBytes(IV);
  const cipher = createCipheriv('aes-256-gcm', await deriveKey(passphrase, salt), iv);
  let started = false;
  const frame = new Transform({
    transform(chunk: Buffer, _enc, done) {
      if (!started) {
        started = true;
        this.push(Buffer.concat([MAGIC, salt, iv]));
      }
      done(null, cipher.update(chunk));
    },
    flush(done) {
      if (!started) this.push(Buffer.concat([MAGIC, salt, iv]));
      this.push(cipher.final());
      done(null, cipher.getAuthTag());
    },
  });
  await pipeline(input, frame, output);
}

export async function decryptStream(passphrase: string, input: Readable, output: Writable): Promise<void> {
  const head = MAGIC.length + SALT + IV;
  let header = Buffer.alloc(0);
  let decipher: DecipherGCM | null = null;
  // The last TAG bytes are the tag, so they are held back until the input ends.
  let held = Buffer.alloc(0);
  const frame = new Transform({
    async transform(chunk: Buffer, _enc, done) {
      try {
        if (!decipher) {
          header = Buffer.concat([header, chunk]);
          if (header.length < head) return done();
          if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Not an encrypted backup (unknown format)');
          const salt = header.subarray(MAGIC.length, MAGIC.length + SALT);
          const iv = header.subarray(MAGIC.length + SALT, head);
          decipher = createDecipheriv('aes-256-gcm', await deriveKey(passphrase, salt), iv);
          chunk = header.subarray(head);
        }
        held = Buffer.concat([held, chunk]);
        if (held.length <= TAG) return done();
        const out = decipher.update(held.subarray(0, held.length - TAG));
        held = held.subarray(held.length - TAG);
        done(null, out);
      } catch (err) {
        done(err as Error);
      }
    },
    flush(done) {
      try {
        if (!decipher || held.length !== TAG) throw new Error('The file is too short to be an encrypted backup');
        decipher.setAuthTag(held);
        done(null, decipher.final());
      } catch (err) {
        const msg = (err as Error).message;
        done(new Error(/auth|tag/i.test(msg) ? 'Wrong passphrase, or the file is damaged' : msg));
      }
    },
  });
  await pipeline(input, frame, output);
}
