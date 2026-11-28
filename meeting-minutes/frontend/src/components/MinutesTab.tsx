import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useSession } from '../App';
import { DOCUMENTS } from '../labels';
import type { Block, MeetingDetail, Minutes, Section } from '../types';
import { SeverityBadge } from './Badges';

export default function MinutesTab({ meeting, reload }: { meeting: MeetingDetail; reload: () => void }) {
  const { can } = useSession();
  const [minutes, setMinutes] = useState<Minutes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ section: Section; block: Block } | null>(null);
  const [preview, setPreview] = useState<{ kind: string; page: number } | null>(null);
  const load = useCallback(() => {
    api.get<Minutes>(`/api/meetings/${meeting.id}/minutes`).then(setMinutes).catch((e) => setError(e.status === 409 ? null : e.message));
  }, [meeting.id]);
  useEffect(() => { load(); }, [load, meeting.documents?.minutes_version]);

  const act = async (path: string, body: unknown, done: string) => {
    setError(null);
    try { await api.post(`/api/meetings/${meeting.id}${path}`, body); setNotice(done); reload(); } catch (e) { setError((e as Error).message); }
  };
  const busy = meeting.status === 'processing';
  const docs = meeting.documents;

  return (
    <div className="grid2" style={{ gridTemplateColumns: 'minmax(0, 2.2fr) minmax(0, 1fr)' }}>
      <div>
        {!minutes ? <div className="card empty">لم يُنشأ المحضر بعد.</div> : (
          <div className="paper" aria-label="معاينة المحضر">
            <h1>{minutes.title}</h1>
            <p className="status"><span className={`badge ${minutes.status_label === 'معتمد' ? 'ok' : minutes.status_label === 'تمت مراجعته' ? 'info' : 'bad'}`}>
              حالة المحضر: {minutes.status_label}</span> {minutes.classification_label && <span className="badge plain">التصنيف: {minutes.classification_label}</span>}</p>
            {minutes.sections.map((s) => (
              <section key={s.key}>
                <h2>{s.title}</h2>
                {s.rows.length > 0 && s.key !== 'info' && (
                  <table><thead><tr>{s.table_columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                    <tbody>{s.rows.map((r) => <tr key={r.id}>{s.table_columns.map((c) => <td key={c}>{r.cells[c]}</td>)}</tr>)}</tbody></table>
                )}
                {s.key === 'info' && (
                  <table><tbody>{s.rows.map((r) => <tr key={r.id}><th style={{ width: '30%' }}>{r.cells['البيان']}</th><td>{r.cells['القيمة']}</td></tr>)}</tbody></table>
                )}
                {s.blocks.map((b) => b.text.startsWith('## ') ? <h3 key={b.id}>{b.text.slice(3)}</h3> : (
                  <div key={b.id} className="block">
                    {b.kind === 'bullet' ? <ul style={{ margin: 0 }}><li>{b.text}</li></ul> : <p style={{ margin: '0 0 0.5rem' }}>{b.text}</p>}
                    {can('editor') && b.item_ids.length > 0 && (
                      <button className="btn small edit" onClick={() => setEditing({ section: s, block: b })} aria-label="تعديل الفقرة">✎</button>
                    )}
                  </div>
                ))}
              </section>
            ))}
          </div>
        )}
      </div>
      <div>
        <div className="card">
          <h2>المراجعة والاعتماد</h2>
          {error && <div className="alert bad">{error}</div>}
          {notice && <div className="alert ok">{notice}</div>}
          {busy && <div className="alert info">جارٍ إعادة الإنشاء…</div>}
          <ol className="small" style={{ paddingInlineStart: '1.2rem' }}>
            <li>صحّح النص وأسماء المتحدثين إن لزم.</li>
            <li>راجع كل بند: اقبله أو صحّحه أو ارفضه، واحسم الملاحظات الحرجة.</li>
            <li>أكمل المراجعة؛ يصبح المحضر «تمت مراجعته» إن لم تبق ملاحظة حرجة.</li>
            <li>يعتمده صاحب صلاحية الاعتماد.</li>
          </ol>
          {can('editor') && (
            <div style={{ display: 'grid', gap: '0.5rem' }}>
              <button className="btn" disabled={busy} onClick={() => act('/regenerate', { scope: 'regenerate' }, 'بدأت إعادة صياغة المحضر بناءً على قرارات المراجعة.')}>إعادة صياغة المحضر</button>
              <button className="btn" disabled={busy} onClick={() => act('/regenerate', { scope: 'reverify' }, 'بدأت إعادة التحقق من الأدلة ثم الصياغة.')}>إعادة التحقق من الأدلة (بعد تصحيح النص)</button>
              <button className="btn" disabled={busy} onClick={() => {
                if (window.confirm('إعادة التحليل تُنشئ بنوداً جديدة وتُلغي قرارات المراجعة الحالية على البنود (تبقى في السجل). متابعة؟'))
                  act('/regenerate', { scope: 'reanalyse' }, 'بدأت إعادة التحليل الكامل.');
              }}>إعادة التحليل من النص</button>
              <button className="btn primary" disabled={busy} onClick={() => act('/review/complete', {}, 'سُجّل إكمال المراجعة، وجارٍ تحديث المحضر.')}>إكمال المراجعة</button>
            </div>
          )}
          {can('approver') && (
            <div style={{ marginTop: '0.8rem' }}>
              <button className="btn ok" disabled={busy || meeting.minutes_status !== 'reviewed' || meeting.critical_open > 0}
                onClick={() => { if (window.confirm('اعتماد المحضر بصفتك؟ يُسجَّل الاعتماد باسمك وتاريخه.')) act('/approve', {}, 'اعتُمد المحضر.'); }}>
                اعتماد المحضر
              </button>
              {meeting.minutes_status !== 'reviewed' && <p className="muted small">يُتاح الاعتماد بعد إكمال المراجعة وعدم وجود ملاحظات حرجة مفتوحة.</p>}
            </div>
          )}
        </div>
        <div className="card">
          <h2>التصدير</h2>
          {!docs ? <p className="muted">لا توجد مستندات بعد.</p> : (
            <>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.4rem' }}>
                {DOCUMENTS.filter(([k]) => docs.available.includes(k)).map(([k, label]) => (
                  <li key={k} className="row">
                    <a className="btn small" href={`/api/meetings/${meeting.id}/documents/${k}`}>⬇ {label}</a>
                    {k.endsWith('_pdf') && <button className="btn small" onClick={() => setPreview({ kind: k, page: 1 })}>معاينة</button>}
                    {docs.checks[k] && !docs.checks[k]!.ok && <span className="badge bad" title={docs.checks[k]!.problems.join('\n')}>مشكلة عرض</span>}
                  </li>
                ))}
              </ul>
              <p className="muted small">تقرير الأدلة منفصل عن المحضر الرسمي ويُستخدم في المراجعة الداخلية.</p>
            </>
          )}
        </div>
        {minutes && minutes.issues.length > 0 && (
          <div className="card">
            <h2>ملاحظات الصياغة</h2>
            <ul className="checks">
              {minutes.issues.filter((i) => i.code.startsWith('writer') || i.code.startsWith('human') || i.code === 'language_note').slice(0, 20).map((i, n) => (
                <li key={n} className={i.severity}><SeverityBadge severity={i.severity} /> {i.message_ar}</li>
              ))}
            </ul>
            {minutes.language_review?.refused && minutes.language_review.refused.length > 0 && (
              <p className="small muted">رُفض {minutes.language_review.refused.length} تعديلاً لغوياً لأنه غيّر معلومة.</p>
            )}
          </div>
        )}
      </div>
      {editing && <EditBlock meetingId={meeting.id} section={editing.section} block={editing.block} onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); setNotice('حُفظت الصياغة؛ أعد صياغة المحضر لتطبيقها على المستندات.'); }} />}
      {preview && <Preview meetingId={meeting.id} kind={preview.kind} page={preview.page} onPage={(p) => setPreview({ ...preview, page: p })} onClose={() => setPreview(null)} />}
    </div>
  );
}

