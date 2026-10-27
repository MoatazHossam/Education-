import { randomBytes } from 'node:crypto';
import { PassThrough, Readable, Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { decryptStream, encryptStream, MAGIC } from '../../src/lib/backup-crypt.js';

const PASS = 'correct horse battery';

/** Feeds `data` in chunks of `size` bytes, so headers and tags span chunk boundaries. */
const chunks = (data: Buffer, size: number) => Readable.from(Array.from({ length: Math.ceil(data.length / size) || 1 }, (_, i) => data.subarray(i * size, (i + 1) * size)));

async function run(fn: typeof encryptStream, pass: string, input: Readable): Promise<Buffer> {
  const parts: Buffer[] = [];
  const out = new Writable({ write(chunk: Buffer, _enc, done) { parts.push(chunk); done(); } });
  await fn(pass, input, out);
  return Buffer.concat(parts);
}

describe('backup archive encryption', () => {
  it('round-trips data of any size, whatever the chunk boundaries', async () => {
    for (const size of [0, 1, 15, 16, 17, 70_000, 1_100_000]) {
      const data = randomBytes(size);
      const sealed = await run(encryptStream, PASS, chunks(data, 4096));
      expect(sealed.subarray(0, MAGIC.length)).toEqual(MAGIC);
      expect(sealed.length).toBe(MAGIC.length + 16 + 12 + size + 16);
      if (size >= 64) expect(sealed.includes(data.subarray(0, 64))).toBe(false);
      for (const step of [1, 7, 37, 65_536]) {
        if (size > 100_000 && step < 37) continue;
        expect(await run(decryptStream, PASS, chunks(sealed, step))).toEqual(data);
      }
    }
  }, 60_000);

  it('refuses a wrong passphrase, a changed byte, a cut file, another format and a short passphrase', async () => {
    const data = Buffer.from('pg_dump archive '.repeat(1000));
    const sealed = await run(encryptStream, PASS, chunks(data, 1000));
    await expect(run(decryptStream, 'wrong passphrase!', chunks(sealed, 512))).rejects.toThrow('Wrong passphrase, or the file is damaged');
    const changed = Buffer.from(sealed);
    changed.writeUInt8(changed.readUInt8(MAGIC.length + 40) ^ 1, MAGIC.length + 40);
    await expect(run(decryptStream, PASS, chunks(changed, 512))).rejects.toThrow('Wrong passphrase, or the file is damaged');
    await expect(run(decryptStream, PASS, chunks(sealed.subarray(0, sealed.length - 5), 512))).rejects.toThrow('Wrong passphrase, or the file is damaged');
    await expect(run(decryptStream, PASS, chunks(Buffer.from('PGDMP plain dump, not encrypted at all'), 512))).rejects.toThrow('Not an encrypted backup');
    await expect(run(decryptStream, PASS, chunks(MAGIC, 512))).rejects.toThrow('too short');
    await expect(run(encryptStream, 'short', new PassThrough().end('x'))).rejects.toThrow('at least 12 characters');
  });

  it('uses a fresh salt and IV each time', async () => {
    const data = Buffer.from('same input');
    const a = await run(encryptStream, PASS, chunks(data, 100));
    const b = await run(encryptStream, PASS, chunks(data, 100));
    expect(a.equals(b)).toBe(false);
  });
});
