import { sql, type Kysely } from 'kysely';

// Homework files in an S3-compatible bucket (docs/CLASSROOM.md §5, src/classroom/file-store.ts, FILE_STORAGE=s3).
//
// - classroom_files.storage_key: the object's name in the bucket; storage_dek_enc: the object's own encryption key,
//   encrypted with DATA_ENCRYPTION_KEY. A file's bytes are in the row (data) or in the bucket, never both; a blocked
//   file (infected, unreadable) has neither.
// - object_deletions: objects to delete from the bucket. Removing a file's row, or replacing its object (a resized
//   photo), queues the old object in the same transaction (trigger below); the worker deletes it afterwards, so a
//   rolled-back removal keeps its object. A new object is queued with a delay before its row exists and taken off
//   the queue by the transaction that inserts the row, so a failed upload leaves nothing behind.
// The queue has no org_id: it holds object names only, for the worker (like rate_limits).
const UP = `
ALTER TABLE classroom_files
  ADD COLUMN storage_key text CHECK (storage_key ~ '^homework/[0-9a-f-]{36}/[0-9a-f-]{36}$'),
  ADD COLUMN storage_dek_enc text CHECK (length(storage_dek_enc) <= 500);
ALTER TABLE classroom_files ADD CONSTRAINT classroom_files_storage_pair_check
  CHECK ((storage_key IS NULL) = (storage_dek_enc IS NULL));
ALTER TABLE classroom_files ADD CONSTRAINT classroom_files_one_place_check
  CHECK (data IS NULL OR storage_key IS NULL);
ALTER TABLE classroom_files DROP CONSTRAINT classroom_files_data_status_check;
ALTER TABLE classroom_files ADD CONSTRAINT classroom_files_data_status_check
  CHECK ((data IS NULL AND storage_key IS NULL) = (status IN ('infected', 'unreadable')));
CREATE UNIQUE INDEX classroom_files_storage_key_idx ON classroom_files (storage_key) WHERE storage_key IS NOT NULL;

CREATE TABLE object_deletions (
  key text PRIMARY KEY CHECK (length(key) BETWEEN 1 AND 300),
  due_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  last_error text CHECK (length(last_error) <= 500),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX object_deletions_due_idx ON object_deletions (due_at);

CREATE FUNCTION queue_object_deletion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.storage_key IS NOT NULL AND (TG_OP = 'DELETE' OR NEW.storage_key IS DISTINCT FROM OLD.storage_key) THEN
    INSERT INTO object_deletions (key, due_at) VALUES (OLD.storage_key, now())
    ON CONFLICT (key) DO UPDATE SET due_at = LEAST(object_deletions.due_at, EXCLUDED.due_at);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER classroom_files_object_deletion AFTER DELETE OR UPDATE OF storage_key ON classroom_files
  FOR EACH ROW EXECUTE FUNCTION queue_object_deletion();
`;

const DOWN = `
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM classroom_files WHERE storage_key IS NOT NULL) THEN
    RAISE EXCEPTION 'Homework files are in object storage: move them into the database first (npm run files:move -- --to database)';
  END IF;
END $$;
DROP TRIGGER IF EXISTS classroom_files_object_deletion ON classroom_files;
DROP FUNCTION IF EXISTS queue_object_deletion();
DROP TABLE IF EXISTS object_deletions;
DROP INDEX IF EXISTS classroom_files_storage_key_idx;
ALTER TABLE classroom_files DROP CONSTRAINT IF EXISTS classroom_files_data_status_check;
ALTER TABLE classroom_files DROP CONSTRAINT IF EXISTS classroom_files_one_place_check;
ALTER TABLE classroom_files DROP CONSTRAINT IF EXISTS classroom_files_storage_pair_check;
ALTER TABLE classroom_files DROP COLUMN IF EXISTS storage_dek_enc, DROP COLUMN IF EXISTS storage_key;
ALTER TABLE classroom_files ADD CONSTRAINT classroom_files_data_status_check
  CHECK ((data IS NULL) = (status IN ('infected', 'unreadable')));
`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  await sql.raw(UP).execute(db);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  await sql.raw(DOWN).execute(db);
}
