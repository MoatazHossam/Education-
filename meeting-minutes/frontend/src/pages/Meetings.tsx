import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useSession } from '../App';
import { CLASSIFICATION, MEETING_STATUS, fmtDate, fmtDuration } from '../labels';
import type { MeetingSummary, SystemInfo } from '../types';
import { MinutesBadge, StatusBadge } from '../components/Badges';

export default function Meetings() {
  const { can } = useSession();
  const [meetings, setMeetings] = useState<MeetingSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    const load = () => api.get<MeetingSummary[]>('/api/meetings').then((m) => alive && setMeetings(m)).catch((e) => alive && setError(e.message));
    load();
    const t = setInterval(load, 5000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  return (
    <>
      <div className="row" style={{ marginBottom: '1rem' }}>
        <div>
          <h1>الاجتماعات</h1>
          <p className="muted small" style={{ margin: 0 }}>ارفع تسجيلاً صوتياً لاجتماع، وراجع المحضر المستخرج منه قبل اعتماده.</p>
        </div>
        <span className="spacer" />
        {can('editor') && <button className="btn primary" onClick={() => setShowUpload(true)}>رفع تسجيل جديد</button>}
      </div>
      {error && <div className="alert bad">{error}</div>}
      <div className="card" style={{ padding: 0 }}>
        {!meetings ? <div className="empty">جارٍ التحميل…</div> : meetings.length === 0 ? (
          <div className="empty">لا توجد اجتماعات بعد.</div>
        ) : (
          <table className="data">
            <thead>
              <tr><th>الاجتماع</th><th>التاريخ</th><th>المدة</th><th>التصنيف</th><th>المعالجة</th><th>حالة المحضر</th><th>ملاحظات حرجة</th></tr>
            </thead>
            <tbody>
              {meetings.map((m) => (
                <tr key={m.id} className="click" onClick={() => navigate(`/meetings/${m.id}`)} tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/meetings/${m.id}`); }}>
                  <td><strong>{m.title}</strong><div className="muted small">رُفع {fmtDate(m.created_at)}</div></td>
                  <td>{m.date ?? '—'}</td>
                  <td>{fmtDuration(m.duration_seconds)}</td>
                  <td>{CLASSIFICATION[m.classification]}</td>
                  <td>
                    <StatusBadge status={m.status} />
                    {m.status === 'processing' && <div className="progress" style={{ marginTop: 6 }}><span style={{ width: `${Math.round(m.progress * 100)}%` }} /></div>}
                  </td>
                  <td>{m.status === 'review' ? <MinutesBadge status={m.minutes_status} /> : <span className="muted">{MEETING_STATUS[m.status]}</span>}</td>
                  <td>{m.critical_open ? <span className="badge bad">{m.critical_open}</span> : <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {showUpload && <UploadDialog onClose={() => setShowUpload(false)} onDone={(id) => navigate(`/meetings/${id}`)} />}
    </>
  );
}

function UploadDialog({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [location, setLocation] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [preparedBy, setPreparedBy] = useState('');
  const [classification, setClassification] = useState('internal');
  const [speakers, setSpeakers] = useState('');
  const [attendees, setAttendees] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  useEffect(() => { api.get<SystemInfo>('/api/system').then(setSystem).catch(() => {}); }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append('file', file);
    form.append('title', title);
    if (date) form.append('meeting_date', date);
    if (location) form.append('location', location);
    if (start) form.append('start_time', start);
    if (end) form.append('end_time', end);
    if (preparedBy) form.append('prepared_by', preparedBy);
    form.append('classification', classification);
    if (speakers) form.append('expected_speakers', speakers);
    const names = attendees.split('\n').map((s) => s.trim()).filter(Boolean);
    if (names.length) form.append('attendees', JSON.stringify(names));
    try {
      const m = await api.upload<MeetingSummary>('/api/meetings', form);
      onDone(m.id);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-labelledby="upload-title">
      <form className="modal" onSubmit={submit}>
        <h2 id="upload-title">رفع تسجيل اجتماع</h2>
        {error && <div className="alert bad" role="alert">{error}</div>}
        {system && (
          <div className="alert info small">
            التفريغ: <span className="ltr">{system.asr_provider}{system.whisper_model ? ` / ${system.whisper_model}` : ''}</span> — التحليل:{' '}
            <span className="ltr">{system.llm_provider} / {system.llm_model}</span>. الحد الأقصى: {system.max_upload_mb} ميجابايت و{system.max_duration_minutes} دقيقة.
            {system.allowed_external_providers.length === 0 && ' لا يُرسل أي محتوى إلى مزوّد خارجي في هذا التشغيل.'}
          </div>
        )}
        <div className="grid2">
          <label className="field" style={{ gridColumn: '1 / -1' }}>الملف الصوتي (MP3، WAV، M4A، OGG، FLAC، WEBM)
            <input type="file" required accept=".mp3,.wav,.m4a,.mp4,.aac,.ogg,.oga,.opus,.flac,.webm,.wma,.amr,audio/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          <label className="field" style={{ gridColumn: '1 / -1' }}>موضوع الاجتماع
            <input type="text" required maxLength={300} value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="field">تاريخ الاجتماع<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="field">المكان أو وسيلة الانعقاد<input type="text" value={location} onChange={(e) => setLocation(e.target.value)} /></label>
          <label className="field">وقت البداية<input type="time" value={start} onChange={(e) => setStart(e.target.value)} /></label>
          <label className="field">وقت النهاية<input type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
          <label className="field">معد المحضر<input type="text" value={preparedBy} onChange={(e) => setPreparedBy(e.target.value)} /></label>
          <label className="field">التصنيف
            <select value={classification} onChange={(e) => setClassification(e.target.value)}>
              {Object.entries(CLASSIFICATION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="field">عدد المتحدثين المتوقع (اختياري، يحسّن تمييز المتحدثين)
            <input type="number" min={1} max={30} value={speakers} onChange={(e) => setSpeakers(e.target.value)} />
          </label>
          <label className="field" style={{ gridColumn: '1 / -1' }}>أسماء الحاضرين وصفاتهم (سطر لكل شخص، اختياري)
            <textarea value={attendees} onChange={(e) => setAttendees(e.target.value)} placeholder="أحمد علي، رئيس اللجنة" />
          </label>
        </div>
        <p className="muted small">لا يستنتج النظام أسماء المتحدثين من أصواتهم؛ تُحدَّد الأسماء يدوياً في صفحة المتحدثين.</p>
        <div className="row">
          <button className="btn primary" type="submit" disabled={busy || !file}>{busy ? 'جارٍ الرفع والفحص…' : 'رفع وبدء المعالجة'}</button>
          <button className="btn" type="button" onClick={onClose} disabled={busy}>إلغاء</button>
        </div>
      </form>
    </div>
  );
}
