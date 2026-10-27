import { sql, type RawBuilder } from 'kysely';
import { z } from 'zod';
import { recordAudit } from '../audit/audit.js';
import type { AppConfig } from '../config.js';
import { withOrgContext, withSystemContext, type Database, type Executor } from '../db/index.js';
import type { Locale, RetentionStage } from '../db/types.js';
import { addDays } from '../lib/time.js';
import { enqueueEmail, notify } from '../notifications/email.js';
import { cairoClock, SEND_FROM_HOUR, SEND_UNTIL_HOUR } from '../scopes/reminders.js';

// How long a school keeps classroom data (migration 0015, docs/CLASSROOM.md §11).
//
// A school sets up to three periods, in days from a homework's due time or a
// test's end (its closing time with any extra time, or when it was closed early):
//   monitoring  a test's monitoring events
//   work        students' work: homework answers and files, test answers
//   records     the homework or test itself, with marks and comments
// Nothing is deleted while a period is unset.
//
// Before anything is deleted, the worker records a notice per homework or test
// and stage and tells the school's owners and admins; deletion waits at least
// NOTICE_DAYS after the notice. When the time comes, the item is checked again
// against the current periods, its dates and its hold, so a longer period, a
// later due time or a hold set in the meantime cancels the deletion.

export const NOTICE_DAYS = 14;
export const MAX_DAYS = 3650;
const BATCH = 500;
const LIST_MAX = 20;
const AUDIT_ITEMS_MAX = 100;

export type ItemKind = 'homework' | 'test';
export const STAGES: readonly RetentionStage[] = ['monitoring', 'work', 'records'];

export interface RetentionPeriods {
  monitoringDays: number | null;
  workDays: number | null;
  recordsDays: number | null;
}

const zDays = z.number().int().min(1).max(MAX_DAYS).nullable();
export const zPeriods = z.object({ monitoringDays: zDays, workDays: zDays, recordsDays: zDays });

/** Work and monitoring cannot be kept longer than the homework or test they belong to (also a database check). */
export function periodsInOrder(p: RetentionPeriods): boolean {
  if (p.recordsDays === null) return true;
  return (p.workDays === null || p.workDays <= p.recordsDays) && (p.monitoringDays === null || p.monitoringDays <= p.recordsDays);
}

export function periodOf(p: RetentionPeriods, stage: RetentionStage): number | null {
  return stage === 'monitoring' ? p.monitoringDays : stage === 'work' ? p.workDays : p.recordsDays;
}

const kindsFor = (stage: RetentionStage): ItemKind[] => (stage === 'monitoring' ? ['test'] : ['homework', 'test']);

export async function getPeriods(exec: Executor, orgId: string): Promise<RetentionPeriods & { updatedAt: Date | null; updatedBy: string | null }> {
  const r = await exec.selectFrom('classroom_retention').selectAll().where('org_id', '=', orgId).executeTakeFirst();
  return { monitoringDays: r?.monitoring_days ?? null, workDays: r?.work_days ?? null, recordsDays: r?.records_days ?? null, updatedAt: r?.updated_at ?? null, updatedBy: r?.updated_by ?? null };
}

// ------------------------------------------------------------ which items are due

const TABLE: Record<ItemKind, RawBuilder<unknown>> = { homework: sql.raw('homework'), test: sql.raw('tests') };

/** The date a period counts from, for the item aliased `i`. */
const ANCHOR: Record<ItemKind, RawBuilder<Date>> = {
  homework: sql<Date>`i.due_at`,
  test: sql<Date>`coalesce(i.closed_early_at, i.closes_at + make_interval(mins => i.max_extra_minutes))`,
};

