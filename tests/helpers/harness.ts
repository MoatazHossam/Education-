import type { FastifyInstance, InjectOptions } from 'fastify';
import { authenticator } from 'otplib';
import { hashPassword } from '../../src/auth/password.js';
import { buildApp } from '../../src/app.js';
import { loadConfig, type AppConfig } from '../../src/config.js';
import { createDatabase, type Database } from '../../src/db/index.js';
import { encryptSecret } from '../../src/lib/crypto.js';
import { OWNER_URL, TEST_ENV } from './env.js';

export interface Harness {
  app: FastifyInstance;
  config: AppConfig;
  /** Application-role connection (RLS enforced), same as the app uses. */
  db: Database;
  /** Owner connection for test assertions and fixtures (bypasses nothing implicitly; use with care). */
  ownerDb: Database;
  close(): Promise<void>;
}

export async function createHarness(overrides: Record<string, string> = {}): Promise<Harness> {
  const config = loadConfig({ ...TEST_ENV, ...overrides });
  const db = createDatabase(config.DATABASE_URL, { poolMax: 5 });
  const ownerDb = createDatabase(OWNER_URL, { poolMax: 2 });
  const app = await buildApp({ config, db, logger: false });
  await app.ready();
  return {
    app,
    config,
    db,
    ownerDb,
    async close() {
      await app.close();
      await db.destroy();
      await ownerDb.destroy();
    },
  };
}

/** Removes all tenant/user data, keeping plans and the catalogue. */
export async function resetData(ownerDb: Database): Promise<void> {
  const { sql } = await import('kysely');
  // TRUNCATE ... CASCADE would also empty catalog_versions (it references users),
  // so tenant data is removed through the foreign keys' ON DELETE actions instead.
  await sql`TRUNCATE email_outbox, billing_events, worker_heartbeats, audit_logs, rate_limits, ops_alerts RESTART IDENTITY`.execute(ownerDb);
  await sql`DELETE FROM organizations`.execute(ownerDb);
  await sql`DELETE FROM users`.execute(ownerDb);
  // Keep only the seeded catalogue version (tests may create and publish others).
  await sql`DELETE FROM catalog_versions WHERE id <> (SELECT id FROM catalog_versions ORDER BY created_at LIMIT 1)`.execute(ownerDb);
  for (const table of ['catalog_subjects', 'catalog_materials']) {
    await sql`UPDATE ${sql.table(table)} SET verification_status = 'unverified', verification_source = NULL, verification_url = NULL,
              verification_note = NULL, reviewed_by = NULL, reviewed_at = NULL WHERE verification_status <> 'unverified'`.execute(ownerDb);
  }
  // Also bumps updated_at (trigger), so the app's cached catalogue trees are rebuilt.
  await sql`UPDATE catalog_versions SET status = 'published'`.execute(ownerDb);
  await sql`UPDATE plans SET price_monthly_cents = 99000 WHERE id = 'starter'`.execute(ownerDb);
}

let ipCounter = 0;

/** Minimal browser-like client: cookie jar, CSRF header, unique client IP. */
export class Client {
  cookies = new Map<string, string>();
  csrf: string | null = null;
  readonly ip: string;

