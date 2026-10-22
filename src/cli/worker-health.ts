import { loadConfig } from '../config.js';
import { createDatabase } from '../db/index.js';

// Container health check for the worker: exits 0 when the worker wrote a
// heartbeat within the last few intervals, 1 otherwise.
async function main() {
  const config = loadConfig();
  const db = createDatabase(config.DATABASE_URL, { poolMax: 1, ssl: config.DATABASE_SSL });
  try {
    const row = await db.selectFrom('worker_heartbeats').select('last_beat_at').where('name', '=', 'worker').executeTakeFirst();
    const maxAgeMs = Math.max(120_000, config.WORKER_INTERVAL_MS * 4);
    process.exitCode = row && Date.now() - row.last_beat_at.getTime() < maxAgeMs ? 0 : 1;
  } finally {
    await db.destroy();
  }
}

main().catch(() => {
  process.exitCode = 1;
});
