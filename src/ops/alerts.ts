import type { FastifyBaseLogger } from 'fastify';
import { sql } from 'kysely';
import { hostname } from 'node:os';
import type { AppConfig } from '../config.js';
import { checkDatabase, withSystemContext, type Database } from '../db/index.js';
import { pendingMigrations } from '../db/migrator.js';
import { createMailer, type Mailer } from '../notifications/mailer.js';

// Operational alerts. Every app instance evaluates the checks on a timer; the
// ops_alerts table decides which instance notifies, so a problem produces one
// message when it starts, a reminder every few hours while it lasts, and one
// when it clears. Notifications go straight to SMTP and/or a webhook, not
// through the email outbox, so they still arrive when the worker is down.
// Messages carry counts only: no customer names, emails or other data.

export const REMIND_AFTER_HOURS = 6;
/** A condition must stay clear this long before an alert resolves (no flapping). */
export const RESOLVE_AFTER_MINUTES = 5;
export const SERVER_ERROR_THRESHOLD = 10; // 5xx responses in 5 minutes on one instance

export type AlertKey =
  | 'worker_stalled' | 'email_failing' | 'email_backlog' | 'server_errors'
  | 'payment_webhooks_failing' | 'migrations_pending' | 'file_checks_stalled' | 'database_unreachable';
const DB_CHECKS: AlertKey[] = ['worker_stalled', 'email_failing', 'email_backlog', 'server_errors', 'payment_webhooks_failing', 'migrations_pending', 'file_checks_stalled'];
/** Homework files waiting longer than this for the worker's check (virus scan, photo resizing). */
export const FILE_CHECK_STALE_MINUTES = 10;

export interface Observation { key: AlertKey; summary: string; details: Record<string, number | string> }
export interface AlertMessage { kind: 'firing' | 'reminder' | 'resolved' | 'test'; key: AlertKey | 'test'; summary: string; details: Record<string, number | string>; since?: Date }
type ChannelResult = 'sent' | 'failed' | 'off';
export interface AlertChannels { mailer: Mailer | null; emails: string[]; webhookUrl?: string }

const HINTS: Record<AlertMessage['key'], string> = {
  worker_stalled: 'Check the worker: docker compose ps worker; docker compose logs worker. Emails and subscription renewals wait until it runs again.',
  email_failing: 'Check the SMTP settings and the email provider. The worker logs show the delivery errors (docker compose logs worker).',
  email_backlog: 'The worker is not sending queued emails: see whether it is running (docker compose ps worker) and its logs.',
  server_errors: 'See the app logs for the failing requests: docker compose logs app app2 (look for statusCode 500).',
  payment_webhooks_failing: 'Open Platform admin → Webhooks for the failed events and their errors.',
  migrations_pending: 'Apply the migrations: docker compose run --rm migrate. Instances report not ready until then.',
  file_checks_stalled: 'Check the virus scanner and the worker: docker compose ps clamav worker; docker compose logs clamav worker. Teachers and students cannot open these files until they are checked.',
  database_unreachable: 'Check the database: docker compose ps postgres and its logs, or the managed database status page.',
  test: 'This is a test sent from Platform admin → Overview.',
};

/** The worker is considered stopped after this long without a heartbeat (also used by its container health check). */
export function workerStaleAfterMs(config: Pick<AppConfig, 'WORKER_INTERVAL_MS'>): number {
  return Math.max(120_000, config.WORKER_INTERVAL_MS * 4);
}

/** 5xx responses per minute on this instance, kept for the last few minutes. */
export class ServerErrorCounter {
  private readonly minutes = new Map<number, number>();

  constructor(private readonly clock = () => Date.now()) {}

  record(): void {
    const m = Math.floor(this.clock() / 60_000);
    this.minutes.set(m, (this.minutes.get(m) ?? 0) + 1);
    for (const k of this.minutes.keys()) if (k <= m - 10) this.minutes.delete(k);
  }

