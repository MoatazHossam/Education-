import { sql } from 'kysely';
import { withSystemContext, type Database } from '../db/index.js';

// The daily operations report (docs/DEPLOYMENT_GUIDE.md §8.11): what the server's scripts measured on the
// host (ops/midad.sh report), what changed in the application in the last hours, and a verdict, in Arabic
// or English. The host facts arrive as `key=value` lines; everything here is counts and names an operator
// needs, never a student's data or a secret.

export type Level = 'ok' | 'info' | 'warn' | 'fail';
export type Lang = 'ar' | 'en';

export interface HostFacts {
  collectedAt?: Date;
  host?: string;
  site?: string;
  appVersion?: { commit: string; date?: string };
  update?: { latest?: string; latestDate?: string; behind?: number; unavailable?: boolean };
  services: { name: string; state: string; health: string; restarts: number }[];
  ready: { name: string; ok: boolean }[];
  disks: { mount: string; usedPct: number; availBytes: number }[];
  memory?: { totalMb: number; availableMb: number };
  load?: { one: number; cpus: number };
  uptimeSeconds?: number;
  rebootRequired?: boolean;
  osUpdates?: { total: number; security: number };
  tlsDays?: number | null;
  backup: {
    count: number;
    totalBytes: number;
    latest?: { name: string; at: Date; bytes: number; checksum: 'ok' | 'mismatch' | 'missing' };
    copies: string[];
    keepDays?: number;
    lastVerifiedAt?: Date | null;
    logErrors?: number;
    lastLogError?: string;
  };
  appErrors?: number;
  cleanup: { kind: string; amount: string }[];
}

const num = (v: string | undefined) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? undefined : Number(v));
const compactUtc = (s: string) => {
  const m = /^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})Z?$/.exec(s);
  return m ? new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!)) : undefined;
};

/** Reads the `key=value` lines ops/midad.sh writes. Unknown keys and malformed lines are ignored. */
export function parseHostFacts(text: string): HostFacts {
  const f: HostFacts = { services: [], ready: [], disks: [], backup: { count: 0, totalBytes: 0, copies: [] }, cleanup: [] };
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    const parts = value.split('|');
    switch (key) {
      case 'collected_at': { const d = new Date(value); if (!Number.isNaN(d.getTime())) f.collectedAt = d; break; }
      case 'host': f.host = value; break;
      case 'site': f.site = value; break;
      case 'app_version': {
        const [commit, date] = value.split(/\s+/);
        if (commit && /^[0-9a-f]{7,40}$/.test(commit)) f.appVersion = { commit, date };
        break;
      }
      case 'update_latest':
        if (value === 'unavailable' || value === '') f.update = { unavailable: true };
        else { const [latest, latestDate] = value.split(/\s+/); f.update = { latest, latestDate }; }
        break;
      case 'update_behind': { const n = num(value); if (n !== undefined) f.update = { ...f.update, behind: n }; break; }
      case 'service':
        if (parts[0]) f.services.push({ name: parts[0], state: parts[1] || 'unknown', health: parts[2] || '', restarts: num(parts[3]) ?? 0 });
        break;
      case 'ready': if (parts[0]) f.ready.push({ name: parts[0], ok: parts[1] === 'yes' }); break;
      case 'disk': {
        const used = num(parts[1]?.replace('%', ''));
        if (parts[0] && used !== undefined) f.disks.push({ mount: parts[0], usedPct: used, availBytes: num(parts[2]) ?? 0 });
        break;
      }
      case 'memory': { const t = num(parts[0]); const a = num(parts[1]); if (t && a !== undefined) f.memory = { totalMb: t, availableMb: a }; break; }
      case 'load': { const o = num(parts[0]); if (o !== undefined) f.load = { one: o, cpus: num(parts[1]) ?? 1 }; break; }
      case 'uptime_seconds': f.uptimeSeconds = num(value); break;
      case 'reboot_required': f.rebootRequired = value === 'yes'; break;
      case 'os_updates': { const t = num(parts[0]); if (t !== undefined) f.osUpdates = { total: t, security: num(parts[1]) ?? 0 }; break; }
      case 'tls_days': f.tlsDays = value === 'unavailable' ? null : num(value) ?? null; break;
      case 'backup_count': f.backup.count = num(value) ?? 0; break;
      case 'backup_total_bytes': f.backup.totalBytes = num(value) ?? 0; break;
      case 'backup_latest': {
        const at = num(parts[1]);
        const checksum = parts[3] === 'ok' || parts[3] === 'mismatch' ? parts[3] : 'missing';
        if (parts[0] && at) f.backup.latest = { name: parts[0], at: new Date(at * 1000), bytes: num(parts[2]) ?? 0, checksum };
        break;
      }
      case 'backup_copies': f.backup.copies = value.split(',').map((s) => s.trim()).filter((s) => s && s !== 'none'); break;
      case 'backup_keep_days': f.backup.keepDays = num(value); break;
      case 'verify_last_ok': f.backup.lastVerifiedAt = value === 'none' ? null : compactUtc(value) ?? null; break;
      case 'backup_log_errors': f.backup.logErrors = num(parts[0]); if (parts.length > 1) f.backup.lastLogError = parts.slice(1).join('|').slice(0, 200); break;
      case 'app_errors': f.appErrors = num(value); break;
      case 'cleanup': if (parts[0]) f.cleanup.push({ kind: parts[0], amount: (parts[1] || '0B').slice(0, 40) }); break;
      default: break;
    }
  }
  return f;
}

