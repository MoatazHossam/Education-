import { randomBytes } from 'node:crypto';
import { hashPassword } from '../auth/password.js';
import { loadConfig } from '../config.js';
import { createDatabase, withSystemContext } from '../db/index.js';
import { recordAudit } from '../audit/audit.js';

// Usage: create-platform-admin --email ops@example.com --name "Ops Admin"
// Creates (or promotes) a platform administrator. A new account receives a
// random one-time password printed to the terminal; two-factor enrollment is
// enforced before any admin endpoint can be used.
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg('email')?.trim().toLowerCase();
  const name = arg('name') ?? 'Platform Admin';
  if (!email || !/^[^@\s]+@[^@\s]+$/.test(email)) throw new Error('Pass --email <address>');
  const config = loadConfig();
  const db = createDatabase(config.DATABASE_URL, { poolMax: 1, ssl: config.DATABASE_SSL });
  try {
    const existing = await db.selectFrom('users').select(['id']).where('email', '=', email).executeTakeFirst();
    if (existing) {
      await db.updateTable('users').set({ is_platform_admin: true }).where('id', '=', existing.id).execute();
      await withSystemContext(db, (trx) => recordAudit(trx, { type: 'system', email: 'cli' }, { action: 'admin.promoted', targetType: 'user', targetId: existing.id }));
      console.log(`Promoted ${email} to platform administrator.`);
      return;
    }
    const password = randomBytes(12).toString('base64url');
    const user = await db
      .insertInto('users')
      .values({ email, name, password_hash: await hashPassword(password), email_verified_at: new Date(), is_platform_admin: true })
      .returning('id')
      .executeTakeFirstOrThrow();
    await withSystemContext(db, (trx) => recordAudit(trx, { type: 'system', email: 'cli' }, { action: 'admin.created', targetType: 'user', targetId: user.id }));
    console.log(`Created platform administrator ${email}\nOne-time password: ${password}\nSign in, change the password and enable two-factor authentication.`);
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
