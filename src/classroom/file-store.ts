import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { sql } from 'kysely';
import type { AppConfig } from '../config.js';
import { withSystemContext, type Database, type Executor } from '../db/index.js';
import { decryptSecret, encryptSecret, type KeyRing } from '../lib/crypto.js';
import { AppError } from '../lib/errors.js';

// Homework files in an S3-compatible bucket (docs/CLASSROOM.md §5, FILE_STORAGE=s3).
//
// - Each object is encrypted before it leaves the application (AES-256-GCM) with a key of its own, made for it.
//   That key is kept in the file's row, encrypted with DATA_ENCRYPTION_KEY (classroom_files.storage_dek_enc), so
//   the bucket alone reveals nothing, a key rotation re-encrypts only the small keys (src/ops/data-keys.ts), and
//   the object's name is bound to its contents (a file copied under another name does not decrypt).
// - Objects are never deleted while the request or transaction that removes a file runs: removing the row queues
//   its object in object_deletions (a trigger, migration 0026), in the same transaction, and the worker deletes
//   queued objects afterwards (runObjectDeletions). A rolled-back removal therefore keeps its object.
// - An object is written before the row that names it, so a new object is first queued for deletion
//   ("reserved", with a delay); the transaction that inserts the row takes it off the queue (keepObject). An
//   upload that fails after the object was written, or a crash, leaves nothing behind for long.

/** A bucket: bytes in, bytes out. Errors are thrown as they are; callers decide what the user sees. */
export interface ObjectStore {
  put(key: string, body: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  /** Succeeds when the object is already gone. */
  delete(key: string): Promise<void>;
  /** Throws unless the bucket can be reached with these credentials. */
  check(): Promise<void>;
  /** For logs and the command-line tools: the bucket and endpoint, never the keys. */
  readonly description: string;
}

const REQUEST_TIMEOUT_MS = 30_000;

/** The bucket in the S3_* settings, or null when none is set. */
export function createObjectStore(
  config: Pick<AppConfig, 'S3_ENDPOINT' | 'S3_REGION' | 'S3_BUCKET' | 'S3_ACCESS_KEY_ID' | 'S3_SECRET_ACCESS_KEY' | 'S3_FORCE_PATH_STYLE'>,
): ObjectStore | null {
  const bucket = config.S3_BUCKET;
  if (!bucket || !config.S3_ACCESS_KEY_ID || !config.S3_SECRET_ACCESS_KEY) return null;
  const client = new S3Client({
    region: config.S3_REGION,
    ...(config.S3_ENDPOINT ? { endpoint: config.S3_ENDPOINT } : {}),
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    credentials: { accessKeyId: config.S3_ACCESS_KEY_ID, secretAccessKey: config.S3_SECRET_ACCESS_KEY },
    // Several S3-compatible services reject the checksums the SDK adds by default since 2025; S3 does not need them.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    maxAttempts: 3,
    requestHandler: { connectionTimeout: 5_000, requestTimeout: REQUEST_TIMEOUT_MS, throwOnRequestTimeout: true },
  });
  return {
    // The endpoint's origin only: no user name or password that a URL might carry.
    description: `bucket ${bucket} at ${config.S3_ENDPOINT ? new URL(config.S3_ENDPOINT).origin : `Amazon S3 (${config.S3_REGION})`}`,
    async put(key, body) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentLength: body.length, ContentType: 'application/octet-stream' }));
    },
    async get(key) {
      const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!res.Body) throw new Error(`object ${key} has no body`);
      return Buffer.from(await res.Body.transformToByteArray());
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
    async check() {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
    },
  };
}

// ------------------------------------------------------------ encrypted objects

const MAGIC = Buffer.from('MDF1');
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** The object as stored: MAGIC, IV, ciphertext, GCM tag. The object's name is the additional data. */
export function sealObject(key: string, data: Buffer, dek: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', dek, iv);
  cipher.setAAD(Buffer.from(key, 'utf8'));
  const ct = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([MAGIC, iv, ct, cipher.getAuthTag()]);
}

