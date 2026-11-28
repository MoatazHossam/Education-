import { useEffect, useState } from 'react';
import { api } from '../api';
import { useSession } from '../App';
import { CLASSIFICATION, ROLE, fmtDate } from '../labels';
import type { GlossaryTerm, OrgSettings, Role, SystemInfo, User } from '../types';

const CATEGORIES: Record<string, string> = {
  person: 'شخص', organization: 'جهة', project: 'مشروع', product: 'منتج أو نظام', acronym: 'اختصار', term: 'مصطلح', place: 'مكان', title: 'صفة',
};

export default function Settings() {
  const { can } = useSession();
  return (
    <>
      <h1>الإعدادات والمسرد</h1>
      <Glossary />
      {can('admin') && <><Privacy /><Retention /><Gates /><Branding /><Users /></>}
    </>
  );
}

function Glossary() {
  const { can } = useSession();
  const [terms, setTerms] = useState<GlossaryTerm[]>([]);
  const [term, setTerm] = useState('');
  const [variants, setVariants] = useState('');
  const [category, setCategory] = useState('term');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const load = () => api.get<GlossaryTerm[]>('/api/glossary').then(setTerms).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  const add = async () => {
    try {
      await api.post('/api/glossary', { term, category, note: note || null, variants: variants.split('،').join(',').split(',').map((v) => v.trim()).filter(Boolean) });
      setTerm(''); setVariants(''); setNote(''); load();
    } catch (e) { setError((e as Error).message); }
  };
  const remove = async (id: string) => { await api.del(`/api/glossary/${id}`).catch((e) => setError(e.message)); load(); };
  return (
    <div className="card">
      <h2>مسرد المؤسسة</h2>
      <p className="muted small">أسماء الأشخاص والجهات والمشروعات والاختصارات. يُستخدم لتحسين التفريغ، وتوحيد الكتابة في النسخة المقروءة (مثل «إي بي آي» ← API)،
        وللتحقق من أن أي اسم في المحضر وارد في التسجيل. لا يُخمَّن اسم علم غير مؤكد.</p>
      {error && <div className="alert bad">{error}</div>}
      {can('editor') && (
        <div className="row" style={{ alignItems: 'flex-end', marginBottom: '0.8rem' }}>
          <label className="field">المصطلح بالكتابة المعتمدة<input type="text" value={term} onChange={(e) => setTerm(e.target.value)} /></label>
          <label className="field" style={{ flex: 1 }}>أشكال النطق أو الكتابة الأخرى (مفصولة بفاصلة)<input type="text" value={variants} onChange={(e) => setVariants(e.target.value)} /></label>
          <label className="field">الفئة<select value={category} onChange={(e) => setCategory(e.target.value)}>{Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="field">ملاحظة<input type="text" value={note} onChange={(e) => setNote(e.target.value)} /></label>
          <button className="btn primary" disabled={!term.trim()} onClick={add}>إضافة</button>
        </div>
      )}
      <table className="data">
        <thead><tr><th>المصطلح</th><th>الأشكال الأخرى</th><th>الفئة</th><th>ملاحظة</th><th /></tr></thead>
        <tbody>{terms.map((t) => (
          <tr key={t.id}><td><strong>{t.term}</strong></td><td>{t.variants.join('، ')}</td><td>{CATEGORIES[t.category] ?? t.category}</td><td>{t.note}</td>
            <td>{can('editor') && <button className="btn small danger" onClick={() => remove(t.id)}>حذف</button>}</td></tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function useOrg() {
  const [org, setOrg] = useState<{ settings: OrgSettings } | null>(null);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  useEffect(() => {
    api.get<{ settings: OrgSettings }>('/api/org').then(setOrg).catch(() => {});
    api.get<SystemInfo>('/api/system').then(setSystem).catch(() => {});
  }, []);
  return { org, system };
}

function Saved({ msg }: { msg: string | null }) { return msg ? <span className="badge ok">{msg}</span> : null; }

function Privacy() {
  const { org, system } = useOrg();
  const [audio, setAudio] = useState<string[]>([]);
  const [transcript, setTranscript] = useState<string[]>([]);
  const [max, setMax] = useState('internal');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!org) return;
    setAudio(org.settings.privacy.audio); setTranscript(org.settings.privacy.transcript); setMax(org.settings.privacy.max_classification_external);
  }, [org]);
  if (!org || !system) return null;
  const toggle = (list: string[], set: (v: string[]) => void, p: string) => set(list.includes(p) ? list.filter((x) => x !== p) : [...list, p]);
  const save = async () => {
    try { await api.put('/api/org/privacy', { audio, transcript, max_classification_external: max }); setMsg('حُفظ'); } catch (e) { setError((e as Error).message); }
  };
  return (
    <div className="card">
      <h2>الخصوصية والمعالجة الخارجية</h2>
      <p className="muted small">لا يُرسل أي تسجيل أو نص إلى مزوّد خارجي إلا إذا سمح به التشغيل (<span className="ltr">MAHDAR_ALLOWED_EXTERNAL_PROVIDERS</span>) وسمحت به المؤسسة هنا
        لنوع البيانات، وكان تصنيف الاجتماع لا يتجاوز الحد المحدد. كل معالجة تُسجَّل في سجل المعالجة.</p>
      <p className="small">المسموح به في هذا التشغيل: {system.allowed_external_providers.length ? <span className="ltr">{system.allowed_external_providers.join(', ')}</span> : 'لا شيء (معالجة محلية فقط)'}</p>
      {error && <div className="alert bad">{error}</div>}
      <div className="grid2">
        <fieldset><legend>التسجيل الصوتي يُرسل إلى</legend>
          {system.known_external_providers.map((p) => <label key={p} className="row small"><input type="checkbox" checked={audio.includes(p)} onChange={() => toggle(audio, setAudio, p)} /> <span className="ltr">{p}</span></label>)}
        </fieldset>
        <fieldset><legend>النص المفرغ يُرسل إلى</legend>
          {system.known_external_providers.map((p) => <label key={p} className="row small"><input type="checkbox" checked={transcript.includes(p)} onChange={() => toggle(transcript, setTranscript, p)} /> <span className="ltr">{p}</span></label>)}
        </fieldset>
      </div>
      <label className="field" style={{ maxWidth: 360, marginTop: '0.8rem' }}>أعلى تصنيف يُسمح بمعالجته خارجياً
        <select value={max} onChange={(e) => setMax(e.target.value)}>{Object.entries(CLASSIFICATION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      </label>
      <div className="row" style={{ marginTop: '0.8rem' }}><button className="btn primary" onClick={save}>حفظ</button><Saved msg={msg} /></div>
    </div>
  );
}

function Retention() {
  const { org } = useOrg();
  const [v, setV] = useState({ audio_days: '', transcript_days: '', documents_days: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!org) return;
    const r = org.settings.retention;
    setV({ audio_days: r.audio_days?.toString() ?? '', transcript_days: r.transcript_days?.toString() ?? '', documents_days: r.documents_days?.toString() ?? '' });
  }, [org]);
  if (!org) return null;
  const num = (s: string) => (s.trim() ? Number(s) : null);
  const save = async () => {
    try { await api.put('/api/org/retention', { audio_days: num(v.audio_days), transcript_days: num(v.transcript_days), documents_days: num(v.documents_days) }); setMsg('حُفظ'); }
    catch (e) { setError((e as Error).message); }
  };
  return (
    <div className="card">
      <h2>مدة الاحتفاظ بالبيانات</h2>
      <p className="muted small">تُحذف البيانات تلقائياً بعد انقضاء المدة (بالأيام من تاريخ الرفع). اترك الحقل فارغاً للاحتفاظ حتى الحذف اليدوي. يبقى سجل التدقيق.</p>
      {error && <div className="alert bad">{error}</div>}
      <div className="grid3">
        <label className="field">التسجيلات الصوتية<input type="number" min={1} value={v.audio_days} onChange={(e) => setV({ ...v, audio_days: e.target.value })} /></label>
        <label className="field">النصوص والتحليلات<input type="number" min={1} value={v.transcript_days} onChange={(e) => setV({ ...v, transcript_days: e.target.value })} /></label>
        <label className="field">المستندات المصدرة<input type="number" min={1} value={v.documents_days} onChange={(e) => setV({ ...v, documents_days: e.target.value })} /></label>
      </div>
      <div className="row" style={{ marginTop: '0.8rem' }}><button className="btn primary" onClick={save}>حفظ</button><Saved msg={msg} /></div>
    </div>
  );
}

const GATE_LABELS: Record<string, string> = {
  max_low_confidence_word_ratio: 'أقصى نسبة لكلمات منخفضة الثقة',
  min_evidence_coverage: 'أدنى نسبة لبنود بأدلة مطابقة',
  max_unverified_critical: 'أقصى عدد لملاحظات حرجة مفتوحة',
  max_potential_omissions: 'أقصى عدد لمواضع إغفال محتملة',
};

function Gates() {
  const { org } = useOrg();
  const [g, setG] = useState<Record<string, number>>({});
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (org) setG(org.settings.quality_gates); }, [org]);
  if (!org) return null;
  return (
    <div className="card">
      <h2>بوابات الجودة</h2>
      <p className="muted small">أي محضر لا يستوفي هذه البوابات يُوسَم «مسودة تتطلب المراجعة» ولا يمكن اعتماده.</p>
      <div className="grid2">
        {Object.keys(GATE_LABELS).map((k) => (
          <label key={k} className="field">{GATE_LABELS[k]}
            <input type="number" step="0.01" value={g[k] ?? ''} onChange={(e) => setG({ ...g, [k]: Number(e.target.value) })} />
          </label>
        ))}
      </div>
      <div className="row" style={{ marginTop: '0.8rem' }}>
        <button className="btn primary" onClick={() => api.put('/api/org/quality-gates', g).then(() => setMsg('حُفظ'))}>حفظ</button><Saved msg={msg} />
      </div>
    </div>
  );
}

function Branding() {
  const { org } = useOrg();
  const [name, setName] = useState('');
  const [footer, setFooter] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (org) { setName(org.settings.branding.org_name_ar ?? ''); setFooter(org.settings.branding.footer_text ?? ''); } }, [org]);
  if (!org) return null;
  const upload = async (file: File) => {
    const f = new FormData(); f.append('file', file);
    try { await api.upload('/api/org/logo', f); setMsg('رُفع الشعار'); } catch (e) { setError((e as Error).message); }
  };
  return (
    <div className="card">
      <h2>هوية المستندات</h2>
      {error && <div className="alert bad">{error}</div>}
      <div className="grid3">
        <label className="field">اسم الجهة في رأس المحضر<input type="text" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field">نص التذييل<input type="text" value={footer} onChange={(e) => setFooter(e.target.value)} /></label>
        <label className="field">الشعار (PNG أو JPEG)<input type="file" accept="image/png,image/jpeg" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} /></label>
      </div>
      <div className="row" style={{ marginTop: '0.8rem' }}>
        <button className="btn primary" onClick={() => api.put('/api/org/branding', { org_name_ar: name || null, footer_text: footer || null }).then(() => setMsg('حُفظ'))}>حفظ</button>
        <Saved msg={msg} />
      </div>
    </div>
  );
}

