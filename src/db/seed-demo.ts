import { authenticator } from 'otplib';
import { randomBytes } from 'node:crypto';
import { hashPassword } from '../auth/password.js';
import type { AppConfig } from '../config.js';
import { encryptSecret } from '../lib/crypto.js';
import { createOrganization } from '../orgs/service.js';
import { setOrgContext, type Database } from './index.js';

/**
 * Local development data. Passwords come from DEMO_PASSWORD or are generated
 * and printed once; nothing here runs in production (guarded by the CLI).
 */
export async function seedDemoData(db: Database, config: AppConfig, catalogVersionId: string): Promise<{ message: string }> {
  const existing = await db.selectFrom('users').select('id').where('email', '=', 'owner@demo.local').executeTakeFirst();
  if (existing) return { message: 'Demo data already present.' };
  const password = process.env.DEMO_PASSWORD ?? randomBytes(9).toString('base64url');
  const passwordHash = await hashPassword(password);
  const adminTotp = authenticator.generateSecret(20);

  await db.transaction().execute(async (trx) => {
    const mk = (email: string, name: string, extra: Record<string, unknown> = {}) =>
      trx.insertInto('users').values({ email, name, password_hash: passwordHash, email_verified_at: new Date(), ...extra }).returningAll().executeTakeFirstOrThrow();
    const owner = await mk('owner@demo.local', 'Demo Owner');
    const editor = await mk('editor@demo.local', 'Demo Editor');
    const viewer = await mk('viewer@demo.local', 'Demo Viewer');
    await mk('admin@demo.local', 'Platform Admin', { is_platform_admin: true, mfa_enabled: true, mfa_secret_enc: encryptSecret(config.dataKeys, adminTotp) });

    const { org } = await createOrganization(trx, config, { name: 'Demo Ed-Tech Co', owner, locale: 'en' }, null);
    await setOrgContext(trx, org.id, owner.id);
    await trx.insertInto('memberships').values([
      { org_id: org.id, user_id: editor.id, role: 'editor' },
      { org_id: org.id, user_id: viewer.id, role: 'viewer' },
    ]).execute();
    const scope = await trx
      .insertInto('scopes')
      .values({ org_id: org.id, catalog_version_id: catalogVersionId, name: 'Primary maths & science', description: 'Demo scope', created_by: owner.id })
      .returning('id')
      .executeTakeFirstOrThrow();
    const mats = await trx
      .selectFrom('catalog_materials as m')
      .innerJoin('catalog_subjects as s', 's.id', 'm.subject_id')
      .select('m.id')
      .where('m.version_id', '=', catalogVersionId)
      .where('s.grade', '<=', 3)
      .where('s.code', '=', 'ma')
      .where('m.kind', '=', 'moe')
      .execute();
    if (mats.length) {
      await trx.insertInto('scope_items').values(mats.map((m) => ({ scope_id: scope.id, org_id: org.id, catalog_version_id: catalogVersionId, material_id: m.id, added_by: owner.id }))).execute();
    }
  });

  return {
    message: [
      'Demo data created (development only):',
      `  owner@demo.local / editor@demo.local / viewer@demo.local / admin@demo.local — password: ${password}`,
      `  admin@demo.local TOTP secret (add to an authenticator app): ${adminTotp}`,
    ].join('\n'),
  };
}
