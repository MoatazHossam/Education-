import { sql } from 'kysely';
import type { AppConfig } from '../config.js';
import { withSystemContext, type Database } from '../db/index.js';
import type { Mailer } from '../notifications/mailer.js';
import { addDays } from '../lib/time.js';
import { DELIVERY_RETENTION_DAYS } from '../webhooks/service.js';

const MAX_ATTEMPTS = 8;

/**
 * Sends pending emails. FOR UPDATE SKIP LOCKED lets several workers share the
 * queue without double-sending. Bodies are redacted after sending because they
 * can contain single-use links.
 */
export async function processOutbox(db: Database, mailer: Mailer, batch = 20): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  await db.transaction().execute(async (trx) => {
    const rows = await trx
      .selectFrom('email_outbox')
      .selectAll()
      .where('status', '=', 'pending')
      .where('send_after', '<=', new Date())
      .orderBy('created_at')
      .limit(batch)
      .forUpdate()
      .skipLocked()
      .execute();
    for (const row of rows) {
      try {
        await mailer.send({ to: row.to_email, subject: row.subject, text: row.text_body });
        await trx.updateTable('email_outbox').set({ status: 'sent', sent_at: new Date(), text_body: '[redacted after delivery]', attempts: row.attempts + 1, last_error: null }).where('id', '=', row.id).execute();
        sent++;
      } catch (err) {
        const attempts = row.attempts + 1;
        await trx
          .updateTable('email_outbox')
          .set({
            attempts,
            last_error: String((err as Error).message).slice(0, 500),
            status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
            send_after: new Date(Date.now() + Math.min(2 ** attempts, 360) * 60_000),
          })
          .where('id', '=', row.id)
          .execute();
        failed++;
      }
    }
  });
  return { sent, failed };
}

/** Retention policy (see docs/DATABASE_DESIGN.md#data-retention). */
export async function runCleanup(db: Database, config: AppConfig, now = new Date()) {
  return withSystemContext(db, async (trx) => {
    const sessions = await trx.deleteFrom('sessions').where((eb) => eb.or([eb('expires_at', '<=', now), eb('last_seen_at', '<=', addDays(now, -7))])).executeTakeFirst();
    const tokens = await trx.deleteFrom('user_tokens').where((eb) => eb.or([eb('expires_at', '<=', addDays(now, -7)), eb('used_at', '<=', addDays(now, -7))])).executeTakeFirst();
    const emails = await trx.deleteFrom('email_outbox').where('status', 'in', ['sent', 'failed']).where('created_at', '<=', addDays(now, -30)).executeTakeFirst();
    const notifications = await trx.deleteFrom('notifications').where('read_at', '<=', addDays(now, -180)).executeTakeFirst();
    const invitations = await trx.deleteFrom('invitations').where('accepted_at', 'is', null).where('expires_at', '<=', addDays(now, -90)).executeTakeFirst();
    const audit = await trx.deleteFrom('audit_logs').where('created_at', '<=', addDays(now, -config.AUDIT_RETENTION_DAYS)).executeTakeFirst();
    // Database clock, as the counters' windows use it (rate-limit-store.ts).
    const rateLimits = await trx.deleteFrom('rate_limits').where('expires_at', '<=', sql<Date>`now()`).executeTakeFirst();
    const alerts = await trx.deleteFrom('ops_alerts').where('status', '=', 'resolved').where('resolved_at', '<=', addDays(now, -90)).executeTakeFirst();
    // A reminder record is only needed while its due date is in the reminder window (scopes/reminders.ts).
    const reminders = await trx.deleteFrom('item_reminders').where('due_on', '<', addDays(now, -60).toISOString().slice(0, 10)).executeTakeFirst();
    // Daily summaries take their rows each morning; anything older was never going to be sent.
    const digestItems = await trx.deleteFrom('assignment_digest_items').where('assigned_at', '<=', addDays(now, -30)).executeTakeFirst();
    const webhookDeliveries = await trx.deleteFrom('webhook_deliveries').where('status', '!=', 'pending').where('created_at', '<=', addDays(now, -DELIVERY_RETENTION_DAYS)).executeTakeFirst();
    return {
      sessions: Number(sessions.numDeletedRows),
      tokens: Number(tokens.numDeletedRows),
      emails: Number(emails.numDeletedRows),
      notifications: Number(notifications.numDeletedRows),
      invitations: Number(invitations.numDeletedRows),
      auditLogs: Number(audit.numDeletedRows),
      rateLimits: Number(rateLimits.numDeletedRows),
      resolvedAlerts: Number(alerts.numDeletedRows),
      itemReminders: Number(reminders.numDeletedRows),
      digestItems: Number(digestItems.numDeletedRows),
      webhookDeliveries: Number(webhookDeliveries.numDeletedRows),
    };
  });
}

export async function heartbeat(db: Database, name: string, details: Record<string, unknown>): Promise<void> {
  await sql`
    INSERT INTO worker_heartbeats (name, last_beat_at, details) VALUES (${name}, now(), ${JSON.stringify(details)}::jsonb)
    ON CONFLICT (name) DO UPDATE SET last_beat_at = now(), details = EXCLUDED.details`.execute(db);
}
