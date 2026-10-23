import { sql, type Kysely } from 'kysely';

// Editorial verification marks on catalogue subjects and materials: who checked
// an entry against which official source, and when. Marks are annotations, so
// they may change on published versions; content edits reset them.
const columns = (table: string) => `
ALTER TABLE ${table}
  ADD COLUMN verification_status text NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('unverified', 'verified', 'needs_review')),
  ADD COLUMN verification_source text CHECK (length(verification_source) BETWEEN 1 AND 300),
  ADD COLUMN verification_url text CHECK (verification_url ~ '^https?://' AND length(verification_url) <= 2000),
  ADD COLUMN verification_note text CHECK (length(verification_note) BETWEEN 1 AND 1000),
  ADD COLUMN reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN reviewed_at timestamptz,
  ADD CONSTRAINT ${table}_verification_check CHECK (
    (verification_status = 'unverified' AND verification_source IS NULL AND verification_url IS NULL
      AND verification_note IS NULL AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR (verification_status = 'verified' AND verification_source IS NOT NULL AND reviewed_at IS NOT NULL)
    OR (verification_status = 'needs_review' AND verification_note IS NOT NULL AND reviewed_at IS NOT NULL)
  );`;

const dropColumns = (table: string) => `
ALTER TABLE ${table}
  DROP CONSTRAINT IF EXISTS ${table}_verification_check,
  DROP COLUMN IF EXISTS verification_status,
  DROP COLUMN IF EXISTS verification_source,
  DROP COLUMN IF EXISTS verification_url,
  DROP COLUMN IF EXISTS verification_note,
  DROP COLUMN IF EXISTS reviewed_by,
  DROP COLUMN IF EXISTS reviewed_at;`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  await sql.raw(columns('catalog_subjects') + columns('catalog_materials')).execute(db);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  await sql.raw(dropColumns('catalog_subjects') + dropColumns('catalog_materials')).execute(db);
}
