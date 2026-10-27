import { createServer } from 'node:net';
import { crc32, deflateSync } from 'node:zlib';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clamdScanner, PHOTO_MAX_SIDE, preparePhoto } from '../../src/classroom/file-checks.js';
import { EICAR, startFakeClamd } from '../helpers/fake-clamd.js';

let clamd: Awaited<ReturnType<typeof startFakeClamd>>;
beforeAll(async () => {
  clamd = await startFakeClamd();
});
afterAll(async () => clamd.close());

/** A port nothing listens on. */
async function closedPort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const port = (s.address() as { port: number }).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

describe('ClamAV daemon client (clamd INSTREAM over TCP)', () => {
  it('reports clean files and viruses, sending the file in 64 KB chunks', async () => {
    clamd.mode = 'scan';
    const scanner = clamdScanner('127.0.0.1', clamd.port);
    expect(await scanner.ping()).toBe(true);
    const big = Buffer.alloc(200 * 1024, 7);
    clamd.chunkSizes.length = 0;
    expect(await scanner.scan(big)).toEqual({ clean: true });
    expect(clamd.chunkSizes).toEqual([65536, 65536, 65536, 200 * 1024 - 3 * 65536]);
    expect(clamd.streams.at(-1)!.equals(big)).toBe(true);
    expect(await scanner.scan(Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from(EICAR)]))).toEqual({ clean: false, virus: 'Eicar-Test-Signature' });
  });

  it('throws when clamd reports an error, hangs up, does not answer in time, or cannot be reached', async () => {
    const scanner = clamdScanner('127.0.0.1', clamd.port, 300);
    clamd.mode = 'error';
    await expect(scanner.scan(Buffer.from('%PDF-1.4'))).rejects.toThrow(/clamd: stream: Can't allocate memory ERROR/);
    clamd.mode = 'close';
    await expect(scanner.scan(Buffer.from('%PDF-1.4'))).rejects.toThrow(/clamd: no answer/);
    clamd.mode = 'hang';
    await expect(scanner.scan(Buffer.from('%PDF-1.4'))).rejects.toThrow(/did not answer within 0.3 s/);
    clamd.mode = 'scan';
    const port = await closedPort();
    await expect(clamdScanner('127.0.0.1', port).scan(Buffer.from('%PDF-1.4'))).rejects.toThrow(/ECONNREFUSED/);
    expect(await clamdScanner('127.0.0.1', port).ping()).toBe(false);
  });
});

/** A PNG whose header claims width × height pixels, with almost no image data: decoding it would need gigabytes. */
function pngHeaderOnly(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.alloc(16))), chunk('IEND', Buffer.alloc(0))]);
}

describe('photos', () => {
  it('makes a large phone photo at most 2000 px and drops its EXIF, location included', async () => {
    const photo = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: { r: 200, g: 120, b: 40 } } })
      .jpeg({ quality: 95 })
      .withExif({ IFD0: { Make: 'PhoneMaker', Model: 'Phone 12' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '30/1 2/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '31/1 14/1 0/1' } })
      .toBuffer();
    const before = await sharp(photo).metadata();
    expect(before.exif?.toString('latin1')).toContain('PhoneMaker');
    const out = await preparePhoto(photo, 'image/jpeg');
    const after = await sharp(out).metadata();
    expect([after.format, after.width, after.height]).toEqual(['jpeg', PHOTO_MAX_SIDE, 1500]);
    expect(after.exif).toBeUndefined();
    expect(out.toString('latin1')).not.toContain('PhoneMaker');
  });

  it('turns a photo upright from its EXIF orientation', async () => {
    // Stored 300 × 100 with "rotate 90° clockwise to view": upright it is 100 × 300.
    const photo = await sharp({ create: { width: 300, height: 100, channels: 3, background: '#336699' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    expect((await sharp(photo).metadata()).orientation).toBe(6);
    const after = await sharp(await preparePhoto(photo, 'image/jpeg')).metadata();
    expect([after.width, after.height, after.orientation]).toEqual([100, 300, undefined]);
  });

  it('keeps the format, never enlarges, and refuses what is not a readable image of its type', async () => {
    const png = await sharp({ create: { width: 50, height: 40, channels: 4, background: '#00000000' } }).png().toBuffer();
    expect(await sharp(await preparePhoto(png, 'image/png')).metadata()).toMatchObject({ format: 'png', width: 50, height: 40 });
    const webp = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: '#ffffff' } }).webp().toBuffer();
    expect(await sharp(await preparePhoto(webp, 'image/webp')).metadata()).toMatchObject({ format: 'webp', width: 2000, height: 1000 });

    await expect(preparePhoto(png, 'image/jpeg')).rejects.toThrow(/not a jpeg image/);
    await expect(preparePhoto(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(500, 1)]), 'image/jpeg')).rejects.toThrow();
    // A header claiming 20,000 × 20,000 pixels is refused before anything is decoded.
    await expect(preparePhoto(pngHeaderOnly(20_000, 20_000), 'image/png')).rejects.toThrow(/pixel limit/);
  });
});
