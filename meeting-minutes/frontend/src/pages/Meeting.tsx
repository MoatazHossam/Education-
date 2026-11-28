import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { CLASSIFICATION, fmtDuration } from '../labels';
import type { ItemsData, MeetingDetail, TranscriptData } from '../types';
import { MinutesBadge, StatusBadge } from '../components/Badges';
import Overview from '../components/Overview';
import TranscriptTab from '../components/TranscriptTab';
import SpeakersTab from '../components/SpeakersTab';
import ItemsTab from '../components/ItemsTab';
import MinutesTab from '../components/MinutesTab';
import AuditTab from '../components/AuditTab';

const TABS = [
  ['overview', 'المعالجة والجودة'],
  ['transcript', 'النص'],
  ['speakers', 'المتحدثون'],
  ['items', 'البنود والقرارات'],
  ['minutes', 'المحضر والتصدير'],
  ['audit', 'السجل'],
] as const;
type Tab = (typeof TABS)[number][0];

export default function Meeting() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'overview';
  const [meeting, setMeeting] = useState<MeetingDetail | null>(null);
  const [transcript, setTranscript] = useState<TranscriptData | null>(null);
  const [items, setItems] = useState<ItemsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const m = await api.get<MeetingDetail>(`/api/meetings/${id}`);
      setMeeting(m);
      const hasTranscript = m.versions.some((v) => v.kind === 'transcript');
      const hasItems = m.versions.some((v) => v.kind === 'verification');
      if (hasTranscript) setTranscript(await api.get<TranscriptData>(`/api/meetings/${id}/transcript`));
      if (hasItems) setItems(await api.get<ItemsData>(`/api/meetings/${id}/items`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!meeting || (meeting.status !== 'processing' && meeting.status !== 'uploaded')) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [meeting, load]);

  const goSegment = (segmentId: string) => setParams({ tab: 'transcript', seg: segmentId });

  if (error) return <div className="alert bad">{error}</div>;
  if (!meeting) return <div className="empty">جارٍ التحميل…</div>;
  const openCritical = meeting.critical_open;

  return (
    <>
      <p className="small"><Link to="/">→ الاجتماعات</Link></p>
      <div className="row">
        <div>
          <h1>{meeting.title}</h1>
          <div className="row small muted">
            <span>{meeting.date ?? 'تاريخ غير محدد'}</span>
            <span>المدة: {fmtDuration(meeting.duration_seconds)}</span>
            <span>التصنيف: {CLASSIFICATION[meeting.classification]}</span>
          </div>
        </div>
        <span className="spacer" />
        <StatusBadge status={meeting.status} />
        {meeting.status === 'review' && <MinutesBadge status={meeting.minutes_status} />}
      </div>
      {meeting.minutes_status === 'draft_requires_review' && meeting.status === 'review' && (
        <div className="alert warn" style={{ marginTop: '1rem' }}>
          هذا المحضر «مسودة تتطلب المراجعة»: {openCritical ? `توجد ${openCritical} ملاحظة حرجة مفتوحة` : 'لم تُستوفَ إحدى بوابات الجودة'}.
          راجع البنود المعلَّمة في تبويب «البنود والقرارات» قبل الاعتماد.
        </div>
      )}
      <div className="tabs" role="tablist">
        {TABS.map(([key, label]) => (
          <button key={key} role="tab" aria-selected={tab === key} onClick={() => setParams({ tab: key })}>
            {label}
            {key === 'items' && openCritical > 0 && <span className="count">{openCritical}</span>}
          </button>
        ))}
      </div>
      {tab === 'overview' && <Overview meeting={meeting} reload={load} />}
      {tab === 'transcript' && (transcript ? <TranscriptTab meetingId={id} data={transcript} focus={params.get('seg')} reload={load} />
        : <div className="empty">لم يكتمل التفريغ بعد.</div>)}
      {tab === 'speakers' && (transcript ? <SpeakersTab meetingId={id} data={transcript} reload={load} />
        : <div className="empty">لم يكتمل تمييز المتحدثين بعد.</div>)}
      {tab === 'items' && (items && transcript ? <ItemsTab meetingId={id} data={items} transcript={transcript} reload={load} goSegment={goSegment} />
        : <div className="empty">لم يكتمل التحليل والتحقق بعد.</div>)}
      {tab === 'minutes' && <MinutesTab meeting={meeting} reload={load} />}
      {tab === 'audit' && <AuditTab meetingId={id} />}
    </>
  );
}