export interface Activity {
  since: Date;
  schools: { total: number; new: { name: string; createdAt: Date }[]; newCount: number };
  staff: { total: number; newCount: number };
  students: { total: number; newCount: number };
  signIns: { ok: number; failed: number; locked: number };
  homework: { created: number; handedIn: number };
  tests: { created: number; submitted: number };
  emails: { sent: number; failed: number; waiting: number };
  alerts: { open: { key: string; summary: string; since: Date }[]; resolved: number };
  workerLastBeat: Date | null;
  adminActions: { action: string; count: number }[];
  databaseBytes: number;
}

const SIGN_INS = ['auth.login', 'auth.password_ok_mfa_pending', 'auth.student_login'];
const FAILED = ['auth.login_failed', 'auth.student_login_failed', 'auth.passkey_login_failed', 'auth.mfa_failed'];
const LOCKED = ['auth.account_locked', 'auth.student_locked', 'auth.login_blocked_locked', 'auth.student_login_blocked_locked', 'auth.mfa_blocked_locked'];

/** What happened since `since`, across every school: counts, the new schools' names and the platform's own actions. */
export async function collectActivity(db: Database, since: Date): Promise<Activity> {
  return withSystemContext(db, async (trx) => {
    const count = (n: unknown) => Number(n ?? 0);
    const schoolRows = await trx.selectFrom('organizations').select(['name', 'created_at']).where('created_at', '>=', since).orderBy('created_at').limit(10).execute();
    const totals = await sql<{ schools: string; new_schools: string; staff: string; new_staff: string; students: string; new_students: string }>`
      SELECT (SELECT count(*) FROM organizations) AS schools,
             (SELECT count(*) FROM organizations WHERE created_at >= ${since}) AS new_schools,
             (SELECT count(*) FROM users WHERE kind = 'staff') AS staff,
             (SELECT count(*) FROM users WHERE kind = 'staff' AND created_at >= ${since}) AS new_staff,
             (SELECT count(*) FROM students) AS students,
             (SELECT count(*) FROM students WHERE created_at >= ${since}) AS new_students`.execute(trx);
    const t = totals.rows[0]!;
    const audit = await trx.selectFrom('audit_logs').select(['action', (eb) => eb.fn.countAll<string>().as('n')])
      .where('created_at', '>=', since).where('action', 'in', [...SIGN_INS, ...FAILED, ...LOCKED]).groupBy('action').execute();
    const sumOf = (names: string[]) => audit.filter((a) => names.includes(a.action)).reduce((s, a) => s + count(a.n), 0);
    const work = await sql<{ hw: string; handed: string; tests: string; submitted: string }>`
      SELECT (SELECT count(*) FROM homework WHERE created_at >= ${since}) AS hw,
             (SELECT count(*) FROM homework_submissions WHERE submitted_at >= ${since}) AS handed,
             (SELECT count(*) FROM tests WHERE created_at >= ${since}) AS tests,
             (SELECT count(*) FROM test_attempts WHERE submitted_at >= ${since}) AS submitted`.execute(trx);
    const w = work.rows[0]!;
    const mail = await sql<{ sent: string; failed: string; waiting: string }>`
      SELECT (SELECT count(*) FROM email_outbox WHERE status = 'sent' AND sent_at >= ${since}) AS sent,
             (SELECT count(*) FROM email_outbox WHERE status = 'failed' AND created_at >= ${since}) AS failed,
             (SELECT count(*) FROM email_outbox WHERE status = 'pending' AND send_after < now() - interval '1 hour') AS waiting`.execute(trx);
    const m = mail.rows[0]!;
    const open = await trx.selectFrom('ops_alerts').select(['key', 'summary', 'first_seen_at']).where('status', '=', 'firing').orderBy('first_seen_at').execute();
    const resolved = await trx.selectFrom('ops_alerts').select((eb) => eb.fn.countAll<string>().as('n')).where('status', '=', 'resolved').where('resolved_at', '>=', since).executeTakeFirst();
    const beat = await trx.selectFrom('worker_heartbeats').select((eb) => eb.fn.max('last_beat_at').as('at')).executeTakeFirst();
    const admin = await trx.selectFrom('audit_logs').select(['action', (eb) => eb.fn.countAll<string>().as('n')])
      .where('created_at', '>=', since).where('action', 'like', 'admin.%').groupBy('action').orderBy('action').limit(15).execute();
    const size = await sql<{ bytes: string }>`SELECT pg_database_size(current_database()) AS bytes`.execute(trx);
    return {
      since,
      schools: { total: count(t.schools), new: schoolRows.map((r) => ({ name: r.name, createdAt: r.created_at })), newCount: count(t.new_schools) },
      staff: { total: count(t.staff), newCount: count(t.new_staff) },
      students: { total: count(t.students), newCount: count(t.new_students) },
      signIns: { ok: sumOf(SIGN_INS), failed: sumOf(FAILED), locked: sumOf(LOCKED) },
      homework: { created: count(w.hw), handedIn: count(w.handed) },
      tests: { created: count(w.tests), submitted: count(w.submitted) },
      emails: { sent: count(m.sent), failed: count(m.failed), waiting: count(m.waiting) },
      alerts: { open: open.map((a) => ({ key: a.key, summary: a.summary, since: a.first_seen_at })), resolved: count(resolved?.n) },
      workerLastBeat: beat?.at ? new Date(beat.at as unknown as string) : null,
      adminActions: admin.map((a) => ({ action: a.action, count: count(a.n) })),
      databaseBytes: count(size.rows[0]?.bytes),
    };
  });
}

