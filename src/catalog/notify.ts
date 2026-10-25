import { sql, type NotNull } from 'kysely';
import type { AppConfig } from '../config.js';
import type { Executor } from '../db/index.js';
import type { Locale } from '../db/types.js';
import { enqueueEmail, notify } from '../notifications/email.js';

// Tells customers about catalogue changes that affect their content scopes:
// a newer catalogue they have not moved to yet, and selected entries newly
// flagged "needs review". Recipients are the people who can act (owners,
// admins, editors) of active organizations; texts use each person's language,
// and emails respect their `catalog_emails` choice.

type Texts = Record<Locale, (p: Record<string, string>) => { title: string; body: string }>;
const TEXT: Record<'catalog_behind' | 'catalog_review', Texts> = {
  catalog_behind: {
    en: (p) => ({ title: `The ${p.year} catalogue is published`, body: `${p.scopes} still ${p.many === 'true' ? 'use' : 'uses'} an older catalogue. Review what changed and carry ${p.many === 'true' ? 'them' : 'it'} forward.` }),
    ar: (p) => ({ title: `نُشر دليل عام ${p.year}`, body: `ما زالت ${p.scopes} تستخدم دليلًا أقدم. راجع التغييرات وانقلها إلى الدليل الجديد.` }),
  },
  catalog_review: {
    en: (p) => ({ title: `${p.count} selected ${p.count === '1' ? 'item is' : 'items are'} under review`, body: `${p.note} — ${p.scopes}` }),
    ar: (p) => ({ title: `${p.count} من العناصر المحددة قيد المراجعة`, body: `${p.note} — ${p.scopes}` }),
  },
};

function names(list: string[], locale: Locale): string {
  const q = (n: string) => (locale === 'ar' ? `«${n}»` : `“${n}”`);
  const shown = list.slice(0, 3).map(q).join(locale === 'ar' ? '، ' : ', ');
  return list.length > 3 ? `${shown} +${list.length - 3}` : shown;
}
const bullets = (list: string[]) => list.map((n) => `• ${n}`).join('\n');

interface Recipient { orgId: string; id: string; email: string; locale: Locale; catalogEmails: boolean }

async function recipientsByOrg(exec: Executor, orgIds: string[]): Promise<Map<string, Recipient[]>> {
  const out = new Map<string, Recipient[]>();
  if (!orgIds.length) return out;
  const rows = await exec
    .selectFrom('memberships as m')
    .innerJoin('users as u', 'u.id', 'm.user_id')
    .select(['m.org_id', 'u.id', 'u.email', 'u.locale', 'u.catalog_emails'])
    .where('m.org_id', 'in', orgIds)
    .where('m.role', 'in', ['owner', 'admin', 'editor'])
    .where('u.status', '=', 'active')
    .where('u.email_verified_at', 'is not', null)
    // Members are staff accounts, which always have an email (migration 0007).
    .$narrowType<{ email: NotNull }>()
    .execute();
  for (const r of rows) {
    const list = out.get(r.org_id) ?? [];
    list.push({ orgId: r.org_id, id: r.id, email: r.email, locale: r.locale, catalogEmails: r.catalog_emails });
    out.set(r.org_id, list);
  }
  return out;
}

/**
 * Notifies organizations whose scopes use a catalogue older than `targetVersionId`
 * (an earlier academic year, or an archived version of the same year). Called when a
 * version is published and when one is archived; each organization hears about a
 * given academic year once (a later correction of that year does not notify again).
 */
