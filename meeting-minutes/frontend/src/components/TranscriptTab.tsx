import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { useSession } from '../App';
import { FLAGS, fmtTime } from '../labels';
import type { Segment, TranscriptData } from '../types';
import AudioClip from './AudioClip';

export const SPEAKER_COLORS = ['#1d4775', '#b6872b', '#1c6b3a', '#8a1c6b', '#2a7f8f', '#9b4a1c', '#5a4fa0', '#6b7a1c'];
export const speakerColor = (id: string | null, ids: string[]): string => (id ? SPEAKER_COLORS[ids.indexOf(id) % SPEAKER_COLORS.length] ?? '#99a3ad' : '#99a3ad');

export default function TranscriptTab({ meetingId, data, focus, reload }: { meetingId: string; data: TranscriptData; focus: string | null; reload: () => void }) {
  const { can } = useSession();
  const [mode, setMode] = useState<'readable' | 'verbatim'>('readable');
  const [filter, setFilter] = useState<'all' | 'flagged'>('all');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Segment | null>(null);
  const names = useMemo(() => Object.fromEntries(data.speakers.map((s) => [s.id, s.display_name || s.label])), [data.speakers]);
  const ids = data.speakers.map((s) => s.id);
  const target = useRef<HTMLDivElement | null>(null);
  useEffect(() => { target.current?.scrollIntoView({ block: 'center' }); }, [focus]);

  const shown = data.segments.filter((s) => (filter === 'all' || s.flags.length > 0)
    && (!query || s.text_verbatim.includes(query) || s.text_readable.includes(query)));

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: '0.8rem' }}>
        <div role="radiogroup" aria-label="نسخة النص" className="row">
          <button className={`btn small ${mode === 'readable' ? 'primary' : ''}`} onClick={() => setMode('readable')}>المقروءة</button>
          <button className={`btn small ${mode === 'verbatim' ? 'primary' : ''}`} onClick={() => setMode('verbatim')}>الحرفية</button>
        </div>
        <button className={`btn small ${filter === 'flagged' ? 'primary' : ''}`} onClick={() => setFilter(filter === 'all' ? 'flagged' : 'all')}>
          المقاطع التي تتطلب الانتباه فقط ({data.segments.filter((s) => s.flags.length).length})
        </button>
        <input type="text" placeholder="بحث في النص" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="بحث في النص" />
        <span className="spacer" />
        <span className="muted small ltr">{data.asr_provider} / {data.asr_model} · {data.diarization_provider}</span>
      </div>
      <p className="muted small">النسخة الحرفية هي ما تعرّف عليه النظام دون تعديل؛ النسخة المقروءة تحذف التردد والتكرار وتطبّق المسرد دون تغيير المعنى، ويُرفض آلياً أي تعديل يغيّر رقماً أو نفياً أو مصطلحاً.</p>
      {shown.map((s) => (
        <div key={s.id} ref={focus === s.id ? target : undefined}
          className={`seg ${s.flags.length ? 'flagged' : ''} ${s.excluded ? 'excluded' : ''} ${focus === s.id ? 'target' : ''}`}>
          <div>
            <div className="who"><span className="speaker-chip" style={{ background: speakerColor(s.speaker_id, ids) }} />{s.speaker_id ? names[s.speaker_id] : 'متحدث غير محدد'}</div>
            <div className="when ltr">{s.id} · {fmtTime(s.start)}–{fmtTime(s.end)}</div>
            {s.speaker_confidence !== 'high' && <div className="small muted">ثقة النسبة: {{ medium: 'متوسطة', low: 'منخفضة', unknown: 'غير معروفة' }[s.speaker_confidence]}</div>}
          </div>
          <div>
            <div className="text">{mode === 'readable' ? s.text_readable : s.text_verbatim}</div>
            <div className="tools">
              <AudioClip meetingId={meetingId} start={s.start} end={s.end} />
              {can('editor') && <button className="btn small" onClick={() => setEditing(s)}>تصحيح</button>}
              {s.flags.map((f) => <span key={f} className={`badge ${f === 'possible_hallucination' || f === 'low_confidence' ? 'bad' : 'warn'}`}>{FLAGS[f] ?? f}</span>)}
              {s.uncertain_terms.length > 0 && <span className="small muted">غير مؤكد: {s.uncertain_terms.join('، ')}</span>}
              {s.excluded && <span className="small muted">مستبعد من التحليل</span>}
            </div>
          </div>
        </div>
      ))}
      {editing && <EditSegment meetingId={meetingId} segment={editing} data={data} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </div>
  );
}

function EditSegment({ meetingId, segment, data, onClose, onSaved }: { meetingId: string; segment: Segment; data: TranscriptData; onClose: () => void; onSaved: () => void }) {
  const [verbatim, setVerbatim] = useState(segment.text_verbatim);
  const [readable, setReadable] = useState(segment.text_readable);
  const [speaker, setSpeaker] = useState(segment.speaker_id ?? '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    try {
      await api.patch(`/api/meetings/${meetingId}/transcript/segments/${segment.id}`, {
        text_verbatim: verbatim !== segment.text_verbatim ? verbatim : undefined,
        text_readable: readable !== segment.text_readable ? readable : undefined,
        speaker_id: speaker && speaker !== segment.speaker_id ? speaker : undefined,
        reason,
      });
      onSaved();
    } catch (e) { setError((e as Error).message); }
  };
  return (
    <div className="modal-back" role="dialog" aria-modal="true">
      <div className="modal">
        <h2>تصحيح المقطع {segment.id}</h2>
        <AudioClip meetingId={meetingId} start={segment.start} end={segment.end} label="استمع قبل التصحيح" />
        {error && <div className="alert bad">{error}</div>}
        <label className="field">النص الحرفي (ما قيل فعلاً)<textarea value={verbatim} onChange={(e) => setVerbatim(e.target.value)} /></label>
        <label className="field">النسخة المقروءة<textarea value={readable} onChange={(e) => setReadable(e.target.value)} /></label>
        <label className="field">المتحدث
          <select value={speaker} onChange={(e) => setSpeaker(e.target.value)}>
            {data.speakers.map((s) => <option key={s.id} value={s.id}>{s.display_name || s.label}</option>)}
          </select>
        </label>
        <label className="field">سبب التصحيح (يُسجَّل في سجل التدقيق)<input type="text" required value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <p className="muted small">بعد التصحيح، أعد التحقق من الأدلة من تبويب «المحضر» حتى تعكس البنود النص المصحح.</p>
        <div className="row">
          <button className="btn primary" onClick={save} disabled={reason.trim().length < 2}>حفظ</button>
          <button className="btn" onClick={onClose}>إلغاء</button>
        </div>
      </div>
    </div>
  );
}
