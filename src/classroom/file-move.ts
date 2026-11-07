import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import { withSystemContext, type Database } from '../db/index.js';
import { keepObject, runObjectDeletions, type FileObjects } from './file-store.js';

// Moves the bytes of homework files that are already stored between the database and the bucket
// (npm run files:move, src/cli/move-files.ts; docs/DEPLOYMENT_GUIDE.md, "Homework files in object storage").
// New uploads go where FILE_STORAGE says; this moves the others. Each file is moved on its own: its bytes are
// written to the other place, read back and compared with the file's SHA-256, and only then is the row switched
// to the new place, in one statement that also checks the row did not change meanwhile. A file that changed, was
// removed or is still being checked by the worker is left as it is and counted; running the move again picks it
// up. Bytes are never lost in between: until the row is switched, the old place still holds them.

export type FilePlace = 'database' | 's3';

export interface FilePlaces {
  database: { files: number; bytes: number };
  s3: { files: number; bytes: number };
  /** Files the worker has not checked yet (they are moved once ready). */
  pending: number;
}

export interface MoveResult {
  to: FilePlace;
  moved: number;
  bytes: number;
  /** Changed, removed or not checked yet while moving; moved by a later run. */
  skipped: number;
  /** Could not be written, read back or matched; ids, for the log. */
  failed: { id: string; error: string }[];
  /** Objects deleted from the bucket after a move into the database. */
  objectsDeleted: number;
}

const BATCH = 50;
const NO_ID = '00000000-0000-0000-0000-000000000000';
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const errorText = (err: unknown) => (err instanceof Error ? `${err.name}: ${err.message}` : String(err)).slice(0, 300);

/** Where the files' bytes are, across all schools. */
export async function filePlaces(db: Database): Promise<FilePlaces> {
  return withSystemContext(db, async (trx) => {
    const { rows } = await sql<{ place: string; files: string; bytes: string }>`
      SELECT CASE WHEN data IS NOT NULL THEN 'database' WHEN storage_key IS NOT NULL THEN 's3' ELSE 'none' END AS place,
             count(*) AS files, coalesce(sum(size_bytes), 0) AS bytes
      FROM classroom_files GROUP BY 1`.execute(trx);
    const pending = await trx.selectFrom('classroom_files').select((eb) => eb.fn.countAll<string>().as('n')).where('status', '=', 'pending').executeTakeFirstOrThrow();
    const of = (place: string) => {
      const r = rows.find((x) => x.place === place);
      return { files: Number(r?.files ?? 0), bytes: Number(r?.bytes ?? 0) };
    };
    return { database: of('database'), s3: of('s3'), pending: Number(pending.n) };
  });
}

/** Moves every checked file's bytes to `to`. `onProgress` is called after each batch. */
export async function moveFiles(db: Database, files: FileObjects, to: FilePlace, onProgress?: (r: MoveResult) => void): Promise<MoveResult> {
  const result: MoveResult = { to, moved: 0, bytes: 0, skipped: 0, failed: [], objectsDeleted: 0 };
  let after = NO_ID;
  for (;;) {
    const rows = await withSystemContext(db, (trx) =>
      trx
        .selectFrom('classroom_files')
        .select(['id', 'org_id', 'status', 'sha256', 'size_bytes', 'data', 'storage_key', 'storage_dek_enc'])
        .where(to === 's3' ? 'data' : 'storage_key', 'is not', null)
        .where('id', '>', after)
        .orderBy('id')
        .limit(BATCH)
        .execute(),
    );
    if (!rows.length) break;
    after = rows[rows.length - 1]!.id;
    for (const f of rows) {
      // The worker may still replace a pending file's bytes (a resized photo); it is moved once ready.
      if (f.status !== 'ready') {
        result.skipped++;
        continue;
      }
      try {
        if (to === 's3') {
          const stored = await files.write(db, f.org_id, f.data!);
          const back = await files.read(stored);
          if (!back.equals(f.data!)) throw new Error('the object read back differs from the file');
          const switched = await withSystemContext(db, async (trx) => {
            const r = await trx
              .updateTable('classroom_files')
              .set({ data: null, storage_key: stored.storage_key, storage_dek_enc: stored.storage_dek_enc })
              .where('id', '=', f.id)
              .where('sha256', '=', f.sha256)
              .where('status', '=', 'ready')
              .where('data', 'is not', null)
              .executeTakeFirst();
            if (Number(r.numUpdatedRows) !== 1) return false;
            await keepObject(trx, stored.storage_key);
            return true;
          });
          if (!switched) {
            // Changed or removed meanwhile: the new object goes at once.
            await withSystemContext(db, (trx) => trx.updateTable('object_deletions').set({ due_at: sql<Date>`now()` }).where('key', '=', stored.storage_key).execute());
            result.skipped++;
            continue;
          }
        } else {
          const data = await files.read({ storage_key: f.storage_key!, storage_dek_enc: f.storage_dek_enc! });
          if (sha256(data) !== f.sha256) throw new Error('the object does not match the file’s SHA-256');
          // Switching the row queues the object for deletion (trigger, migration 0026).
          const r = await withSystemContext(db, (trx) =>
            trx
              .updateTable('classroom_files')
              .set({ data, storage_key: null, storage_dek_enc: null })
              .where('id', '=', f.id)
              .where('storage_key', '=', f.storage_key)
              .where('status', '=', 'ready')
              .executeTakeFirst(),
          );
          if (Number(r.numUpdatedRows) !== 1) {
            result.skipped++;
            continue;
          }
        }
        result.moved++;
        result.bytes += f.size_bytes;
      } catch (err) {
        result.failed.push({ id: f.id, error: errorText(err) });
      }
    }
    onProgress?.(result);
  }
  if (to === 'database') {
    // The moved objects were queued for deletion; delete them now, while this has the bucket's settings.
    for (;;) {
      const d = await runObjectDeletions(db, files.bucket);
      result.objectsDeleted += d.deleted;
      if (d.failed || d.deleted + d.kept === 0) break;
    }
  }
  return result;
}
