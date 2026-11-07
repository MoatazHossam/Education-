import pino from 'pino';
import { runBillingLifecycle } from './billing/service.js';
import { fileScanner, limitImageWork, runClassroomFileChecks, FILE_CHECK_BATCH, type FileCheckResult } from './classroom/file-checks.js';
import { createFileObjects, runObjectDeletions } from './classroom/file-store.js';
import { runClassroomRetention } from './classroom/retention.js';
import { runHomeworkAnnouncements } from './classroom/service.js';
import { runTestDeadlines } from './classroom/tests-service.js';
import { loadConfig } from './config.js';
import { createAppDatabase, databaseRoleProblems } from './db/index.js';
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
  const config = loadConfig(process.env, 'worker');
  const log = pino({ level: config.LOG_LEVEL });
  const db = createAppDatabase(config, 3);
  for (const msg of await databaseRoleProblems(db)) {
    if (config.isProduction) throw new Error(msg);
    log.warn(msg);
  }
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
  const files = createFileObjects(config);
  limitImageWork();
  log.info({ intervalMs: config.WORKER_INTERVAL_MS, email: config.EMAIL_TRANSPORT, fileScan: config.FILE_SCAN ?? 'off', fileStorage: config.FILE_STORAGE }, 'worker started');
  if (scanner && !(await scanner.ping())) log.warn({ host: config.CLAMAV_HOST, port: config.CLAMAV_PORT }, 'the virus scanner (clamd) does not answer yet; homework files wait until it does');
  if (files) {
    await files.bucket.check().then(
      () => log.info({ bucket: files.bucket.description }, 'file storage bucket reachable'),
      (err: unknown) => log.warn({ bucket: files.bucket.description, err }, 'the file storage bucket cannot be reached yet; homework files in it wait until it can'),
    );
  }

  // Virus scan and photo resizing of homework files (docs/CLASSROOM.md §5).
  let checked: FileCheckResult | null = null;
  let lastFileError: string | undefined;
  const fileLoop = (async () => {
    while (!stopping) {
      let full = false;
      try {
        checked = await runClassroomFileChecks(db, scanner, files);
        full = checked.ready + checked.infected + checked.unreadable + checked.rescanned >= FILE_CHECK_BATCH;
        if (checked.error && checked.error !== lastFileError) log.warn({ files: checked }, 'homework files could not be scanned; they are tried again');
        if (checked.infected || checked.unreadable) log.info({ files: checked }, 'homework files blocked');
        lastFileError = checked.error;
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
      // Objects of removed homework files, deleted from the bucket (src/classroom/file-store.ts).
      const objects = await runObjectDeletions(db, files?.bucket ?? null);
      if (objects.failed) log.warn({ objects }, 'some file objects could not be deleted from the bucket; they are retried later');
      if (objects.waiting) log.warn({ objects }, 'file objects are waiting to be deleted, but no bucket is configured (S3_BUCKET)');
      tick.objects = objects;
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
      tick.files = checked;
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
