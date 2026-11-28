import { useEffect, useState } from 'react';
import { api } from '../api';
import { useSession } from '../App';
import { SEVERITY, STAGES, fmtDate, fmtTime } from '../labels';
import type { MeetingDetail } from '../types';

interface ProcessingRecord { at: string; stage: string; provider: string; model: string | null; data_kind: string; external: boolean; detail: Record<string, unknown> }

export default function Overview({ meeting, reload }: { meeting: MeetingDetail; reload: () => void }) {
  const { can } = useSession();
  const [records, setRecords] = useState<ProcessingRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.get<ProcessingRecord[]>(`/api/meetings/${meeting.id}/processing`).then(setRecords).catch(() => {}); }, [meeting.id, meeting.status]);
  const job = meeting.job;
  const current = job?.stage ?? meeting.stage;
  const idx = STAGES.findIndex(([k]) => k === current);
  const q = meeting.audio_quality;
  const failure = job?.stages.filter((s) => s.stage === 'error' || s.status === 'awaiting_authorization').at(-1);

  const resume = async () => {
    try { await api.post(`/api/meetings/${meeting.id}/resume`); reload(); } catch (e) { setError((e as Error).message); }
  };

  return (
    <div className="grid2">
      <div className="card">
        <h2>مراحل المعالجة</h2>
        {meeting.status === 'processing' && (
          <div className="progress" style={{ marginBottom: '0.8rem' }} aria-label="نسبة الإنجاز"><span style={{ width: `${Math.round(meeting.progress * 100)}%` }} /></div>
        )}
        <ol className="stages">
          {STAGES.map(([key, label], i) => {
            const state = meeting.status === 'review' || (idx >= 0 && i < idx) ? 'done' : i === idx && meeting.status === 'processing' ? 'current' : 'todo';
            return <li key={key} className={state}><span className="dot" />{label}</li>;
          })}
        </ol>
        {failure && (
          <div className={`alert ${meeting.status === 'awaiting_authorization' ? 'warn' : 'bad'}`} style={{ marginTop: '1rem' }}>
            {failure.message_ar}
            {(meeting.status === 'awaiting_authorization' || meeting.status === 'failed') && can('editor') && (
              <div style={{ marginTop: '0.5rem' }}><button className="btn small" onClick={resume}>استئناف المعالجة</button></div>
            )}
          </div>
        )}
        {error && <div className="alert bad">{error}</div>}
      </div>
      <div className="card">
        <h2>جودة التسجيل</h2>
        {!q ? <p className="muted">لم يُفحص التسجيل بعد.</p> : (
          <>
            <div className="grid3">
              <div className="kpi"><span className="muted small">التقييم العام</span><b>{{ good: 'جيدة', fair: 'مقبولة', poor: 'ضعيفة' }[q.overall]}</b></div>
              <div className="kpi"><span className="muted small">نسبة الكلام</span><b>{Math.round(q.speech_ratio * 100)}٪</b></div>
              <div className="kpi"><span className="muted small">الإشارة إلى الضوضاء</span><b>{q.estimated_snr_db != null ? <span className="ltr">{q.estimated_snr_db} dB</span> : '—'}</b></div>
            </div>
            <p className="small muted">
              الصيغة: <span className="ltr">{q.original_format} / {q.original_codec ?? '?'}</span>، معدل العينات {q.original_sample_rate ?? '?'} هرتز،
              الأجزاء: {q.chunks.length}، التداخل بين المتحدثين: {q.overlap_regions.length} موضع.
            </p>
            {q.issues.length > 0 && (
              <ul className="checks">{q.issues.map((i, n) => (
                <li key={n} className={i.severity}>[{SEVERITY[i.severity]}] {i.message_ar}{i.start != null && ` (${fmtTime(i.start)})`}</li>
              ))}</ul>
            )}
          </>
        )}
      </div>
      <div className="card">
        <h2>بوابات الجودة</h2>
        {!meeting.documents ? <p className="muted">تُحسب بعد إنشاء المحضر.</p> : (
          <table className="data">
            <tbody>
              {meeting.documents.quality.gates.map((g) => (
                <tr key={g.gate}>
                  <td>{g.label_ar}</td>
                  <td className="ltr">{String(g.value)}</td>
                  <td>{g.passed ? <span className="badge ok">مستوفاة</span> : <span className="badge bad">غير مستوفاة</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted small">لا يعرض النظام نسبة «دقة» إجمالية: كل بوابة قياس فعلي بحد قابل للضبط في الإعدادات.</p>
      </div>
      <div className="card">
        <h2>سجل المعالجة (من عالج أي بيانات)</h2>
        {records.length === 0 ? <p className="muted">لا توجد سجلات بعد.</p> : (
          <table className="data small">
            <thead><tr><th>المرحلة</th><th>المزوّد</th><th>البيانات</th><th>خارجي؟</th><th>الوقت</th></tr></thead>
            <tbody>
              {records.map((r, i) => (
                <tr key={i}>
                  <td>{STAGES.find(([k]) => k === r.stage)?.[1] ?? r.stage}</td>
                  <td className="ltr">{r.provider}{r.model ? ` / ${r.model}` : ''}</td>
                  <td>{r.data_kind === 'audio' ? 'الصوت' : 'النص'}</td>
                  <td>{r.external ? <span className="badge warn">خارجي</span> : <span className="badge ok">محلي</span>}</td>
                  <td>{fmtDate(r.at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
