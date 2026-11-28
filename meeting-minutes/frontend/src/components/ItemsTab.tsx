import { useMemo, useState } from 'react';
import { api } from '../api';
import { useSession } from '../App';
import { ITEM_GROUPS, fmtTime } from '../labels';
import type { Issue, Item, ItemsData, TranscriptData } from '../types';
import AudioClip from './AudioClip';
import { SeverityBadge, VerificationBadge } from './Badges';

export default function ItemsTab({ meetingId, data, transcript, reload, goSegment }: {
  meetingId: string; data: ItemsData; transcript: TranscriptData; reload: () => void; goSegment: (id: string) => void;
}) {
  const [onlyOpen, setOnlyOpen] = useState(false);
  const names = useMemo(() => Object.fromEntries(transcript.speakers.map((s) => [s.id, s.display_name || s.label])), [transcript.speakers]);
  const needsAttention = (it: Item) => !it.review && !!it.verification && it.verification.issues.some((i) => i.severity === 'critical' || i.severity === 'major');
  const items = data.items.filter((it) => !onlyOpen || needsAttention(it));
  const typeOf = (it: Item) => it.review?.type || it.verification?.final_type || it.type;

  return (
    <>
      <div className="card">
        <div className="row">
          <div className="kpi"><span className="muted small">البنود</span><b>{data.items.length}</b></div>
          <div className="kpi"><span className="muted small">بأدلة مطابقة</span><b>{Math.round((data.coverage.evidence_coverage ?? 0) * 100)}٪</b></div>
          <div className="kpi"><span className="muted small">تتطلب انتباهاً</span><b>{data.items.filter(needsAttention).length}</b></div>
          <div className="kpi"><span className="muted small">مراجعة مستقلة</span><b className="small">{data.llm_used ? <span className="ltr">{data.llm_model}</span> : 'قواعد فقط'}</b></div>
          <span className="spacer" />
          <label className="row small"><input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> ما يتطلب المراجعة فقط</label>
        </div>
        <p className="muted small" style={{ marginBottom: 0 }}>
          كل بند مستخرج آلياً ومستند إلى مقاطع من التسجيل؛ لا يُعدّ أي بند مقبولاً حتى يقبله مراجع. يُخفَّض تصنيف أي «قرار» لا يتضمن دليله عبارة اعتماد صريحة،
          ولا يُرفع تصنيف بند تلقائياً أبداً.
        </p>
      </div>
      {data.document_issues.length > 0 && <DocumentIssues meetingId={meetingId} issues={data.document_issues} reload={reload} goSegment={goSegment} />}
      {ITEM_GROUPS.map((g) => {
        const list = items.filter((it) => g.types.includes(typeOf(it)));
        if (!list.length) return null;
        return (
          <div key={g.key} className="card">
            <h2>{g.title} ({list.length})</h2>
            {list.map((it) => <ItemCard key={it.id} meetingId={meetingId} item={it} data={data} names={names} reload={reload} goSegment={goSegment} />)}
          </div>
        );
      })}
    </>
  );
}