/** The item (aliased `i`) still has data for this stage to delete. Draft tests hold no student data and are left alone. */
function hasDataFor(kind: ItemKind, stage: RetentionStage): RawBuilder<boolean> {
  if (kind === 'homework') {
    if (stage === 'monitoring') return sql<boolean>`false`;
    if (stage === 'records') return sql<boolean>`true`;
    return sql<boolean>`i.work_removed_at IS NULL AND EXISTS (
      SELECT 1 FROM homework_submissions s WHERE s.homework_id = i.id
        AND (s.body <> '' OR EXISTS (SELECT 1 FROM classroom_files f WHERE f.submission_id = s.id)))`;
  }
  if (stage === 'monitoring') {
    return sql<boolean>`i.status = 'published' AND i.monitoring_removed_at IS NULL AND EXISTS (
      SELECT 1 FROM test_events e JOIN test_attempts a ON a.id = e.attempt_id WHERE a.test_id = i.id)`;
  }
  if (stage === 'work') {
    return sql<boolean>`i.status = 'published' AND i.work_removed_at IS NULL AND EXISTS (
      SELECT 1 FROM test_answers x JOIN test_attempts a ON a.id = x.attempt_id WHERE a.test_id = i.id AND x.answer <> 'null'::jsonb)`;
  }
  return sql<boolean>`i.status = 'published'`;
}

const scheduled = (kind: ItemKind, days: number) => sql<Date>`(${ANCHOR[kind]} + make_interval(days => ${days}::int))`;

/**
 * Records a notice for every item of the school whose stage falls due within
 * NOTICE_DAYS and has none yet. Deletion waits until NOTICE_DAYS after the
 * notice at the earliest. Returns the new notices' ids.
 */
async function recordNotices(exec: Executor, orgId: string, periods: RetentionPeriods, now: Date): Promise<string[]> {
  const horizon = addDays(now, NOTICE_DAYS);
  const ids: string[] = [];
  for (const stage of STAGES) {
    const days = periodOf(periods, stage);
    if (days === null) continue;
    for (const kind of kindsFor(stage)) {
      const column = sql.raw(kind === 'homework' ? 'homework_id' : 'test_id');
      const { rows } = await sql<{ id: string }>`
        INSERT INTO classroom_retention_notices (org_id, ${column}, stage, delete_after, notified_at)
        SELECT i.org_id, i.id, ${stage}, greatest(${scheduled(kind, days)}, ${horizon}::timestamptz), ${now}::timestamptz
        FROM ${TABLE[kind]} i
        WHERE i.org_id = ${orgId} AND NOT i.retention_hold
          AND ${scheduled(kind, days)} <= ${horizon}::timestamptz
          AND ${hasDataFor(kind, stage)}
          AND NOT EXISTS (SELECT 1 FROM classroom_retention_notices n WHERE n.item_id = i.id AND n.stage = ${stage})
        ORDER BY ${ANCHOR[kind]}
        LIMIT ${BATCH}
        ON CONFLICT (item_id, stage) DO NOTHING
        RETURNING id`.execute(exec);
      ids.push(...rows.map((r) => r.id));
    }
  }
  return ids;
}

/** How many homework and tests would get a notice now under these periods (shown before saving them). */
export async function previewPeriods(exec: Executor, orgId: string, periods: RetentionPeriods, now = new Date()) {
  const horizon = addDays(now, NOTICE_DAYS);
  const counts: Record<RetentionStage, Record<ItemKind, number>> = { monitoring: { homework: 0, test: 0 }, work: { homework: 0, test: 0 }, records: { homework: 0, test: 0 } };
  const items = { homework: new Set<string>(), test: new Set<string>() };
  for (const stage of STAGES) {
    const days = periodOf(periods, stage);
    if (days === null) continue;
    for (const kind of kindsFor(stage)) {
      const { rows } = await sql<{ id: string }>`
        SELECT i.id FROM ${TABLE[kind]} i
        WHERE i.org_id = ${orgId} AND NOT i.retention_hold
          AND ${scheduled(kind, days)} <= ${horizon}::timestamptz
          AND ${hasDataFor(kind, stage)}`.execute(exec);
      counts[stage][kind] = rows.length;
      for (const r of rows) items[kind].add(r.id);
    }
  }
  return { counts, homework: items.homework.size, tests: items.test.size, deleteFrom: horizon };
}

