import { sql, type Kysely } from 'kysely';

// Homework files are checked by the worker before anyone can open them
// (docs/CLASSROOM.md §5, src/classroom/file-checks.ts):
//   pending     uploaded; waiting for the worker
//   ready       checked: scanned for viruses when a scanner is configured
//               (scanned_at), and photos resized with their metadata removed
//   infected    the scanner found a virus; the bytes are deleted
//   unreadable  a photo the worker could not read; the bytes are deleted
// Files uploaded before this migration are ready as they were (scanned_at null);
// with a scanner configured, the worker scans them too.
const UP = `
ALTER TABLE classroom_files
  ADD COLUMN status text NOT NULL DEFAULT 'ready' CHECK (status IN ('pending', 'ready', 'infected', 'unreadable')),
  ADD COLUMN scanned_at timestamptz,
  ADD COLUMN virus_name text CHECK (length(virus_name) <= 200),
  ADD COLUMN original_size_bytes integer CHECK (original_size_bytes BETWEEN 1 AND 5242880),
  ADD COLUMN check_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN check_error text CHECK (length(check_error) <= 500),
  ADD COLUMN checked_at timestamptz;
ALTER TABLE classroom_files ALTER COLUMN status SET DEFAULT 'pending';
ALTER TABLE classroom_files ALTER COLUMN data DROP NOT NULL;
-- Bytes are kept exactly while a file can still be opened or checked.
ALTER TABLE classroom_files ADD CONSTRAINT classroom_files_data_status_check
  CHECK ((data IS NULL) = (status IN ('infected', 'unreadable')));
CREATE INDEX classroom_files_pending_idx ON classroom_files (created_at) WHERE status = 'pending';
CREATE INDEX classroom_files_unscanned_idx ON classroom_files (created_at) WHERE status = 'ready' AND scanned_at IS NULL;
`;

const DOWN = `
DROP INDEX IF EXISTS classroom_files_unscanned_idx;
DROP INDEX IF EXISTS classroom_files_pending_idx;
DELETE FROM classroom_files WHERE data IS NULL;
ALTER TABLE classroom_files DROP CONSTRAINT IF EXISTS classroom_files_data_status_check;
ALTER TABLE classroom_files ALTER COLUMN data SET NOT NULL;
ALTER TABLE classroom_files
  DROP COLUMN IF EXISTS checked_at,
  DROP COLUMN IF EXISTS check_error,
  DROP COLUMN IF EXISTS check_attempts,
  DROP COLUMN IF EXISTS original_size_bytes,
  DROP COLUMN IF EXISTS virus_name,
  DROP COLUMN IF EXISTS scanned_at,
  DROP COLUMN IF EXISTS status;
`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  await sql.raw(UP).execute(db);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  await sql.raw(DOWN).execute(db);
}