function EditBlock({ meetingId, section, block, onClose, onSaved }: { meetingId: string; section: Section; block: Block; onClose: () => void; onSaved: () => void }) {
  const [text, setText] = useState(block.text);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    try { await api.post(`/api/meetings/${meetingId}/minutes/edits`, { section: section.key, item_ids: block.item_ids, text, reason }); onSaved(); }
    catch (e) { setError((e as Error).message); }
  };
  return (
    <div className="modal-back" role="dialog" aria-modal="true">
      <div className="modal">
        <h2>تعديل صياغة فقرة — {section.title}</h2>
        <p className="muted small">البنود المرتبطة: <span className="ltr">{block.item_ids.join(', ')}</span>. يُتحقق آلياً من أن الصياغة لا تضيف رقماً أو تاريخاً أو اسماً غير وارد في البنود، ويُسجَّل أي اختلاف.</p>
        {error && <div className="alert bad">{error}</div>}
        <label className="field">الصياغة<textarea value={text} onChange={(e) => setText(e.target.value)} style={{ minHeight: 140 }} /></label>
        <label className="field">سبب التعديل<input type="text" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <div className="row"><button className="btn primary" disabled={reason.trim().length < 2} onClick={save}>حفظ</button><button className="btn" onClick={onClose}>إلغاء</button></div>
      </div>
    </div>
  );
}

function Preview({ meetingId, kind, page, onPage, onClose }: { meetingId: string; kind: string; page: number; onPage: (p: number) => void; onClose: () => void }) {
  return (
    <div className="modal-back" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 900 }} onClick={(e) => e.stopPropagation()}>
        <div className="row"><h2 style={{ margin: 0 }}>معاينة — صفحة {page}</h2><span className="spacer" />
          <button className="btn small" disabled={page <= 1} onClick={() => onPage(page - 1)}>السابقة</button>
          <button className="btn small" onClick={() => onPage(page + 1)}>التالية</button>
          <button className="btn small" onClick={onClose}>إغلاق</button></div>
        <img src={`/api/meetings/${meetingId}/documents/${kind}/preview?page=${page}`} alt={`صفحة ${page}`} style={{ width: '100%', border: '1px solid var(--line)', marginTop: '0.8rem' }} />
      </div>
    </div>
  );
}