function ItemCard({ meetingId, item, data, names, reload, goSegment }: {
  meetingId: string; item: Item; data: ItemsData; names: Record<string, string>; reload: () => void; goSegment: (id: string) => void;
}) {
  const { can } = useSession();
  const [editing, setEditing] = useState(false);
  const [statement, setStatement] = useState(item.review?.edits?.statement ?? item.statement);
  const [owner, setOwner] = useState(item.review?.edits?.owner ?? item.owner.name_as_spoken ?? '');
  const [due, setDue] = useState(item.review?.edits?.due ?? item.due.text_as_spoken ?? '');
  const [type, setType] = useState(item.review?.type ?? item.verification?.final_type ?? item.type);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const v = item.verification;
  const failed = v?.checks.filter((c) => !c.passed) ?? [];
  const worst = failed.some((c) => c.severity === 'critical') ? 'crit' : failed.some((c) => c.severity === 'major') ? 'major' : 'okk';
  const reclassified = v && v.final_type !== v.original_type;

  const send = async (decision: 'accepted' | 'rejected' | 'reset', withEdits = false) => {
    try {
      await api.post(`/api/meetings/${meetingId}/items/${item.id}/review`, {
        decision, note: note || undefined,
        ...(withEdits ? { statement: statement !== item.statement ? statement : undefined, owner: owner !== (item.owner.name_as_spoken ?? '') ? owner : undefined,
          due: due !== (item.due.text_as_spoken ?? '') ? due : undefined, type: type !== (v?.final_type ?? item.type) ? type : undefined } : {}),
      });
      setEditing(false);
      reload();
    } catch (e) { setError((e as Error).message); }
  };

  return (
    <div className={`item ${item.review?.decision === 'rejected' ? 'rejected' : item.review ? 'okk' : worst}`}>
      <div className="row">
        <strong className="ltr">{item.id}</strong>
        <span className="badge info">{item.final_type_ar ?? item.type_ar}</span>
        {reclassified && <span className="badge warn">أُعيد تصنيفه من «{data.types_ar[v!.original_type]}»</span>}
        {v && <VerificationBadge status={v.status} />}
        {item.requires_confirmation && <span className="badge warn">يتطلب التأكيد</span>}
        {item.review && <span className={`badge ${item.review.decision === 'accepted' ? 'ok' : 'bad'}`}>
          {item.review.decision === 'accepted' ? 'قبِله' : 'رفضه'} {item.review.by_name}</span>}
        <span className="spacer" />
        {can('editor') && !editing && (
          <div className="row">
            <button className="btn small ok" onClick={() => send('accepted')}>قبول</button>
            <button className="btn small" onClick={() => setEditing(true)}>تصحيح</button>
            <button className="btn small danger" onClick={() => send('rejected')}>رفض</button>
            {item.review && <button className="btn small" onClick={() => send('reset')}>إلغاء القرار</button>}
          </div>
        )}
      </div>
      {error && <div className="alert bad">{error}</div>}
      {!editing ? (
        <>
          <p className="statement">{item.review?.edits?.statement ?? item.statement}</p>
          <div className="row small muted">
            {item.speaker_ids.length > 0 && <span>القائل: {item.speaker_ids.map((s) => names[s] ?? s).join('، ')}</span>}
            {(item.owner.name_as_spoken || item.review?.edits?.owner) && <span>المسؤول: {item.review?.edits?.owner ?? item.owner.name_as_spoken}</span>}
            {(item.due.text_as_spoken || item.review?.edits?.due) && <span>الموعد: {item.review?.edits?.due ?? item.due.text_as_spoken}{item.due.date_iso ? ` (${item.due.date_iso})` : ''}</span>}
          </div>
          {item.qualifications.length > 0 && <p className="small">الشروط والتحفظات: {item.qualifications.join('؛ ')}</p>}
        </>
      ) : (
        <div className="grid2" style={{ marginTop: '0.5rem' }}>
          <label className="field" style={{ gridColumn: '1 / -1' }}>الصياغة<textarea value={statement} onChange={(e) => setStatement(e.target.value)} /></label>
          <label className="field">النوع
            <select value={type} onChange={(e) => setType(e.target.value)}>
              {Object.entries(data.types_ar).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </label>
          <label className="field">المسؤول<input type="text" value={owner} onChange={(e) => setOwner(e.target.value)} /></label>
          <label className="field">الموعد<input type="text" value={due} onChange={(e) => setDue(e.target.value)} /></label>
          <label className="field">ملاحظة المراجع<input type="text" value={note} onChange={(e) => setNote(e.target.value)} /></label>
          <div className="row" style={{ gridColumn: '1 / -1' }}>
            <button className="btn primary" onClick={() => send('accepted', true)}>حفظ التصحيح وقبول البند</button>
            <button className="btn" onClick={() => setEditing(false)}>إلغاء</button>
          </div>
        </div>
      )}
      {v?.evidence.map((e, i) => (
        <div key={i} className="evidence">
          <div className="meta row">
            <span>{e.quote_found ? '✓ اقتباس مطابق' : `✗ لا يطابق النص (${Math.round(e.match_score)}٪)`}</span>
            <button className="btn small" onClick={() => goSegment(e.segment_id)}>{e.segment_id}</button>
            <span>{e.speaker_id ? names[e.speaker_id] : 'متحدث غير محدد'} · {fmtTime(e.start)}</span>
            {e.speaker_confidence !== 'high' && <span className="badge warn">نسبة المتحدث غير مؤكدة</span>}
            <AudioClip meetingId={meetingId} start={e.start} end={e.end} />
          </div>
          «{e.original_text}»
        </div>
      ))}
      {failed.length > 0 && (
        <ul className="checks">
          {failed.map((c, i) => <li key={i} className={c.severity}>[{({ critical: 'حرج', major: 'مهم', minor: 'ثانوي', info: '' })[c.severity]}] {c.detail_ar}</li>)}
        </ul>
      )}
      {v?.llm && <p className="small muted">المراجعة المستقلة ({v.llm.verdict}): {v.llm.rationale_ar}</p>}
    </div>
  );
}

function DocumentIssues({ meetingId, issues, reload, goSegment }: { meetingId: string; issues: Issue[]; reload: () => void; goSegment: (id: string) => void }) {
  const { can } = useSession();
  const [error, setError] = useState<string | null>(null);
  const resolve = async (key: string, resolution: 'accepted' | 'dismissed' | 'reset') => {
    const note = resolution === 'reset' ? 'إلغاء' : window.prompt('سبب القرار (يُسجَّل في سجل التدقيق):') ?? '';
    if (resolution !== 'reset' && note.trim().length < 2) return;
    try { await api.post(`/api/meetings/${meetingId}/issues/resolve`, { key, resolution, note }); reload(); } catch (e) { setError((e as Error).message); }
  };
  return (
    <div className="card">
      <h2>ملاحظات على مستوى الاجتماع</h2>
      <p className="muted small">مواضع قد تتضمن قرارات أو تكليفات لم تُستخرج، وتعارضات، ومقاطع مستبعدة. استمع إليها ثم احسم كل ملاحظة.</p>
      {error && <div className="alert bad">{error}</div>}
      <table className="data">
        <tbody>
          {issues.map((i) => (
            <tr key={i.key}>
              <td><SeverityBadge severity={i.severity} /></td>
              <td>{i.message_ar}</td>
              <td className="row">
                {i.segment_ids.slice(0, 3).map((s) => <button key={s} className="btn small" onClick={() => goSegment(s)}>{s}</button>)}
                {i.start != null && i.end != null && <AudioClip meetingId={meetingId} start={i.start} end={i.end} />}
              </td>
              <td>
                {i.resolution ? (
                  <span className="small">{i.resolution.resolution === 'accepted' ? 'عولجت' : 'أُغلقت'} — {i.resolution.by_name}
                    {can('editor') && <button className="btn small" onClick={() => resolve(i.key!, 'reset')}>تراجع</button>}</span>
                ) : can('editor') && (
                  <span className="row">
                    <button className="btn small" onClick={() => resolve(i.key!, 'accepted')}>عولجت</button>
                    <button className="btn small" onClick={() => resolve(i.key!, 'dismissed')}>لا تنطبق</button>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
