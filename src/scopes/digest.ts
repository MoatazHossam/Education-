import { sql } from 'kysely';
import type { AppConfig } from '../config.js';
import { withSystemContext, type Database, type Trx } from '../db/index.js';
import type { Locale } from '../db/types.js';
import { enqueueEmail } from '../notifications/email.js';
import { cairoClock, SEND_FROM_HOUR, SEND_UNTIL_HOUR } from './reminders.js';

// One summary a day of the books assigned to a member, for members who chose
// it (users.assignment_email_frequency = 'daily', migration 0011) instead of an
// email per assignment. Assignments wait in assignment_digest_items. From
// SEND_FROM_HOUR each morning (Cairo time) the worker sends each waiting member
// one email, across all their organizations, and deletes what it took. What is
// assigned after that morning's sending time waits for the next morning, so a
// member gets at most one summary a day. Books unassigned or removed since,
// and suspended organizations, are left out. The in-app notification is not
// delayed (scopes/notes.ts).

const MEMBERS_PER_RUN = 500;
const GROUP_MAX = 10;

export interface DigestEntry {
  orgId: string;
  orgName: string;
  scopeName: string;
  byName: string | null;
  title: string;
}

export interface DigestSummary {
  skipped?: 'outside_hours';
  members: number;
  emails: number;
  books: number;
  failed: number;
  /** The first failure's message, for the worker log. */
  error?: string;
}

/** The email's body: per organization, the books per scope and assigner, and a link to My assignments. */
export function digestSections(locale: Locale, entries: DigestEntry[], appUrl: string): string {
  const ar = locale === 'ar';
  const orgs = new Map<string, DigestEntry[]>();
  for (const e of entries) orgs.set(e.orgId, [...(orgs.get(e.orgId) ?? []), e]);
  return [...orgs.entries()]
    .sort(([, a], [, b]) => a[0]!.orgName.localeCompare(b[0]!.orgName))
    .map(([orgId, list]) => {
      const groups = new Map<string, DigestEntry[]>();
      for (const e of list) {
        const key = `${e.scopeName}\u0000${e.byName ?? ''}`;
        groups.set(key, [...(groups.get(key) ?? []), e]);
      }
      const lines = [ar ? `${list[0]!.orgName} (${list.length}):` : `${list[0]!.orgName} (${list.length} ${list.length === 1 ? 'book' : 'books'}):`];
      for (const [, g] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        const { scopeName, byName } = g[0]!;
        if (ar) lines.push(byName ? `«${scopeName}»، أسندها ${byName}:` : `«${scopeName}»:`);
        else lines.push(byName ? `“${scopeName}”, assigned by ${byName}:` : `“${scopeName}”:`);
        const titles = g.map((e) => e.title).sort((a, b) => a.localeCompare(b));
        lines.push(...titles.slice(0, GROUP_MAX).map((t) => `• ${t}`));
        const more = titles.length - GROUP_MAX;
        if (more > 0) lines.push(ar ? `• و${more} غيرها` : `• and ${more} more`);
      }
      lines.push(`${ar ? 'اطّلع عليها' : 'See them'}: ${appUrl}/org/${orgId}/assignments`);
      return lines.join('\n');
    })
    .join('\n\n');
}

/**
 * One worker pass. Safe to run often and on several workers at once: a
 * member's waiting assignments are taken with DELETE … RETURNING in the same
 * transaction that queues the email, so two passes never send them twice.
 */
export async function runAssignmentDigests(db: Database, config: AppConfig, now = new Date()): Promise<DigestSummary> {
  const summary: DigestSummary = { members: 0, emails: 0, books: 0, failed: 0 };
  const { today, hour } = await cairoClock(db, now);
  if (hour < SEND_FROM_HOUR || hour >= SEND_UNTIL_HOUR) return { ...summary, skipped: 'outside_hours' };

  // This morning's sending time: members with something assigned before it get today's summary.
  const morning = sql<Date>`(${today}::date + make_interval(hours => ${SEND_FROM_HOUR}::int)) AT TIME ZONE 'Africa/Cairo'`;
  const members = await withSystemContext(db, async (trx) => {
    const { rows } = await sql<{ user_id: string }>`
      SELECT DISTINCT user_id FROM assignment_digest_items WHERE assigned_at < ${morning} LIMIT ${MEMBERS_PER_RUN}`.execute(trx);
    return rows;
  });

  for (const { user_id: userId } of members) {
    try {
      const sent = await withSystemContext(db, (trx) => sendDigest(trx, config, userId, now));
      summary.members++;
      if (sent) {
        summary.emails++;
        summary.books += sent;
      }
    } catch (err) {
      // Nothing was taken for this member, so the next pass tries again.
      summary.failed++;
      summary.error ??= String((err as Error).message).slice(0, 200);
    }
  }
  return summary;
}

/** Takes everything waiting for the member and queues their summary. Returns the number of books sent (0: none). */
async function sendDigest(trx: Trx, config: AppConfig, userId: string, now: Date): Promise<number> {
  const { rows } = await sql<{ org_id: string; org_name: string; scope_name: string; by_name: string | null; title: string }>`
    WITH taken AS (
      DELETE FROM assignment_digest_items WHERE user_id = ${userId} AND assigned_at <= ${now}
      RETURNING org_id, scope_id, material_id, user_id, assigned_by)
    SELECT t.org_id, o.name AS org_name, s.name AS scope_name, b.name AS by_name, m.title
    FROM taken t
    JOIN scope_items i ON i.scope_id = t.scope_id AND i.material_id = t.material_id AND i.assignee_id = t.user_id
    JOIN organizations o ON o.id = t.org_id AND o.status = 'active'
    JOIN scopes s ON s.id = t.scope_id
    JOIN catalog_materials m ON m.id = t.material_id
    LEFT JOIN users b ON b.id = t.assigned_by`.execute(trx);
  if (!rows.length) return 0;

  const user = await trx
    .selectFrom('users')
    .select(['name', 'email', 'locale', 'status', 'email_verified_at', 'assignment_emails', 'assignment_email_frequency'])
    .where('id', '=', userId)
    .executeTakeFirst();
  // The member changed their mind or cannot receive email: what was waiting is dropped (the in-app notices were sent).
  if (!user?.email || !user.email_verified_at || user.status !== 'active' || !user.assignment_emails || user.assignment_email_frequency !== 'daily') return 0;

  const entries = rows.map((r) => ({ orgId: r.org_id, orgName: r.org_name, scopeName: r.scope_name, byName: r.by_name, title: r.title }));
  await enqueueEmail(trx, user.email, 'items_assigned_daily', user.locale, {
    name: user.name,
    count: String(entries.length),
    sections: digestSections(user.locale, entries, config.APP_URL),
    settingsLink: `${config.APP_URL}/account`,
  });
  return entries.length;
}
