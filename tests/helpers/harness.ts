import type { FastifyInstance, InjectOptions } from 'fastify';
import { authenticator } from 'otplib';
import { buildApp } from '../../src/app.js';
import { loadConfig, type AppConfig } from '../../src/config.js';
import { createDatabase, type Database } from '../../src/db/index.js';
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
  await sql`TRUNCATE users, organizations, sessions, user_tokens, email_outbox, notifications, billing_events, worker_heartbeats, audit_logs RESTART IDENTITY CASCADE`.execute(ownerDb);
  await sql`DELETE FROM catalog_versions WHERE status = 'draft'`.execute(ownerDb);
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

export function totp(secret: string): string {
  return authenticator.generate(secret);
}
