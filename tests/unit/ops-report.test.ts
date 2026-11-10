import { describe, expect, it } from 'vitest';
import { buildReport, LIMITS, parseHostFacts, type Activity, type HostFacts } from '../../src/ops/report.js';

// The daily operations report (src/ops/report.ts, docs/DEPLOYMENT_GUIDE.md §8.11): what the host facts
// say, each check's level, the verdict in the subject, both languages, times in the report's zone.
const NOW = new Date('2026-11-11T02:00:00Z'); // 04:00 in Cairo
const H = 3600_000;

const HEALTHY = [
  'collected_at=2026-11-11T02:00:00Z',
  'host=224',
  'site=https://midad.example.com',
  'app_version=5a802418f32a2ea01fc24775de6c5f7e24c0c5d5 2026-11-10',
  'service=app|running|healthy|0',
  'service=app2|running|healthy|0',
  'service=caddy|running||0',
  'service=postgres|running|healthy|0',
  'service=worker|running|healthy|0',
  'ready=app|yes',
  'ready=app2|yes',
  'disk=/|41%|60000000000',
  'memory=7900|5200',
  'load=0.31|4',
  'uptime_seconds=200000',
  'reboot_required=no',
  'os_updates=3|1',
  'tls_days=74',
  'backup_count=8',
  'backup_total_bytes=2700000',
  `backup_latest=midad-backup-prod-20261110T021500Z.tar.enc|${Math.floor((NOW.getTime() - 24 * H) / 1000)}|337977|ok`,
  'backup_copies=',
  'backup_keep_days=30',
  'verify_last_ok=20261109034501',
  'backup_log_errors=0',
  'app_errors=0',
  'update_latest=5a802418f32a2ea01fc24775de6c5f7e24c0c5d5 2026-11-10',
  'update_behind=0',
  'cleanup=images|0B',
  'cleanup=cache|1.2GB',
  'not a fact line',
  'unknown_key=whatever',
].join('\n');

const ACTIVITY: Activity = {
  since: new Date(NOW.getTime() - 24 * H),
  schools: { total: 3, new: [{ name: 'مدرسة الأمل', createdAt: new Date('2026-11-10T08:30:00Z') }], newCount: 1 },
  staff: { total: 9, newCount: 2 },
  students: { total: 40, newCount: 12 },
  signIns: { ok: 57, failed: 4, locked: 0 },
  homework: { created: 3, handedIn: 21 },
  tests: { created: 1, submitted: 18 },
  emails: { sent: 6, failed: 0, waiting: 0 },
  alerts: { open: [], resolved: 0 },
  workerLastBeat: new Date(NOW.getTime() - 60_000),
  adminActions: [{ action: 'admin.plan_updated', count: 1 }],
  databaseBytes: 64 * 1024 * 1024,
};

const build = (facts: HostFacts, over: Partial<Parameters<typeof buildReport>[0]> = {}) =>
  buildReport({ facts, activity: ACTIVITY, hours: 24, lang: 'ar', now: NOW, timeZone: 'Africa/Cairo', ...over });
const withFacts = (...lines: string[]) => parseHostFacts(`${HEALTHY}\n${lines.join('\n')}`);

describe('ops report: host facts', () => {
  it('reads every kind of line and ignores the rest', () => {
    const f = parseHostFacts(HEALTHY);
    expect(f.services.map((s) => s.name)).toEqual(['app', 'app2', 'caddy', 'postgres', 'worker']);
    expect(f.ready).toEqual([{ name: 'app', ok: true }, { name: 'app2', ok: true }]);
    expect(f.disks).toEqual([{ mount: '/', usedPct: 41, availBytes: 60_000_000_000 }]);
    expect(f.backup.latest).toMatchObject({ name: 'midad-backup-prod-20261110T021500Z.tar.enc', bytes: 337977, checksum: 'ok' });
    expect(f.backup.lastVerifiedAt?.toISOString()).toBe('2026-11-09T03:45:01.000Z');
    expect(f.backup.copies).toEqual([]);
    expect(f.appVersion).toEqual({ commit: '5a802418f32a2ea01fc24775de6c5f7e24c0c5d5', date: '2026-11-10' });
    expect(f.cleanup).toEqual([{ kind: 'images', amount: '0B' }, { kind: 'cache', amount: '1.2GB' }]);
    expect(f.osUpdates).toEqual({ total: 3, security: 1 });
    // A version file a package did not stamp, a log with no successful test, an unreadable certificate.
    const g = parseHostFacts('app_version=$Format:%H %cs$\nverify_last_ok=none\ntls_days=unavailable\nbackup_log_errors=2|could not copy to the server');
    expect(g.appVersion).toBeUndefined();
    expect(g.backup.lastVerifiedAt).toBeNull();
    expect(g.tlsDays).toBeNull();
    expect(g.backup).toMatchObject({ logErrors: 2, lastLogError: 'could not copy to the server' });
  });
});

