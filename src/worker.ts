import pino from 'pino';
import { runBillingLifecycle } from './billing/service.js';
import { runHomeworkAnnouncements } from './classroom/service.js';
import { runTestDeadlines } from './classroom/tests-service.js';
import { loadConfig } from './config.js';
import { createDatabase } from './db/index.js';
import { heartbeat, processOutbox, runCleanup } from './jobs/tasks.js';
import { createMailer } from './notifications/mailer.js';
import { runAssignmentDigests } from './scopes/digest.js';
import { runDueReminders } from './scopes/reminders.js';
import { processWebhookDeliveries } from './webhooks/service.js';

const CLEANUP_EVERY_MS = 3_600_000;
const REMINDERS_EVERY_MS = 900_000;

async function main() {
  const config = loadConfig();
  const log = pino({ level: config.LOG_LEVEL });
  const db = createDatabase(config.DATABASE_URL, { poolMax: 3, ssl: config.DATABASE_SSL });
  const mailer = createMailer(config, log);
  let stopping = false;
  let lastCleanup = 0;
  let lastReminders = 0;

  const stop = () => {
    stopping = true;
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);

  log.info({ intervalMs: config.WORKER_INTERVAL_MS, email: config.EMAIL_TRANSPORT }, 'worker started');
  while (!stopping) {
    const tick: Record<string, unknown> = {};
    try {
      if (mailer) tick.outbox = await processOutbox(db, mailer);
      tick.webhooks = await processWebhookDeliveries(db, config);
      tick.billing = await runBillingLifecycle(db, config);
      tick.homework = await runHomeworkAnnouncements(db);
      tick.tests = await runTestDeadlines(db);
      if (Date.now() - lastReminders > REMINDERS_EVERY_MS) {
        const reminders = await runDueReminders(db, config);
        if (reminders.failed) log.warn({ reminders }, 'some due-date reminders failed; they are retried on the next pass');
        tick.reminders = reminders;
        const digests = await runAssignmentDigests(db, config);
        if (digests.failed) log.warn({ digests }, 'some daily summaries failed; they are retried on the next pass');
        tick.digests = digests;
        lastReminders = Date.now();
      }
      if (Date.now() - lastCleanup > CLEANUP_EVERY_MS) {
        tick.cleanup = await runCleanup(db, config);
        lastCleanup = Date.now();
      }
      await heartbeat(db, 'worker', { ...tick, pid: process.pid });
      log.debug(tick, 'worker tick');
    } catch (err) {
      log.error({ err }, 'worker tick failed');
    }
    await new Promise((r) => setTimeout(r, config.WORKER_INTERVAL_MS));
  }
  await db.destroy();
  log.info('worker stopped');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