// ------------------------------------------------------------ what owners and admins see

export interface NoticeItem {
  noticeId: string;
  kind: ItemKind;
  id: string;
  title: string;
  classId: string;
  className: string;
  subjectEn: string;
  subjectAr: string;
  /** The homework's due time or the test's end, which the periods count from. */
  date: Date;
  stage: RetentionStage;
  deleteAfter: Date;
  notifiedAt: Date;
}

/** Notices of the school, soonest first (all, or only the given ones). */
export async function listNotices(exec: Executor, orgId: string, ids?: string[]): Promise<NoticeItem[]> {
  if (ids && !ids.length) return [];
  const { rows } = await sql<NoticeItem>`
    SELECT n.id AS "noticeId", CASE WHEN n.homework_id IS NULL THEN 'test' ELSE 'homework' END AS kind, n.item_id AS id,
      coalesce(h.title, t.title) AS title, c.id AS "classId", c.name AS "className",
      coalesce(h.subject_en, t.subject_en) AS "subjectEn", coalesce(h.subject_ar, t.subject_ar) AS "subjectAr",
      coalesce(h.due_at, coalesce(t.closed_early_at, t.closes_at + make_interval(mins => t.max_extra_minutes))) AS date,
      n.stage, n.delete_after AS "deleteAfter", n.notified_at AS "notifiedAt"
    FROM classroom_retention_notices n
    LEFT JOIN homework h ON h.id = n.homework_id
    LEFT JOIN tests t ON t.id = n.test_id
    JOIN classes c ON c.id = coalesce(h.class_id, t.class_id)
    WHERE n.org_id = ${orgId} ${ids ? sql`AND n.id = ANY(${ids}::uuid[])` : sql``}
    ORDER BY n.delete_after, c.name, title, n.stage`.execute(exec);
  return rows;
}

/** Homework and tests an admin chose to keep whatever the periods say. */
export async function listHeld(exec: Executor, orgId: string) {
  const { rows } = await sql<{ kind: ItemKind; id: string; title: string; classId: string; className: string; subjectEn: string; subjectAr: string; date: Date }>`
    SELECT 'homework' AS kind, i.id, i.title, c.id AS "classId", c.name AS "className", i.subject_en AS "subjectEn", i.subject_ar AS "subjectAr", ${ANCHOR.homework} AS date
    FROM homework i JOIN classes c ON c.id = i.class_id WHERE i.org_id = ${orgId} AND i.retention_hold
    UNION ALL
    SELECT 'test', i.id, i.title, c.id, c.name, i.subject_en, i.subject_ar, ${ANCHOR.test}
    FROM tests i JOIN classes c ON c.id = i.class_id WHERE i.org_id = ${orgId} AND i.retention_hold
    ORDER BY date DESC
    LIMIT 500`.execute(exec);
  return rows;
}

/** For a homework or test page: whether it is kept, what was deleted, and what is due to be. */
export async function itemRetention(exec: Executor, kind: ItemKind, item: { id: string; retention_hold: boolean; work_removed_at: Date | null; monitoring_removed_at?: Date | null }) {
  const pending = await exec
    .selectFrom('classroom_retention_notices')
    .select(['stage', 'delete_after'])
    .where(kind === 'homework' ? 'homework_id' : 'test_id', '=', item.id)
    .orderBy('delete_after')
    .execute();
  return {
    hold: item.retention_hold,
    workRemovedAt: item.work_removed_at,
    monitoringRemovedAt: kind === 'test' ? (item.monitoring_removed_at ?? null) : null,
    pending: pending.map((p) => ({ stage: p.stage, deleteAfter: p.delete_after })),
  };
}

// ------------------------------------------------------------ telling owners and admins

const fmtDay = (d: Date, locale: Locale) =>
  new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: locale === 'ar' ? 'long' : 'short', year: 'numeric', timeZone: 'Africa/Cairo' }).format(d);

