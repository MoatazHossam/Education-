import { recordPlatformAudit } from '../audit/audit.js';
import { filePlaces, moveFiles, type FilePlace, type FilePlaces } from '../classroom/file-move.js';
import { createFileObjects } from '../classroom/file-store.js';
import { loadConfig } from '../config.js';
import { createAppDatabase } from '../db/index.js';

// Usage: move-files --to s3|database [--check]
// Moves the homework files already stored to the bucket in the S3_* settings, or back into the database
// (src/classroom/file-move.ts). --check only reports where the files are and checks the bucket can be reached.
// Exits with 1 when some files could not be moved (they stay where they were; run it again).
// Runbook: docs/DEPLOYMENT_GUIDE.md, "Homework files in object storage".

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const describe = (p: FilePlaces) =>
  `In the database: ${p.database.files} files (${mb(p.database.bytes)}). In the bucket: ${p.s3.files} files (${mb(p.s3.bytes)}). Waiting for the worker's check: ${p.pending}.`;

async function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const toAt = args.indexOf('--to');
  const to = toAt >= 0 ? args[toAt + 1] : undefined;
  if (to !== 's3' && to !== 'database') {
    console.error('Usage: move-files --to s3|database [--check]');
    process.exit(2);
  }
  const config = loadConfig();
  const files = createFileObjects(config);
  if (!files) throw new Error('No bucket is set: give S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY (and S3_ENDPOINT for a provider other than Amazon S3).');
  const db = createAppDatabase(config, 2);
  try {
    await files.bucket.check().catch((err: unknown) => {
      throw new Error(`The ${files.bucket.description} cannot be reached: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`);
    });
    console.log(`Bucket: ${files.bucket.description} (reachable). FILE_STORAGE=${config.FILE_STORAGE}.`);
    console.log(describe(await filePlaces(db)));
    if (to !== config.FILE_STORAGE) {
      console.log(`Note: FILE_STORAGE is ${config.FILE_STORAGE}, so new uploads still go ${config.FILE_STORAGE === 's3' ? 'to the bucket' : 'into the database'}. Set FILE_STORAGE=${to} and restart the application and worker first.`);
    }
    if (check) return;
    const result = await moveFiles(db, files, to as FilePlace, (r) => console.log(`... ${r.moved} moved, ${r.skipped} skipped, ${r.failed.length} failed`));
    console.log(`\nMoved ${result.moved} files (${mb(result.bytes)}) ${to === 's3' ? 'to the bucket' : 'into the database'}; ${result.skipped} skipped (changed or still being checked); ${result.failed.length} failed.`);
    if (to === 'database') console.log(`Deleted ${result.objectsDeleted} objects from the bucket.`);
    console.log(describe(await filePlaces(db)));
    await recordPlatformAudit(db, { type: 'system', email: 'cli' }, {
      action: 'admin.files_moved',
      metadata: { to, moved: result.moved, bytes: result.bytes, skipped: result.skipped, failed: result.failed.length, objectsDeleted: result.objectsDeleted },
    });
    if (result.failed.length) {
      console.error(`\nThese files could not be moved and stay where they were (run again):\n${result.failed.slice(0, 20).map((f) => `${f.id}: ${f.error}`).join('\n')}`);
      process.exitCode = 1;
    } else if (result.skipped) {
      console.log('\nRun again once the worker has checked the remaining files.');
    }
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