export async function notifyScopesBehind(exec: Executor, config: AppConfig, targetVersionId: string): Promise<{ orgs: number }> {
  const target = await exec.selectFrom('catalog_versions').select(['id', 'academic_year', 'label', 'status']).where('id', '=', targetVersionId).executeTakeFirst();
  if (!target || target.status !== 'published') return { orgs: 0 };
  const { rows } = await sql<{ org_id: string; org_name: string; scope_id: string; scope_name: string }>`
    SELECT s.org_id, o.name AS org_name, s.id AS scope_id, s.name AS scope_name
    FROM scopes s
    JOIN catalog_versions sv ON sv.id = s.catalog_version_id
    JOIN organizations o ON o.id = s.org_id
    WHERE o.status = 'active' AND sv.id <> ${target.id}
      AND (sv.academic_year < ${target.academic_year} OR (sv.status = 'archived' AND sv.academic_year <= ${target.academic_year}))
    ORDER BY s.org_id, s.created_at, s.id`.execute(exec);
  const byOrg = new Map<string, { name: string; scopes: { id: string; name: string }[] }>();
  for (const r of rows) {
    const org = byOrg.get(r.org_id) ?? { name: r.org_name, scopes: [] };
    org.scopes.push({ id: r.scope_id, name: r.scope_name });
    byOrg.set(r.org_id, org);
  }
  const recipients = await recipientsByOrg(exec, [...byOrg.keys()]);
  let notified = 0;
  for (const [orgId, org] of byOrg) {
    const fresh = await exec
      .insertInto('catalog_notices')
      .values({ org_id: orgId, kind: 'catalog_behind', ref: target.academic_year })
      .onConflict((oc) => oc.doNothing())
      .returning('org_id')
      .executeTakeFirst();
    if (!fresh) continue;
    notified++;
    const link = org.scopes.length === 1 ? `/org/${orgId}/scopes/${org.scopes[0]!.id}/carry?to=${target.id}` : `/org/${orgId}/scopes`;
    for (const r of recipients.get(orgId) ?? []) {
      const text = TEXT.catalog_behind[r.locale]({ year: target.academic_year, scopes: names(org.scopes.map((s) => s.name), r.locale), many: String(org.scopes.length > 1) });
      await notify(exec, { userId: r.id, orgId, kind: 'catalog_behind', title: text.title, body: text.body, link });
      if (r.catalogEmails) {
        await enqueueEmail(exec, r.email, 'catalog_published', r.locale, {
          year: target.academic_year,
          label: target.label,
          orgName: org.name,
          scopes: bullets(org.scopes.map((s) => s.name)),
          link: `${config.APP_URL}${link}`,
          settingsLink: `${config.APP_URL}/account`,
        });
      }
    }
  }
  return { orgs: notified };
}

/**
 * Notifies organizations that selected any of `materialIds` (newly flagged for review,
 * directly or through their subject) in their scopes.
 */
export async function notifyFlaggedForReview(exec: Executor, config: AppConfig, materialIds: string[], note: string): Promise<{ orgs: number }> {
  if (!materialIds.length) return { orgs: 0 };
  const rows = await exec
    .selectFrom('scope_items as i')
    .innerJoin('scopes as s', 's.id', 'i.scope_id')
    .innerJoin('organizations as o', 'o.id', 'i.org_id')
    .innerJoin('catalog_materials as m', 'm.id', 'i.material_id')
    .select(['i.org_id', 'o.name as orgName', 's.id as scopeId', 's.name as scopeName', 's.created_at as scopeCreated', 'm.id as materialId', 'm.title'])
    .where('i.material_id', 'in', materialIds)
    .where('o.status', '=', 'active')
    .orderBy('i.org_id')
    .orderBy('s.created_at')
    .execute();
  const byOrg = new Map<string, { name: string; scopes: Map<string, string>; items: Map<string, string> }>();
  for (const r of rows) {
    const org = byOrg.get(r.org_id) ?? { name: r.orgName, scopes: new Map(), items: new Map() };
    org.scopes.set(r.scopeId, r.scopeName);
    org.items.set(r.materialId, r.title);
    byOrg.set(r.org_id, org);
  }
  const recipients = await recipientsByOrg(exec, [...byOrg.keys()]);
  for (const [orgId, org] of byOrg) {
    const scopeNames = [...org.scopes.values()];
    const link = `/org/${orgId}?scope=${[...org.scopes.keys()][0]}`;
    const count = String(org.items.size);
    for (const r of recipients.get(orgId) ?? []) {
      const text = TEXT.catalog_review[r.locale]({ count, note, scopes: names(scopeNames, r.locale) });
      await notify(exec, { userId: r.id, orgId, kind: 'catalog_review', title: text.title, body: text.body, link });
      if (r.catalogEmails) {
        await enqueueEmail(exec, r.email, 'catalog_review', r.locale, {
          count,
          orgName: org.name,
          items: bullets([...org.items.values()]),
          note,
          scopes: bullets(scopeNames),
          link: `${config.APP_URL}${link}`,
          settingsLink: `${config.APP_URL}/account`,
        });
      }
    }
  }
  return { orgs: byOrg.size };
}