const WHAT: Record<Locale, Record<RetentionStage, Record<ItemKind, string>>> = {
  en: {
    monitoring: { homework: '', test: 'monitoring records' },
    work: { homework: 'students’ work', test: 'students’ answers' },
    records: { homework: 'the homework with its marks', test: 'the test with its marks' },
  },
  ar: {
    monitoring: { homework: '', test: 'سجلات المتابعة' },
    work: { homework: 'أعمال الطلاب', test: 'إجابات الطلاب' },
    records: { homework: 'الواجب ودرجاته', test: 'الاختبار ودرجاته' },
  },
};

export function noticeLines(locale: Locale, items: NoticeItem[]): string {
  const lines = items.slice(0, LIST_MAX).map((i) => {
    const what = WHAT[locale][i.stage][i.kind];
    return locale === 'ar'
      ? `• ${i.className} — «${i.title}»: ${what}، في ${fmtDay(i.deleteAfter, locale)} أو بعده`
      : `• ${i.className} — “${i.title}”: ${what}, on or after ${fmtDay(i.deleteAfter, locale)}`;
  });
  const more = items.length - LIST_MAX;
  if (more > 0) lines.push(locale === 'ar' ? `• و${more} غيرها` : `• and ${more} more`);
  return lines.join('\n');
}

/** One in-app notification and one email (verified address) per owner and admin, listing the new notices. */
async function tellAdmins(exec: Executor, config: AppConfig, orgId: string, items: NoticeItem[]): Promise<number> {
  if (!items.length) return 0;
  const org = await exec.selectFrom('organizations').select(['name']).where('id', '=', orgId).executeTakeFirstOrThrow();
  const admins = await exec
    .selectFrom('memberships as m')
    .innerJoin('users as u', 'u.id', 'm.user_id')
    .select(['u.id', 'u.name', 'u.email', 'u.locale', 'u.email_verified_at'])
    .where('m.org_id', '=', orgId)
    .where('m.role', 'in', ['owner', 'admin'])
    .where('u.status', '=', 'active')
    .execute();
  const first = items.reduce((d, i) => (i.deleteAfter < d ? i.deleteAfter : d), items[0]!.deleteAfter);
  const path = `/org/${orgId}/classes/retention`;
  for (const a of admins) {
    const date = fmtDay(first, a.locale);
    await notify(exec, {
      userId: a.id,
      orgId,
      kind: 'classroom_retention',
      title: a.locale === 'ar' ? `ستُحذف بيانات من الفصول بدءًا من ${date}` : `Classroom data will be deleted from ${date}`,
      body:
        a.locale === 'ar'
          ? `عناصر في ${org.name} (${items.length}). نزّل ما تحتاجه من دفاتر الدرجات أو احتفظ بعنصر مدة أطول.`
          : `${items.length} ${items.length === 1 ? 'item' : 'items'} in ${org.name}. Download the gradebooks you need, or keep an item longer.`,
      link: path,
    });
    if (a.email && a.email_verified_at) {
      await enqueueEmail(exec, a.email, 'classroom_retention', a.locale, { name: a.name, orgName: org.name, date, items: noticeLines(a.locale, items), link: `${config.APP_URL}${path}` });
    }
  }
  return admins.length;
}

/** Records notices that are due and tells owners and admins about them. */
export async function scheduleNotices(exec: Executor, config: AppConfig, orgId: string, periods: RetentionPeriods, now = new Date()): Promise<NoticeItem[]> {
  const ids = await recordNotices(exec, orgId, periods, now);
  const items = await listNotices(exec, orgId, ids);
  await tellAdmins(exec, config, orgId, items);
  return items;
}

/**
 * After the periods change: notices that no longer apply are dropped (their
 * period was unset, or now ends after the announced date). A shorter period
 * keeps the announced date, which is never earlier than NOTICE_DAYS after the notice.
 */