describe('ops report: checks and verdict', () => {
  it('a healthy server is all good, in Arabic, with Cairo times and the new school by name', () => {
    const r = build(parseHostFacts(HEALTHY));
    expect(r.problems).toEqual([]);
    expect(r.subject).toContain('تقرير مِداد اليومي');
    expect(r.subject).toContain('midad.example.com');
    expect(r.subject).toContain('✅ كل شيء سليم');
    expect(r.text).toContain('بصمة آخر نسخة مطابقة');
    expect(r.text).toContain('مدرسة جديدة: مدرسة الأمل');
    expect(r.text).toContain('10:30'); // 08:30 UTC is 10:30 in Cairo
    expect(r.text).toContain('تسجيلات الدخول: 57 ناجحة، 4 فاشلة');
    expect(r.text).toContain('هذا أحدث إصدار على GitHub');
    expect(r.text).toContain('وُفّر 1.2GB');
    // No copy off the server is a note, not a problem: the owner chose it for now.
    expect(r.text).toContain('لا توجد نسخة خارج الخادم');
  });

  it('the same report in English', () => {
    const r = build(parseHostFacts(HEALTHY), { lang: 'en' });
    expect(r.subject).toContain('Midad daily report');
    expect(r.subject).toContain('All good');
    expect(r.text).toContain('Latest backup: midad-backup-prod-20261110T021500Z.tar.enc');
    expect(r.text).toContain('New school: مدرسة الأمل');
  });

  it('flags a missing, old or damaged backup, and an overdue restore test', () => {
    const old = withFacts(`backup_latest=x.tar.enc|${Math.floor((NOW.getTime() - (LIMITS.backupMaxAgeHours + 4) * H) / 1000)}|10|ok`);
    expect(build(old).problems.map((p) => p.level)).toContain('fail');
    expect(build(old).text).toContain('آخر نسخة أقدم من اللازم');
    const damaged = withFacts(`backup_latest=x.tar.enc|${Math.floor(NOW.getTime() / 1000) - 3600}|10|mismatch`);
    expect(build(damaged).text).toContain('❌ بصمة آخر نسخة غير مطابقة');
    const none = parseHostFacts(HEALTHY.split('\n').filter((l) => !l.startsWith('backup_latest=')).join('\n'));
    expect(build(none).problems[0]).toEqual({ level: 'fail', text: 'لا توجد أي نسخة احتياطية في مجلد النسخ' });
    const untested = withFacts('verify_last_ok=20261101034501');
    expect(build(untested).problems).toEqual([expect.objectContaining({ level: 'warn' })]);
    expect(build(withFacts('verify_last_ok=none')).text).toContain('⚠️ لا يوجد اختبار استعادة ناجح');
  });

  it('flags stopped or unhealthy services, restarts, a stale worker and open alerts', () => {
    const r = build(withFacts('service=clamav|exited||0', 'service=worker|running|unhealthy|3', 'ready=app2|no'), {
      activity: { ...ACTIVITY, workerLastBeat: new Date(NOW.getTime() - 30 * 60_000), alerts: { open: [{ key: 'disk', summary: 'Database is slow', since: new Date('2026-11-10T20:00:00Z') }], resolved: 2 } },
    });
    const texts = r.problems.map((p) => p.text);
    expect(texts).toEqual(expect.arrayContaining([
      'clamav لا تعمل (exited)', 'worker غير سليمة (فحص الصحة)', 'worker أُعيد تشغيلها تلقائيًا 3 مرة منذ إنشائها',
      'app2 غير جاهز', 'العامل الخلفي متوقف (آخر نبضة قبل 30 دقيقة)',
    ]));
    expect(texts.some((t) => t.startsWith('تنبيه مفتوح: Database is slow'))).toBe(true);
    expect(r.subject).toContain('❌ يحتاج انتباه');
  });

  it('flags a full disk, low memory, a certificate that is not renewing, a needed restart and failing email', () => {
    const r = build(withFacts('disk=/var/lib/docker|93%|1000', 'memory=8000|400', 'tls_days=5', 'reboot_required=yes'), {
      activity: { ...ACTIVITY, emails: { sent: 1, failed: 2, waiting: 3 }, signIns: { ok: 1, failed: LIMITS.failedSignInsWarn + 1, locked: 2 } },
    });
    const levels = Object.fromEntries(r.problems.map((p) => [p.text.slice(0, 18), p.level]));
    expect(Object.values(levels)).toContain('fail');
    expect(r.text).toContain('❌ القرص /var/lib/docker: مستخدم 93%');
    expect(r.text).toContain('⚠️ الذاكرة المتاحة 400');
    expect(r.text).toContain('❌ شهادة HTTPS تنتهي بعد 5 يومًا');
    expect(r.text).toContain('⚠️ الخادم يطلب إعادة تشغيل');
    expect(r.text).toContain('⚠️ رسائل بريد فشل إرسالها: 2');
    expect(r.text).toContain('⚠️ محاولات دخول فاشلة كثيرة');
    expect(build(withFacts('disk=/|82%|1000')).problems).toEqual([expect.objectContaining({ level: 'warn' })]);
  });

  it('says when a newer version is on GitHub, and when the database could not be read', () => {
    const r = build(withFacts('update_latest=1111111111111111111111111111111111111111 2026-11-20', 'update_behind=4'), { activity: null, activityError: 'database: connection refused' });
    expect(r.text).toContain('يوجد إصدار أحدث على GitHub: 4 تغيير، آخرها 2026-11-20');
    expect(r.problems).toContainEqual({ level: 'fail', text: 'database: connection refused' });
    expect(build(withFacts('update_latest=unavailable'), {}).text).toContain('تعذّر التحقق من وجود إصدار أحدث');
    // Known latest, but the running version cannot be compared with it (not on GitHub, or no stamp).
    expect(build(withFacts('app_version=$Format:%H$', 'update_latest=1111111111111111111111111111111111111111 2026-11-20'), {}).text).toContain('أحدث إصدار على GitHub: 1111111 (2026-11-20)');
  });
});