function Users() {
  const [users, setUsers] = useState<User[]>([]);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('editor');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const load = () => api.get<User[]>('/api/users').then(setUsers).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  const add = async () => {
    try { await api.post('/api/users', { email, name, role, password }); setEmail(''); setName(''); setPassword(''); load(); } catch (e) { setError((e as Error).message); }
  };
  const patch = async (id: string, body: object) => { try { await api.patch(`/api/users/${id}`, body); load(); } catch (e) { setError((e as Error).message); } };
  return (
    <div className="card">
      <h2>المستخدمون والصلاحيات</h2>
      {error && <div className="alert bad">{error}</div>}
      <div className="row" style={{ alignItems: 'flex-end', marginBottom: '0.8rem' }}>
        <label className="field">الاسم<input type="text" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field">البريد<input type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="field">الصلاحية<select value={role} onChange={(e) => setRole(e.target.value as Role)}>{Object.entries(ROLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="field">كلمة مرور مؤقتة (12 حرفاً على الأقل)<input type="password" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <button className="btn primary" disabled={!email || !name || password.length < 12} onClick={add}>إضافة</button>
      </div>
      <table className="data">
        <thead><tr><th>الاسم</th><th>البريد</th><th>الصلاحية</th><th>آخر دخول</th><th>الحالة</th></tr></thead>
        <tbody>{users.map((u) => (
          <tr key={u.id}>
            <td>{u.name}</td><td className="ltr">{u.email}</td>
            <td><select value={u.role} onChange={(e) => patch(u.id, { role: e.target.value })}>{Object.entries(ROLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td>
            <td className="small">{fmtDate(u.last_login_at)}</td>
            <td><button className={`btn small ${u.active ? '' : 'ok'}`} onClick={() => patch(u.id, { active: !u.active })}>{u.active ? 'تعطيل' : 'تفعيل'}</button></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}
