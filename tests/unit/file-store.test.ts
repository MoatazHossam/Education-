import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fileObjects, openObject, sealObject, type ObjectStore } from '../../src/classroom/file-store.js';
import { loadConfig } from '../../src/config.js';
import { TEST_ENV } from '../helpers/env.js';

// Homework files in a bucket (src/classroom/file-store.ts): each object encrypted with its own key, bound to its name;
// and the settings that choose the bucket.

const KEY = 'homework/2b1f0c8e-0d3c-4a5e-9f1a-111111111111/3c2e1d9f-1e4d-4b6f-8a2b-222222222222';
const DATA = Buffer.from('%PDF-1.4 the homework of a student\n');

describe('encrypted objects', () => {
  it('round-trips, and hides the contents and their length only up to the fixed overhead', () => {
    const dek = randomBytes(32);
    const sealed = sealObject(KEY, DATA, dek);
    expect(sealed.length).toBe(DATA.length + 32);
    expect(sealed.includes(DATA.subarray(0, 8))).toBe(false);
    expect(openObject(KEY, sealed, dek).equals(DATA)).toBe(true);
    // A fresh IV each time: the same file twice gives different objects.
    expect(sealObject(KEY, DATA, dek).equals(sealed)).toBe(false);
  });

  it('refuses another key, another name, a changed byte, a cut object and a foreign one', () => {
    const dek = randomBytes(32);
    const sealed = sealObject(KEY, DATA, dek);
    expect(() => openObject(KEY, sealed, randomBytes(32))).toThrow();
    expect(() => openObject(`${KEY.slice(0, -1)}3`, sealed, dek)).toThrow();
    for (const at of [4, 16, sealed.length - 1]) {
      const changed = Buffer.from(sealed);
      changed[at] = changed[at]! ^ 0x80;
      expect(() => openObject(KEY, changed, dek)).toThrow();
    }
    expect(() => openObject(KEY, sealed.subarray(0, sealed.length - 1), dek)).toThrow();
    expect(() => openObject(KEY, sealed.subarray(0, 20), dek)).toThrow(/not an encrypted homework file/);
    expect(() => openObject(KEY, Buffer.concat([Buffer.from('PK\x03\x04'), sealed.subarray(4)]), dek)).toThrow(/not an encrypted homework file/);
  });

  it('keeps each object’s key encrypted with the application key ring, and reads with the previous key after a rotation', async () => {
    const objects = new Map<string, Buffer>();
    const bucket: ObjectStore = {
      description: 'memory',
      put: async (k, b) => void objects.set(k, b),
      get: async (k) => objects.get(k)!,
      delete: async (k) => void objects.delete(k),
      check: async () => undefined,
    };
    const oldKey = randomBytes(32).toString('base64');
    const inserted: string[] = [];
    const db = { insertInto: () => ({ values: (v: { key: string }) => ({ execute: async () => void inserted.push(v.key) }) }) } as never;
    const stored = await fileObjects(bucket, { current: oldKey, previous: [] }).write(db, '2b1f0c8e-0d3c-4a5e-9f1a-111111111111', DATA);
    expect(inserted).toEqual([stored.storage_key]); // reserved before the object was written
    expect(stored.storage_dek_enc).toMatch(/^v2\./);
    expect(stored.storage_dek_enc).not.toContain(objects.get(stored.storage_key)!.toString('base64').slice(0, 12));
    const rotated = fileObjects(bucket, { current: randomBytes(32).toString('base64'), previous: [oldKey] });
    expect((await rotated.read(stored)).equals(DATA)).toBe(true);
    await expect(fileObjects(bucket, { current: randomBytes(32).toString('base64'), previous: [] }).read(stored)).rejects.toThrow(/not configured/);
  });
});

describe('file storage settings', () => {
  const S3 = { S3_BUCKET: 'midad-files', S3_ACCESS_KEY_ID: 'AKIAEXAMPLE', S3_SECRET_ACCESS_KEY: 'secret-example-0123456789' };
  const prod = {
    ...TEST_ENV,
    NODE_ENV: 'production',
    APP_URL: 'https://midad.example',
    EMAIL_TRANSPORT: 'smtp',
    SMTP_URL: 'smtp://mail.example:587',
    BILLING_PROVIDER: 'disabled',
    FILE_SCAN: 'off',
  };

  it('keeps files in the database unless told otherwise', () => {
    const c = loadConfig({ ...TEST_ENV });
    expect([c.FILE_STORAGE, c.S3_REGION, c.S3_FORCE_PATH_STYLE, c.S3_BUCKET]).toEqual(['database', 'us-east-1', false, undefined]);
  });

  it('needs a bucket for s3, and both parts of the access key with a bucket', () => {
    expect(() => loadConfig({ ...TEST_ENV, FILE_STORAGE: 's3' })).toThrow('S3_BUCKET is required when FILE_STORAGE=s3');
    expect(() => loadConfig({ ...TEST_ENV, S3_BUCKET: 'midad-files', S3_ACCESS_KEY_ID: 'AKIAEXAMPLE' })).toThrow('S3_SECRET_ACCESS_KEY is required when S3_BUCKET is set');
    expect(() => loadConfig({ ...TEST_ENV, FILE_STORAGE: 's3', S3_BUCKET: 'midad-files' })).toThrow(/S3_ACCESS_KEY_ID is required[\s\S]*S3_SECRET_ACCESS_KEY is required/);
    expect(loadConfig({ ...TEST_ENV, FILE_STORAGE: 's3', ...S3, S3_REGION: 'auto' })).toMatchObject({ FILE_STORAGE: 's3', S3_REGION: 'auto' });
    expect(() => loadConfig({ ...TEST_ENV, ...S3, S3_BUCKET: 'Bad_Bucket' })).toThrow(/S3_BUCKET must be a bucket name/);
    expect(() => loadConfig({ ...TEST_ENV, FILE_STORAGE: 'disk' })).toThrow(/FILE_STORAGE/);
  });

  it('needs an https endpoint in production', () => {
    expect(() => loadConfig({ ...prod, FILE_STORAGE: 's3', ...S3, S3_ENDPOINT: 'http://minio:9000' })).toThrow('S3_ENDPOINT must use https in production');
    expect(loadConfig({ ...prod, FILE_STORAGE: 's3', ...S3, S3_ENDPOINT: 'https://account.r2.cloudflarestorage.com' }).S3_ENDPOINT).toBe('https://account.r2.cloudflarestorage.com');
    expect(loadConfig({ ...prod, FILE_STORAGE: 's3', ...S3 }).S3_ENDPOINT).toBeUndefined(); // Amazon S3
  });

  it('gives the worker the bucket too (it checks and deletes files)', () => {
    expect(loadConfig({ ...TEST_ENV, FILE_STORAGE: 's3', ...S3 }, 'worker')).toMatchObject({ FILE_STORAGE: 's3', S3_BUCKET: 'midad-files' });
  });
});
