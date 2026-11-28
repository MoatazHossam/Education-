import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { useSession } from '../App';
import type { Me } from '../types';

export default function Login() {
  const { setMe } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/login', { email, password });
      setMe(await api.get<Me>('/api/auth/me'));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login card">
      <h1>مَحضَر</h1>
      <p className="muted">محاضر اجتماعات عربية رسمية، كل ما فيها مستند إلى التسجيل.</p>
      {error && <div className="alert bad" role="alert">{error}</div>}
      <form onSubmit={submit} className="grid" style={{ display: 'grid', gap: '0.9rem' }}>
        <label className="field">البريد الإلكتروني
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" />
        </label>
        <label className="field">كلمة المرور
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} dir="ltr" />
        </label>
        <button className="btn primary" disabled={busy} type="submit">{busy ? 'جارٍ الدخول…' : 'دخول'}</button>
      </form>
    </div>
  );
}