export async function dropStaleNotices(exec: Executor, orgId: string, periods: RetentionPeriods): Promise<number> {
  let dropped = 0;
  for (const stage of STAGES) {
    const days = periodOf(periods, stage);
    const res = await sql`
      DELETE FROM classroom_retention_notices n
      WHERE n.org_id = ${orgId} AND n.stage = ${stage}
        AND (${days}::int IS NULL
          OR EXISTS (SELECT 1 FROM homework i WHERE i.id = n.homework_id AND ${scheduled('homework', days ?? 0)} > n.delete_after)
          OR EXISTS (SELECT 1 FROM tests i WHERE i.id = n.test_id AND ${scheduled('test', days ?? 0)} > n.delete_after))`.execute(exec);
    dropped += Number(res.numAffectedRows ?? 0);
  }
  return dropped;
}

// ------------------------------------------------------------ deleting

interface Removed {
  kind: ItemKind;
  id: string;
  title: string;
  className: string;
  stage: RetentionStage;
}

/** Deletes one stage of one item. The caller has checked it is still due. */
async function removeStage(exec: Executor, orgId: string, kind: ItemKind, id: string, stage: RetentionStage, now: Date): Promise<void> {
  if (kind === 'homework' && stage === 'work') {
    // Answers and files go; the hand-in state, time, mark and comments stay until the record goes.
    await sql`DELETE FROM classroom_files f USING homework_submissions s WHERE f.submission_id = s.id AND s.homework_id = ${id}`.execute(exec);
    await exec.deleteFrom('homework_submissions').where('homework_id', '=', id).where('status', '=', 'draft').execute();
    await exec.updateTable('homework_submissions').set({ body: '' }).where('homework_id', '=', id).where('body', '<>', '').execute();
    await exec.updateTable('homework').set({ work_removed_at: now }).where('id', '=', id).execute();
  } else if (kind === 'test' && stage === 'monitoring') {
    await sql`DELETE FROM test_events e USING test_attempts a WHERE e.attempt_id = a.id AND a.test_id = ${id}`.execute(exec);
    await exec.updateTable('test_attempts').set({ events_count: 0, session_id: null }).where('test_id', '=', id).execute();
    await exec.updateTable('tests').set({ monitoring_removed_at: now }).where('id', '=', id).execute();
  } else if (kind === 'test' && stage === 'work') {
    // Each answer becomes JSON null; its marks and comments stay, and markAttempt keeps the stored automatic marks.
    await sql`UPDATE test_answers x SET answer = 'null'::jsonb FROM test_attempts a WHERE x.attempt_id = a.id AND a.test_id = ${id}`.execute(exec);
    await exec.updateTable('tests').set({ work_removed_at: now }).where('id', '=', id).execute();
  } else if (stage === 'records') {
    if (kind === 'homework') await exec.deleteFrom('homework').where('id', '=', id).execute();
    else await exec.deleteFrom('tests').where('id', '=', id).execute();
    // The students' notifications about it would only lead to a page that is gone.
    await exec
      .deleteFrom('notifications')
      .where('org_id', '=', orgId)
      .where('link', '=', kind === 'homework' ? `/student/homework/${id}` : `/student/tests/${id}`)
      .execute();
  }
}

/**
 * Deletes what is due: notices whose date has come, checked again against the
 * current periods, the item's dates and hold. A notice that no longer applies
 * is dropped; a test with an attempt still running waits for the next pass.
 */
