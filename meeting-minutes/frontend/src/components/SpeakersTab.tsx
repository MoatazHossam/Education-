import { useState } from 'react';
import { api } from '../api';
import { useSession } from '../App';
import { fmtDuration } from '../labels';
import type { Speaker, TranscriptData } from '../types';
import AudioClip from './AudioClip';
import { speakerColor } from './TranscriptTab';

export default function SpeakersTab({ meetingId, data, reload }: { meetingId: string; data: TranscriptData; reload: () => void }) {
  const { can } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [mergeFrom, setMergeFrom] = useState('');
  const [mergeInto, setMergeInto] = useState('');
  const ids = data.speakers.map((s) => s.id);

  const merge = async () => {
    try {
      await api.post(`/api/meetings/${meetingId}/speakers/merge`, { source: mergeFrom, target: mergeInto });
      setMergeFrom(''); setMergeInto(''); reload();
    } catch (e) { setError((e as Error).message); }
  };

  return (
    <>
      <div className="alert info">
        يميّز النظام المتحدثين بأصواتهم ويعطيهم أرقاماً مجهولة فقط، ولا يستنتج أسماءهم. استمع إلى مقاطع كل متحدث ثم اكتب اسمه وصفته وأكّدهما.
        الأسماء المؤكدة وحدها تظهر في المحضر.
      </div>
      {error && <div className="alert bad">{error}</div>}
      <div className="grid2">
        {data.speakers.map((s) => (
          <SpeakerCard key={s.id} meetingId={meetingId} speaker={s} data={data} color={speakerColor(s.id, ids)} editable={can('editor')} onSaved={reload} onError={setError} />
        ))}
      </div>
      {can('editor') && data.speakers.length > 1 && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <h2>دمج متحدثَين</h2>
          <p className="muted small">إذا قسّم النظام شخصاً واحداً إلى رقمين، انقل كل مقاطع أحدهما إلى الآخر (يُسجَّل في سجل التدقيق).</p>
          <div className="row">
            <select value={mergeFrom} onChange={(e) => setMergeFrom(e.target.value)} aria-label="المتحدث المنقول">
              <option value="">انقل مقاطع…</option>
              {data.speakers.map((s) => <option key={s.id} value={s.id}>{s.display_name || s.label}</option>)}
            </select>
            <span>إلى</span>
            <select value={mergeInto} onChange={(e) => setMergeInto(e.target.value)} aria-label="المتحدث الهدف">
              <option value="">…</option>
              {data.speakers.filter((s) => s.id !== mergeFrom).map((s) => <option key={s.id} value={s.id}>{s.display_name || s.label}</option>)}
            </select>
            <button className="btn" disabled={!mergeFrom || !mergeInto} onClick={merge}>دمج</button>
          </div>
        </div>
      )}
    </>
  );
}

function SpeakerCard({ meetingId, speaker, data, color, editable, onSaved, onError }: {
  meetingId: string; speaker: Speaker; data: TranscriptData; color: string; editable: boolean; onSaved: () => void; onError: (m: string) => void;
}) {
  const [name, setName] = useState(speaker.display_name ?? '');
  const [title, setTitle] = useState(speaker.title ?? '');
  const samples = data.segments.filter((s) => s.speaker_id === speaker.id && s.speaker_confidence === 'high').slice(0, 3);
  const hints = data.speaker_name_hints.filter((h) => h.speaker_id === speaker.id);
  const save = async (confirmed: boolean) => {
    try {
      await api.patch(`/api/meetings/${meetingId}/speakers/${speaker.id}`, { display_name: name, title, confirmed });
      onSaved();
    } catch (e) { onError((e as Error).message); }
  };
  return (
    <div className="card">
      <div className="row">
        <h2 style={{ margin: 0 }}><span className="speaker-chip" style={{ background: color }} />{speaker.display_name || speaker.label}</h2>
        {speaker.confirmed ? <span className="badge ok">مؤكد</span> : <span className="badge plain">غير مؤكد</span>}
        <span className="spacer" />
        <span className="muted small">مدة الحديث: {fmtDuration(speaker.speaking_seconds)}</span>
      </div>
      <div className="row" style={{ margin: '0.6rem 0' }}>
        {samples.map((s, i) => <AudioClip key={s.id} meetingId={meetingId} start={s.start} end={Math.min(s.end, s.start + 12)} label={`عيّنة ${i + 1}`} />)}
      </div>
      {hints.length > 0 && (
        <div className="alert warn small">
          اقتراح من محتوى الكلام (ليس من الصوت): قد يكون «{hints[0]!.name}» — «{hints[0]!.evidence[0]?.quote}». تحقق قبل التأكيد.
        </div>
      )}
      {editable && (
        <div className="grid2">
          <label className="field">الاسم<input type="text" value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="field">الصفة الوظيفية<input type="text" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
          <div className="row" style={{ gridColumn: '1 / -1' }}>
            <button className="btn primary" disabled={!name.trim()} onClick={() => save(true)}>حفظ وتأكيد</button>
            {speaker.confirmed && <button className="btn" onClick={() => save(false)}>إلغاء التأكيد</button>}
          </div>
        </div>
      )}
    </div>
  );
}