// ---------------------------------------------------------------- the report

export const LIMITS = {
  backupMaxAgeHours: 26,
  verifyMaxAgeDays: 8,
  diskWarnPct: 80,
  diskFailPct: 90,
  memoryWarnPct: 10,
  tlsWarnDays: 21,
  tlsFailDays: 7,
  appErrorsWarn: 50,
  failedSignInsWarn: 50,
  workerMaxAgeMinutes: 10,
} as const;

const T = {
  ar: {
    title: 'تقرير مِداد اليومي',
    allGood: 'كل شيء سليم',
    attention: (n: number) => `يحتاج انتباه (${n})`,
    window: (h: number) => `آخر ${h} ساعة`,
    at: 'وقت التقرير',
    server: 'الخادم',
    summary: 'الخلاصة',
    sServices: 'الخدمات',
    sBackups: 'النسخ الاحتياطية',
    sServer: 'الخادم',
    sNew: 'الجديد',
    sMaint: 'الصيانة التي تمت',
    sVersion: 'الإصدار',
    running: 'تعمل',
    notRunning: (s: string, st: string) => `${s} لا تعمل (${st})`,
    unhealthy: (s: string) => `${s} غير سليمة (فحص الصحة)`,
    restarted: (s: string, n: number) => `${s} أُعيد تشغيلها تلقائيًا ${n} مرة منذ إنشائها`,
    ready: (s: string) => `${s} جاهز`,
    notReady: (s: string) => `${s} غير جاهز`,
    noServices: 'لم تُقرأ حالة الخدمات',
    workerOk: (m: number) => `العامل الخلفي نشط (آخر نبضة قبل ${m} دقيقة)`,
    workerStale: (m: number) => `العامل الخلفي متوقف (آخر نبضة قبل ${m} دقيقة)`,
    workerNone: 'لا نبضة للعامل الخلفي',
    backupLatest: (name: string, when: string, age: string, size: string) => `آخر نسخة: ${name} — ${when} (منذ ${age})، الحجم ${size}`,
    backupOld: (age: string) => `آخر نسخة أقدم من اللازم (منذ ${age}): المهمة الليلية لم تعمل؟`,
    backupNone: 'لا توجد أي نسخة احتياطية في مجلد النسخ',
    checksumOk: 'بصمة آخر نسخة مطابقة (الملف سليم)',
    checksumBad: 'بصمة آخر نسخة غير مطابقة: الملف تالف',
    checksumMissing: 'لا يوجد ملف بصمة لآخر نسخة',
    backupCount: (n: number, size: string, days?: number) => `عدد النسخ المحفوظة: ${n} (المجموع ${size})${days ? `، وتُحذف الأقدم من ${days} يومًا` : ''}`,
    verifyOk: (when: string, age: string) => `آخر اختبار استعادة ناجح: ${when} (منذ ${age})`,
    verifyOld: (age: string) => `آخر اختبار استعادة ناجح منذ ${age}: الاختبار الأسبوعي لم يعمل؟`,
    verifyNone: 'لا يوجد اختبار استعادة ناجح في سجل النسخ',
    copiesNone: 'لا توجد نسخة خارج الخادم: لو تعطل الخادم تضيع النسخ معه',
    copies: (c: string) => `نسخ خارج الخادم: ${c}`,
    logErrors: (n: number, last?: string) => `أخطاء في سجل النسخ: ${n}${last ? ` (آخرها: ${last})` : ''}`,
    disk: (m: string, p: number, free: string) => `القرص ${m}: مستخدم ${p}%، والمتاح ${free}`,
    memory: (avail: number, total: number) => `الذاكرة المتاحة ${avail} م.ب من ${total} م.ب`,
    load: (l: number, c: number) => `الحمل: ${l} على ${c} معالج`,
    uptime: (d: string) => `يعمل منذ ${d}`,
    reboot: 'الخادم يطلب إعادة تشغيل بعد تحديثات النظام: أعد تشغيله في وقت هادئ',
    osUpdates: (t: number, s: number) => `تحديثات النظام المتاحة: ${t} (منها ${s} أمنية)`,
    osNone: 'نظام التشغيل محدَّث',
    tls: (d: number) => `شهادة HTTPS صالحة ${d} يومًا (تجدد تلقائيًا)`,
    tlsLow: (d: number) => `شهادة HTTPS تنتهي بعد ${d} يومًا ولم تتجدد بعد`,
    tlsNone: 'لم تُقرأ شهادة HTTPS',
    appErrors: (n: number) => `أخطاء في سجلات التطبيق: ${n}`,
    dbSize: (s: string) => `حجم قاعدة البيانات: ${s}`,
    alertOpen: (s: string, when: string) => `تنبيه مفتوح: ${s} (منذ ${when})`,
    alertsResolved: (n: number) => `تنبيهات انتهت: ${n}`,
    noAlerts: 'لا توجد تنبيهات مفتوحة',
    schools: (t: number, n: number) => `المدارس: ${t} (جديدة: ${n})`,
    newSchool: (name: string, when: string) => `مدرسة جديدة: ${name} — ${when}`,
    staff: (t: number, n: number) => `حسابات المعلمين والإداريين: ${t} (جديدة: ${n})`,
    students: (t: number, n: number) => `حسابات الطلاب: ${t} (جديدة: ${n})`,
    signIns: (o: number, f: number, l: number) => `تسجيلات الدخول: ${o} ناجحة، ${f} فاشلة، ${l} قفل حساب`,
    manyFailed: (f: number) => `محاولات دخول فاشلة كثيرة (${f}): قد تكون محاولة اختراق`,
    homework: (c: number, h: number) => `واجبات جديدة: ${c}، وأعمال سلّمها الطلاب: ${h}`,
    tests: (c: number, s: number) => `اختبارات جديدة: ${c}، ومحاولات سُلِّمت: ${s}`,
    emails: (s: number) => `رسائل بريد أُرسلت: ${s}`,
    emailsFailed: (f: number) => `رسائل بريد فشل إرسالها: ${f}`,
    emailsWaiting: (w: number) => `رسائل تنتظر الإرسال أكثر من ساعة: ${w}`,
    adminActions: (list: string) => `إجراءات مدير المنصة: ${list}`,
    version: (c: string, d?: string) => `الإصدار العامل: ${c}${d ? ` (${d})` : ''}`,
    versionUnknown: 'الإصدار العامل غير معروف (حزمة أقدم من هذا التقرير)',
    updateAvail: (n: number, d?: string) => `يوجد إصدار أحدث على GitHub: ${n} تغيير${d ? `، آخرها ${d}` : ''}`,
    updateLatest: 'هذا أحدث إصدار على GitHub',
    updateLatestIs: (c: string, d?: string) => `أحدث إصدار على GitHub: ${c}${d ? ` (${d})` : ''}`,
    updateUnknown: 'تعذّر التحقق من وجود إصدار أحدث',
    noCleanup: 'لا شيء يحتاج تنظيفًا',
    cleanup: (kind: string, amount: string) => (kind === 'images' ? `حُذفت صور Docker لا يستخدمها شيء: وُفّر ${amount}` : kind === 'cache' ? `حُذفت ملفات بناء أقدم من أسبوع: وُفّر ${amount}` : `${kind}: ${amount}`),
    footer: 'أُرسل من الخادم بالأمر ops/report.sh. لإيقافه احذف سطره من /etc/cron.d/midad.',
  },
  en: {
    title: 'Midad daily report',
    allGood: 'All good',
    attention: (n: number) => `Needs attention (${n})`,
    window: (h: number) => `last ${h} hours`,
    at: 'Report time',
    server: 'Server',
    summary: 'Summary',
    sServices: 'Services',
    sBackups: 'Backups',
    sServer: 'Server',
    sNew: 'What is new',
    sMaint: 'Maintenance done',
    sVersion: 'Version',
    running: 'running',
    notRunning: (s: string, st: string) => `${s} is not running (${st})`,
    unhealthy: (s: string) => `${s} is unhealthy (health check)`,
    restarted: (s: string, n: number) => `${s} was restarted automatically ${n} times since it was created`,
    ready: (s: string) => `${s} ready`,
    notReady: (s: string) => `${s} not ready`,
    noServices: 'The services\' state could not be read',
    workerOk: (m: number) => `Background worker alive (last beat ${m} min ago)`,
    workerStale: (m: number) => `Background worker stopped (last beat ${m} min ago)`,
    workerNone: 'No background worker heartbeat',
    backupLatest: (name: string, when: string, age: string, size: string) => `Latest backup: ${name}, ${when} (${age} ago), ${size}`,
    backupOld: (age: string) => `The latest backup is too old (${age} ago): did the nightly job run?`,
    backupNone: 'No backup in the backup folder',
    checksumOk: 'The latest backup matches its checksum (the file is intact)',
    checksumBad: 'The latest backup does not match its checksum: the file is damaged',
    checksumMissing: 'The latest backup has no checksum file',
    backupCount: (n: number, size: string, days?: number) => `Backups kept: ${n} (${size} in all)${days ? `, older than ${days} days removed` : ''}`,
    verifyOk: (when: string, age: string) => `Last successful restore test: ${when} (${age} ago)`,
    verifyOld: (age: string) => `Last successful restore test ${age} ago: did the weekly test run?`,
    verifyNone: 'No successful restore test in the backup log',
    copiesNone: 'No copy off the server: if the server is lost, its backups are lost with it',
    copies: (c: string) => `Copies off the server: ${c}`,
    logErrors: (n: number, last?: string) => `Errors in the backup log: ${n}${last ? ` (last: ${last})` : ''}`,
    disk: (m: string, p: number, free: string) => `Disk ${m}: ${p}% used, ${free} free`,
    memory: (avail: number, total: number) => `Memory available: ${avail} MB of ${total} MB`,
    load: (l: number, c: number) => `Load: ${l} on ${c} CPUs`,
    uptime: (d: string) => `Up for ${d}`,
    reboot: 'The server asks for a restart after system updates: restart it at a quiet time',
    osUpdates: (t: number, s: number) => `System updates available: ${t} (${s} security)`,
    osNone: 'The operating system is up to date',
    tls: (d: number) => `HTTPS certificate valid for ${d} days (renewed automatically)`,
    tlsLow: (d: number) => `The HTTPS certificate ends in ${d} days and has not been renewed`,
    tlsNone: 'The HTTPS certificate could not be read',
    appErrors: (n: number) => `Errors in the app logs: ${n}`,
    dbSize: (s: string) => `Database size: ${s}`,
    alertOpen: (s: string, when: string) => `Open alert: ${s} (since ${when})`,
    alertsResolved: (n: number) => `Alerts resolved: ${n}`,
    noAlerts: 'No open alerts',
    schools: (t: number, n: number) => `Schools: ${t} (new: ${n})`,
    newSchool: (name: string, when: string) => `New school: ${name}, ${when}`,
    staff: (t: number, n: number) => `Staff accounts: ${t} (new: ${n})`,
    students: (t: number, n: number) => `Student accounts: ${t} (new: ${n})`,
    signIns: (o: number, f: number, l: number) => `Sign-ins: ${o} successful, ${f} failed, ${l} account locks`,
    manyFailed: (f: number) => `Many failed sign-ins (${f}): possibly an attack`,
    homework: (c: number, h: number) => `New homework: ${c}; work handed in: ${h}`,
    tests: (c: number, s: number) => `New tests: ${c}; attempts submitted: ${s}`,
    emails: (s: number) => `Emails sent: ${s}`,
    emailsFailed: (f: number) => `Emails that failed: ${f}`,
    emailsWaiting: (w: number) => `Emails waiting more than an hour: ${w}`,
    adminActions: (list: string) => `Platform admin actions: ${list}`,
    version: (c: string, d?: string) => `Running version: ${c}${d ? ` (${d})` : ''}`,
    versionUnknown: 'Running version unknown (a package older than this report)',
    updateAvail: (n: number, d?: string) => `A newer version is on GitHub: ${n} changes${d ? `, the latest ${d}` : ''}`,
    updateLatest: 'This is the latest version on GitHub',
    updateLatestIs: (c: string, d?: string) => `Latest version on GitHub: ${c}${d ? ` (${d})` : ''}`,
    updateUnknown: 'Could not check for a newer version',
    noCleanup: 'Nothing to clean up',
    cleanup: (kind: string, amount: string) => (kind === 'images' ? `Docker images nothing uses removed: ${amount} freed` : kind === 'cache' ? `Build cache older than a week removed: ${amount} freed` : `${kind}: ${amount}`),
    footer: 'Sent from the server by ops/report.sh. To stop it, remove its line from /etc/cron.d/midad.',
  },
} as const;