export async function applyDue(exec: Executor, orgId: string, periods: RetentionPeriods, now = new Date()) {
  const notices = await exec
    .selectFrom('classroom_retention_notices')
    .selectAll()
    .where('org_id', '=', orgId)
    .where('delete_after', '<=', now)
    .orderBy('delete_after')
    // An item's work and monitoring before the item itself, so each stage is deleted and audited in turn.
    .orderBy(sql`stage = 'records'`)
    .limit(BATCH)
    .forUpdate()
    .skipLocked()
    .execute();
  const removed: Removed[] = [];
  let dropped = 0;
  let waiting = 0;
  for (const n of notices) {
    const kind: ItemKind = n.homework_id ? 'homework' : 'test';
    const id = (n.homework_id ?? n.test_id)!;
    const days = periodOf(periods, n.stage);
    const { rows } =
      days === null
        ? { rows: [] }
        : await sql<{ title: string; className: string; running: boolean }>`
            SELECT i.title, c.name AS "className",
              ${kind === 'test' ? sql`EXISTS (SELECT 1 FROM test_attempts a WHERE a.test_id = i.id AND a.status = 'in_progress')` : sql`false`} AS running
            FROM ${TABLE[kind]} i JOIN classes c ON c.id = i.class_id
            WHERE i.id = ${id} AND NOT i.retention_hold AND ${scheduled(kind, days)} <= ${now}::timestamptz AND ${hasDataFor(kind, n.stage)}`.execute(exec);
    const item = rows[0];
    if (!item) {
      await exec.deleteFrom('classroom_retention_notices').where('id', '=', n.id).execute();
      dropped++;
      continue;
    }
    if (item.running) {
      waiting++;
      continue;
    }
    await removeStage(exec, orgId, kind, id, n.stage, now);
    await exec.deleteFrom('classroom_retention_notices').where('id', '=', n.id).execute();
    removed.push({ kind, id, title: item.title, className: item.className, stage: n.stage });
  }
  if (removed.length) {
    const count = (stage: RetentionStage, kind: ItemKind) => removed.filter((r) => r.stage === stage && r.kind === kind).length;
    await recordAudit(
      exec,
      { type: 'system' },
      {
        orgId,
        action: 'classroom.retention_applied',
        metadata: {
          monitoring: { tests: count('monitoring', 'test') },
          work: { homework: count('work', 'homework'), tests: count('work', 'test') },
          records: { homework: count('records', 'homework'), tests: count('records', 'test') },
          items: removed.slice(0, AUDIT_ITEMS_MAX),
          ...(removed.length > AUDIT_ITEMS_MAX ? { more: removed.length - AUDIT_ITEMS_MAX } : {}),
        },
      },
    );
  }
  return { removed: removed.length, dropped, waiting };
}

// ------------------------------------------------------------ worker

export interface RetentionSummary {
  schools: number;
  removed: number;
  dropped: number;
  waiting: number;
  notices: number;
  failed: number;
  error?: string;
}

/**
 * Worker pass for every active school with retention settings. Each school is
 * handled in its own tenant transaction, so its row-level security limits every
 * deletion to that school. Notices go out only between SEND_FROM_HOUR and
 * SEND_UNTIL_HOUR, Cairo time; deletions whose date has come happen at any hour.
 */
export async function runClassroomRetention(db: Database, config: AppConfig, now = new Date()): Promise<RetentionSummary> {
  const summary: RetentionSummary = { schools: 0, removed: 0, dropped: 0, waiting: 0, notices: 0, failed: 0 };
  const { hour } = await cairoClock(db, now);
  const sendNotices = hour >= SEND_FROM_HOUR && hour < SEND_UNTIL_HOUR;
  const orgs = await withSystemContext(db, (trx) =>
    trx.selectFrom('classroom_retention as r').innerJoin('organizations as o', 'o.id', 'r.org_id').select('r.org_id').where('o.status', '=', 'active').orderBy('r.org_id').execute(),
  );
  for (const { org_id: orgId } of orgs) {
    try {
      await withOrgContext(db, { orgId }, async (trx) => {
        const periods = await getPeriods(trx, orgId);
        const applied = await applyDue(trx, orgId, periods, now);
        summary.removed += applied.removed;
        summary.dropped += applied.dropped;
        summary.waiting += applied.waiting;
        if (sendNotices) summary.notices += (await scheduleNotices(trx, config, orgId, periods, now)).length;
      });
      summary.schools++;
    } catch (err) {
      // Nothing of this school's pass was kept; the next pass tries again.
      summary.failed++;
      summary.error ??= String((err as Error).message).slice(0, 200);
    }
  }
  return summary;
}
