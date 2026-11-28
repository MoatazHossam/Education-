import { Fragment, useEffect, useState } from 'react';
import { api } from '../api';
import { fmtDate } from '../labels';
import type { AuditEntry } from '../types';

export const ACTIONS: Record<string, string> = {
  'meeting.uploaded': 'رفع التسجيل', 'meeting.updated': 'تعديل بيانات الاجتماع', 'meeting.deleted': 'حذف الاجتماع',
  'transcript.segment_edited': 'تصحيح مقطع من النص', 'speaker.named': 'تسمية متحدث', 'speaker.merged': 'دمج متحدثين',
  'item.accepted': 'قبول بند', 'item.rejected': 'رفض بند', 'item.reset': 'إلغاء قرار على بند', 'issue.resolved': 'حسم ملاحظة',
  'minutes.edited': 'تعديل صياغة المحضر', 'minutes.generated': 'إنشاء المحضر (آلياً)', 'minutes.review_completed': 'إكمال المراجعة',
  'minutes.approved': 'اعتماد المحضر', 'minutes.approval_withdrawn': 'سحب الاعتماد', 'document.downloaded': 'تنزيل مستند',
  'pipeline.regenerate': 'طلب إعادة الصياغة', 'pipeline.reverify': 'طلب إعادة التحقق', 'pipeline.reanalyse': 'طلب إعادة التحليل',
  'pipeline.failed': 'فشل المعالجة', 'pipeline.awaiting_authorization': 'توقف بانتظار الإذن', 'retention.purged': 'حذف بانتهاء مدة الاحتفاظ',
};

export default function AuditTab({ meetingId }: { meetingId: string }) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => { api.get<AuditEntry[]>(`/api/meetings/${meetingId}/audit`).then(setEntries).catch((e) => setError(e.message)); }, [meetingId]);
  if (error) return <div className="alert bad">{error}</div>;
  if (!entries) return <div className="empty">جارٍ التحميل…</div>;
  return (
    <div className="card" style={{ padding: 0 }}>
      <table className="data">
        <thead><tr><th>الوقت</th><th>المنفّذ</th><th>الإجراء</th><th>الهدف</th><th /></tr></thead>
        <tbody>
          {entries.map((e) => (
            <Fragment key={e.id}>
              <tr>
                <td className="small">{fmtDate(e.at)}</td>
                <td>{e.actor_kind === 'user' ? e.actor_name : e.actor_kind === 'agent' ? 'النظام (وكيل آلي)' : 'النظام'}</td>
                <td>{ACTIONS[e.action] ?? e.action}</td>
                <td className="small ltr">{e.target_id ?? ''}</td>
                <td>{e.details && <button className="btn small" onClick={() => setOpen(open === e.id ? null : e.id)}>التفاصيل</button>}</td>
              </tr>
              {open === e.id && <tr><td colSpan={5}><pre className="small" dir="auto" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{JSON.stringify(e.details, null, 2)}</pre></td></tr>}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
