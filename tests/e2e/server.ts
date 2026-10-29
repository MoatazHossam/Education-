import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { runClassroomFileChecks } from '../../src/classroom/file-checks.js';
import { runClassroomRetention } from '../../src/classroom/retention.js';
import { loadConfig } from '../../src/config.js';
import { createDatabase } from '../../src/db/index.js';
import { runAssignmentDigests } from '../../src/scopes/digest.js';
import { runDueReminders } from '../../src/scopes/reminders.js';
import { processWebhookDeliveries } from '../../src/webhooks/service.js';
import { ADMIN_URL } from '../helpers/env.js';

export const E2E_PORT = 3100;
export const E2E_DB = 'midad_e2e';
const PID_FILE = join(process.cwd(), 'test-results', '.e2e-server.pid');
// The AI provider of the E2E server is the local simulator (tests/helpers/ai-simulator.ts), run as its own process.
export const E2E_AI_PORT = 3199;
export const E2E_AI_KEY = 'e2e-ai-key-0123456789';
const AI_PID_FILE = join(process.cwd(), 'test-results', '.e2e-ai-simulator.pid');

function dbUrl(user: string, password: string): string {
  const u = new URL(ADMIN_URL);
  u.username = user;
  u.password = password;
  u.pathname = `/${E2E_DB}`;
  return u.toString();
}

export const E2E_OWNER_URL = dbUrl('midad_test_owner', 'owner-test-pw');

export const E2E_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  PORT: String(E2E_PORT),
  HOST: '127.0.0.1',
  APP_URL: `http://localhost:${E2E_PORT}`,
  LOG_LEVEL: 'warn',
  DATABASE_URL: dbUrl('midad_test_app', 'app-test-pw'),
  MIGRATION_DATABASE_URL: E2E_OWNER_URL,
  SESSION_SECRET: 'e2e-session-secret-0123456789-abcdefghijklmnop',
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
  EMAIL_TRANSPORT: 'none',
  BILLING_PROVIDER: 'sandbox',
  SANDBOX_WEBHOOK_SECRET: 'e2e-sandbox-secret-123456',
  // Customer webhooks are delivered to a local receiver in the journeys (refused in production).
  WEBHOOK_ALLOW_INSECURE_TARGETS: 'true',
  AI_PROVIDER: 'gemini',
  AI_API_KEY: E2E_AI_KEY,
  AI_MODEL: 'gemini-2.5-pro',
  AI_API_BASE: `http://127.0.0.1:${E2E_AI_PORT}`,
};

/** Starts the AI provider simulator in a process of its own, ready before the server needs it. */
export async function startAiSimulator(): Promise<void> {
  const child = spawn(process.execPath, ['--import', 'tsx', 'tests/e2e/ai-simulator-server.ts'], {
    env: { ...process.env, E2E_AI_PORT: String(E2E_AI_PORT), E2E_AI_KEY },
    stdio: ['ignore', 'inherit', 'inherit'],
    detached: true,
  });
  child.unref();
  writeFileSync(AI_PID_FILE, String(child.pid));
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      await fetch(`http://127.0.0.1:${E2E_AI_PORT}/`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error('AI simulator did not start');
}

export async function stopAiSimulator(): Promise<void> {
  if (!existsSync(AI_PID_FILE)) return;
  const pid = Number(readFileSync(AI_PID_FILE, 'utf8'));
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
  }
}

export async function startServer(): Promise<number> {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    env: { ...process.env, ...E2E_ENV },
    stdio: ['ignore', 'inherit', 'inherit'],
    detached: true,
  });
  child.unref();
  writeFileSync(PID_FILE, String(child.pid));
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${E2E_PORT}/readyz`);
      if (res.ok) return child.pid!;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('E2E server did not become ready');
}

export async function stopServer(): Promise<void> {
  if (!existsSync(PID_FILE)) return;
  const pid = Number(readFileSync(PID_FILE, 'utf8'));
  try {
    process.kill(-pid, 'SIGKILL'); // whole process group (tsx loader + node)
  } catch {
    try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
  }
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      await fetch(`http://localhost:${E2E_PORT}/healthz`);
      await new Promise((r) => setTimeout(r, 200));
    } catch {
      return;
    }
  }
}

/** Reads the newest email of a template sent to an address (outbox table). */
export async function latestEmailText(to: string, template: string): Promise<string> {
  const client = new pg.Client({ connectionString: E2E_OWNER_URL });
  await client.connect();
  try {
    for (let i = 0; i < 20; i++) {
      const r = await client.query('SELECT text_body FROM email_outbox WHERE to_email = $1 AND template = $2 ORDER BY created_at DESC LIMIT 1', [to, template]);
      if (r.rows[0]) return r.rows[0].text_body as string;
      await new Promise((res) => setTimeout(res, 250));
    }
    throw new Error(`no ${template} email for ${to}`);
  } finally {
    await client.end();
  }
}

export async function ownerQuery(sql: string, params: unknown[] = []) {
  const client = new pg.Client({ connectionString: E2E_OWNER_URL });
  await client.connect();
  try {
    await client.query(`SELECT set_config('app.rls_bypass', 'on', false)`);
    return (await client.query(sql, params)).rows;
  } finally {
    await client.end();
  }
}

/** One pass of the worker's due-date reminders against the E2E database (the E2E run starts no worker). */
export async function runReminderPass(now: Date) {
  const db = createDatabase(E2E_ENV.DATABASE_URL!, { poolMax: 2 });
  try {
    return await runDueReminders(db, loadConfig(E2E_ENV), now);
  } finally {
    await db.destroy();
  }
}

/** One pass of the worker's daily summaries against the E2E database. */
export async function runDigestPass(now: Date) {
  const db = createDatabase(E2E_ENV.DATABASE_URL!, { poolMax: 2 });
  try {
    return await runAssignmentDigests(db, loadConfig(E2E_ENV), now);
  } finally {
    await db.destroy();
  }
}

/** One pass of the worker's webhook deliveries against the E2E database. */
export async function runWebhookPass() {
  const db = createDatabase(E2E_ENV.DATABASE_URL!, { poolMax: 2 });
  try {
    return await processWebhookDeliveries(db, loadConfig(E2E_ENV));
  } finally {
    await db.destroy();
  }
}

/** One pass of the worker's file checks (docs/CLASSROOM.md §5) against the E2E database; no virus scanner here. */
export async function runFileCheckPass() {
  const db = createDatabase(E2E_ENV.DATABASE_URL!, { poolMax: 2 });
  try {
    return await runClassroomFileChecks(db, null);
  } finally {
    await db.destroy();
  }
}

/** One pass of the worker's classroom retention (docs/CLASSROOM.md §11) against the E2E database. */
export async function runRetentionPass(now: Date) {
  const db = createDatabase(E2E_ENV.DATABASE_URL!, { poolMax: 2 });
  try {
    return await runClassroomRetention(db, loadConfig(E2E_ENV), now);
  } finally {
    await db.destroy();
  }
}
