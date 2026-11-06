import { sql, type RawBuilder } from 'kysely';
import type { Executor } from '../db/index.js';

// Schools' time zones (organizations.time_zone, migration 0024). Dates a school sees ("overdue", the morning
// window for reminders) follow its own zone; Cairo is every school's default.

export const DEFAULT_TIME_ZONE = 'Africa/Cairo';

/** The school's time zone; Cairo for a school that cannot be read. */
export async function orgTimeZone(exec: Executor, orgId: string): Promise<string> {
  const row = await exec.selectFrom('organizations').select('time_zone').where('id', '=', orgId).executeTakeFirst();
  return row?.time_zone ?? DEFAULT_TIME_ZONE;
}

/** Today's date in the school's time zone, inside a query (the database's time-zone rules). */
export function orgToday(orgId: string): RawBuilder<string> {
  return sql<string>`(now() AT TIME ZONE coalesce((SELECT o.time_zone FROM organizations o WHERE o.id = ${orgId}), ${DEFAULT_TIME_ZONE}))::date`;
}

/** The hour (0–23) at `now` in time zone `tz`, by the runtime's time-zone data. */
export function hourIn(tz: string, now: Date): number {
  const h = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }).format(now);
  return Number(h);
}

/** Whether both the runtime and PostgreSQL know `tz` as a time zone (a school's zone is used by both). */
export async function isKnownTimeZone(exec: Executor, tz: string): Promise<boolean> {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
  } catch {
    return false;
  }
  const { rows } = await sql<{ ok: boolean }>`SELECT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = ${tz}) AS ok`.execute(exec);
  return Boolean(rows[0]?.ok);
}