export function openObject(key: string, body: Buffer, dek: Buffer): Buffer {
  if (body.length < MAGIC.length + IV_BYTES + TAG_BYTES || !body.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error(`object ${key} is not an encrypted homework file`);
  }
  const iv = body.subarray(MAGIC.length, MAGIC.length + IV_BYTES);
  const tag = body.subarray(body.length - TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', dek, iv);
  decipher.setAAD(Buffer.from(key, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body.subarray(MAGIC.length + IV_BYTES, body.length - TAG_BYTES)), decipher.final()]);
}

/** Where a file's bytes are: in the row, or in the bucket under storage_key. */
export interface StoredObject {
  storage_key: string;
  /** The object's own key, encrypted with DATA_ENCRYPTION_KEY. */
  storage_dek_enc: string;
}

/** How long a new object waits on the deletion queue for the row that names it (see keepObject). */
export const RESERVATION_MINUTES = 30;

/** Homework files in a bucket, encrypted with the application's key ring. */
export interface FileObjects {
  readonly bucket: ObjectStore;
  readonly ring: KeyRing;
  /**
   * Writes `data` as a new, encrypted object of the school's, queued for deletion until a row names it (keepObject
   * in the same transaction as that row). The queue entry is committed on its own, before the object is written,
   * so it outlives a failed transaction.
   */
  write(db: Database, orgId: string, data: Buffer): Promise<StoredObject>;
  /** Reads and decrypts an object. */
  read(o: StoredObject): Promise<Buffer>;
}

export function fileObjects(bucket: ObjectStore, ring: KeyRing): FileObjects {
  return {
    bucket,
    ring,
    async write(db, orgId, data) {
      const key = `homework/${orgId}/${randomUUID()}`;
      const dek = randomBytes(32);
      // On its own (not in the caller's transaction), so that it is committed before the object exists.
      await db.insertInto('object_deletions').values({ key, due_at: sql<Date>`now() + make_interval(mins => ${RESERVATION_MINUTES})` }).execute();
      await bucket.put(key, sealObject(key, data, dek));
      return { storage_key: key, storage_dek_enc: encryptSecret(ring, dek.toString('base64')) };
    },
    async read(o) {
      const body = await bucket.get(o.storage_key);
      return openObject(o.storage_key, body, Buffer.from(decryptSecret(ring, o.storage_dek_enc), 'base64'));
    },
  };
}

/** The bucket in the S3_* settings with the application's keys, or null when no bucket is set. */
export function createFileObjects(config: Parameters<typeof createObjectStore>[0] & Pick<AppConfig, 'dataKeys'>): FileObjects | null {
  const bucket = createObjectStore(config);
  return bucket ? fileObjects(bucket, config.dataKeys) : null;
}

/**
 * Takes a new object off the deletion queue; call in the transaction that writes the row naming it. Throws when the
 * object is no longer queued (the worker deleted it: the transaction took longer than RESERVATION_MINUTES).
 */
export async function keepObject(exec: Executor, key: string): Promise<void> {
  const r = await exec.deleteFrom('object_deletions').where('key', '=', key).executeTakeFirst();
  if (Number(r.numDeletedRows) !== 1) throw new Error(`object ${key} was already deleted; the file must be saved again`);
}

export const STORAGE_UNAVAILABLE = () =>
  new AppError(503, 'FILE_STORAGE_UNAVAILABLE', 'Files cannot be opened or saved right now. Try again in a few minutes.');

/**
 * For an upload: the new file's object in the bucket when FILE_STORAGE=s3, or null when its bytes go in the row.
 * Call before taking the school's lock (the bucket is called over the network).
 */