  inLast(minutes: number): number {
    const m = Math.floor(this.clock() / 60_000);
    let n = 0;
    for (const [k, v] of this.minutes) if (k > m - minutes) n += v;
    return n;
  }
}

/** Evaluates the database-backed checks. */
export async function evaluate(db: Database, config: AppConfig, errors: ServerErrorCounter): Promise<Observation[]> {
  return withSystemContext(db, async (trx) => {
    const found: Observation[] = [];
    const beat = await sql<{ age_s: number }>`
      SELECT extract(epoch FROM now() - last_beat_at)::float8 AS age_s FROM worker_heartbeats WHERE name = 'worker'`.execute(trx);
    const ageS = beat.rows[0]?.age_s;
    if (ageS === undefined || ageS * 1000 > workerStaleAfterMs(config)) {
      found.push({ key: 'worker_stalled', summary: ageS === undefined ? 'The background worker has never reported' : `The background worker has not reported for ${Math.round(ageS / 60)} minutes`, details: ageS === undefined ? {} : { minutesSinceHeartbeat: Math.round(ageS / 60) } });
    }

    const mail = await sql<{ failed: string; retrying: string; overdue: string }>`
      SELECT count(*) FILTER (WHERE status = 'failed' AND created_at > now() - interval '1 hour') AS failed,
             count(*) FILTER (WHERE status = 'pending' AND attempts >= 2) AS retrying,
             count(*) FILTER (WHERE status = 'pending' AND send_after <= now() - interval '15 minutes') AS overdue
      FROM email_outbox`.execute(trx);
    const failed = Number(mail.rows[0]!.failed);
    const retrying = Number(mail.rows[0]!.retrying);
    const overdue = Number(mail.rows[0]!.overdue);
    if (failed > 0 || retrying >= 3) {
      found.push({ key: 'email_failing', summary: `Emails are failing to send: ${failed} gave up in the last hour, ${retrying} being retried`, details: { failedLastHour: failed, retrying } });
    }
    if (overdue > 0) found.push({ key: 'email_backlog', summary: `${overdue} emails have waited more than 15 minutes to be sent`, details: { overdue } });

    const errorCount = errors.inLast(5);
    if (errorCount >= SERVER_ERROR_THRESHOLD) {
      found.push({ key: 'server_errors', summary: `${errorCount} server errors in the last 5 minutes on ${hostname()}`, details: { serverErrors: errorCount, instance: hostname() } });
    }

    const hooks = await sql<{ n: string }>`
      SELECT count(*) AS n FROM billing_events WHERE status = 'failed' AND received_at > now() - interval '1 hour'`.execute(trx);
    const failedHooks = Number(hooks.rows[0]!.n);
    if (failedHooks > 0) {
      found.push({ key: 'payment_webhooks_failing', summary: `${failedHooks} payment provider notifications failed to process in the last hour`, details: { failedLastHour: failedHooks } });
    }

    const files = await sql<{ n: string }>`
      SELECT count(*) AS n FROM classroom_files
      WHERE status = 'pending' AND created_at <= now() - make_interval(mins => ${FILE_CHECK_STALE_MINUTES}::int)`.execute(trx);
    const waitingFiles = Number(files.rows[0]!.n);
    if (waitingFiles > 0) {
      found.push({ key: 'file_checks_stalled', summary: `${waitingFiles} homework ${waitingFiles === 1 ? 'file has' : 'files have'} waited more than ${FILE_CHECK_STALE_MINUTES} minutes to be checked`, details: { waitingFiles } });
    }

    const pending = await pendingMigrations(db);
    if (pending.length) found.push({ key: 'migrations_pending', summary: `Database migrations are pending: ${pending.join(', ')}`, details: { pending: pending.join(', ') } });
    return found;
  });
}