  constructor(private readonly app: FastifyInstance) {
    ipCounter++;
    this.ip = `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
  }

  async request(method: InjectOptions['method'], url: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await this.app.inject({
      method,
      url,
      remoteAddress: this.ip,
      headers: {
        ...(this.cookies.size ? { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
        ...(this.csrf && method !== 'GET' ? { 'x-csrf-token': this.csrf } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
    });
    for (const c of res.cookies as { name: string; value: string; expires?: Date; maxAge?: number }[]) {
      if (!c.value || (c.expires && c.expires.getTime() < Date.now())) this.cookies.delete(c.name);
      else this.cookies.set(c.name, c.value);
    }
    return res;
  }

  get(url: string, headers?: Record<string, string>) {
    return this.request('GET', url, undefined, headers);
  }
  post(url: string, body: unknown = {}, headers?: Record<string, string>) {
    return this.request('POST', url, body, headers);
  }
  patch(url: string, body: unknown = {}, headers?: Record<string, string>) {
    return this.request('PATCH', url, body, headers);
  }
  delete(url: string, headers?: Record<string, string>) {
    return this.request('DELETE', url, undefined, headers);
  }

  /** Loads /api/auth/me and stores the CSRF token. */
  async refresh() {
    const res = await this.get('/api/auth/me');
    if (res.statusCode === 200) this.csrf = res.json().csrfToken;
    return res;
  }
}

export const PASSWORD = 'correct-horse-battery-staple';

export async function latestEmail(h: Harness, to: string, template?: string) {
  let q = h.ownerDb.selectFrom('email_outbox').selectAll().where('to_email', '=', to).orderBy('created_at', 'desc');
  if (template) q = q.where('template', '=', template);
  return q.executeTakeFirst();
}

export function tokenFrom(text: string, param = 'token'): string {
  const m = text.match(new RegExp(`[?&]${param}=([A-Za-z0-9_-]+)`));
  if (!m?.[1]) throw new Error(`no ${param} in email:\n${text}`);
  return m[1];
}

let userCounter = 0;
export function uniqueEmail(prefix = 'user'): string {
  userCounter++;
  return `${prefix}.${Date.now().toString(36)}.${userCounter}@example.test`;
}

/** Registers an owner + organization, verifies the email and signs in. */
export async function signUp(h: Harness, opts: { email?: string; org?: string; name?: string } = {}) {
  const email = opts.email ?? uniqueEmail('owner');
  const client = new Client(h.app);
  const reg = await client.post('/api/auth/register', { name: opts.name ?? 'Test Owner', email, password: PASSWORD, organizationName: opts.org ?? 'Test Org' });
  if (reg.statusCode !== 201) throw new Error(`register failed: ${reg.body}`);
  const mail = await latestEmail(h, email, 'verify_email');
  const verify = await client.post('/api/auth/verify-email', { token: tokenFrom(mail!.text_body) });
  if (verify.statusCode !== 200) throw new Error(`verify failed: ${verify.body}`);
  const login = await client.post('/api/auth/login', { email, password: PASSWORD });
  if (login.statusCode !== 200) throw new Error(`login failed: ${login.body}`);
  const me = await client.refresh();
  const orgId: string = me.json().organizations[0].id;
  return { client, email, orgId, userId: me.json().user.id as string };
}

/** Creates a platform administrator (with TOTP unless `mfa: false`) and returns a signed-in client. */
export async function createPlatformAdmin(h: Harness, opts: { mfa: boolean } = { mfa: true }) {
  const email = uniqueEmail('admin');
  const secret = authenticator.generateSecret();
  await h.ownerDb
    .insertInto('users')
    .values({
      email,
      name: 'Ops',
      password_hash: await hashPassword(PASSWORD),
      email_verified_at: new Date(),
      is_platform_admin: true,
      mfa_enabled: opts.mfa,
      mfa_secret_enc: opts.mfa ? encryptSecret(h.config.DATA_ENCRYPTION_KEY, secret) : null,
    })
    .execute();
  const client = new Client(h.app);
  const login = await client.post('/api/auth/login', { email, password: PASSWORD });
  if (login.statusCode !== 200) throw new Error(`admin login failed: ${login.body}`);
  await client.refresh();
  if (opts.mfa) {
    const verify = await client.post('/api/auth/mfa/verify', { code: authenticator.generate(secret) });
    if (verify.statusCode !== 200) throw new Error(`admin MFA failed: ${verify.body}`);
    await client.refresh();
  }
  return client;
}

/** Invites `email` with `role` into the org and returns a signed-in client for the new member. */
export async function addMember(h: Harness, owner: Client, orgId: string, role: 'admin' | 'editor' | 'viewer', email = uniqueEmail(role)) {
  const inv = await owner.post(`/api/orgs/${orgId}/invitations`, { email, role });
  if (inv.statusCode !== 201) throw new Error(`invite failed: ${inv.body}`);
  const mail = await latestEmail(h, email, 'invitation');
  const client = new Client(h.app);
  const reg = await client.post('/api/auth/register', { name: `Member ${role}`, email, password: PASSWORD, inviteToken: tokenFrom(mail!.text_body) });
  if (reg.statusCode !== 201) throw new Error(`invite registration failed: ${reg.body}`);
  await client.refresh();
  const me = await client.get('/api/auth/me');
  return { client, email, userId: me.json().user.id as string };
}

export async function publishedVersionId(h: Harness): Promise<string> {
  const v = await h.ownerDb.selectFrom('catalog_versions').select('id').where('status', '=', 'published').orderBy('created_at').executeTakeFirstOrThrow();
  return v.id;
}

export async function someMaterialIds(h: Harness, versionId: string, n: number, offset = 0): Promise<string[]> {
  const rows = await h.ownerDb.selectFrom('catalog_materials').select('id').where('version_id', '=', versionId).orderBy('id').limit(n).offset(offset).execute();
  return rows.map((r) => r.id);
}

/**
 * Materials with different titles. The catalogue repeats titles across subjects
 * (1,038 materials, 113 titles), so tests that look for a title in an email
 * need books whose titles cannot be confused.
 */
export async function distinctTitleMaterialIds(h: Harness, versionId: string, n: number): Promise<string[]> {
  const rows = await h.ownerDb.selectFrom('catalog_materials').select('id').distinctOn('title').where('version_id', '=', versionId).orderBy('title').orderBy('id').limit(n).execute();
  if (rows.length < n) throw new Error(`only ${rows.length} distinct titles`);
  return rows.map((r) => r.id);
}

export function totp(secret: string): string {
  return authenticator.generate(secret);
}

/**
 * The student portal routes (besides sign-in and sign-out, the only ones a
 * student account may use). Reviewed list: the student tests check that every
 * other route rejects a student session.
 */
export const STUDENT_ROUTES = [
  'POST /api/auth/student-login', 'GET /api/student/curriculum', 'PATCH /api/student/profile', 'POST /api/student/password',
  // Homework (docs/CLASSROOM.md)
  'GET /api/student/home', 'GET /api/student/homework', 'GET /api/student/homework/:homeworkId', 'PUT /api/student/homework/:homeworkId/submission',
  'POST /api/student/homework/:homeworkId/hand-in', 'POST /api/student/homework/:homeworkId/take-back', 'POST /api/student/homework/:homeworkId/files',
  'DELETE /api/student/homework/:homeworkId/files/:fileId', 'GET /api/student/files/:fileId', 'GET /api/student/notifications', 'POST /api/student/notifications/read',
  // Online tests (docs/ONLINE_TESTS.md)
  'GET /api/student/tests', 'GET /api/student/tests/:testId', 'POST /api/student/tests/:testId/start', 'GET /api/student/attempts/:attemptId',
  'PUT /api/student/attempts/:attemptId/answers/:questionId', 'POST /api/student/attempts/:attemptId/heartbeat', 'POST /api/student/attempts/:attemptId/events',
  'POST /api/student/attempts/:attemptId/submit', 'GET /api/student/attempts/:attemptId/result',
];

/**
 * Enables student accounts for the organization (the platform-admin override)
 * and creates one through the staff API. Returns its one-time password.
 */
export async function enableStudents(h: Harness, orgId: string, max = 50) {
  const { sql } = await import('kysely');
  const { withSystemContext } = await import('../../src/db/index.js');
  await withSystemContext(h.ownerDb, (trx) =>
    sql`UPDATE subscriptions SET limit_overrides = limit_overrides || ${JSON.stringify({ max_students: max })}::jsonb WHERE org_id = ${orgId}`.execute(trx),
  );
}

export async function createStudent(h: Harness, owner: Client, orgId: string, body: { username?: string; name?: string; grade?: number; scopeId?: string | null } = {}) {
  userCounter++;
  const res = await owner.post(`/api/orgs/${orgId}/students`, { username: body.username ?? `student${userCounter}`, name: body.name ?? 'Test Student', grade: body.grade ?? 7, scopeId: body.scopeId ?? null });
  if (res.statusCode !== 201) throw new Error(`student creation failed: ${res.body}`);
  const { student, password } = res.json() as { student: { userId: string; username: string }; password: string };
  const school = (await h.ownerDb.selectFrom('organizations').select('slug').where('id', '=', orgId).executeTakeFirstOrThrow()).slug;
  return { ...student, password, school };
}

/** Signs a student in through the student sign-in route and loads the CSRF token. */
export async function studentLogin(h: Harness, s: { school: string; username: string; password: string }) {
  const client = new Client(h.app);
  const res = await client.post('/api/auth/student-login', { school: s.school, username: s.username, password: s.password });
  if (res.statusCode !== 200) throw new Error(`student login failed: ${res.body}`);
  await client.refresh();
  return client;
}
