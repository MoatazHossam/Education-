import { sql, type Kysely } from 'kysely';

// Each school's time zone and country (docs/production/IMPLEMENTATION_ROADMAP.md task 5.1). Until now every
// school's dates followed Cairo: "overdue", the hours when reminders and daily summaries go out, retention
// notices, and the times in notifications. They now follow organizations.time_zone, an IANA zone name checked
// against the database's own list when it is set (src/orgs/routes.ts). Every existing and new school starts
// on Africa/Cairo, so nothing changes for them. country (ISO 3166-1 alpha-2) is recorded for the
// country-specific work to come (prices, curriculum); nothing uses it yet. Monthly allowances stay counted per
// UTC month for every school (src/lib/time.ts periodKey).
const UP = `
ALTER TABLE organizations
  ADD COLUMN time_zone text NOT NULL DEFAULT 'Africa/Cairo' CHECK (length(time_zone) BETWEEN 1 AND 64),
  ADD COLUMN country text CHECK (country ~ '^[A-Z]{2}$');
`;

const DOWN = `
ALTER TABLE organizations DROP COLUMN IF EXISTS country, DROP COLUMN IF EXISTS time_zone;
`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  await sql.raw(UP).execute(db);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  await sql.raw(DOWN).execute(db);
}