export interface ReportInput { facts: HostFacts; activity: Activity | null; activityError?: string; hours: number; lang: Lang; now: Date; timeZone: string }
export interface ReportLine { level: Level; text: string }
export interface Report { subject: string; text: string; problems: ReportLine[]; sections: { title: string; lines: ReportLine[] }[] }

const MARK: Record<Level, string> = { ok: '✅', info: '•', warn: '⚠️', fail: '❌' };

function bytes(n: number, lang: Lang): string {
  const units = lang === 'ar' ? ['بايت', 'ك.ب', 'م.ب', 'ج.ب', 'ت.ب'] : ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}
function duration(ms: number, lang: Lang): string {
  const m = Math.max(0, Math.round(ms / 60000));
  const ar = lang === 'ar';
  if (m < 60) return ar ? `${m} دقيقة` : `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return ar ? `${h} ساعة` : `${h} h`;
  const d = Math.floor(h / 24);
  return ar ? `${d} يومًا` : `${d} days`;
}

export function buildReport(input: ReportInput): Report {
  const { facts: f, activity: a, lang, now, hours, timeZone } = input;
  const t = T[lang];
  const when = (d: Date) => new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(d);
  const sections: { title: string; lines: ReportLine[] }[] = [];
  const add = (title: string, lines: ReportLine[]) => { if (lines.length) sections.push({ title, lines }); };
  const L = (level: Level, text: string): ReportLine => ({ level, text });

  // Services
  const svc: ReportLine[] = [];
  if (!f.services.length) svc.push(L('fail', t.noServices));
  for (const s of f.services) {
    if (s.state !== 'running') svc.push(L('fail', t.notRunning(s.name, s.state)));
    else if (s.health === 'unhealthy') svc.push(L('fail', t.unhealthy(s.name)));
    else svc.push(L('ok', `${s.name}: ${t.running}${s.health && s.health !== 'running' ? ` (${s.health})` : ''}`));
    if (s.restarts > 0) svc.push(L('warn', t.restarted(s.name, s.restarts)));
  }
  for (const r of f.ready) svc.push(L(r.ok ? 'ok' : 'fail', r.ok ? t.ready(r.name) : t.notReady(r.name)));
  if (a) {
    if (!a.workerLastBeat) svc.push(L('warn', t.workerNone));
    else {
      const age = (now.getTime() - a.workerLastBeat.getTime()) / 60000;
      svc.push(L(age > LIMITS.workerMaxAgeMinutes ? 'fail' : 'ok', (age > LIMITS.workerMaxAgeMinutes ? t.workerStale : t.workerOk)(Math.round(age))));
    }
    for (const al of a.alerts.open) svc.push(L('warn', t.alertOpen(al.summary, when(al.since))));
    if (!a.alerts.open.length) svc.push(L('ok', t.noAlerts));
    if (a.alerts.resolved) svc.push(L('info', t.alertsResolved(a.alerts.resolved)));
  }
  if (f.appErrors !== undefined) svc.push(L(f.appErrors > LIMITS.appErrorsWarn ? 'warn' : f.appErrors ? 'info' : 'ok', t.appErrors(f.appErrors)));
  add(t.sServices, svc);

  // Backups
  const b = f.backup;
  const bl: ReportLine[] = [];
  if (!b.latest) bl.push(L('fail', t.backupNone));
  else {
    const ageMs = now.getTime() - b.latest.at.getTime();
    bl.push(L(ageMs > LIMITS.backupMaxAgeHours * 3600_000 ? 'fail' : 'ok', t.backupLatest(b.latest.name, when(b.latest.at), duration(ageMs, lang), bytes(b.latest.bytes, lang))));
    if (ageMs > LIMITS.backupMaxAgeHours * 3600_000) bl.push(L('fail', t.backupOld(duration(ageMs, lang))));
    bl.push(b.latest.checksum === 'ok' ? L('ok', t.checksumOk) : b.latest.checksum === 'mismatch' ? L('fail', t.checksumBad) : L('warn', t.checksumMissing));
    bl.push(L('info', t.backupCount(b.count, bytes(b.totalBytes, lang), b.keepDays)));
  }
  if (b.lastVerifiedAt) {
    const ageMs = now.getTime() - b.lastVerifiedAt.getTime();
    const old = ageMs > LIMITS.verifyMaxAgeDays * 86400_000;
    bl.push(L(old ? 'warn' : 'ok', old ? t.verifyOld(duration(ageMs, lang)) : t.verifyOk(when(b.lastVerifiedAt), duration(ageMs, lang))));
  } else if (b.lastVerifiedAt === null) bl.push(L('warn', t.verifyNone));
  bl.push(b.copies.length ? L('ok', t.copies(b.copies.join(', '))) : L('info', t.copiesNone));
  if (b.logErrors) bl.push(L('warn', t.logErrors(b.logErrors, b.lastLogError)));
  add(t.sBackups, bl);

  // Server
  const sv: ReportLine[] = [];
  for (const d of f.disks) sv.push(L(d.usedPct >= LIMITS.diskFailPct ? 'fail' : d.usedPct >= LIMITS.diskWarnPct ? 'warn' : 'ok', t.disk(d.mount, d.usedPct, bytes(d.availBytes, lang))));
  if (f.memory) sv.push(L(f.memory.availableMb * 100 < f.memory.totalMb * LIMITS.memoryWarnPct ? 'warn' : 'ok', t.memory(f.memory.availableMb, f.memory.totalMb)));
  if (f.load) sv.push(L(f.load.one > f.load.cpus * 2 ? 'warn' : 'info', t.load(f.load.one, f.load.cpus)));
  if (f.uptimeSeconds !== undefined) sv.push(L('info', t.uptime(duration(f.uptimeSeconds * 1000, lang))));
  if (f.rebootRequired) sv.push(L('warn', t.reboot));
  if (f.osUpdates) sv.push(f.osUpdates.total ? L('info', t.osUpdates(f.osUpdates.total, f.osUpdates.security)) : L('ok', t.osNone));
  if (f.tlsDays === null) sv.push(L('warn', t.tlsNone));
  else if (f.tlsDays !== undefined) sv.push(L(f.tlsDays < LIMITS.tlsFailDays ? 'fail' : f.tlsDays < LIMITS.tlsWarnDays ? 'warn' : 'ok', f.tlsDays < LIMITS.tlsWarnDays ? t.tlsLow(f.tlsDays) : t.tls(f.tlsDays)));
  if (a) sv.push(L('info', t.dbSize(bytes(a.databaseBytes, lang))));
  add(t.sServer, sv);

  // What is new
  const nw: ReportLine[] = [];
  if (a) {
    nw.push(L('info', t.schools(a.schools.total, a.schools.newCount)));
    for (const s of a.schools.new) nw.push(L('info', t.newSchool(s.name, when(s.createdAt))));
    nw.push(L('info', t.staff(a.staff.total, a.staff.newCount)));
    nw.push(L('info', t.students(a.students.total, a.students.newCount)));
    nw.push(L('info', t.signIns(a.signIns.ok, a.signIns.failed, a.signIns.locked)));
    if (a.signIns.failed > LIMITS.failedSignInsWarn) nw.push(L('warn', t.manyFailed(a.signIns.failed)));
    nw.push(L('info', t.homework(a.homework.created, a.homework.handedIn)));
    nw.push(L('info', t.tests(a.tests.created, a.tests.submitted)));
    nw.push(L('info', t.emails(a.emails.sent)));
    if (a.emails.failed) nw.push(L('warn', t.emailsFailed(a.emails.failed)));
    if (a.emails.waiting) nw.push(L('warn', t.emailsWaiting(a.emails.waiting)));
    if (a.adminActions.length) nw.push(L('info', t.adminActions(a.adminActions.map((x) => `${x.action} ×${x.count}`).join(lang === 'ar' ? '، ' : ', '))));
  } else if (input.activityError) nw.push(L('fail', input.activityError));
  add(`${t.sNew} (${t.window(hours)})`, nw);

  // Version
  const vr: ReportLine[] = [];
  vr.push(f.appVersion ? L('info', t.version(f.appVersion.commit.slice(0, 7), f.appVersion.date)) : L('info', t.versionUnknown));
  if (f.update?.behind) vr.push(L('info', t.updateAvail(f.update.behind, f.update.latestDate)));
  else if (f.update?.latest && f.appVersion && f.update.latest.startsWith(f.appVersion.commit.slice(0, 7))) vr.push(L('ok', t.updateLatest));
  else if (f.update?.latest) vr.push(L('info', t.updateLatestIs(f.update.latest.slice(0, 7), f.update.latestDate)));
  else if (f.update) vr.push(L('info', t.updateUnknown));
  add(t.sVersion, vr);

  // Maintenance
  add(t.sMaint, f.cleanup.length ? f.cleanup.map((c) => L('info', t.cleanup(c.kind, c.amount))) : [L('info', t.noCleanup)]);

  const problems = sections.flatMap((s) => s.lines).filter((l) => l.level === 'warn' || l.level === 'fail');
  const verdict = problems.length ? `${problems.some((p) => p.level === 'fail') ? MARK.fail : MARK.warn} ${t.attention(problems.length)}` : `${MARK.ok} ${t.allGood}`;
  const site = f.site ? new URL(f.site).host : f.host ?? '';
  const day = new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { timeZone, dateStyle: 'medium' }).format(now);
  const subject = `${t.title} — ${site} — ${day} — ${verdict}`;
  const out: string[] = [
    `${t.title} — ${site}`,
    `${t.at}: ${when(now)} (${timeZone})${f.host ? ` · ${t.server}: ${f.host}` : ''}`,
    '',
    `${t.summary}: ${verdict}`,
    ...problems.map((p) => `  ${MARK[p.level]} ${p.text}`),
  ];
  for (const s of sections) {
    out.push('', `── ${s.title} ──`, ...s.lines.map((l) => `${MARK[l.level]} ${l.text}`));
  }
  out.push('', t.footer);
  return { subject, text: out.join('\n'), problems, sections };
}