/** Records a firing observation; returns what to send, or null when another instance already did or it is not reminder time. */
async function fire(db: Database, o: Observation): Promise<AlertMessage | null> {
  const { rows } = await sql<{ notify: boolean; fresh: boolean; first_seen_at: Date }>`
    INSERT INTO ops_alerts AS a (key, status, summary, details, first_seen_at, last_seen_at, notified_at)
    VALUES (${o.key}, 'firing', ${o.summary}, ${JSON.stringify(o.details)}::jsonb, now(), now(), now())
    ON CONFLICT (key) DO UPDATE SET
      status = 'firing',
      summary = EXCLUDED.summary,
      details = EXCLUDED.details,
      first_seen_at = CASE WHEN a.status = 'resolved' THEN now() ELSE a.first_seen_at END,
      last_seen_at = now(),
      resolved_at = NULL,
      notified_at = CASE WHEN a.status = 'resolved' OR a.notified_at <= now() - make_interval(hours => ${REMIND_AFTER_HOURS}::int)
                         THEN now() ELSE a.notified_at END
    RETURNING notified_at = now() AS notify, first_seen_at = now() AS fresh, first_seen_at`.execute(db);
  const r = rows[0]!;
  if (!r.notify) return null;
  return { kind: r.fresh ? 'firing' : 'reminder', key: o.key, summary: o.summary, details: o.details, since: r.first_seen_at };
}

/** Resolves a firing alert once its condition has been clear for RESOLVE_AFTER_MINUTES; exactly one instance gets the row. */
async function resolve(db: Database, key: AlertKey): Promise<AlertMessage | null> {
  const { rows } = await sql<{ summary: string; first_seen_at: Date }>`
    UPDATE ops_alerts SET status = 'resolved', resolved_at = now()
    WHERE key = ${key} AND status = 'firing' AND last_seen_at <= now() - make_interval(mins => ${RESOLVE_AFTER_MINUTES}::int)
    RETURNING summary, first_seen_at`.execute(db);
  return rows[0] ? { kind: 'resolved', key, summary: rows[0].summary, details: {}, since: rows[0].first_seen_at } : null;
}

export function alertChannels(config: AppConfig, log: Pick<FastifyBaseLogger, 'info'>): AlertChannels {
  return { mailer: config.ALERT_EMAILS.length ? createMailer(config, log) : null, emails: config.ALERT_EMAILS, webhookUrl: config.ALERT_WEBHOOK_URL };
}

function render(msg: AlertMessage, config: AppConfig) {
  const site = new URL(config.APP_URL).host;
  const label = { firing: 'ALERT', reminder: 'Still failing', resolved: 'Resolved', test: 'Test alert' }[msg.kind];
  const subject = `[${site}] ${label}: ${msg.summary}`;
  const lines = [
    `${label}: ${msg.summary}`,
    ...(msg.since ? [`Since: ${msg.since.toISOString().replace('T', ' ').slice(0, 16)} UTC`] : []),
    `Instance: ${hostname()}`,
    ...(Object.keys(msg.details).length ? [`Details: ${Object.entries(msg.details).map(([k, v]) => `${k}=${v}`).join(', ')}`] : []),
    ...(msg.kind === 'resolved' ? [] : [`What to check: ${HINTS[msg.key]}`]),
    `Platform admin: ${config.appOrigin}/admin`,
  ];
  return { subject, text: lines.join('\n') };
}

