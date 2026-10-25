import { sql, type RawBuilder } from 'kysely';
import type { AppConfig } from '../config.js';
import { withSystemContext, type Database, type Trx } from '../db/index.js';
import type { Locale, ReminderKind } from '../db/types.js';
import { enqueueEmail, notify } from '../notifications/email.js';
import { DUE_SOON_DAYS } from './notes.js';

// Reminders for assigned books with a due date (migration 0010). The worker
// sends each member one reminder per organization listing their books that are
// due soon (today or in the next DUE_SOON_DAYS days) or overdue (by up to
// OVERDUE_WINDOW_DAYS days), and records every book it reminded about, so a
// book is never reminded twice for the same assignee, due date and kind.
// Done books, suspended organizations and suspended accounts are left out.
// Every member gets an in-app notification; the email also needs a verified
// address and the member's `due_reminder_emails` choice.

export const OVERDUE_WINDOW_DAYS = 7;
/** Reminders and daily summaries go out between these hours, Cairo time (a worker that was down catches up within the window). */
export const SEND_FROM_HOUR = 8;
export const SEND_UNTIL_HOUR = 21;
const MEMBERS_PER_RUN = 500;
const LIST_MAX = 20;

export interface DueItem {
  scopeName: string;
  title: string;
  dueOn: string;
  kind: ReminderKind;
}