export async function storeUpload(
  ctx: { config: Pick<AppConfig, 'FILE_STORAGE'>; db: Database; files: FileObjects | null },
  orgId: string,
  data: Buffer,
): Promise<StoredObject | null> {
  if (ctx.config.FILE_STORAGE !== 's3') return null;
  if (!ctx.files) throw STORAGE_UNAVAILABLE();
  try {
    return await ctx.files.write(ctx.db, orgId, data);
  } catch (err) {
    throw Object.assign(STORAGE_UNAVAILABLE(), { cause: err });
  }
}

/**
 * A file's bytes, from its row or from the bucket. Throws FILE_STORAGE_UNAVAILABLE (503) when the bucket is not
 * configured or cannot be reached; a file that cannot be decrypted is a server error.
 */
export async function fileBytes(
  files: FileObjects | null,
  f: { data: Buffer | null; storage_key: string | null; storage_dek_enc: string | null },
): Promise<Buffer> {
  if (f.data) return f.data;
  if (!f.storage_key || !f.storage_dek_enc) throw new Error('the file has no bytes (it was blocked)');
  if (!files) throw STORAGE_UNAVAILABLE();
  let body: Buffer;
  try {
    body = await files.bucket.get(f.storage_key);
  } catch (err) {
    throw Object.assign(STORAGE_UNAVAILABLE(), { cause: err });
  }
  return openObject(f.storage_key, body, Buffer.from(decryptSecret(files.ring, f.storage_dek_enc), 'base64'));
}

// ------------------------------------------------------------ the worker's deletion pass

export interface ObjectDeletionResult {
  deleted: number;
  /** Queued objects a row names again (a restored backup); taken off the queue, not deleted. */
  kept: number;
  failed: number;
  /** Queued objects waiting because no bucket is configured. */
  waiting?: number;
  error?: string;
}

export const OBJECT_DELETION_BATCH = 100;
const MAX_RETRY_MINUTES = 6 * 60;

/**
 * Deletes due objects from the bucket and takes them off the queue. An object a row names (for example after a
 * database restore) is never deleted. A failure is retried later, waiting longer each time (up to six hours).
 */
export async function runObjectDeletions(db: Database, store: ObjectStore | null, batch = OBJECT_DELETION_BATCH): Promise<ObjectDeletionResult> {
  const result: ObjectDeletionResult = { deleted: 0, kept: 0, failed: 0 };
  if (!store) {
    const r = await withSystemContext(db, (trx) =>
      trx.selectFrom('object_deletions').select((eb) => eb.fn.countAll<string>().as('n')).where('due_at', '<=', sql<Date>`now()`).executeTakeFirstOrThrow(),
    );
    if (Number(r.n)) result.waiting = Number(r.n);
    return result;
  }
  await withSystemContext(db, async (trx) => {
    const due = await trx
      .selectFrom('object_deletions as d')
      .select(['d.key', 'd.attempts'])
      .select((eb) => eb.exists(eb.selectFrom('classroom_files as f').select('f.id').whereRef('f.storage_key', '=', 'd.key')).as('named'))
      // The database's clock, which also stamped due_at (microseconds; a JavaScript Date has milliseconds).
      .where('d.due_at', '<=', sql<Date>`now()`)
      .orderBy('d.due_at')
      .limit(batch)
      .forUpdate('d')
      .skipLocked()
      .execute();
    for (const d of due) {
      if (!d.named) {
        try {
          await store.delete(d.key);
        } catch (err) {
          result.failed++;
          result.error = (err instanceof Error ? `${err.name}: ${err.message}` : String(err)).slice(0, 500);
          const minutes = Math.min(MAX_RETRY_MINUTES, 2 ** Math.min(d.attempts, 12));
          await trx
            .updateTable('object_deletions')
            .set({ attempts: d.attempts + 1, last_error: result.error, due_at: sql<Date>`now() + make_interval(mins => ${minutes})` })
            .where('key', '=', d.key)
            .execute();
          continue;
        }
        result.deleted++;
      } else {
        result.kept++;
      }
      await trx.deleteFrom('object_deletions').where('key', '=', d.key).execute();
    }
  });
  return result;
}