/** Sends one alert to every configured channel. Never throws; failures are logged without the webhook URL. */
export async function notify(channels: AlertChannels, msg: AlertMessage, config: AppConfig, log: Pick<FastifyBaseLogger, 'warn' | 'error'>): Promise<{ email: ChannelResult; webhook: ChannelResult }> {
  const { subject, text } = render(msg, config);
  log.warn({ alert: msg.key, kind: msg.kind, summary: msg.summary }, 'operational alert');
  let email: ChannelResult = 'off';
  if (channels.mailer && channels.emails.length) {
    try {
      await channels.mailer.send({ to: channels.emails.join(', '), subject, text });
      email = 'sent';
    } catch (err) {
      email = 'failed';
      log.error({ err: (err as Error).message, alert: msg.key }, 'alert email failed');
    }
  }
  let webhook: ChannelResult = 'off';
  if (channels.webhookUrl) {
    try {
      const res = await fetch(channels.webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // `text` suits Slack and Mattermost, `content` Discord; the rest is for any JSON consumer.
        body: JSON.stringify({ text: `${subject}\n${text}`, content: `${subject}\n${text}`.slice(0, 1900), status: msg.kind, alert: msg.key, summary: msg.summary, details: msg.details, since: msg.since?.toISOString() ?? null, instance: hostname(), app: config.appOrigin, at: new Date().toISOString() }),
        signal: AbortSignal.timeout(5_000),
      });
      webhook = res.ok ? 'sent' : 'failed';
      if (!res.ok) log.error({ status: res.status, alert: msg.key }, 'alert webhook refused');
    } catch (err) {
      webhook = 'failed';
      log.error({ err: (err as Error).message, alert: msg.key }, 'alert webhook failed');
    }
  }
  return { email, webhook };
}

/** Runs the checks on a timer in each app instance. The database outage alert is kept in memory: it cannot be stored. */
export class AlertMonitor {
  private running = false;
  private dbOutage = { failures: 0, since: null as Date | null, notifiedAt: null as number | null };

  constructor(private readonly deps: { db: Database; config: AppConfig; log: Pick<FastifyBaseLogger, 'warn' | 'error' | 'info'>; errors: ServerErrorCounter; channels: AlertChannels; clock?: () => number }) {}

  /** One round of checks; returns the messages this instance sent. */
  async runOnce(): Promise<AlertMessage[]> {
    const { db, config, log, errors, channels } = this.deps;
    const now = (this.deps.clock ?? Date.now)();
    const out: AlertMessage[] = [];
    const send = async (msg: AlertMessage) => {
      await notify(channels, msg, config, log);
      out.push(msg);
    };

    const dbCheck = await checkDatabase(db);
    const state = this.dbOutage;
    if (!dbCheck.ok) {
      state.failures++;
      state.since ??= new Date(now);
      const due = state.notifiedAt === null || now - state.notifiedAt >= REMIND_AFTER_HOURS * 3_600_000;
      if (state.failures >= 2 && due) {
        await send({ kind: state.notifiedAt === null ? 'firing' : 'reminder', key: 'database_unreachable', summary: `The database is unreachable from ${hostname()}`, details: { consecutiveFailedChecks: state.failures }, since: state.since });
        state.notifiedAt = now;
      }
      return out;
    }
    if (state.notifiedAt !== null) await send({ kind: 'resolved', key: 'database_unreachable', summary: `The database is unreachable from ${hostname()}`, details: {}, since: state.since ?? undefined });
    this.dbOutage = { failures: 0, since: null, notifiedAt: null };

    const found = await evaluate(db, config, errors);
    for (const o of found) {
      const msg = await fire(db, o);
      if (msg) await send(msg);
    }
    for (const key of DB_CHECKS.filter((k) => !found.some((o) => o.key === k))) {
      const msg = await resolve(db, key);
      if (msg) await send(msg);
    }
    return out;
  }

  /** Starts the timer (first round after one interval); returns a stop function. */
  start(): () => void {
    const { config, log, channels } = this.deps;
    if (!channels.webhookUrl && !(channels.mailer && channels.emails.length)) {
      log.warn('No alert channels configured (ALERT_EMAILS, ALERT_WEBHOOK_URL): alerts are only written to the logs');
    }
    const timer = setInterval(() => {
      if (this.running) return;
      this.running = true;
      this.runOnce()
        .catch((err: Error) => log.error({ err: err.message }, 'alert checks failed'))
        .finally(() => { this.running = false; });
    }, config.ALERT_CHECK_INTERVAL_MS);
    timer.unref();
    return () => clearInterval(timer);
  }
}