export interface ReminderSummary {
  skipped?: 'outside_hours';
  members: number;
  reminded: number;
  emails: number;
  failed: number;
  /** The first failure's message, for the worker log. */
  error?: string;
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** "8 Nov 2026" / "٨ نوفمبر ٢٠٢٦": the month in words, so a plain-text email needs no direction marks. */
function fmtDay(day: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: locale === 'ar' ? 'long' : 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${day}T00:00:00Z`),
  );
}

/** "due today", "due tomorrow", "due 12 Nov 2026" or "was due 3 Nov 2026", in the member's language. */
export function describeDue(locale: Locale, dueOn: string, today: string): string {
  const days = daysBetween(today, dueOn);
  if (locale === 'ar') {
    if (days === 0) return 'موعده اليوم';
    if (days === 1) return 'موعده غدًا';
    return days < 0 ? `كان موعده ${fmtDay(dueOn, locale)}` : `موعده ${fmtDay(dueOn, locale)}`;
  }
  if (days === 0) return 'due today';
  if (days === 1) return 'due tomorrow';
  return days < 0 ? `was due ${fmtDay(dueOn, locale)}` : `due ${fmtDay(dueOn, locale)}`;
}

/** The email's lists: overdue books first, then books due soon, each by due date. */
export function reminderSections(locale: Locale, items: DueItem[], today: string): string {
  const byDue = (a: DueItem, b: DueItem) => a.dueOn.localeCompare(b.dueOn) || a.scopeName.localeCompare(b.scopeName) || a.title.localeCompare(b.title);
  const section = (kind: ReminderKind, heading: string) => {
    const list = items.filter((i) => i.kind === kind).sort(byDue);
    if (!list.length) return null;
    const lines = list.slice(0, LIST_MAX).map((i) => (locale === 'ar' ? `• ${i.title} — «${i.scopeName}»، ${describeDue(locale, i.dueOn, today)}` : `• ${i.title} — “${i.scopeName}”, ${describeDue(locale, i.dueOn, today)}`));
    const more = list.length - LIST_MAX;
    if (more > 0) lines.push(locale === 'ar' ? `• و${more} غيرها` : `• and ${more} more`);
    return `${heading} (${list.length}):\n${lines.join('\n')}`;
  };
  return [
    section('overdue', locale === 'ar' ? 'متأخرة عن موعدها' : 'Overdue'),
    section('due_soon', locale === 'ar' ? 'يحين موعدها قريبًا' : 'Due soon'),
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Title of the in-app notification. */
export function reminderTitle(locale: Locale, overdue: number, soon: number): string {
  if (locale === 'ar') {
    if (overdue && soon) return `كتب متأخرة (${overdue}) وكتب يحين موعدها قريبًا (${soon})`;
    return overdue ? `كتب متأخرة عن موعدها (${overdue})` : `كتب يحين موعدها قريبًا (${soon})`;
  }
  const books = (n: number) => `${n} ${n === 1 ? 'book is' : 'books are'}`;
  if (overdue && soon) return `${overdue} overdue and ${soon} due soon`;
  return overdue ? `${books(overdue)} overdue` : `${books(soon)} due soon`;
}

/** Cairo's date and hour at `now` (the database's time-zone rules, as for "overdue" in the app). */
export async function cairoClock(db: Database, now: Date): Promise<{ today: string; hour: number }> {
  const { rows } = await sql<{ today: string; hour: number }>`
    SELECT (${now}::timestamptz AT TIME ZONE 'Africa/Cairo')::date AS today,
           extract(hour FROM ${now}::timestamptz AT TIME ZONE 'Africa/Cairo')::int AS hour`.execute(db);
  const [clock] = rows;
  if (!clock) throw new Error('no clock');
  return clock;
}

/** Assigned, not done, with a due date in the reminder window. Uses scope_items_due_idx. */
function dueFilter(today: string): RawBuilder<boolean> {
  return sql<boolean>`i.assignee_id IS NOT NULL AND i.due_on IS NOT NULL
    AND i.due_on BETWEEN ${today}::date - ${OVERDUE_WINDOW_DAYS}::int AND ${today}::date + ${DUE_SOON_DAYS}::int
    AND i.status IS DISTINCT FROM 'done'`;
}

const kindOf = (today: string) => sql<ReminderKind>`CASE WHEN i.due_on < ${today}::date THEN 'overdue' ELSE 'due_soon' END`;

/**
 * One worker pass. Safe to run often and on several workers at once: each
 * member's reminder is claimed by inserting its rows (ON CONFLICT DO NOTHING),
 * and the notification and email are queued in the same transaction.
 */
export async function runDueReminders(db: Database, config: AppConfig, now = new Date()): Promise<ReminderSummary> {
  const summary: ReminderSummary = { members: 0, reminded: 0, emails: 0, failed: 0 };
  const { today, hour } = await cairoClock(db, now);
  if (hour < SEND_FROM_HOUR || hour >= SEND_UNTIL_HOUR) return { ...summary, skipped: 'outside_hours' };

  const members = await withSystemContext(db, async (trx) => {
    const { rows } = await sql<{ org_id: string; assignee_id: string }>`
      SELECT DISTINCT i.org_id, i.assignee_id
      FROM scope_items i
      JOIN organizations o ON o.id = i.org_id AND o.status = 'active'
      JOIN users u ON u.id = i.assignee_id AND u.status = 'active'
      WHERE ${dueFilter(today)}
        AND NOT EXISTS (
          SELECT 1 FROM item_reminders r
          WHERE r.scope_id = i.scope_id AND r.material_id = i.material_id AND r.assignee_id = i.assignee_id
            AND r.due_on = i.due_on AND r.kind = ${kindOf(today)})
      LIMIT ${MEMBERS_PER_RUN}`.execute(trx);
    return rows;
  });

  for (const m of members) {
    try {
      const sent = await withSystemContext(db, (trx) => remindMember(trx, config, m.org_id, m.assignee_id, today));
      if (sent) {
        summary.members++;
        summary.reminded += sent.items;
        if (sent.emailed) summary.emails++;
      }
    } catch (err) {
      // Nothing was recorded for this member, so the next pass tries again.
      summary.failed++;
      summary.error ??= String((err as Error).message).slice(0, 200);
    }
  }
  return summary;
}

async function remindMember(trx: Trx, config: AppConfig, orgId: string, userId: string, today: string): Promise<{ items: number; emailed: boolean } | null> {
  const { rows: items } = await sql<DueItem>`
    WITH claimed AS (
      INSERT INTO item_reminders (org_id, scope_id, material_id, assignee_id, due_on, kind)
      SELECT i.org_id, i.scope_id, i.material_id, i.assignee_id, i.due_on, ${kindOf(today)}
      FROM scope_items i
      WHERE i.org_id = ${orgId} AND i.assignee_id = ${userId} AND ${dueFilter(today)}
      ON CONFLICT DO NOTHING
      RETURNING scope_id, material_id, due_on, kind)
    SELECT s.name AS "scopeName", m.title, c.due_on AS "dueOn", c.kind
    FROM claimed c JOIN scopes s ON s.id = c.scope_id JOIN catalog_materials m ON m.id = c.material_id`.execute(trx);
  if (!items.length) return null;

  const user = await trx
    .selectFrom('users')
    .select(['name', 'email', 'locale', 'status', 'email_verified_at', 'due_reminder_emails'])
    .where('id', '=', userId)
    .executeTakeFirst();
  const org = await trx.selectFrom('organizations').select(['name', 'status']).where('id', '=', orgId).executeTakeFirst();
  // Checked again inside the claim: rolling back keeps the books for when the account or organization is active again.
  if (!user || user.status !== 'active' || !org || org.status !== 'active') throw new Error('inactive');

  const overdue = items.filter((i) => i.kind === 'overdue').length;
  const soon = items.length - overdue;

  const path = `/org/${orgId}/assignments`;
  await notify(trx, {
    userId,
    orgId,
    kind: 'items_due',
    title: reminderTitle(user.locale, overdue, soon),
    body: user.locale === 'ar' ? `كتب مسندة إليك في ${org.name}.` : `Books assigned to you in ${org.name}.`,
    link: path,
  });
  let emailed = false;
  if (user.due_reminder_emails && user.email_verified_at && user.email) {
    emailed = true;
    await enqueueEmail(trx, user.email, 'items_due', user.locale, {
      name: user.name,
      orgName: org.name,
      overdue: String(overdue),
      soon: String(soon),
      sections: reminderSections(user.locale, items, today),
      link: `${config.APP_URL}${path}`,
      settingsLink: `${config.APP_URL}/account`,
    });
  }
  return { items: items.length, emailed };
}
