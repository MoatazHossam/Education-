import pino from 'pino';
import { runBillingLifecycle } from './billing/service.js';
import { fileScanner, limitImageWork, runClassroomFileChecks, FILE_CHECK_BATCH, type FileCheckResult } from './classroom/file-checks.js';
import { runClassroomRetention } from './classroom/retention.js';
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
// Homework files wait for this pass before anyone can open them, so it runs on its own short loop.
const FILE_CHECKS_EVERY_MS = 2_000;

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

  const scanner = fileScanner(config);
  limitImageWork();
  log.info({ intervalMs: config.WORKER_INTERVAL_MS, email: config.EMAIL_TRANSPORT, fileScan: config.FILE_SCAN ?? 'off' }, 'worker started');
  if (scanner && !(await scanner.ping())) log.warn({ host: config.CLAMAV_HOST, port: config.CLAMAV_PORT }, 'the virus scanner (clamd) does not answer yet; homework files wait until it does');

  // Virus scan and photo resizing of homework files (docs/CLASSROOM.md §5).
  let files: FileCheckResult | null = null;
  let lastFileError: string | undefined;
  const fileLoop = (async () => {
    while (!stopping) {
      let full = false;
      try {
        files = await runClassroomFileChecks(db, scanner);
        full = files.ready + files.infected + files.unreadable + files.rescanned >= FILE_CHECK_BATCH;
        if (files.error && files.error !== lastFileError) log.warn({ files }, 'homework files could not be scanned; they are tried again');
        if (files.infected || files.unreadable) log.info({ files }, 'homework files blocked');
        lastFileError = files.error;
      } catch (err) {
        log.error({ err }, 'homework file checks failed');
      }
      if (!full) await new Promise((r) => setTimeout(r, FILE_CHECKS_EVERY_MS));
    }
  })();

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
        // Schools' own retention periods for classroom data (docs/CLASSROOM.md §11).
        const retention = await runClassroomRetention(db, config);
        if (retention.failed) log.warn({ retention }, 'classroom retention failed for some schools; they are retried on the next pass');
        tick.retention = retention;
        lastCleanup = Date.now();
      }
      tick.files = files;
      await heartbeat(db, 'worker', { ...tick, pid: process.pid });
      log.debug(tick, 'worker tick');
    } catch (err) {
      log.error({ err }, 'worker tick failed');
    }
    await new Promise((r) => setTimeout(r, config.WORKER_INTERVAL_MS));
  }
  await fileLoop;
  await db.destroy();
  log.info('worker stopped');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
